// lib/ai/assistant.js — "나만의 비서": 대화(자동 배분) · AI 할 일 추출 · 캡처 이미지 읽기
import { kst, addDays, shortDate, dowLabel } from "../dates.js";
import { TOOL_DEFS, runTool } from "./tools.js";
import { geminiChat, geminiJson, geminiVision } from "./gemini.js";
import { claudeChat, claudeJson } from "./claude.js";
import { pickProvider, getSpend, recordSpend } from "./router.js";
import { extractTasks } from "../extract.js";
import { byDue } from "../brief.js";


export async function buildSystemPrompt({ gas, cal, cfg, team, ownerName, now }) {
  const t = kst(now); const today = t.iso;
  const tasks = (await gas.listTasks()).filter((x) => x.status !== "삭제");
  const active = tasks.filter((x) => x.status === "진행").sort(byDue).slice(0, 40);
  const cands = tasks.filter((x) => x.status === "후보");
  let calText = "";
  if (cal?.enabled) {
    try { const ev = await cal.listEvents({ start: today, end: addDays(today, 1) }); calText = ev.map((e) => `[일정 ${e.id}] ${shortDate(e.date, today)} ${e.allDay ? "종일" : e.time + (e.endTime ? "~" + e.endTime : "")} ${e.title}${e.location ? " @" + e.location : ""}`).join("\n") || "오늘·내일 일정 없음"; }
    catch (e) { calText = `(캘린더 조회 실패: ${e.message})`; }
  }
  return [
    `너는 ${ownerName || "사용자"}님의 개인 업무 비서다. 한국어로, 짧고 정확하게, 존댓말로 답한다.`,
    `지금: ${today} (${dowLabel(today)}) ${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")} KST. 날짜 계산은 반드시 이 날짜 기준. '내일'=${addDays(today, 1)}, '모레'=${addDays(today, 2)}.`,
    `팀원: ${team.filter((m) => m.active !== "N").map((m) => m.name + (m.role ? `(${m.role})` : "")).join(", ") || "없음"}.`,
    `규칙:
- 할 일·일정을 만들거나 바꾸는 요청은 반드시 도구(add_task/update_task/create_event)로 실제 처리한 뒤, 처리 결과(#번호, 기한)를 그대로 알려준다. 도구 없이 "등록했습니다"라고 말하지 않는다.
- 사용자가 여러 일을 한꺼번에 말하면 각각 add_task 로 등록한다. 팀원 이름이 붙은 일은 owner 에 그 팀원을 넣는다. "제가/내가 ~하겠다"는 본인 일.
- 기한은 YYYY-MM-DD 로 계산해 넣는다. 애매하면 resolve_date 도구를 쓰거나 사용자에게 한 번만 되묻는다.
- 목록·일정 질문은 list_tasks/get_calendar 도구로 실제 데이터를 본 뒤 답한다. 지어내지 않는다.
- 잡담·질문에는 도구 없이 자연스럽게 답한다. 답은 모바일에서 읽기 좋게 줄바꿈과 번호를 쓴다. 마크다운 표는 쓰지 않는다.`,
    `현재 진행 중 (최대 40):\n${active.map((x) => `#${x.id} ${x.title}${x.owner && x.owner !== ownerName ? ` (담당 ${x.owner})` : ""}${x.due ? ` ~${shortDate(x.due, today)}` : ""}`).join("\n") || "없음"}`,
    `확인 필요한 후보: ${cands.length}건${cands.length ? " (list_tasks status=후보 로 볼 수 있음)" : ""}`,
    calText ? `일정(오늘·내일):\n${calText}` : "일정 없음.",
  ].join("\n\n");
}

/**
 * @returns {{reply, provider, usage, costKrw}}
 */
export async function assistantReply({ text, history = [], gas, cal, cfg, notifier, now = new Date(), impl = {} }) {
  const team = await gas.listTeam();
  const ownerName = cfg.OWNER_NAME;
  const spend = await getSpend(gas, now);
  let provider = pickProvider({ text, cfg, spendKrw: +(spend.claude_krw || 0), historyLen: history.length });
  if (!provider) throw new Error("AI 키가 없습니다 (GEMINI_API_KEY 또는 ANTHROPIC_API_KEY)");
  const system = await buildSystemPrompt({ gas, cal, cfg, team, ownerName, now });
  const ctx = { gas, cal, cfg, team, ownerName, notifier, now };
  const run = (name, input) => runTool(name, input, ctx);
  const messages = [...history.slice(-12).map((h) => ({ role: h.who === "me" ? "user" : "assistant", text: String(h.text || "").slice(0, 2000) })).filter((m) => m.text), { role: "user", text }];
  const chat = { gemini: impl.gemini || geminiChat, claude: impl.claude || claudeChat };
  let out, used = provider;
  try { out = await chat[provider]({ cfg, system, messages, tools: TOOL_DEFS, runTool: run }); }
  catch (e) {
    const other = provider === "gemini" ? "claude" : "gemini";
    if (!cfg[other === "gemini" ? "GEMINI_ENABLED" : "CLAUDE_ENABLED"]) throw e;
    await gas.log("ai_fallback", `${provider} 실패 → ${other}: ${e.message}`);
    used = other; out = await chat[other]({ cfg, system, messages, tools: TOOL_DEFS, runTool: run });
  }
  const { krw } = await recordSpend(gas, used, out.usage, cfg, now);
  return { reply: out.text, provider: used, usage: out.usage, costKrw: krw };
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: { tasks: { type: "array", items: { type: "object", properties: {
    title: { type: "string", description: "짧은 할 일 제목 (명사형, 30자 이내)" },
    owner: { type: "string", description: "담당자: 팀장 본인이면 '나', 팀원이면 그 이름, 모르면 '나'" },
    due: { type: "string", description: "기한 YYYY-MM-DD, 없으면 빈 문자열" },
    due_time: { type: "string", description: "HH:MM 또는 빈 문자열" },
    requested_by: { type: "string", description: "요청한 사람 이름/회사, 없으면 빈 문자열" },
    quote: { type: "string", description: "근거가 된 원문 한 문장" },
  }, required: ["title", "owner", "due", "due_time", "requested_by", "quote"], additionalProperties: false } } },
  required: ["tasks"], additionalProperties: false,
};

