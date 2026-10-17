import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import { createHandler } from "../src/app.js";
import { createTenant, issueKey } from "../src/auth.js";
import { verifySignature } from "../src/webhooks.js";
import { getCategory } from "../src/catalog.js";
import { texture, scene, recapture, grayToJpeg, flat } from "./helpers.js";

/** 가짜 Claude: model_hint 에 FAKE 가 있으면 사이즈 태그·텅 라벨을 major 로 본다 */
function fakeClaude(calls) {
  const respond = (params) => {
    calls.push(params);
    const textBlocks = params.messages[0].content.filter((b) => b.type === "text").map((b) => b.text);
    const ids = textBlocks.map((t) => /^\[체크포인트 (\w+)/.exec(t)?.[1]).filter(Boolean);
    const fake = textBlocks[0].includes("FAKE");
    const out = {
      checkpoints: ids.map((id) => ({ checkpoint_id: id, image_usable: true, observations: `${id} 관찰`, anomaly: fake && ["size_tag", "tongue_label"].includes(id) ? "major" : "none", confidence: 0.9, inspector_note: "" })),
      overall_observation: fake ? "라벨 글꼴과 간격이 다릅니다" : "특이점 없음",
      recapture: [],
    };
    return { model: params.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }], usage: { input_tokens: 1000, output_tokens: 200 } };
  };
  return { beta: { messages: { create: async (p) => respond(p) } }, messages: { create: async (p) => respond(p) } };
}

async function startServer(t) {
  const store = new Store();
  const calls = [];
  const ctx = { cfg: loadConfig({ ANTHROPIC_API_KEY: "", PUBLIC_BASE_URL: "" }), store, aiClient: fakeClaude(calls), random: () => 0.99 };
  const server = http.createServer(createHandler(ctx));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const mkTenant = (name) => {
    const tenant = createTenant(store, { name });
    const k = (role) => issueKey(store, { tenantId: tenant.id, role }).key;
    return { tenant, platform: k("platform"), inspector: k("inspector"), admin: k("admin") };
  };
  const call = async (method, path, { key, body } = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: ct.includes("json") ? await res.json() : await res.arrayBuffer() };
  };
  return { ctx, store, calls, base, call, mkTenant };
}

const img = (seed, w = 900, h = 700) => grayToJpeg(scene(w, h, seed), 85).toString("base64");
const required = getCategory("sneakers").checkpoints.filter((c) => c.required).map((c) => c.id);

