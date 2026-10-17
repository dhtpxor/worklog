import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { createTenant } from "../src/auth.js";
import { getCategory } from "../src/catalog.js";
import { quote, issue, openClaim, resolveClaim, lossRatios, applyKillSwitch } from "../src/guarantee.js";

function setup() {
  const store = new Store();
  const tenant = createTenant(store, { name: "t" });
  return { store, tenant, cat: getCategory("sneakers") };
}
function mkCase(store, tenant, { score = 5, price = 200000, complete = true, ai = true, category = "sneakers" } = {}) {
  return store.insert("cases", { id: `case_${Math.random().toString(36).slice(2)}`, tenant_id: tenant.id, category, listing: { price }, assessment: { score, complete, ai_assessed: ai } });
}

test("저위험 건 견적: 기본 요율 × 구간 배수", () => {
  const { store, tenant, cat } = setup();
  const q = quote({ caseDoc: mkCase(store, tenant, { score: 5 }), category: cat, settings: tenant.settings.guarantee });
  assert.equal(q.eligible, true);
  assert.equal(q.rate_bps, 160); // 200 × 0.8
  assert.equal(q.fee_krw, 3200);
});

test("점수 초과, 한도 초과, 비활성 카테고리는 보증 불가", () => {
  const { store, tenant, cat } = setup();
  assert.equal(quote({ caseDoc: mkCase(store, tenant, { score: 40 }), category: cat, settings: tenant.settings.guarantee }).eligible, false);
  assert.equal(quote({ caseDoc: mkCase(store, tenant, { price: 5_000_000 }), category: cat, settings: tenant.settings.guarantee }).eligible, false);
  const bag = getCategory("handbags");
  const r = quote({ caseDoc: mkCase(store, tenant, { category: "handbags" }), category: bag, settings: tenant.settings.guarantee });
  assert.equal(r.eligible, false);
  assert.match(r.reasons.join(), /보증 대상이 아닙니다/);
});

test("검수사 진품 판정이면 점수가 높아도 할인 요율로 보증", () => {
  const { store, tenant, cat } = setup();
  const q = quote({ caseDoc: mkCase(store, tenant, { score: 70, ai: false }), category: cat, settings: tenant.settings.guarantee, verdict: { verdict: "authentic" } });
  assert.equal(q.eligible, true);
  assert.equal(q.rate_bps, 140);
  assert.equal(q.basis, "inspector_authentic");
});

test("발행 → 청구 → 가품 확정 지급, 손해율 계산, 중복 청구 차단", () => {
  const { store, tenant, cat } = setup();
  const c = mkCase(store, tenant);
  const q = quote({ caseDoc: c, category: cat, settings: tenant.settings.guarantee });
  const g = issue({ store, tenantId: tenant.id, caseDoc: c, q, payer: "buyer", termDays: 365 });
  assert.equal(store.get("cases", c.id).guarantee_id, g.id);
  assert.equal(quote({ caseDoc: store.get("cases", c.id), category: cat, settings: tenant.settings.guarantee }).eligible, false);
  const claim = openClaim({ store, tenantId: tenant.id, guarantee: g, reason: "브랜드 매장 감정 결과 가품" });
  assert.throws(() => openClaim({ store, tenantId: tenant.id, guarantee: store.get("guarantees", g.id), reason: "x" }), /유효한 보증이 아닙니다/);
  const done = resolveClaim({ store, claim, outcome: "counterfeit_confirmed", resolver: "k" });
  assert.equal(done.payout_krw, 200000);
  const lr = lossRatios(store, tenant.id).sneakers;
  assert.equal(lr.paid_krw, 200000);
  assert.equal(lr.loss_ratio, Math.round((200000 / 3200) * 1000) / 1000);
});

test("기각되면 보증이 다시 유효해진다", () => {
  const { store, tenant, cat } = setup();
  const c = mkCase(store, tenant);
  const g = issue({ store, tenantId: tenant.id, caseDoc: c, q: quote({ caseDoc: c, category: cat, settings: tenant.settings.guarantee }), termDays: 365 });
  const claim = openClaim({ store, tenantId: tenant.id, guarantee: g, reason: "의심" });
  resolveClaim({ store, claim, outcome: "not_confirmed", resolver: "k" });
  assert.equal(store.get("guarantees", g.id).status, "active");
});

test("킬 스위치: 표본이 충분하고 손해율이 기준을 넘으면 카테고리 중단", () => {
  const { store, tenant, cat } = setup();
  store.update("tenants", tenant.id, { settings: { ...tenant.settings, guarantee: { ...tenant.settings.guarantee, kill_switch: { min_issued: 3, max_loss_ratio: 0.5 } } } });
  let t = store.get("tenants", tenant.id);
  const gs = [];
  for (let i = 0; i < 3; i++) {
    const c = mkCase(store, t);
    gs.push(issue({ store, tenantId: t.id, caseDoc: c, q: quote({ caseDoc: c, category: cat, settings: t.settings.guarantee }), termDays: 365 }));
  }
  assert.deepEqual(applyKillSwitch({ store, tenant: t }), []);
  resolveClaim({ store, claim: openClaim({ store, tenantId: t.id, guarantee: gs[0], reason: "x" }), outcome: "counterfeit_confirmed", resolver: "k" });
  t = store.get("tenants", tenant.id);
  assert.deepEqual(applyKillSwitch({ store, tenant: t }), ["sneakers"]);
  t = store.get("tenants", tenant.id);
  const q = quote({ caseDoc: mkCase(store, t), category: cat, settings: t.settings.guarantee });
  assert.equal(q.eligible, false);
  assert.match(q.reasons.join(), /일시 중단/);
});