/** AI 로 할 일 추출. 실패하면 규칙 추출로 되돌아간다. 반환 형식은 extractTasks 와 같다. */
export async function aiExtractTasks(p) {
  const { text = "", subject = "", sender = "", isOwner = false, team = [], ownerName = "", base, source = "직접", sourceRef = "", cfg, gas, impl = {} } = p;
  const body = `${subject ? `제목: ${subject}\n` : ""}${sender ? `보낸 사람: ${sender}${isOwner ? " (= 팀장 본인)" : ""}\n` : ""}\n${text}`.slice(0, 12000);
  if (!body.trim() || !cfg?.AI_ENABLED) return extractTasks(p);
  const system = `너는 업무 메시지에서 '해야 할 일'만 뽑는 추출기다. 기준일: ${base} (${dowLabel(base)}). 팀장: ${ownerName}. 팀원: ${team.map((m) => m.name).join(", ") || "없음"}.
규칙: 남이 팀장에게 요청/부탁한 것 → owner '나'. 팀장이 팀원에게 시킨 것 → owner 그 팀원. 팀장이 "하겠다"고 약속한 것 → '나'. 이미 끝난 일, 인사, 광고, 단순 정보 공유는 제외. 기한은 기준일로 계산. 없으면 tasks 를 빈 배열로.`;
  const prompt = `출처: ${source}${sourceRef ? ` (${sourceRef})` : ""}\n---\n${body}`;
  const fn = cfg.GEMINI_ENABLED ? (impl.geminiJson || geminiJson) : (impl.claudeJson || claudeJson);
  const provider = cfg.GEMINI_ENABLED ? "gemini" : "claude";
  let data, usage;
  try { ({ data, usage } = await fn({ cfg, system, prompt, schema: EXTRACT_SCHEMA })); }
  catch (e) { if (gas) await gas.log("ai_extract_error", e.message); return extractTasks(p); }
  if (gas) await recordSpend(gas, provider, usage, cfg).catch(() => {});
  const out = [];
  for (const t of data?.tasks || []) {
    const title = String(t.title || "").trim(); if (!title) continue;
    let owner = ownerName, ownerUserId = "";
    const on = String(t.owner || "").trim();
    if (on && on !== "나" && on !== ownerName) { const m = team.find((x) => x.name === on) || team.find((x) => x.name.endsWith(on)); if (m) { owner = m.name; ownerUserId = m.user_id || ""; } }
    out.push({ title: title.slice(0, 70), owner, owner_user_id: ownerUserId, requested_by: String(t.requested_by || "").trim() || (owner !== ownerName ? ownerName : sender), due: /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : "", due_time: /^\d{2}:\d{2}$/.test(t.due_time) ? t.due_time : "", source, source_ref: sourceRef, snippet: String(t.quote || "").slice(0, 200) });
  }
  return out;
}

/** 캡처 이미지 → 대화 텍스트 ("이름: 메시지" 형식) */
export async function aiTranscribeImage({ base64, mime, cfg, gas, impl = {} }) {
  if (!cfg.GEMINI_ENABLED) throw new Error("이미지 읽기는 Gemini 키가 필요합니다 (GEMINI_API_KEY)");
  const prompt = "이 화면 캡처(메신저/카톡/메일)의 글자를 그대로 옮겨 적어라. 대화면 한 줄에 하나씩 '보낸사람: 내용' 형식으로, 내 말풍선(보통 오른쪽·노란색/파란색)은 보낸사람을 '나'로 표시. 날짜·시각 줄은 그대로 남긴다. 설명이나 요약은 하지 말고 텍스트만 출력.";
  const { text, usage } = await (impl.geminiVision || geminiVision)({ cfg, base64, mime, prompt });
  if (gas) await recordSpend(gas, "gemini", usage, cfg).catch(() => {});
  return text;
}

/** AI 가 켜져 있으면 AI 추출, 아니면 규칙 추출 */
export async function extractAny(p) { return p.cfg?.AI_ENABLED ? aiExtractTasks(p) : extractTasks(p); }
