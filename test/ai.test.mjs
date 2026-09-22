import test from "node:test";
import assert from "node:assert/strict";
import { MemoryGas } from "../lib/gas.js";
import { MemoryCalendar, SheetCalendar, buildIcsFeed, formatEvents } from "../lib/calendar.js";
import { pickProvider, estimateCostKrw, recordSpend, getSpend } from "../lib/ai/router.js";
import { TOOL_DEFS, runTool } from "../lib/ai/tools.js";
import { assistantReply, aiExtractTasks, buildSystemPrompt } from "../lib/ai/assistant.js";
import { geminiChat, geminiJson } from "../lib/ai/gemini.js";
import { claudeChat } from "../lib/ai/claude.js";
import { composeMorningBrief } from "../lib/brief.js";

const cfg = { OWNER_NAME: "박팀장", GEMINI_ENABLED: true, CLAUDE_ENABLED: true, AI_ENABLED: true, AI_BUDGET_KRW: 10000, USD_KRW: 1400, GEMINI_USD_IN: 0.3, GEMINI_USD_OUT: 2.5, CLAUDE_USD_IN: 5, CLAUDE_USD_OUT: 25, GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", GEMINI_MODEL: "gemini-2.5-flash", CLAUDE_MODEL: "claude-opus-5" };
const now = new Date("2026-09-22T01:00:00Z");

test("배분 규칙: 짧은 말·명령은 Gemini, 분석·작성·긴 글은 Claude, 예산 초과면 Gemini", () => {
  assert.equal(pickProvider({ text: "오늘 뭐 해야 해?", cfg }), "gemini");
  assert.equal(pickProvider({ text: "내일 3시 A사 미팅 잡아줘", cfg }), "gemini");
  assert.equal(pickProvider({ text: "이번 분기 영업 결과를 분석해서 보고서 초안 써줘", cfg }), "claude");
  assert.equal(pickProvider({ text: "A".repeat(700), cfg }), "claude");
  assert.equal(pickProvider({ text: "이번 분기 영업 결과를 분석해서 보고서 초안 써줘", cfg, spendKrw: 12000 }), "gemini");
  assert.equal(pickProvider({ text: "분석해줘 길게", cfg: { ...cfg, GEMINI_ENABLED: false } }), "claude");
  assert.equal(pickProvider({ text: "분석해줘 길게", cfg: { ...cfg, CLAUDE_ENABLED: false } }), "gemini");
  assert.equal(pickProvider({ text: "x", cfg: { ...cfg, GEMINI_ENABLED: false, CLAUDE_ENABLED: false } }), "");
});

test("비용 추정과 월 누적", async () => {
  assert.equal(estimateCostKrw("claude", { input: 1_000_000, output: 0 }, cfg), 7000);
  const gas = new MemoryGas();
  await recordSpend(gas, "claude", { input: 100000, output: 10000 }, cfg, now);
  await recordSpend(gas, "gemini", { input: 100000, output: 10000 }, cfg, now);
  const s = await getSpend(gas, now);
  assert.equal(s.key, "ai_spend_2026-09"); assert.equal(s.calls, 2); assert.ok(s.claude_krw > s.gemini_krw);
});

test("도구: add_task/update_task/list_tasks/create_event/get_calendar", async () => {
  const gas = new MemoryGas(); const cal = new MemoryCalendar([{ title: "주간회의", date: "2026-09-22", time: "10:00", endTime: "10:30", allDay: false, location: "" }]);
  gas.team.push({ name: "김철수", user_id: "", email: "kim@x.com", active: "Y", daily_report: "Y", role: "대리" });
  const sent = []; const notifier = { toMember: async (m, text) => { sent.push({ to: m.email, text }); return "mail"; } };
  const ctx = { gas, cal, cfg, team: gas.team, ownerName: "박팀장", notifier, now };
  let r = await runTool("add_task", { title: "견적서 보내기", due: "2026-09-25", due_time: "", owner: "", requested_by: "A사" }, ctx);
  assert.match(r, /등록: #1 견적서 보내기 · 담당 박팀장 · ~9\/25/);
  r = await runTool("add_task", { title: "주간보고 취합", due: "2026-09-23", due_time: "", owner: "철수", requested_by: "" }, ctx);
  assert.match(r, /담당 김철수.*알림 보냄/); assert.equal(sent[0].to, "kim@x.com");
  r = await runTool("add_task", { title: "x", due: "", due_time: "", owner: "홍길동", requested_by: "" }, ctx);
  assert.match(r, /실패: '홍길동' 팀원이 없습니다/);
  r = await runTool("update_task", { id: 1, status: "완료", due: "", owner: "", title: "" }, ctx);
  assert.match(r, /#1 견적서 보내기 · 완료/);
  r = await runTool("list_tasks", { status: "진행", owner: "" }, ctx);
  assert.match(r, /#2 \[진행\] 주간보고 취합 \(담당 김철수\)/); assert.doesNotMatch(r, /#1/);
  r = await runTool("get_calendar", { from: "2026-09-22", to: "2026-09-22" }, ctx);
  assert.match(r, /10:00~10:30 주간회의/);
  r = await runTool("create_event", { title: "A사 미팅", date: "2026-09-23", start_time: "15:00", end_time: "", location: "강남", description: "" }, ctx);
  assert.match(r, /일정 등록: \[일정 \d+\] 9\/23\(수\) 내일 15:00~16:00 A사 미팅 @강남/);
  assert.equal(cal.created[0].title, "A사 미팅");
  r = await runTool("resolve_date", { text: "다음 주 수요일 오후 2시" }, ctx);
  assert.match(r, /^2026-09-30 14:00/);
  r = await runTool("morning_brief", {}, ctx);
  assert.match(r, /📅 오늘 일정\n 10:00~10:30 주간회의/);
  assert.ok(TOOL_DEFS.every((t) => t.input_schema.additionalProperties === false));
});

test("비서: 가짜 Gemini 가 도구를 호출하고 답한다 · Gemini 실패 시 Claude 로 폴백 · 비용 기록", async () => {
  const gas = new MemoryGas(); const cal = new MemoryCalendar();
  const fakeGemini = async ({ system, messages, tools, runTool }) => {
    assert.match(system, /지금: 2026-09-22 \(화\)/); assert.ok(tools.length >= 8);
    const r = await runTool("add_task", { title: "A사 견적서", due: "2026-09-23", due_time: "", owner: "", requested_by: "" });
    return { text: `등록했습니다. ${r}`, usage: { input: 500, output: 50, tools: 1 } };
  };
  let r = await assistantReply({ text: "내일까지 A사 견적서 보내야 해", gas, cal, cfg, now, impl: { gemini: fakeGemini } });
  assert.equal(r.provider, "gemini"); assert.match(r.reply, /#1 A사 견적서/); assert.equal(gas.tasks.length, 1);
  assert.ok(r.costKrw > 0);
  const failing = async () => { throw new Error("quota"); };
  const fakeClaude = async () => ({ text: "클로드 답", usage: { input: 10, output: 10, tools: 0 } });
  r = await assistantReply({ text: "안녕", gas, cal, cfg, now, impl: { gemini: failing, claude: fakeClaude } });
  assert.equal(r.provider, "claude"); assert.equal(r.reply, "클로드 답");
  assert.ok(gas.logs.some((l) => l.type === "ai_fallback"));
  const sp = await getSpend(gas, now); assert.equal(sp.calls, 2);
});

test("AI 추출: 가짜 Gemini JSON → 후보 형식, 실패하면 규칙 추출", async () => {
  const team = [{ name: "김철수", user_id: "u1" }];
  const fake = async () => ({ data: { tasks: [{ title: "제안서 수정본 보내기", owner: "나", due: "2026-09-25", due_time: "", requested_by: "A사 김대리", quote: "25일까지 보내주세요" }, { title: "주간보고 취합", owner: "철수", due: "", due_time: "", requested_by: "", quote: "" }] }, usage: { input: 100, output: 50 } });
  const gas = new MemoryGas();
  const r = await aiExtractTasks({ text: "A사 김대리: 제안서 수정본 25일까지 보내주세요", team, ownerName: "박팀장", base: "2026-09-22", source: "카카오톡", sourceRef: "A사", cfg, gas, impl: { geminiJson: fake } });
  assert.equal(r.length, 2); assert.equal(r[0].owner, "박팀장"); assert.equal(r[0].due, "2026-09-25"); assert.equal(r[1].owner, "김철수"); assert.equal(r[1].owner_user_id, "u1"); assert.equal(r[1].requested_by, "박팀장");
  const bad = async () => { throw new Error("down"); };
  const r2 = await aiExtractTasks({ text: "박팀장님 계약서 검토 부탁드립니다 9/30까지요", sender: "외부", team, ownerName: "박팀장", base: "2026-09-22", cfg, gas, impl: { geminiJson: bad } });
  assert.equal(r2[0].title, "계약서 검토"); assert.ok(gas.logs.some((l) => l.type === "ai_extract_error"));
});

test("Gemini REST 형식: functionDeclarations 변환과 functionResponse 왕복 (fetch 가짜)", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body); seen.push(body);
    assert.ok(url.includes("/models/gemini-2.5-flash:generateContent")); assert.equal(opts.headers["x-goog-api-key"], "g");
    const json = seen.length === 1
      ? { candidates: [{ content: { parts: [{ functionCall: { name: "list_tasks", args: { status: "진행", owner: "" } } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }
      : { candidates: [{ content: { parts: [{ text: "진행 중 1건입니다" }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 } };
    return { ok: true, json: async () => json };
  };
  const r = await geminiChat({ cfg, system: "s", messages: [{ role: "user", text: "목록" }], tools: TOOL_DEFS, runTool: async () => "#1 [진행] x", fetchImpl });
  assert.equal(r.text, "진행 중 1건입니다"); assert.equal(r.usage.input, 30); assert.equal(r.usage.tools, 1);
  assert.equal(seen[0].tools[0].functionDeclarations[0].name, "add_task");
  assert.equal(JSON.stringify(seen[0]).includes("additionalProperties"), false, "Gemini 는 additionalProperties 를 모른다");
  assert.equal(seen[1].contents[2].parts[0].functionResponse.response.result, "#1 [진행] x");
  const j = await geminiJson({ cfg, system: "s", prompt: "p", schema: { type: "object", properties: { ok: { type: "boolean" } } }, fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: {} }) }) });
  assert.equal(j.data.ok, true);
});

test("Claude 수동 루프: tool_use → tool_result → end_turn (SDK 가짜)", async () => {
  let n = 0; const calls = [];
  const fakeClient = { beta: { messages: { create: async (p) => { calls.push(p); n++; return n === 1
    ? { stop_reason: "tool_use", content: [{ type: "text", text: "확인할게요" }, { type: "tool_use", id: "t1", name: "list_tasks", input: { status: "진행", owner: "나" } }], usage: { input_tokens: 100, output_tokens: 20 } }
    : { stop_reason: "end_turn", content: [{ type: "text", text: "진행 중 1건: #1 x" }], usage: { input_tokens: 150, output_tokens: 30 } }; } } }, messages: { create: async () => { throw new Error("should use beta"); } } };
  const r = await claudeChat({ cfg, system: "s", messages: [{ role: "user", text: "내 일 뭐 있어" }], tools: TOOL_DEFS, runTool: async (name) => `${name} ok`, clientImpl: fakeClient });
  assert.equal(r.text, "진행 중 1건: #1 x"); assert.equal(r.usage.input, 250); assert.equal(r.usage.tools, 1);
  assert.equal(calls[0].model, "claude-opus-5"); assert.equal(calls[0].fallbacks, "default"); assert.ok(calls[0].tools[0].strict);
  assert.equal(calls[1].messages[2].content[0].type, "tool_result"); assert.equal(calls[1].messages[2].content[0].content, "list_tasks ok");
});

test("달력: 시트 저장 달력 조회/등록/수정/삭제, iCal 피드, 브리핑 표시", async () => {
  const gas = new MemoryGas(); const cal = new SheetCalendar({ gas });
  const a = await cal.createEvent({ title: "A사 미팅", date: "2026-09-23", startTime: "15:00", location: "강남" });
  assert.equal(a.endTime, "16:00"); assert.equal(a.allDay, false);
  const b = await cal.createEvent({ title: "휴가", date: "2026-09-24" });
  assert.equal(b.allDay, true);
  let ev = await cal.listEvents({ start: "2026-09-23", end: "2026-09-24" });
  assert.deepEqual(ev.map((e) => e.title), ["A사 미팅", "휴가"]);
  await cal.updateEvent(a.id, { startTime: "16:00", endTime: "17:00" });
  ev = await cal.listEvents({ start: "2026-09-23" }); assert.equal(ev[0].time, "16:00");
  await cal.deleteEvent(b.id);
  assert.equal((await cal.listEvents({ start: "2026-09-24" })).length, 0);
  const ics = buildIcsFeed(await cal.listEvents({ start: "2026-09-01", end: "2026-09-30" }));
  assert.match(ics, /DTSTART;TZID=Asia\/Seoul:20260923T160000/); assert.match(ics, /SUMMARY:A사 미팅/);
  assert.equal(formatEvents([]), "일정 없음");
  const brief = composeMorningBrief({ tasks: [], today: "2026-09-22", ownerName: "박팀장", events: [{ title: "주간회의", date: "2026-09-22", time: "10:00", endTime: "10:30", allDay: false }, { title: "출장", date: "2026-09-23", allDay: true, time: "" }] });
  assert.match(brief, /📅 오늘 일정\n 10:00~10:30 주간회의\n내일\n 종일 출장/);
  // 도구로 일정 수정/삭제
  const ctx = { gas, cal, cfg, team: [], ownerName: "박팀장", now };
  const r = await runTool("update_event", { id: a.id, delete: false, title: "A사 본사 미팅", date: "", start_time: "", end_time: "", location: "" }, ctx);
  assert.match(r, /일정 수정: 9\/23\(수\) 내일 16:00~17:00 A사 본사 미팅/);
  assert.match(await runTool("get_calendar", { from: "2026-09-23", to: "2026-09-23" }, ctx), /^\[일정 1\]/);
  assert.equal(await runTool("update_event", { id: a.id, delete: true, title: "", date: "", start_time: "", end_time: "", location: "" }, ctx), `일정 ${a.id} 삭제`);
});
