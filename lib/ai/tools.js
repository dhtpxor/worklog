// lib/ai/tools.js — AI 비서가 쓰는 도구 (Gemini·Claude 공용 JSON Schema + 실행기)
import { parseKoreanDate, parseKoreanTime, addDays, shortDate, todayISO } from "../dates.js";
import { matchMember } from "../commands.js";
import { composeMorningBrief, composeDailyReportDraft, byDue } from "../brief.js";
import { formatEvents, describeEvent } from "../calendar.js";

const STATUS = ["후보", "진행", "완료", "보류", "삭제"];

export const TOOL_DEFS = [
  { name: "add_task", description: "할 일을 하나 등록한다. 담당자를 비우면 사용자(팀장) 본인의 일. 팀원 이름을 주면 그 팀원에게 지시하고 알림을 보낸다.",
    input_schema: { type: "object", properties: {
      title: { type: "string", description: "짧은 제목 (예: 'A사 견적서 보내기')" },
      due: { type: "string", description: "기한 YYYY-MM-DD. 없으면 빈 문자열" },
      due_time: { type: "string", description: "시각 HH:MM. 없으면 빈 문자열" },
      owner: { type: "string", description: "담당 팀원 이름. 본인 일이면 빈 문자열" },
      requested_by: { type: "string", description: "요청한 사람(외부 거래처 등). 없으면 빈 문자열" },
    }, required: ["title", "due", "due_time", "owner", "requested_by"], additionalProperties: false } },
  { name: "update_task", description: "번호(id)로 할 일을 수정한다: 상태 변경(완료/보류/삭제/진행), 기한, 담당, 제목. 후보를 확정하려면 status='진행', 무시하려면 '삭제'.",
    input_schema: { type: "object", properties: {
      id: { type: "integer" },
      status: { type: "string", enum: ["", ...STATUS], description: "바꾸지 않으면 빈 문자열" },
      due: { type: "string", description: "YYYY-MM-DD, 바꾸지 않으면 빈 문자열, 지우려면 'none'" },
      owner: { type: "string", description: "팀원 이름 또는 '나'. 바꾸지 않으면 빈 문자열" },
      title: { type: "string", description: "바꾸지 않으면 빈 문자열" },
    }, required: ["id", "status", "due", "owner", "title"], additionalProperties: false } },
  { name: "list_tasks", description: "할 일 목록을 본다. status: 진행/후보/완료/보류/전체. owner: 팀원 이름, '나', 또는 빈 문자열(모두).",
    input_schema: { type: "object", properties: { status: { type: "string" }, owner: { type: "string" } }, required: ["status", "owner"], additionalProperties: false } },
  { name: "list_team", description: "팀원 목록과 각자의 진행 중 업무 수", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_calendar", description: "달력 일정을 본다 (from~to, YYYY-MM-DD, 양끝 포함). 일정 번호(id)도 함께 나온다.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"], additionalProperties: false } },
  { name: "create_event", description: "달력에 일정을 등록한다. 시각이 없으면 종일 일정.",
    input_schema: { type: "object", properties: {
      title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" },
      start_time: { type: "string", description: "HH:MM 또는 빈 문자열" }, end_time: { type: "string", description: "HH:MM 또는 빈 문자열(1시간)" },
      location: { type: "string" }, description: { type: "string" },
    }, required: ["title", "date", "start_time", "end_time", "location", "description"], additionalProperties: false } },
  { name: "update_event", description: "일정 번호(id)로 일정을 수정하거나(제목/날짜/시각/장소) 삭제한다(delete=true). 바꾸지 않는 칸은 빈 문자열.",
    input_schema: { type: "object", properties: {
      id: { type: "integer" }, delete: { type: "boolean" }, title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD 또는 빈 문자열" },
      start_time: { type: "string", description: "HH:MM, 종일로 바꾸려면 'none', 그대로면 빈 문자열" }, end_time: { type: "string" }, location: { type: "string" },
    }, required: ["id", "delete", "title", "date", "start_time", "end_time", "location"], additionalProperties: false } },
  { name: "morning_brief", description: "아침 브리핑 텍스트(지연·오늘 마감·이번 주·팀원·후보·일정)를 만든다", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "daily_report_draft", description: "오늘의 일일업무보고 초안(금일 완료·진행·내일 예정·팀원 보고)을 만든다", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "resolve_date", description: "한국어 날짜 표현('다음 주 수요일', '월말', '25일까지')을 YYYY-MM-DD로 바꾼다. 확신이 없을 때만 사용.",
    input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } },
];

