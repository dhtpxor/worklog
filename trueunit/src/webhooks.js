// src/webhooks.js — 플랫폼으로 이벤트 전송. 서명: X-TrueUnit-Signature: t=<unix>,v1=<hex HMAC-SHA256("t.body")>
import crypto from "node:crypto";
import { newId, nowIso } from "./store.js";

export function sign(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifySignature(secret, header, body, toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = sign(secret, t, body);
  return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

/** 이벤트 기록 + (설정돼 있으면) 웹훅 전송. 전송 실패가 본 처리를 막지 않는다. */
export function emit({ store, tenant, type, data, fetchImpl = fetch }) {
  const ev = store.insert("events", { id: newId("evt"), tenant_id: tenant.id, type, data, created_at: nowIso() });
  const url = tenant.settings.webhook?.url;
  if (!url) return { event: ev, delivery: Promise.resolve(null) };
  const body = JSON.stringify({ id: ev.id, type, created_at: ev.created_at, data });
  const t = Math.floor(Date.now() / 1000);
  const delivery = fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-trueunit-signature": `t=${t},v1=${sign(tenant.settings.webhook.secret, t, body)}` },
    body,
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => store.insert("webhook_deliveries", { id: newId("whd"), tenant_id: tenant.id, event_id: ev.id, status: r.status, ok: r.ok, at: nowIso() }))
    .catch((e) => store.insert("webhook_deliveries", { id: newId("whd"), tenant_id: tenant.id, event_id: ev.id, status: 0, ok: false, error: String(e?.message || e).slice(0, 200), at: nowIso() }));
  return { event: ev, delivery };
}