async function uploadAll(call, path, key, seedBase) {
  let i = 0;
  for (const cp of required) {
    const r = await call("POST", `${path}/images`, { key, body: { checkpoint: cp, image_base64: img(seedBase + i++) } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.image.quality.ok, true);
  }
}

test("정상 건: 판매자 촬영 링크로 올리고 제출 → AI 저위험 자동 통과 → 보증 발행", async (t) => {
  const { call, mkTenant, calls } = await startServer(t);
  const A = mkTenant("A");
  const created = await call("POST", "/v1/cases", { key: A.platform, body: { category: "sneakers", brand: "Nike", model_hint: "Dunk Low", external_ref: "order-1", listing: { price: 150000, market_price: 160000 }, seller: { id: "s1", account_age_days: 400, completed_sales: 50 } } });
  assert.equal(created.status, 201);
  const token = created.body.capture_url.split("/capture/")[1];
  assert.ok(token);

  const info = await call("GET", `/v1/capture/${token}`);
  assert.equal(info.status, 200);
  assert.equal(info.body.checkpoints.length, 8);

  // 흐린 사진은 품질 미달로 표시된다
  const blurry = await call("POST", `/v1/capture/${token}/images`, { body: { checkpoint: "size_tag", image_base64: grayToJpeg(flat(900, 700)).toString("base64") } });
  assert.equal(blurry.body.image.quality.ok, false);

  await uploadAll(call, `/v1/capture/${token}`, undefined, 1000);
  const sub = await call("POST", `/v1/capture/${token}/submit`);
  assert.equal(sub.status, 200);
  assert.deepEqual(Object.keys(sub.body).sort(), ["recapture", "status"]); // 판매자에게 점수는 숨김

  // AI 요청 형식 확인: 구조화 출력 + 이미지 블록 + 폴백
  const p = calls[0];
  assert.equal(p.output_config.format.type, "json_schema");
  assert.equal(p.fallbacks, "default");
  assert.ok(p.betas.includes("server-side-fallback-2026-07-01"));
  assert.equal(p.messages[0].content.filter((b) => b.type === "image").length, required.length);

  const got = await call("GET", `/v1/cases/${created.body.id}`, { key: A.platform });
  assert.equal(got.body.status, "passed");
  assert.equal(got.body.assessment.band, "low");

  const q = await call("POST", `/v1/cases/${created.body.id}/guarantee/quote`, { key: A.platform });
  assert.equal(q.body.eligible, true, JSON.stringify(q.body));
  const stale = await call("POST", `/v1/cases/${created.body.id}/guarantee`, { key: A.platform, body: { payer: "buyer", expected_fee_krw: q.body.fee_krw + 1 } });
  assert.equal(stale.status, 409);
  const g = await call("POST", `/v1/cases/${created.body.id}/guarantee`, { key: A.platform, body: { payer: "buyer", expected_fee_krw: q.body.fee_krw } });
  assert.equal(g.status, 201);
  assert.equal(g.body.coverage_krw, 150000);

  // 청구 → 검수사 처리
  const claim = await call("POST", `/v1/guarantees/${g.body.id}/claims`, { key: A.platform, body: { reason: "구매자가 가품 의심 신고" } });
  assert.equal(claim.status, 201);
  const resolved = await call("POST", `/v1/claims/${claim.body.id}/resolve`, { key: A.inspector, body: { outcome: "not_confirmed", note: "재검수 결과 정품" } });
  assert.equal(resolved.body.claim.status, "denied");
});

test("의심 건: 우선 검수 큐 → 검수사 가품 판정 → 웹훅 서명 검증", async (t) => {
  const { call, mkTenant, store } = await startServer(t);
  const A = mkTenant("A");
  const received = [];
  const hook = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { received.push({ sig: req.headers["x-trueunit-signature"], body: b }); res.end("ok"); }); });
  await new Promise((r) => hook.listen(0, r));
  t.after(() => hook.close());
  const set = await call("PATCH", "/v1/settings", { key: A.admin, body: { webhook: { url: `http://127.0.0.1:${hook.address().port}/hook` } } });
  assert.equal(set.status, 200);

  const c = await call("POST", "/v1/cases", { key: A.platform, body: { category: "sneakers", brand: "Nike", model_hint: "Jordan 1 FAKE", listing: { price: 60000, market_price: 250000 } } });
  await uploadAll(call, `/v1/cases/${c.body.id}`, A.platform, 2000);
  const sub = await call("POST", `/v1/cases/${c.body.id}/submit`, { key: A.platform });
  assert.equal(sub.body.status, "in_review");
  assert.equal(sub.body.assessment.recommendation, "escalate_priority");
  assert.ok(sub.body.assessment.evidence.some((e) => e.code === "price_far_below_market"));

  const queue = await call("GET", "/v1/queue", { key: A.inspector });
  assert.equal(queue.body.cases[0].id, c.body.id);
  const detail = await call("GET", `/v1/review/cases/${c.body.id}`, { key: A.inspector });
  assert.equal(detail.body.ai.observation, "라벨 글꼴과 간격이 다릅니다");
  const image = await call("GET", `/v1/images/${detail.body.images[0].id}`, { key: A.inspector });
  assert.equal(image.status, 200);
  assert.ok(image.body.byteLength > 1000);

  const noFlag = await call("POST", `/v1/review/cases/${c.body.id}/verdict`, { key: A.inspector, body: { verdict: "counterfeit" } });
  assert.equal(noFlag.status, 400);
  const v = await call("POST", `/v1/review/cases/${c.body.id}/verdict`, { key: A.inspector, body: { verdict: "counterfeit", flagged_checkpoints: ["size_tag"], note: "사이즈 태그 폰트 상이" } });
  assert.equal(v.status, 200);
  assert.equal(v.body.case.status, "counterfeit");
  const q = await call("POST", `/v1/cases/${c.body.id}/guarantee/quote`, { key: A.platform });
  assert.equal(q.body.eligible, false);

  await store.flush();
  await new Promise((r) => setTimeout(r, 200));
  const types = received.map((r) => JSON.parse(r.body).type);
  assert.ok(types.includes("case.assessed") && types.includes("case.verdict"), types.join());
  const secret = store.get("tenants", A.tenant.id).settings.webhook.secret;
  for (const r of received) assert.equal(verifySignature(secret, r.sig, r.body), true);
  assert.equal(verifySignature("wrong", received[0].sig, received[0].body), false);

  const m = await call("GET", "/v1/metrics", { key: A.admin });
  assert.equal(m.body.quality.counterfeit_caught_in_medium_or_high_pct, 100);
});

test("같은 사진을 다른 판매자가 쓰면 재사용 사진으로 표시 (다른 플랫폼 건 id 는 숨김)", async (t) => {
  const { call, mkTenant } = await startServer(t);
  const A = mkTenant("A"), B = mkTenant("B");
  const c1 = await call("POST", "/v1/cases", { key: A.platform, body: { category: "sneakers", model_hint: "Dunk Low", seller: { id: "honest" } } });
  await uploadAll(call, `/v1/cases/${c1.body.id}`, A.platform, 3000);
  await call("POST", `/v1/cases/${c1.body.id}/submit`, { key: A.platform });
  const c2 = await call("POST", "/v1/cases", { key: B.platform, body: { category: "sneakers", model_hint: "Dunk Low", seller: { id: "copycat" } } });
  await uploadAll(call, `/v1/cases/${c2.body.id}`, B.platform, 3000); // 같은 시드 = 같은 사진
  const r = await call("POST", `/v1/cases/${c2.body.id}/submit`, { key: B.platform });
  const dup = r.body.assessment.evidence.find((e) => e.code === "reused_photo");
  assert.ok(dup);
  assert.deepEqual(dup.cases, ["other_platform"]);
});

