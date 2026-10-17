import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function fakeClaude(calls, result) {
  const create = async (p) => { calls.push(p); return { model: p.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(result) }], usage: { input_tokens: 500, output_tokens: 80 } }; };
  return { beta: { messages: { create } }, messages: { create } };
}
const EMPTY_AI = { product_categories: [], brands: [], characters: [], ingredients_of_concern: [], foreign_shop_branding: false, notes: "" };

async function start(t, { key = "secret-key", ai = EMPTY_AI, calls = [] } = {}) {
  const ctx = {
    cfg: loadConfig({ PRECHECK_API_KEY: key, ANTHROPIC_API_KEY: "", FOOD_AGENCY_REGISTERED: false, AI_SKIP_WHEN_BLOCKED: true }),
    aiClient: fakeClaude(calls, ai),
    lookup: async () => [{ address: "93.184.216.34" }],
    fetchImpl: async () => new Response(PNG, { status: 200 }),
  };
  const server = http.createServer(createHandler(ctx));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, body, auth = `Bearer ${key}`) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: ct.includes("json") ? await res.json() : await res.text() };
  };
}

test("인증: 키 없음·틀린 키는 401, 서버 키 미설정이면 전부 거절", async (t) => {
  const call = await start(t);
  assert.equal((await call("POST", "/v1/precheck", { product: { title: "x" } }, null)).status, 401);
  assert.equal((await call("POST", "/v1/precheck", { product: { title: "x" } }, "Bearer nope")).status, 401);
  const open = await start(t, { key: "" });
  assert.equal((await open("POST", "/v1/precheck", { product: { title: "x" } }, "Bearer ")).status, 401);
  assert.equal((await call("GET", "/v1/health", null, null)).status, 200);
  assert.equal((await call("GET", "/", null, null)).status, 200);
});

test("검사: 이미지와 함께 AI 호출, 요청 형식 확인", async (t) => {
  const calls = [];
  const call = await start(t, { calls, ai: { ...EMPTY_AI, product_categories: ["wireless"], brands: [{ name: "Sony", source: "image", usage: "logo_on_product" }] } });
  const r = await call("POST", "/v1/precheck", { product: { id: "p1", title: "无线耳机 降噪", source_country: "CN", image_urls: ["https://img.alicdn.com/a.png"] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.verdict, "review");
  assert.ok(r.body.checks.some((c) => c.rule_id === "TM_MENTION" && c.evidence.some((e) => e.source === "ai")));
  assert.equal(r.body.images[0].ok, true);
  const p = calls[0];
  assert.equal(p.output_config.format.type, "json_schema");
  assert.equal(p.fallbacks, "default");
  assert.equal(p.messages[0].content.filter((b) => b.type === "image").length, 1);
});

test("텍스트만으로 판매 불가면 AI 를 부르지 않는다", async (t) => {
  const calls = [];
  const call = await start(t, { calls });
  const r = await call("POST", "/v1/precheck", { product: { title: "샤넬st 트위드 자켓", image_urls: ["https://img.example.com/a.png"] } });
  assert.equal(r.body.verdict, "block");
  assert.equal(r.body.ai_skipped, true);
  assert.equal(calls.length, 0);
});

test("요청별 설정으로 식품 등록 여부를 바꿀 수 있다", async (t) => {
  const call = await start(t);
  assert.equal((await call("POST", "/v1/precheck", { product: { title: "サプリメント ビタミンC" } })).body.verdict, "block");
  assert.equal((await call("POST", "/v1/precheck", { product: { title: "サプリメント ビタミンC" }, settings: { food_agency_registered: true } })).body.verdict, "review");
});

test("일괄 검사: 잘못된 항목은 그 항목만 오류, 20개 제한", async (t) => {
  const call = await start(t);
  const r = await call("POST", "/v1/precheck/batch", { products: [{ id: "a", title: "가습기" }, { id: "b" }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.results[0].verdict, "review");
  assert.equal(r.body.results[1].error.code, "invalid_request");
  const many = await call("POST", "/v1/precheck/batch", { products: Array.from({ length: 21 }, (_, i) => ({ title: `t${i}` })) });
  assert.equal(many.status, 400);
  assert.equal((await call("POST", "/v1/precheck", { product: {} })).status, 400);
});

test("규칙 목록 조회", async (t) => {
  const call = await start(t);
  const r = await call("GET", "/v1/rules");
  assert.ok(r.body.rules.length >= 20);
  assert.ok(r.body.brands.some((b) => b.id === "nike"));
});
