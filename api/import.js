// api/import.js — 카카오톡 대화 내보내기(txt) 또는 붙여넣은 글에서 할 일 후보 뽑기
//   POST { kind: "kakao"|"text", text, days?: 14, room?: "" , dryRun?: false }
import { env } from "../lib/env.js";
import { GasClient } from "../lib/gas.js";
import { readJson, checkPin, ok, fail } from "../lib/http.js";
import { parseKakaoExport } from "../lib/kakao.js";
import { extractTasks } from "../lib/extract.js";
import { extractAny } from "../lib/ai/assistant.js";
import { todayISO, addDays } from "../lib/dates.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  const gas = new GasClient();
  try {
    const body = await readJson(req);
    const team = await gas.listTeam();
    const ownerName = env.OWNER_NAME;
    const today = todayISO();
    const found = await importText({ ...body, team, ownerName, today, cfg: env, gas });
    if (body.dryRun) return ok(res, { candidates: found });
    const added = found.length ? await gas.addTasks(found) : [];
    return ok(res, { candidates: added, count: added.length });
  } catch (e) { return fail(res, e); }
}

export async function importText({ kind = "text", text = "", days = 14, room = "", team = [], ownerName = "", today, cfg = null, gas = null }) {
  const out = [];
  const ex = (p) => (cfg?.AI_ENABLED ? extractAny({ ...p, cfg, gas }) : Promise.resolve(extractTasks(p)));
  if (kind === "kakao") {
    const { title, messages } = parseKakaoExport(text);
    const since = addDays(today, -Number(days || 14));
    const roomName = room || title || "카카오톡";
    for (const msg of messages) {
      if (msg.date && msg.date < since) continue;
      const isOwner = ownerName && msg.sender === ownerName;
      out.push(...(await ex({ text: msg.text, sender: msg.sender, isOwner, team, ownerName, base: msg.date || today, source: "카카오톡", sourceRef: roomName })).map((t) => ({ ...t, status: "후보", snippet: `${msg.date} ${msg.sender}: ${t.snippet}`.slice(0, 200) })));
    }
  } else {
    const chat = parseChatLines(text);
    if (cfg?.AI_ENABLED) {
      // AI 는 대화 전체를 한 번에 읽는 편이 문맥을 더 잘 잡는다 ("네 보내드릴게요"가 무엇인지)
      const named = chat.map((m) => (m.sender === "나" ? `${ownerName || "나"}(본인)` : m.sender) + ": " + m.text).join("\n");
      out.push(...(await ex({ text: named || text, sender: "", isOwner: false, team, ownerName, base: today, source: "직접", sourceRef: room || (chat.length >= 2 ? "대화 캡처" : "붙여넣기") })).map((t) => ({ ...t, status: "후보" })));
    } else if (chat.length >= 2) {
      for (const msg of chat) {
        const isOwner = ownerName && (msg.sender === ownerName || msg.sender === "나" || (ownerName.length >= 3 && msg.sender === ownerName.slice(1)));
        out.push(...extractTasks({ text: msg.text, sender: msg.sender, isOwner, team, ownerName, base: today, source: "직접", sourceRef: room || "대화 캡처" }).map((t) => ({ ...t, status: "후보", snippet: `${msg.sender}: ${t.snippet}`.slice(0, 200) })));
      }
    } else {
      out.push(...extractTasks({ text, sender: "", isOwner: false, team, ownerName, base: today, source: "직접", sourceRef: room || "붙여넣기" }).map((t) => ({ ...t, status: "후보" })));
    }
  }
  // 같은 제목+담당은 하나로
  const seen = new Set();
  return out.filter((t) => { const k = `${t.owner}|${t.title}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** "홍길동: 메시지", "[홍길동] 메시지", "홍길동 오후 3:12 메시지" 같은 줄을 발신자/본문으로 나눈다. 안 맞는 줄은 앞 메시지에 붙인다. */
export function parseChatLines(text) {
  const out = []; let last = null;
  for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim(); if (!line) { last = null; continue; }
    let m = line.match(/^\[?([가-힣A-Za-z][가-힣A-Za-z0-9 .·]{0,14}?)\]?\s*(?:\[?(?:오전|오후)\s*\d{1,2}:\d{2}\]?)?\s*[:：]\s*(.+)$/) || line.match(/^\[([^\]]{1,15})\]\s*(?:\[(?:오전|오후)\s*\d{1,2}:\d{2}\]\s*)?(.+)$/) || line.match(/^([가-힣]{2,4})\s+(?:오전|오후)\s*\d{1,2}:\d{2}\s+(.+)$/);
    if (m && !/^https?:/.test(line)) { last = { sender: m[1].trim(), text: m[2].trim() }; out.push(last); continue; }
    if (last) last.text += "\n" + line;
  }
  return out;
}
