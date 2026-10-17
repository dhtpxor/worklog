// src/app.js — HTTP API. 쇼핑몰 서버가 상품 등록 직전에 호출한다 (브라우저에서 직접 부르지 말 것: 키가 노출됨).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { runPrecheck, InputError } from "./precheck.js";
import { RULES, AREAS } from "./rules/catalog.js";
import { BRANDS } from "./rules/brands.js";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "cache-control": "no-store" };

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...HEADERS });
  res.end(JSON.stringify(body));
}

async function readJson(req, max) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error("요청 본문이 너무 큽니다"), { status: 413, code: "body_too_large" }); chunks.push(c); }
  try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); if (!v || typeof v !== "object" || Array.isArray(v)) throw 0; return v; }
  catch { throw new InputError("JSON 본문을 읽지 못했습니다"); }
}

function authorized(cfg, header) {
  if (!cfg.PRECHECK_API_KEY) return false; // 키를 설정하지 않으면 API 를 열지 않는다
  const m = /^Bearer\s+(\S+)$/.exec(header || "");
  if (!m) return false;
  const a = crypto.createHash("sha256").update(m[1]).digest(), b = crypto.createHash("sha256").update(cfg.PRECHECK_API_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

function settingsFrom(cfg, body) {
  const s = { food_agency_registered: cfg.FOOD_AGENCY_REGISTERED };
  if (typeof body?.settings?.food_agency_registered === "boolean") s.food_agency_registered = body.settings.food_agency_registered;
  return s;
}

/** @param {{cfg:object, aiClient?:object, fetchImpl?:Function, lookup?:Function}} ctx */
export function createHandler(ctx) {
  return async (req, res) => {
    const url = new URL(req.url, "http://local");
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/style.css" || url.pathname === "/app.js")) {
        const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        res.writeHead(200, { "content-type": MIME[path.extname(file)], ...HEADERS });
        return void res.end(fs.readFileSync(path.join(PUBLIC, file)));
      }
      if (req.method === "GET" && url.pathname === "/v1/health") return send(res, 200, { ok: true, ai: !!(ctx.cfg.ANTHROPIC_API_KEY || ctx.aiClient) });
      if (!url.pathname.startsWith("/v1/")) return send(res, 404, { error: { code: "not_found", message: "없는 주소입니다" } });
      if (!authorized(ctx.cfg, req.headers.authorization)) return send(res, 401, { error: { code: "unauthorized", message: ctx.cfg.PRECHECK_API_KEY ? "API 키가 올바르지 않습니다" : "서버에 PRECHECK_API_KEY 가 설정되지 않았습니다" } });

      if (req.method === "GET" && url.pathname === "/v1/rules") {
        return send(res, 200, {
          areas: AREAS,
          rules: Object.entries(RULES).map(([id, r]) => ({ id, ...r })),
          brands: BRANDS.map((b) => ({ id: b.id, name: b.name, kind: b.kind })),
          note: "상표 사전은 일부만 담은 시드입니다. 사전에 없는 상표는 AI 가 짚거나 키프리스에서 직접 확인해야 합니다.",
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/precheck") {
        const body = await readJson(req, ctx.cfg.MAX_BODY_BYTES);
        return send(res, 200, await runPrecheck({ ...ctx, product: body.product, settings: settingsFrom(ctx.cfg, body) }));
      }
      if (req.method === "POST" && url.pathname === "/v1/precheck/batch") {
        const body = await readJson(req, ctx.cfg.MAX_BODY_BYTES);
        if (!Array.isArray(body.products) || !body.products.length) throw new InputError("products 배열이 필요합니다");
        if (body.products.length > 20) throw new InputError("한 번에 20개까지 검사할 수 있습니다");
        const settings = settingsFrom(ctx.cfg, body);
        const results = [];
        for (const product of body.products) {
          try { results.push(await runPrecheck({ ...ctx, product, settings })); }
          catch (e) { if (e instanceof InputError) results.push({ id: product?.id ?? null, error: { code: e.code, message: e.message } }); else throw e; }
        }
        return send(res, 200, { results });
      }
      send(res, 404, { error: { code: "not_found", message: "없는 API 입니다" } });
    } catch (e) {
      const status = e.status && e.status < 500 ? e.status : 500;
      if (status >= 500) console.error("[precheck]", e);
      send(res, status, { error: { code: e.code || "internal", message: status >= 500 ? "서버 오류가 발생했습니다" : e.message } });
    }
  };
}
