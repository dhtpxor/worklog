// src/engine.js — 상품 정보 → 검사 결과. 규칙 기반 검사 + (선택) AI 분석 결과 병합.
import { normalize, findAll, findAny, snippet } from "./text.js";
import { BRANDS, COMPAT_MARKERS } from "./rules/brands.js";
import { RULES, KEYWORDS, SEVERITY_ORDER } from "./rules/catalog.js";

export const DEFAULT_SETTINGS = { food_agency_registered: false };

const IMITATION_SUFFIX = /^\s*(st|스타일|style|风|風|系|っぽい|ライク)(?![a-z])/;

class Findings {
  constructor() { this.map = new Map(); }
  add(ruleId, evidence) {
    const rule = RULES[ruleId];
    if (!rule) throw new Error(`unknown rule ${ruleId}`);
    const cur = this.map.get(ruleId) || { rule_id: ruleId, ...rule, evidence: [] };
    if (evidence && !cur.evidence.some((e) => e.text === evidence.text && e.source === evidence.source)) cur.evidence.push(evidence);
    this.map.set(ruleId, cur);
  }
  has(ruleId) { return this.map.has(ruleId); }
  list() { return [...this.map.values()]; }
}

/** 텍스트 필드별로 규칙을 돌린다. fields: [{source:"title"|"description"|..., text}] */
export function textChecks(fields, settings = DEFAULT_SETTINGS) {
  const f = new Findings();
  const brandsFound = new Map();
  let dupeStrong = [], dupeWeak = [];

  for (const field of fields) {
    const text = normalize(field.text);
    if (!text) continue;
    const ev = (hit, extra = {}) => ({ source: field.source, text: snippet(text, hit), keyword: hit.keyword, ...extra });

    for (const b of BRANDS) {
      for (const alias of b.aliases) {
        for (const hit of findAll(text, alias)) {
          const around = text.slice(Math.max(0, hit.index - 12), hit.index + hit.length + 14);
          const compat = COMPAT_MARKERS.some((m) => around.includes(normalize(m)));
          const imitation = IMITATION_SUFFIX.test(text.slice(hit.index + hit.length));
          const rec = brandsFound.get(b.id) || { brand: b, hits: [] };
          rec.hits.push({ ...ev(hit, { brand: b.name }), compat, imitation });
          brandsFound.set(b.id, rec);
        }
      }
    }
    dupeStrong = dupeStrong.concat(findAny(text, KEYWORDS.DUPE_STRONG).map((h) => ev(h)));
    dupeWeak = dupeWeak.concat(findAny(text, KEYWORDS.DUPE_WEAK).map((h) => ev(h)));

    const group = (key, ruleId) => { for (const h of findAny(text, KEYWORDS[key])) f.add(ruleId, ev(h)); };
    group("ELECTRIC", "KC_ELECTRIC");
    group("WIRELESS", "KC_WIRELESS");
    group("CHILDREN", "KC_CHILDREN");
    group("BANNED", "BANNED_INGREDIENT");
    group("DRUG", "DRUG");
    group("QUASI_DRUG", "QUASI_DRUG");
    group("SEED", "SEED_PLANT");
    group("MEAT", "MEAT");
    group("CANNABIS", "CANNABIS");
    group("WEAPON", "WEAPON_LIKE");
    group("FIREWORKS", "FIREWORKS");
    group("NICOTINE", "NICOTINE");
    for (const h of findAny(text, KEYWORDS.FOOD)) f.add(settings.food_agency_registered ? "FOOD_REGISTRATION" : "FOOD_NOT_REGISTERED", ev(h));
    if (findAny(text, KEYWORDS.OFFICIAL_CLAIM).length && brandsFound.size) {
      for (const h of findAny(text, KEYWORDS.OFFICIAL_CLAIM)) f.add("TM_OFFICIAL_CLAIM", ev(h));
    }
  }

  // 상표 판단: 모방 표현과 함께면 block, 호환 표기면 info, 그 외 review
  const anyDupe = dupeStrong.length + dupeWeak.length > 0;
  for (const { brand, hits } of brandsFound.values()) {
    const imitationHits = hits.filter((h) => h.imitation);
    if (imitationHits.length || anyDupe) {
      for (const h of imitationHits.length ? imitationHits : hits.slice(0, 2)) f.add("TM_IMITATION", strip(h));
      for (const d of [...dupeStrong, ...dupeWeak].slice(0, 3)) f.add("TM_IMITATION", d);
      continue;
    }
    if (hits.every((h) => h.compat)) { f.add("TM_COMPAT", strip(hits[0])); continue; }
    f.add(brand.kind === "character" ? "TM_CHARACTER" : "TM_MENTION", strip(hits.find((h) => !h.compat) || hits[0]));
  }
  if (!brandsFound.size && dupeStrong.length) for (const d of dupeStrong.slice(0, 3)) f.add("DUPE_LANGUAGE", d);
  if (!brandsFound.size && dupeWeak.length) for (const d of dupeWeak.slice(0, 3)) f.add("DUPE_LANGUAGE", d);

  // 금지 성분이 있으면 식품 등록 여부와 무관하게 판매 불가가 우선
  return { findings: f, brands: [...brandsFound.values()].map((r) => r.brand.name) };
}

