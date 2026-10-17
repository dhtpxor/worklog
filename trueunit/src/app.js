// src/app.js — HTTP 라우팅. 프레임워크 없이 node:http 만 쓴다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate, allowed } from "./auth.js";
import { publicCatalog, getCategory } from "./catalog.js";
import { HttpError, bad, notFound } from "./services/errors.js";
import * as cases from "./services/cases.js";
import * as units from "./services/units.js";
import { quote, issue, openClaim, resolveClaim, applyKillSwitch } from "./guarantee.js";
import { tenantMetrics } from "./metrics.js";
import { emit } from "./webhooks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

/** @typedef {{cfg:object, store:import('./store.js').Store, aiClient?:object, fetchImpl?:Function, random?:()=>number}} Ctx */

const routes = [];
function route(method, pattern, role, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([A-Za-z0-9_-]+)"; }) + "$");
  routes.push({ method, re, keys, role, handler });
}

// ---------- 공개 ----------
route("GET", "/v1/health", null, () => ({ ok: true }));
route("GET", "/v1/catalog", null, () => ({ categories: publicCatalog() }));

// ---------- 판매자 촬영 링크 (capture token 이 곧 권한) ----------
function caseByToken(ctx, token) {
  const c = ctx.store.find("cases", (x) => x.capture_token === token);
  if (!c) throw notFound("촬영 링크");
  return c;
}
route("GET", "/v1/capture/:token", "capture", (ctx, { params }) => {
  const c = caseByToken(ctx, params.token);
  const cat = getCategory(c.category);
  const best = cases.bestImages(ctx, c);
  return {
    case_id: c.id,
    status: c.status,
    category: { id: cat.id, label: cat.label },
    brand: c.brand,
    model_hint: c.model_hint,
    checkpoints: cat.checkpoints.map(({ id, label, required, guide }) => ({ id, label, required, guide, uploaded: best[id] ? cases.publicImage(best[id]) : null })),
    recapture: c.assessment?.recapture || [],
  };
});
route("POST", "/v1/capture/:token/images", "capture", (ctx, { params, body }) => {
  const c = caseByToken(ctx, params.token);
  return cases.addImage(ctx, ctx.store.get("tenants", c.tenant_id), c, body);
});
route("POST", "/v1/capture/:token/submit", "capture", async (ctx, { params }) => {
  const c = caseByToken(ctx, params.token);
  const updated = await cases.submitCase(ctx, ctx.store.get("tenants", c.tenant_id), c);
  // 판매자에게는 점수·근거를 보여 주지 않는다 (위조범 학습 방지)
  return { status: "submitted", recapture: updated.assessment?.recapture || [] };
});

