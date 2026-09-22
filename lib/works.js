// lib/works.js — 네이버웍스 API 2.0: 서비스 계정(JWT) 토큰 발급, 봇 메시지 전송, 콜백 서명 검증
import crypto from "node:crypto";
import { env } from "./env.js";

const TOKEN_URL = "https://auth.worksmobile.com/oauth2/v2.0/token";
const API = "https://www.worksapis.com/v1.0";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** RS256 JWT (iss=Client ID, sub=Service Account, 유효 30분) */
export function makeAssertion({ clientId, serviceAccount, privateKey, now = Math.floor(Date.now() / 1000) }) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 60 * 30 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const sig = b64url(signer.sign(privateKey));
  return `${header}.${payload}.${sig}`;
}

/** 콜백 검증: X-WORKS-Signature == base64(HMAC-SHA256(rawBody, Bot Secret)) */
export function verifySignature(rawBody, signature, botSecret = env.WORKS_BOT_SECRET) {
  if (!botSecret) return true; // Bot Secret 을 안 넣었으면 검증 생략(테스트용). 운영에선 꼭 넣을 것.
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", botSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export class WorksClient {
  constructor({ fetchImpl = globalThis.fetch, cfg = env } = {}) {
    this.fetch = fetchImpl; this.cfg = cfg; this._token = null; this._exp = 0;
  }
  get enabled() { return this.cfg.WORKS_ENABLED; }

  async token() {
    if (this._token && Date.now() < this._exp - 60_000) return this._token;
    const assertion = makeAssertion({ clientId: this.cfg.WORKS_CLIENT_ID, serviceAccount: this.cfg.WORKS_SERVICE_ACCOUNT, privateKey: this.cfg.WORKS_PRIVATE_KEY });
    const body = new URLSearchParams({
      assertion, grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      client_id: this.cfg.WORKS_CLIENT_ID, client_secret: this.cfg.WORKS_CLIENT_SECRET, scope: "bot",
    });
    const r = await this.fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`네이버웍스 토큰 발급 실패 (HTTP ${r.status}): ${JSON.stringify(j).slice(0, 200)}`);
    this._token = j.access_token; this._exp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
    return this._token;
  }

  async _post(path, body) {
    const tok = await this.token();
    const r = await this.fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`네이버웍스 API 오류 (HTTP ${r.status}) ${path}: ${t.slice(0, 200)}`);
    }
    return true;
  }

  /** 봇 → 개인에게 텍스트. 네이버웍스 텍스트는 한 번에 2000자 안팎이라 길면 나눠 보낸다. */
  async sendToUser(userId, text) {
    for (const chunk of chunks(text)) await this._post(`/bots/${this.cfg.WORKS_BOT_ID}/users/${encodeURIComponent(userId)}/messages`, { content: { type: "text", text: chunk } });
    return true;
  }
  async sendToChannel(channelId, text) {
    for (const chunk of chunks(text)) await this._post(`/bots/${this.cfg.WORKS_BOT_ID}/channels/${encodeURIComponent(channelId)}/messages`, { content: { type: "text", text: chunk } });
    return true;
  }
}

function chunks(text, max = 1800) {
  const s = String(text || "");
  if (s.length <= max) return [s];
  const out = []; let cur = "";
  for (const line of s.split("\n")) {
    if ((cur + "\n" + line).length > max) { out.push(cur); cur = line; } else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) out.push(cur);
  return out;
}

/** 테스트용: 보낸 메시지를 쌓기만 하는 가짜 */
export class MemoryWorks {
  constructor() { this.sent = []; }
  get enabled() { return true; }
  async sendToUser(userId, text) { this.sent.push({ to: userId, text }); return true; }
  async sendToChannel(channelId, text) { this.sent.push({ channel: channelId, text }); return true; }
}
