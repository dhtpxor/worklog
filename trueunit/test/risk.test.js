import test from "node:test";
import assert from "node:assert/strict";
import { scoreCase, DEFAULT_RISK_SETTINGS } from "../src/risk.js";
import { getCategory } from "../src/catalog.js";

const cat = getCategory("sneakers");
const allGood = () => Object.fromEntries(cat.checkpoints.map((c) => [c.id, { quality: { ok: true, score: 0.9 } }]));
const aiAll = (anomaly = "none", conf = 0.9, overrides = {}) => ({
  checkpoints: cat.checkpoints.map((c) => ({ checkpoint_id: c.id, image_usable: true, observations: "관찰", anomaly: overrides[c.id] || anomaly, confidence: conf, inspector_note: "" })),
});
const never = () => 0.99;

test("이상 없음 + 완비 + 정상 가격 → 저위험 자동 통과", () => {
  const r = scoreCase({ category: cat, bestImages: allGood(), ai: aiAll(), listing: { price: 150000, market_price: 160000 }, random: never });
  assert.equal(r.band, "low");
  assert.equal(r.recommendation, "pass");
  assert.equal(r.score, 0);
});

test("주요 부위 두 곳 major → 우선 검수", () => {
  const r = scoreCase({ category: cat, bestImages: allGood(), ai: aiAll("none", 0.9, { size_tag: "major", tongue_label: "major" }), random: never });
  assert.equal(r.band, "high", `score ${r.score}`);
  assert.equal(r.recommendation, "escalate_priority");
  assert.equal(r.evidence[0].code, "ai_major");
});

test("한 곳 major 는 검수로 보낸다", () => {
  const r = scoreCase({ category: cat, bestImages: allGood(), ai: aiAll("none", 0.9, { size_tag: "major" }), random: never });
  assert.equal(r.band, "medium", `score ${r.score}`);
  assert.equal(r.recommendation, "escalate");
});

test("AI 가 없으면 점수가 낮아도 사람 검수", () => {
  const r = scoreCase({ category: cat, bestImages: allGood(), ai: null, random: never });
  assert.equal(r.ai_assessed, false);
  assert.equal(r.recommendation, "escalate");
});

test("필수 부위 누락은 자동 통과하지 않는다", () => {
  const imgs = allGood();
  delete imgs.size_tag;
  const r = scoreCase({ category: cat, bestImages: imgs, ai: aiAll(), random: never });
  assert.deepEqual(r.missing_checkpoints, ["size_tag"]);
  assert.equal(r.recommendation, "escalate");
});

test("시세의 35% 가격 + 가품 이력 판매자 + 재사용 사진 → 우선 검수", () => {
  const r = scoreCase({
    category: cat, bestImages: allGood(), ai: aiAll(), random: never,
    listing: { price: 70000, market_price: 200000 },
    seller: { confirmed_counterfeits: 1, account_age_days: 3 },
    duplicates: [{ checkpoint: "overall_side", other_case_id: "case_x", distance: 2 }],
  });
  assert.ok(r.score >= DEFAULT_RISK_SETTINGS.priority_at, `score ${r.score}`);
  const codes = r.evidence.map((e) => e.code);
  for (const c of ["price_far_below_market", "seller_confirmed_counterfeit", "reused_photo", "new_seller_account"]) assert.ok(codes.includes(c), c);
});

test("학습된 중앙값 가격을 시세 대신 쓴다", () => {
  const r = scoreCase({ category: cat, bestImages: allGood(), ai: aiAll(), listing: { price: 50000 }, learnedMedianPrice: 100000, random: never });
  assert.ok(r.evidence.some((e) => e.code === "price_below_market"));
});

test("저위험이어도 감사 표본으로 뽑히면 사람에게 간다", () => {
  const r = scoreCase({ category: cat, bestImages: allGood(), ai: aiAll(), random: () => 0.01 });
  assert.equal(r.audit_sample, true);
  assert.equal(r.recommendation, "escalate");
});

test("점수는 0~100 으로 잘린다", () => {
  const r = scoreCase({ category: cat, bestImages: {}, ai: aiAll("major", 1), listing: { price: 1, market_price: 100 }, seller: { confirmed_counterfeits: 3, account_age_days: 1, past_disputes: 5, completed_sales: 5 }, duplicates: [{ other_case_id: "x" }], random: never });
  assert.equal(r.score, 100);
});

test("점수가 낮아도 재사용 사진·가품 이력 판매자는 자동 통과하지 않는다", () => {
  for (const extra of [{ duplicates: [{ checkpoint: "overall_side", other_case_id: "x", distance: 1 }] }, { seller: { confirmed_counterfeits: 1 } }]) {
    const r = scoreCase({ category: cat, bestImages: allGood(), ai: aiAll(), random: never, ...extra });
    assert.equal(r.band, "low", `score ${r.score}`);
    assert.equal(r.recommendation, "escalate");
    assert.equal(r.hard_flags.length, 1);
  }
});