function strip(h) {
  const { compat, imitation, ...rest } = h;
  return rest;
}

const AI_CATEGORY_RULE = {
  electrical: "KC_ELECTRIC", wireless: "KC_WIRELESS", children: "KC_CHILDREN", drug: "DRUG", quasi_drug: "QUASI_DRUG",
  seeds_plants: "SEED_PLANT", meat: "MEAT", cannabis: "CANNABIS", weapon_like: "WEAPON_LIKE", fireworks: "FIREWORKS", nicotine: "NICOTINE",
};

/** AI 분석 결과를 같은 규칙 체계로 합친다 */
export function mergeAi(findings, ai, settings = DEFAULT_SETTINGS) {
  if (!ai) return;
  const evAi = (text) => ({ source: "ai", text });
  for (const c of ai.product_categories || []) {
    if (c === "food" || c === "supplement") findings.add(settings.food_agency_registered ? "FOOD_REGISTRATION" : "FOOD_NOT_REGISTERED", evAi(`AI 분류: ${c === "food" ? "식품" : "건강기능식품·보충제"}`));
    else if (AI_CATEGORY_RULE[c]) findings.add(AI_CATEGORY_RULE[c], evAi(`AI 분류: ${c}`));
  }
  for (const b of ai.brands || []) {
    const where = b.source === "image" ? "이미지" : "텍스트";
    if (b.usage === "imitation_reference") findings.add("TM_IMITATION", evAi(`${where}에서 '${b.name}'을(를) 모방 대상으로 언급`));
    else if (b.usage === "compatible_with") { if (!findings.has("TM_MENTION") && !findings.has("TM_IMITATION")) findings.add("TM_COMPAT", evAi(`${where}: '${b.name}' 호환 표기`)); }
    else findings.add("TM_MENTION", evAi(`${where}에서 상표 '${b.name}' 발견 — 사전에 없는 상표면 키프리스에서 등록 여부를 확인하세요`));
  }
  for (const ch of ai.characters || []) findings.add("TM_CHARACTER", evAi(`${ch.source === "image" ? "이미지" : "텍스트"}에서 캐릭터 '${ch.name}' 발견`));
  for (const ing of ai.ingredients_of_concern || []) findings.add("BANNED_INGREDIENT", evAi(`AI가 짚은 성분: ${ing}`));
  if (ai.foreign_shop_branding) findings.add("IMAGE_WATERMARK", evAi("이미지에 원 판매처 로고·워터마크로 보이는 표시"));
  // 호환 표기만 있던 상표가 AI 에서 로고로도 발견되면 호환 안내를 지운다
  if (findings.has("TM_IMITATION") || findings.has("TM_MENTION")) findings.map.delete("TM_COMPAT");
}

export function summarize(findings) {
  const checks = findings.list().map((c) => ({
    rule_id: c.rule_id,
    area: c.area,
    severity: c.severity,
    title: c.title,
    action: c.action,
    basis: c.basis,
    confidence: c.confidence,
    needs_confirmation: c.confidence !== "official",
    evidence: c.evidence.slice(0, 5),
  }));
  checks.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.area.localeCompare(b.area));
  const top = checks[0]?.severity;
  const verdict = top === "block" ? "block" : top === "review" ? "review" : "ok";
  return { verdict, checks, required_notices: notices(checks) };
}

/** 표시 의무 안내 (전안법 구매대행 고지). 문구는 국가기술표준원 안내를 요약한 것으로, 게시 전 원문 대조가 필요하다. */
function notices(checks) {
  const out = [];
  if (checks.some((c) => c.rule_id === "KC_ELECTRIC") && !checks.some((c) => c.severity === "block")) {
    out.push({
      rule_id: "KC_ELECTRIC",
      text: "KC 마크가 없는 경우: 구매대행을 통해 유통되는 제품이며, 「전기용품 및 생활용품 안전관리법」에 따른 안전관리대상 제품임을 상품별로 고지. KC 마크가 있는 경우: \"이 제품은 구매대행을 통하여 유통되는 제품임\" 문구와 KC 마크, 안전인증번호 또는 안전확인신고번호를 표시.",
      verify_at: "https://www.kats.go.kr/content.do?cmsid=227",
    });
  }
  return out;
}