/** 도구 실행. ctx: { gas, cal, cfg, team, ownerName, notifier, now } */
export async function runTool(name, input, ctx) {
  const { gas, cal, cfg, team, ownerName, notifier } = ctx;
  const today = todayISO(ctx.now);
  const args = input || {};
  const s = (k) => String(args[k] ?? "").trim();
  try {
    switch (name) {
      case "add_task": {
        const member = s("owner") && s("owner") !== ownerName && s("owner") !== "나" ? matchMember(s("owner"), team) : null;
        if (s("owner") && !member && s("owner") !== ownerName && s("owner") !== "나") return `실패: '${s("owner")}' 팀원이 없습니다. 등록된 팀원: ${team.map((m) => m.name).join(", ") || "없음"}`;
        const due = /^\d{4}-\d{2}-\d{2}$/.test(s("due")) ? s("due") : "";
        const [t] = await gas.addTasks([{ title: s("title"), owner: member ? member.name : ownerName, owner_user_id: member?.user_id || "", requested_by: s("requested_by") || (member ? ownerName : ""), due, due_time: /^\d{2}:\d{2}$/.test(s("due_time")) ? s("due_time") : "", status: "진행", source: "직접", source_ref: "AI 대화" }]);
        let via = "";
        if (member && notifier) via = await notifier.toMember(member, `📌 새 업무: #${t.id} ${t.title}${due ? ` (~${shortDate(due, today)})` : ""}\n끝내면 '완료 ${t.id}'라고 답장해 주세요.`, `새 업무 #${t.id} ${t.title}`).catch(() => "");
        return `등록: #${t.id} ${t.title} · 담당 ${t.owner}${due ? ` · ~${shortDate(due, today)}` : " · 기한 없음"}${member ? (via ? " · 알림 보냄" : " · 알림 미연결") : ""}`;
      }
      case "update_task": {
        const id = +args.id; const patch = {};
        if (s("status") && STATUS.includes(s("status"))) { patch.status = s("status"); if (s("status") === "완료") patch.completed_at = new Date(ctx.now || Date.now()).toISOString(); }
        if (s("due") === "none") patch.due = ""; else if (/^\d{4}-\d{2}-\d{2}$/.test(s("due"))) patch.due = s("due");
        if (s("owner")) { if (s("owner") === "나" || s("owner") === ownerName) { patch.owner = ownerName; patch.owner_user_id = ""; } else { const m = matchMember(s("owner"), team); if (!m) return `실패: '${s("owner")}' 팀원이 없습니다`; patch.owner = m.name; patch.owner_user_id = m.user_id || ""; } }
        if (s("title")) patch.title = s("title");
        if (!Object.keys(patch).length) return "바꿀 내용이 없습니다";
        const t = await gas.updateTask(id, patch);
        return `수정: #${t.id} ${t.title} · ${t.status}${t.due ? ` · ~${shortDate(t.due, today)}` : ""} · 담당 ${t.owner || ownerName}`;
      }
      case "list_tasks": {
        let tasks = (await gas.listTasks()).filter((t) => t.status !== "삭제");
        const st = s("status"); const ow = s("owner");
        if (st && st !== "전체") tasks = tasks.filter((t) => t.status === st); else if (!st) tasks = tasks.filter((t) => t.status === "진행");
        if (ow === "나") tasks = tasks.filter((t) => !t.owner || t.owner === ownerName); else if (ow) { const m = matchMember(ow, team); tasks = tasks.filter((t) => t.owner === (m ? m.name : ow)); }
        if (!tasks.length) return "해당 항목 없음";
        return tasks.sort(byDue).slice(0, 60).map((t) => `#${t.id} [${t.status}] ${t.title}${t.owner && t.owner !== ownerName ? ` (담당 ${t.owner})` : ""}${t.due ? ` ~${shortDate(t.due, today)}` : ""}${t.requested_by ? ` ·${t.requested_by}` : ""}${t.status === "후보" ? ` [${t.source}]` : ""}`).join("\n");
      }
      case "list_team": {
        const tasks = (await gas.listTasks()).filter((t) => t.status === "진행");
        return team.filter((m) => m.active !== "N").map((m) => `${m.name}${m.role ? `(${m.role})` : ""}: 진행 ${tasks.filter((t) => t.owner === m.name).length}건${m.email || m.user_id ? "" : " · 알림 미연결"}`).join("\n") || "팀원 없음";
      }
      case "get_calendar": {
        if (!cal?.enabled) return "달력을 쓸 수 없습니다 (구글 시트 미연결)";
        const ev = await cal.listEvents({ start: s("from") || today, end: s("to") || s("from") || today });
        if (!ev.length) return "일정 없음";
        return ev.map((e) => `[일정 ${e.id}] ${describeEvent(e, today)}`).join("\n");
      }
      case "create_event": {
        if (!cal?.enabled) return "달력을 쓸 수 없습니다";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s("date"))) return "실패: date 는 YYYY-MM-DD";
        const r = await cal.createEvent({ title: s("title"), date: s("date"), startTime: /^\d{2}:\d{2}$/.test(s("start_time")) ? s("start_time") : "", endTime: /^\d{2}:\d{2}$/.test(s("end_time")) ? s("end_time") : "", location: s("location"), description: s("description") });
        return `일정 등록: [일정 ${r.id}] ${describeEvent(r, today)}`;
      }
      case "update_event": {
        if (!cal?.enabled) return "달력을 쓸 수 없습니다";
        const id = +args.id;
        if (args.delete === true) { await cal.deleteEvent(id); return `일정 ${id} 삭제`; }
        const patch = {};
        if (s("title")) patch.title = s("title");
        if (/^\d{4}-\d{2}-\d{2}$/.test(s("date"))) patch.date = s("date");
        if (s("start_time") === "none") { patch.startTime = ""; patch.endTime = ""; } else if (/^\d{2}:\d{2}$/.test(s("start_time"))) patch.startTime = s("start_time");
        if (/^\d{2}:\d{2}$/.test(s("end_time"))) patch.endTime = s("end_time");
        if (s("location")) patch.location = s("location");
        if (!Object.keys(patch).length) return "바꿀 내용이 없습니다";
        const e = await cal.updateEvent(id, patch);
        return `일정 수정: ${describeEvent(e, today)}`;
      }
      case "morning_brief": {
        const tasks = (await gas.listTasks()).filter((t) => t.status !== "삭제");
        const reports = await gas.listReports({ date: addDays(today, -1) });
        let events = []; if (cal?.enabled) { try { events = await cal.listEvents({ start: today, end: today }); } catch {} }
        return composeMorningBrief({ tasks, team, reports, today, ownerName, events });
      }
      case "daily_report_draft": {
        const tasks = (await gas.listTasks()).filter((t) => t.status !== "삭제");
        const reports = await gas.listReports({ date: today });
        return composeDailyReportDraft({ tasks, reports, today, ownerName, tomorrow: addDays(today, 1) });
      }
      case "resolve_date": {
        const d = parseKoreanDate(s("text"), today); const t = parseKoreanTime(s("text"));
        return d ? `${d.due}${t ? " " + t : ""} (${shortDate(d.due, today)})` : "해석 불가";
      }
      default: return `알 수 없는 도구: ${name}`;
    }
  } catch (e) { return `오류: ${e.message}`; }
}