// ---------- 플랫폼 API ----------
route("POST", "/v1/cases", "platform", (ctx, { auth, body, origin }) => {
  const c = cases.createCase(ctx, auth.tenant, body);
  return { status: 201, body: { ...cases.publicCase(ctx, c), capture_url: cases.captureUrl(ctx, c, origin) } };
});
route("GET", "/v1/cases", ["platform", "inspector"], (ctx, { auth, query }) => {
  const status = query.get("status");
  const limit = Math.min(200, Number(query.get("limit")) || 50);
  const list = ctx.store
    .list("cases", (c) => c.tenant_id === auth.tenant.id && (!status || c.status === status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
  return { cases: list.map((c) => cases.publicCase(ctx, c)) };
});
route("GET", "/v1/cases/:id", ["platform", "inspector"], (ctx, { auth, params }) => {
  const c = cases.getOwnedCase(ctx, auth.tenant, params.id);
  return { ...cases.publicCase(ctx, c), capture_url: cases.captureUrl(ctx, c) };
});
route("POST", "/v1/cases/:id/images", "platform", (ctx, { auth, params, body }) => cases.addImage(ctx, auth.tenant, cases.getOwnedCase(ctx, auth.tenant, params.id), body));
route("POST", "/v1/cases/:id/submit", "platform", async (ctx, { auth, params }) => cases.publicCase(ctx, await cases.submitCase(ctx, auth.tenant, cases.getOwnedCase(ctx, auth.tenant, params.id))));

route("POST", "/v1/cases/:id/guarantee/quote", "platform", (ctx, { auth, params }) => {
  const c = cases.getOwnedCase(ctx, auth.tenant, params.id);
  return quote({ caseDoc: c, category: getCategory(c.category), settings: auth.tenant.settings.guarantee, verdict: c.verdict_id ? ctx.store.get("verdicts", c.verdict_id) : null });
});
route("POST", "/v1/cases/:id/guarantee", "platform", (ctx, { auth, params, body }) => {
  const c = cases.getOwnedCase(ctx, auth.tenant, params.id);
  const q = quote({ caseDoc: c, category: getCategory(c.category), settings: auth.tenant.settings.guarantee, verdict: c.verdict_id ? ctx.store.get("verdicts", c.verdict_id) : null });
  if (!q.eligible) throw new HttpError(422, "not_eligible", q.reasons.join(" / "));
  if (body.expected_fee_krw !== undefined && Number(body.expected_fee_krw) !== q.fee_krw) throw new HttpError(409, "quote_changed", `보증료가 바뀌었습니다 (현재 ${q.fee_krw}원). 다시 견적을 받아 주세요.`);
  const g = issue({ store: ctx.store, tenantId: auth.tenant.id, caseDoc: c, q, payer: body.payer, termDays: auth.tenant.settings.guarantee.term_days });
  emit({ store: ctx.store, tenant: auth.tenant, type: "guarantee.issued", data: g, fetchImpl: ctx.fetchImpl });
  return { status: 201, body: g };
});
route("GET", "/v1/guarantees", ["platform", "inspector"], (ctx, { auth }) => ({ guarantees: ctx.store.list("guarantees", (g) => g.tenant_id === auth.tenant.id).sort((a, b) => b.issued_at.localeCompare(a.issued_at)) }));
route("POST", "/v1/guarantees/:id/claims", "platform", (ctx, { auth, params, body }) => {
  const g = ctx.store.get("guarantees", params.id);
  if (!g || g.tenant_id !== auth.tenant.id) throw notFound("보증");
  const c = openClaim({ store: ctx.store, tenantId: auth.tenant.id, guarantee: g, reason: body.reason });
  emit({ store: ctx.store, tenant: auth.tenant, type: "claim.opened", data: c, fetchImpl: ctx.fetchImpl });
  return { status: 201, body: c };
});

route("POST", "/v1/units", "platform", (ctx, { auth, body }) => ({ status: 201, body: units.publicUnit(units.registerUnit(ctx, auth.tenant, body)) }));
route("POST", "/v1/units/:id/verify", "platform", (ctx, { auth, params, body }) => units.verifyUnit(ctx, auth.tenant, params.id, body));

// ---------- 검수사 ----------
route("GET", "/v1/queue", "inspector", (ctx, { auth }) => ({ cases: cases.reviewQueue(ctx, auth.tenant).map((c) => cases.publicCase(ctx, c)) }));
route("GET", "/v1/review/cases/:id", "inspector", (ctx, { auth, params }) => {
  const c = cases.getOwnedCase(ctx, auth.tenant, params.id);
  const cat = getCategory(c.category);
  const imgs = ctx.store.list("images", (i) => i.case_id === c.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    ...cases.publicCase(ctx, c),
    seller: c.seller,
    checkpoints: cat.checkpoints.map(({ id, label, required }) => ({ id, label, required })),
    images: imgs.map((i) => ({ ...cases.publicImage(i), metrics: i.quality.metrics })),
    ai: c.assessment ? { observation: c.assessment.ai_observation, checkpoints: c.assessment.ai_checkpoints, meta: c.assessment.ai_meta, error: c.assessment.ai_error, audit_sample: c.assessment.audit_sample } : null,
  };
});
route("GET", "/v1/images/:id", "inspector", (ctx, { auth, params }) => {
  const img = ctx.store.get("images", params.id);
  if (!img || img.tenant_id !== auth.tenant.id) throw notFound("이미지");
  return { raw: ctx.store.getBlob(img.id), type: img.content_type };
});
route("POST", "/v1/review/cases/:id/verdict", "inspector", (ctx, { auth, params, body }) => {
  const r = cases.recordVerdict(ctx, auth.tenant, cases.getOwnedCase(ctx, auth.tenant, params.id), auth, body);
  return { case: cases.publicCase(ctx, r.case), verdict: r.verdict };
});
route("GET", "/v1/claims", "inspector", (ctx, { auth }) => ({ claims: ctx.store.list("claims", (c) => c.tenant_id === auth.tenant.id).sort((a, b) => b.opened_at.localeCompare(a.opened_at)) }));
route("POST", "/v1/claims/:id/resolve", "inspector", (ctx, { auth, params, body }) => {
  const claim = ctx.store.get("claims", params.id);
  if (!claim || claim.tenant_id !== auth.tenant.id) throw notFound("청구");
  const c = resolveClaim({ store: ctx.store, claim, outcome: body.outcome, note: body.note, resolver: auth.keyId });
  const suspended = applyKillSwitch({ store: ctx.store, tenant: ctx.store.get("tenants", auth.tenant.id) });
  emit({ store: ctx.store, tenant: auth.tenant, type: "claim.resolved", data: c, fetchImpl: ctx.fetchImpl });
  if (suspended.length) emit({ store: ctx.store, tenant: auth.tenant, type: "guarantee.category_suspended", data: { categories: suspended }, fetchImpl: ctx.fetchImpl });
  return { claim: c, suspended_categories: suspended };
});

// ---------- 관리자 ----------
route("GET", "/v1/me", ["platform", "inspector"], (ctx, { auth }) => ({ tenant: { id: auth.tenant.id, name: auth.tenant.name }, role: auth.role }));
route("GET", "/v1/metrics", "admin", (ctx, { auth }) => tenantMetrics(ctx.store, ctx.store.get("tenants", auth.tenant.id)));
route("GET", "/v1/settings", "admin", (ctx, { auth }) => {
  const t = ctx.store.get("tenants", auth.tenant.id);
  return { ...t.settings, webhook: { url: t.settings.webhook.url, secret: t.settings.webhook.secret } };
});
route("PATCH", "/v1/settings", "admin", (ctx, { auth, body }) => {
  const t = ctx.store.get("tenants", auth.tenant.id);
  const s = structuredClone(t.settings);
  const nr = (v, lo, hi, name) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${name} 는 ${lo}~${hi} 사이 숫자여야 합니다`); return n; };
  if (body.risk) {
    if (body.risk.auto_pass_below !== undefined) s.risk.auto_pass_below = nr(body.risk.auto_pass_below, 0, 100, "risk.auto_pass_below");
    if (body.risk.priority_at !== undefined) s.risk.priority_at = nr(body.risk.priority_at, 0, 100, "risk.priority_at");
    if (body.risk.audit_rate !== undefined) s.risk.audit_rate = nr(body.risk.audit_rate, 0, 1, "risk.audit_rate");
    if (s.risk.auto_pass_below > s.risk.priority_at) throw bad("auto_pass_below 는 priority_at 보다 클 수 없습니다");
  }
  if (body.guarantee) {
    const g = body.guarantee;
    if (g.max_score !== undefined) s.guarantee.max_score = nr(g.max_score, 0, 100, "guarantee.max_score");
    if (Array.isArray(g.enabled_categories)) s.guarantee.enabled_categories = g.enabled_categories.filter((c) => getCategory(c));
    if (Array.isArray(g.suspended_categories)) s.guarantee.suspended_categories = g.suspended_categories.filter((c) => getCategory(c));
    if (g.kill_switch?.max_loss_ratio !== undefined) s.guarantee.kill_switch.max_loss_ratio = nr(g.kill_switch.max_loss_ratio, 0, 10, "kill_switch.max_loss_ratio");
    if (g.kill_switch?.min_issued !== undefined) s.guarantee.kill_switch.min_issued = nr(g.kill_switch.min_issued, 1, 100000, "kill_switch.min_issued");
  }
  if (body.unitprint?.match_threshold !== undefined) s.unitprint.match_threshold = nr(body.unitprint.match_threshold, 0, 1, "unitprint.match_threshold");
  if (body.webhook?.url !== undefined) {
    const u = String(body.webhook.url);
    if (u && !/^https?:\/\//.test(u)) throw bad("webhook.url 은 http(s) 주소여야 합니다");
    s.webhook.url = u;
  }
  ctx.store.update("tenants", t.id, { settings: s });
  return s;
});
route("GET", "/v1/events", "admin", (ctx, { auth, query }) => {
  const limit = Math.min(200, Number(query.get("limit")) || 50);
  return { events: ctx.store.list("events", (e) => e.tenant_id === auth.tenant.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit) };
});

// ---------- 서버 ----------
async function readJson(req, max) {
  const chunks = [];
  let size = 0;
  for await (const ch of req) {
    size += ch.length;
    if (size > max) throw new HttpError(413, "body_too_large", "요청 본문이 너무 큽니다");
    chunks.push(ch);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw bad("JSON 본문을 읽지 못했습니다", "invalid_json");
  }
}

function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(json);
}

const SECURITY_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" };

function serveStatic(res, file) {
  const p = path.resolve(PUBLIC_DIR, file);
  if (!p.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(p) || !fs.statSync(p).isFile()) return false;
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-cache", ...SECURITY_HEADERS });
  res.end(fs.readFileSync(p));
  return true;
}

/** @param {Ctx} ctx */
export function createHandler(ctx) {
  return async (req, res) => {
    const url = new URL(req.url, "http://local");
    const origin = req.headers.host ? `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}` : "";
    try {
      if (req.method === "GET" && !url.pathname.startsWith("/v1/")) {
        if (url.pathname === "/" || url.pathname === "/console") return void serveStatic(res, "console.html");
        if (/^\/capture\/[A-Za-z0-9_-]+$/.test(url.pathname)) return void serveStatic(res, "capture.html");
        if (serveStatic(res, url.pathname.slice(1))) return;
        throw notFound("페이지");
      }
      const r = routes.find((x) => x.re.test(url.pathname) && x.method === req.method);
      if (!r) {
        const anyMethod = routes.some((x) => x.re.test(url.pathname));
        throw anyMethod ? new HttpError(405, "method_not_allowed", "허용되지 않은 메서드입니다") : notFound("API");
      }
      const m = r.re.exec(url.pathname);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      let auth = null;
      if (r.role && r.role !== "capture") {
        auth = authenticate(ctx.store, req.headers.authorization);
        if (!auth) throw new HttpError(401, "unauthorized", "API 키가 없거나 올바르지 않습니다");
        if (!allowed(auth.role, r.role)) throw new HttpError(403, "forbidden", "이 키로는 쓸 수 없는 기능입니다");
      }
      const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readJson(req, ctx.cfg.MAX_BODY_BYTES) : {};
      const out = await r.handler(ctx, { auth, params, body, query: url.searchParams, origin });
      if (out && out.raw) {
        res.writeHead(200, { "content-type": out.type, "cache-control": "private, max-age=300", ...SECURITY_HEADERS });
        return void res.end(out.raw);
      }
      if (out && typeof out.status === "number" && out.body !== undefined) return void send(res, out.status, out.body, SECURITY_HEADERS);
      send(res, 200, out ?? {}, SECURITY_HEADERS);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e.status && e.status < 500 ? e.status : 500;
      if (status >= 500) console.error("[error]", req.method, url.pathname, e);
      send(res, status, { error: { code: e.code || (status >= 500 ? "internal" : "error"), message: status >= 500 ? "서버 오류가 발생했습니다" : e.message } }, SECURITY_HEADERS);
    }
  };
}