test("권한: 키 없음 401, 역할 불일치 403, 다른 테넌트 건 404", async (t) => {
  const { call, mkTenant } = await startServer(t);
  const A = mkTenant("A"), B = mkTenant("B");
  assert.equal((await call("POST", "/v1/cases", { body: { category: "sneakers" } })).status, 401);
  assert.equal((await call("POST", "/v1/cases", { key: "tu_p_wrong", body: { category: "sneakers" } })).status, 401);
  assert.equal((await call("POST", "/v1/cases", { key: A.inspector, body: { category: "sneakers" } })).status, 403);
  assert.equal((await call("GET", "/v1/metrics", { key: A.platform })).status, 403);
  const c = await call("POST", "/v1/cases", { key: A.platform, body: { category: "sneakers" } });
  assert.equal((await call("GET", `/v1/cases/${c.body.id}`, { key: B.platform })).status, 404);
  assert.equal((await call("GET", `/v1/review/cases/${c.body.id}`, { key: B.inspector })).status, 404);
  assert.equal((await call("POST", "/v1/cases", { key: A.platform, body: { category: "watches" } })).status, 400);
  assert.equal((await call("POST", "/v1/cases", { key: A.platform, body: { category: "sneakers", listing: { url: "javascript:alert(1)" } } })).status, 400);
  assert.equal((await call("GET", "/v1/capture/notatoken")).status, 404);
  assert.equal((await call("GET", "/../package.json")).status, 404);
});

test("UnitPrint: A 플랫폼 출고 등록 → B 플랫폼에서 재판매 대조, 바꿔치기는 불일치", async (t) => {
  const { call, mkTenant } = await startServer(t);
  const A = mkTenant("A"), B = mkTenant("B");
  const surface = texture(900, 700, 777);
  const reg = await call("POST", "/v1/units", { key: A.platform, body: { sku: "DD1391-100", spot: "왼쪽 옆면 스우시 아래", source: "outbound", image_base64: grayToJpeg(surface).toString("base64") } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const same = await call("POST", `/v1/units/${reg.body.id}/verify`, { key: B.platform, body: { purpose: "resale", image_base64: grayToJpeg(recapture(surface, { dx: 10, dy: 6, bias: 20, noise: 8 }), 75).toString("base64") } });
  assert.equal(same.body.match, true, JSON.stringify(same.body));
  const swapped = await call("POST", `/v1/units/${reg.body.id}/verify`, { key: A.platform, body: { purpose: "return", image_base64: img(778) } });
  assert.equal(swapped.body.match, false, JSON.stringify(swapped.body));
  const flatReg = await call("POST", "/v1/units", { key: A.platform, body: { image_base64: grayToJpeg(flat(900, 700)).toString("base64") } });
  assert.equal(flatReg.status, 422);
});

test("AI 오류가 나도 건은 사람 검수로 넘어간다", async (t) => {
  const { call, mkTenant, ctx } = await startServer(t);
  ctx.aiClient = { beta: { messages: { create: async () => { throw Object.assign(new Error("overloaded"), { status: 529 }); } } } };
  const A = mkTenant("A");
  const c = await call("POST", "/v1/cases", { key: A.platform, body: { category: "sneakers" } });
  await uploadAll(call, `/v1/cases/${c.body.id}`, A.platform, 4000);
  const r = await call("POST", `/v1/cases/${c.body.id}/submit`, { key: A.platform });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "in_review");
  assert.equal(r.body.assessment.ai_assessed, false);
});

test("설정 검증: 범위 밖 값은 거절", async (t) => {
  const { call, mkTenant } = await startServer(t);
  const A = mkTenant("A");
  assert.equal((await call("PATCH", "/v1/settings", { key: A.admin, body: { risk: { audit_rate: 2 } } })).status, 400);
  assert.equal((await call("PATCH", "/v1/settings", { key: A.admin, body: { webhook: { url: "ftp://x" } } })).status, 400);
  const ok = await call("PATCH", "/v1/settings", { key: A.admin, body: { risk: { auto_pass_below: 20 }, guarantee: { enabled_categories: ["sneakers", "handbags", "nope"] } } });
  assert.equal(ok.body.risk.auto_pass_below, 20);
  assert.deepEqual(ok.body.guarantee.enabled_categories, ["sneakers", "handbags"]);
});
