// src/fetchImage.js — 상품 이미지 URL 을 서버에서 받는다. 내부망 주소 접근(SSRF)을 막고 크기·시간을 제한한다.
import dns from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 5 * 1024 * 1024; // Claude 이미지 1장 상한에 맞춤
const TIMEOUT_MS = 8000;

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

export function sniffImageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buf.length > 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** @returns {Promise<{ok:true, data:Buffer, media_type:string} | {ok:false, error:string}>} */
export async function fetchImage(url, { fetchImpl = fetch, lookup = dns.lookup, allowPrivate = false } = {}) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, error: "주소 형식이 올바르지 않습니다" }; }
  try {
    let res;
    for (let hop = 0; ; hop++) {
      if (!["http:", "https:"].includes(u.protocol)) return { ok: false, error: "http(s) 주소만 받을 수 있습니다" };
      if (!allowPrivate) {
        let addrs;
        try { addrs = await lookup(u.hostname, { all: true }); } catch { return { ok: false, error: "주소를 찾을 수 없습니다" }; }
        if (!addrs.length || addrs.some((a) => isPrivate(a.address))) return { ok: false, error: "내부망 주소는 받을 수 없습니다" };
      }
      res = await fetchImpl(u, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "precheck/0.1" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= 3) return { ok: false, error: "리다이렉트가 너무 많습니다" };
        u = new URL(res.headers.get("location"), u); // 넘어간 주소도 같은 검사를 다시 거친다
        continue;
      }
      break;
    }
    if (!res.ok) return { ok: false, error: `이미지 응답 ${res.status}` };
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return { ok: false, error: "이미지가 5MB 를 넘습니다" };
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_BYTES) return { ok: false, error: "이미지가 5MB 를 넘습니다" };
    const media_type = sniffImageType(data);
    if (!media_type) return { ok: false, error: "JPEG·PNG·GIF·WEBP 이미지가 아닙니다" };
    return { ok: true, data, media_type };
  } catch (e) {
    return { ok: false, error: e?.name === "TimeoutError" ? "이미지 응답 시간 초과" : "이미지를 받지 못했습니다" };
  }
}

export { isPrivate };
