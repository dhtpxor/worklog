// src/guarantee.js — 진품 보증: 견적, 발행, 청구, 손해율, 자동 판매 중단(킬 스위치)
//
// 주의: 이 보증이 보험업법상 보험 상품에 해당하는지는 확인되지 않았다. 운영 전 법률 검토가 필요하며,
// 결과에 따라 보험사 제휴 상품으로 바꾸고 이 모듈은 요율·판정 엔진으로만 쓸 수 있다.
import { newId, nowIso } from "./store.js";

export const DEFAULT_GUARANTEE_SETTINGS = {
  enabled_categories: ["sneakers"],
  max_score: 25, // 이 점수 미만만 보증 가능 (검수사 진품 판정 시 예외)
  min_fee_krw: 1000,
  term_days: 365,
  kill_switch: { min_issued: 30, max_loss_ratio: 0.5 },
  suspended_categories: [],
};

function bandMultiplier(score) {
  if (score < 10) return 0.8;
  if (score < 20) return 1.0;
  return 1.3;
}

/**
 * @returns {{eligible:boolean, reasons:string[], rate_bps?:number, fee_krw?:number, coverage_krw?:number}}
 */
export function quote({ caseDoc, category, settings, verdict }) {
  const reasons = [];
  const price = Number(caseDoc.listing?.price) || 0;
  const a = caseDoc.assessment;
  const inspectorAuthentic = verdict?.verdict === "authentic";
  if (!settings.enabled_categories.includes(category.id)) reasons.push("이 카테고리는 보증 대상이 아닙니다");
  if (settings.suspended_categories.includes(category.id)) reasons.push("손해율 기준 초과로 이 카테고리 보증이 일시 중단됐습니다");
  if (!a) reasons.push("아직 판정 전입니다");
  if (verdict && verdict.verdict !== "authentic") reasons.push("검수 결과가 진품이 아닙니다");
  if (a && !inspectorAuthentic) {
    if (!a.complete) reasons.push("필수 촬영 부위가 빠졌습니다");
    if (!a.ai_assessed) reasons.push("AI 분석이 없는 건은 검수사 진품 판정 후에만 보증할 수 있습니다");
    if (a.hard_flags?.length) reasons.push("검수사 확인이 필요한 위험 신호가 있습니다");
    if (a.score >= settings.max_score) reasons.push(`위험 점수 ${a.score}점은 보증 기준(${settings.max_score}점 미만)을 넘습니다`);
  }
  if (price <= 0) reasons.push("거래 가격이 없습니다");
  if (price > category.guarantee.max_coverage_krw) reasons.push(`보증 한도(${category.guarantee.max_coverage_krw.toLocaleString("ko-KR")}원)를 넘는 가격입니다`);
  if (caseDoc.guarantee_id) reasons.push("이미 보증이 발행된 건입니다");
  if (reasons.length) return { eligible: false, reasons };

  const mult = inspectorAuthentic ? 0.7 : bandMultiplier(a.score);
  const rate_bps = Math.round(category.guarantee.base_rate_bps * mult);
  const fee_krw = Math.max(settings.min_fee_krw, Math.round((price * rate_bps) / 10000));
  return { eligible: true, reasons: [], rate_bps, fee_krw, coverage_krw: price, basis: inspectorAuthentic ? "inspector_authentic" : "risk_score" };
}

export function issue({ store, tenantId, caseDoc, q, payer, termDays }) {
  const now = new Date();
  const g = store.insert("guarantees", {
    id: newId("gtee"),
    tenant_id: tenantId,
    case_id: caseDoc.id,
    category: caseDoc.category,
    unit_id: caseDoc.unit_id || null,
    payer: payer === "buyer" ? "buyer" : "platform",
    rate_bps: q.rate_bps,
    fee_krw: q.fee_krw,
    coverage_krw: q.coverage_krw,
    basis: q.basis,
    status: "active",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + termDays * 86400_000).toISOString(),
  });
  store.update("cases", caseDoc.id, { guarantee_id: g.id });
  return g;
}

export function openClaim({ store, tenantId, guarantee, reason }) {
  if (guarantee.status !== "active") throw Object.assign(new Error("유효한 보증이 아닙니다"), { status: 409 });
  if (new Date(guarantee.expires_at) < new Date()) throw Object.assign(new Error("보증 기간이 끝났습니다"), { status: 409 });
  if (store.find("claims", (c) => c.guarantee_id === guarantee.id && c.status === "reinspection")) throw Object.assign(new Error("이미 처리 중인 청구가 있습니다"), { status: 409 });
  const c = store.insert("claims", { id: newId("clm"), tenant_id: tenantId, guarantee_id: guarantee.id, case_id: guarantee.case_id, category: guarantee.category, reason: String(reason || "").slice(0, 2000), status: "reinspection", opened_at: nowIso() });
  store.update("guarantees", guarantee.id, { status: "claimed" });
  return c;
}

/** outcome: counterfeit_confirmed → 보증금 지급, not_confirmed → 기각 */
export function resolveClaim({ store, claim, outcome, note, resolver }) {
  if (claim.status !== "reinspection") throw Object.assign(new Error("이미 처리된 청구입니다"), { status: 409 });
  if (!["counterfeit_confirmed", "not_confirmed"].includes(outcome)) throw Object.assign(new Error("outcome 값이 올바르지 않습니다"), { status: 400 });
  const g = store.get("guarantees", claim.guarantee_id);
  const paid = outcome === "counterfeit_confirmed";
  const c = store.update("claims", claim.id, { status: paid ? "paid" : "denied", outcome, payout_krw: paid ? g.coverage_krw : 0, note: String(note || "").slice(0, 2000), resolved_by: resolver, resolved_at: nowIso() });
  store.update("guarantees", g.id, { status: paid ? "paid_out" : "active" });
  return c;
}

export function lossRatios(store, tenantId) {
  const out = {};
  for (const g of store.list("guarantees", (x) => x.tenant_id === tenantId)) {
    const r = (out[g.category] ||= { issued: 0, fees_krw: 0, paid_krw: 0, open_claims: 0 });
    r.issued++;
    r.fees_krw += g.fee_krw;
  }
  for (const c of store.list("claims", (x) => x.tenant_id === tenantId)) {
    const r = (out[c.category] ||= { issued: 0, fees_krw: 0, paid_krw: 0, open_claims: 0 });
    if (c.status === "paid") r.paid_krw += c.payout_krw;
    if (c.status === "reinspection") r.open_claims++;
  }
  for (const r of Object.values(out)) r.loss_ratio = r.fees_krw ? Math.round((r.paid_krw / r.fees_krw) * 1000) / 1000 : 0;
  return out;
}

/** 손해율이 기준을 넘은 카테고리를 자동 중단. 바뀐 카테고리 목록을 돌려준다. */
export function applyKillSwitch({ store, tenant }) {
  const s = tenant.settings.guarantee;
  const ratios = lossRatios(store, tenant.id);
  const newly = [];
  for (const [cat, r] of Object.entries(ratios)) {
    if (r.issued >= s.kill_switch.min_issued && r.loss_ratio > s.kill_switch.max_loss_ratio && !s.suspended_categories.includes(cat)) newly.push(cat);
  }
  if (newly.length) {
    const settings = { ...tenant.settings, guarantee: { ...s, suspended_categories: [...s.suspended_categories, ...newly] } };
    store.update("tenants", tenant.id, { settings });
  }
  return newly;
}
