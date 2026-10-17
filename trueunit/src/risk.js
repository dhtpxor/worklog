// src/risk.js — 위험 점수 (0~100). 항목별 가산점의 합이며, 모든 점수에 근거(evidence)가 붙는다.
// 판정이 아니라 "사람이 볼 우선순위"다. 자동 결론은 pass(저위험) 또는 escalate(검수 필요) 두 가지뿐이고,
// 가품 확정은 언제나 사람이 한다.

export const DEFAULT_RISK_SETTINGS = {
  auto_pass_below: 25, // 이 점수 미만 + AI 분석 완료 + 필수 체크포인트 완비 → 자동 통과
  priority_at: 60, // 이 점수 이상이면 우선 검수
  audit_rate: 0.05, // 자동 통과 건 중 품질 감사를 위해 사람에게 보내는 비율
};

// 점수와 관계없이 자동 통과를 막는 신호 (하나만 있어도 사람이 본다)
export const HARD_FLAGS = new Set(["reused_photo", "seller_confirmed_counterfeit", "price_far_below_market"]);

const ANOMALY_SCORE = { none: 0, minor: 0.35, major: 1, cannot_assess: 0.3 };
const AI_MAX_POINTS = 70;

/**
 * @param {object} p
 * @param {object} p.category
 * @param {Record<string,{quality:{ok:boolean,score:number}}>} p.bestImages 체크포인트별 대표 이미지
 * @param {null|{checkpoints:any[]}} p.ai
 * @param {{price?:number, market_price?:number}} p.listing
 * @param {{account_age_days?:number, past_disputes?:number, completed_sales?:number, confirmed_counterfeits?:number}} p.seller
 * @param {{checkpoint:string, other_case_id:string, distance:number}[]} p.duplicates
 * @param {number|null} p.learnedMedianPrice 같은 모델 과거 거래 중앙값(표본 5건 이상일 때)
 * @param {object} p.settings
 * @param {() => number} [p.random]
 */
export function scoreCase({ category, bestImages, ai, listing = {}, seller = {}, duplicates = [], learnedMedianPrice = null, settings = DEFAULT_RISK_SETTINGS, random = Math.random }) {
  const evidence = [];
  const add = (code, points, message, extra = {}) => { evidence.push({ code, points: Math.round(points * 10) / 10, message, ...extra }); };

  // 1) 필수 체크포인트 누락
  const missing = category.checkpoints.filter((c) => c.required && !bestImages[c.id]).map((c) => c.id);
  for (const id of missing) add("missing_checkpoint", 4, `필수 촬영 부위 누락: ${label(category, id)}`, { checkpoint: id });

  // 2) 촬영 품질
  for (const [cp, img] of Object.entries(bestImages)) {
    if (!img.quality.ok) add("poor_quality", 2, `사진 품질 미달: ${label(category, cp)}`, { checkpoint: cp });
  }

  // 3) AI 체크포인트 관찰
  let aiAssessed = false;
  if (ai && ai.checkpoints?.length) {
    aiAssessed = true;
    const wTotal = category.checkpoints.reduce((s, c) => s + c.weight, 0);
    for (const c of ai.checkpoints) {
      const cp = category.checkpoints.find((x) => x.id === c.checkpoint_id);
      if (!cp) continue;
      const base = ANOMALY_SCORE[c.anomaly] ?? 0.3;
      if (base === 0) continue;
      const eff = c.anomaly === "cannot_assess" ? base : base * (0.5 + 0.5 * c.confidence);
      const pts = (AI_MAX_POINTS * cp.weight * eff) / wTotal * 2.6; // 주요 부위 두 곳이 major 면 우선 검수 구간(60점)에 닿도록 보정
      const kind = c.anomaly === "major" ? "큰 이상" : c.anomaly === "minor" ? "작은 차이" : "판단 불가";
      add(`ai_${c.anomaly}`, pts, `${label(category, cp.id)} — ${kind}: ${c.observations}`, { checkpoint: cp.id, confidence: c.confidence });
    }
  } else {
    add("ai_unavailable", 0, "AI 분석을 하지 않았습니다. 사람 검수가 필요합니다.");
  }

  // 4) 가격 이상치
  const ref = Number(listing.market_price) > 0 ? Number(listing.market_price) : learnedMedianPrice;
  const price = Number(listing.price);
  if (ref && price > 0) {
    const ratio = price / ref;
    if (ratio < 0.4) add("price_far_below_market", 25, `시세 대비 ${Math.round(ratio * 100)}% 가격 (기준 ${fmtKrw(ref)})`);
    else if (ratio < 0.6) add("price_below_market", 14, `시세 대비 ${Math.round(ratio * 100)}% 가격 (기준 ${fmtKrw(ref)})`);
  }

  // 5) 판매자 신호
  if (seller.confirmed_counterfeits > 0) add("seller_confirmed_counterfeit", 22, `판매자의 과거 가품 확정 이력 ${seller.confirmed_counterfeits}건`);
  const sales = Math.max(1, Number(seller.completed_sales) || 0);
  if (seller.past_disputes > 0 && seller.past_disputes / sales >= 0.1) add("seller_dispute_rate", 8, `판매자 분쟁 비율 높음 (${seller.past_disputes}/${sales})`);
  if (Number.isFinite(seller.account_age_days) && seller.account_age_days < 30) add("new_seller_account", 6, `신규 계정 (${seller.account_age_days}일)`);

  // 6) 다른 거래와 같은 사진
  const dupCases = [...new Set(duplicates.map((d) => d.other_case_id))];
  if (dupCases.length) add("reused_photo", 20, `다른 거래(${dupCases.length}건)에 올라온 사진과 거의 같습니다. 남의 사진을 쓴 것일 수 있습니다.`, { cases: dupCases });

  const raw = evidence.reduce((s, e) => s + e.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const band = score >= settings.priority_at ? "high" : score >= settings.auto_pass_below ? "medium" : "low";
  const complete = missing.length === 0;

  const hardFlags = evidence.filter((e) => HARD_FLAGS.has(e.code)).map((e) => e.code);
  let recommendation;
  let audit = false;
  if (!aiAssessed || !complete || (band === "low" && hardFlags.length)) recommendation = "escalate";
  else if (band === "low") {
    audit = random() < settings.audit_rate;
    recommendation = audit ? "escalate" : "pass";
  } else recommendation = band === "high" ? "escalate_priority" : "escalate";

  evidence.sort((a, b) => b.points - a.points);
  return { score, band, recommendation, ai_assessed: aiAssessed, complete, missing_checkpoints: missing, hard_flags: hardFlags, audit_sample: audit, evidence };
}

function label(category, id) {
  return category.checkpoints.find((c) => c.id === id)?.label || id;
}

export function fmtKrw(n) {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}
