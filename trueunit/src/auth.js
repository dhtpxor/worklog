// src/auth.js — 테넌트(플랫폼)별 API 키. 키 원문은 발급 때 한 번만 보여 주고 해시만 저장한다.
import crypto from "node:crypto";
import { newId, nowIso } from "./store.js";
import { DEFAULT_RISK_SETTINGS } from "./risk.js";
import { DEFAULT_GUARANTEE_SETTINGS } from "./guarantee.js";
import { DEFAULT_MATCH_THRESHOLD } from "./imaging/fingerprint.js";

export const ROLES = ["platform", "inspector", "admin"];

export function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function createTenant(store, { name }) {
  return store.insert("tenants", {
    id: newId("ten"),
    name: String(name || "tenant").slice(0, 100),
    created_at: nowIso(),
    settings: {
      risk: { ...DEFAULT_RISK_SETTINGS },
      guarantee: structuredClone(DEFAULT_GUARANTEE_SETTINGS),
      unitprint: { match_threshold: DEFAULT_MATCH_THRESHOLD },
      webhook: { url: "", secret: crypto.randomBytes(24).toString("base64url") },
    },
  });
}

/** @returns {{key:string, record:object}} key 는 이때만 알 수 있다 */
export function issueKey(store, { tenantId, role, label = "" }) {
  if (!ROLES.includes(role)) throw new Error(`unknown role ${role}`);
  const key = `tu_${role[0]}_${crypto.randomBytes(24).toString("base64url")}`;
  const record = store.insert("api_keys", { id: newId("key"), tenant_id: tenantId, role, label: String(label).slice(0, 100), prefix: key.slice(0, 10), hash: hashKey(key), created_at: nowIso(), revoked: false });
  return { key, record };
}

/** Authorization: Bearer <key> → { tenant, role, keyId } | null */
export function authenticate(store, header) {
  const m = /^Bearer\s+(\S+)$/.exec(header || "");
  if (!m) return null;
  const h = hashKey(m[1]);
  const rec = store.find("api_keys", (k) => !k.revoked && k.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(k.hash), Buffer.from(h)));
  if (!rec) return null;
  const tenant = store.get("tenants", rec.tenant_id);
  return tenant ? { tenant, role: rec.role, keyId: rec.id } : null;
}

const RANK = { platform: 1, inspector: 1, admin: 2 };
/** admin 은 모든 권한, platform/inspector 는 자기 역할만 */
export function allowed(role, need) {
  if (role === "admin") return true;
  if (Array.isArray(need)) return need.includes(role);
  return role === need && RANK[role] >= 1;
}
