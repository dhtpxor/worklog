// lib/http.js — Vercel 함수 공통: raw body 읽기, PIN 검사, JSON 응답
import { env } from "./env.js";

export async function readRaw(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/** 웹페이지 → API 호출 보호: x-pin 헤더가 ADMIN_PIN 과 같아야 한다 */
export function checkPin(req, res) {
  const pin = String(req.headers["x-pin"] || req.query?.pin || "");
  if (!env.ADMIN_PIN) { res.status(500).json({ ok: false, error: "ADMIN_PIN 환경변수가 비어 있습니다" }); return false; }
  if (pin !== env.ADMIN_PIN) { res.status(401).json({ ok: false, error: "PIN이 다릅니다" }); return false; }
  return true;
}

export function ok(res, data) { return res.status(200).json({ ok: true, data }); }
export function fail(res, e, status = 500) { return res.status(status).json({ ok: false, error: String(e?.message || e) }); }
