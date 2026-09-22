// lib/brief.js — 봇으로 보내는 문구 만들기 (아침 브리핑, 저녁 일일보고 초안, 팀원 리마인드)
import { shortDate, diffDays, dowLabel, addDays } from "./dates.js";
import { formatEvents } from "./calendar.js";

const line = (t) => `#${t.id} ${t.title}${t.due ? ` (~${shortDate(t.due)}${t.due_time ? " " + t.due_time : ""})` : ""}${t.requested_by ? ` ·${t.requested_by}` : ""}`;

export function isMine(t, ownerName) { return !t.owner || t.owner === ownerName; }

/** 아침 브리핑 */
export function composeMorningBrief({ tasks, team = [], reports = [], today, ownerName, events = null }) {
  const mine = tasks.filter((t) => isMine(t, ownerName));
  const active = (arr) => arr.filter((t) => t.status === "진행");
  const cands = tasks.filter((t) => t.status === "후보");
  const overdue = active(mine).filter((t) => t.due && diffDays(today, t.due) < 0).sort(byDue);
  const dueToday = active(mine).filter((t) => t.due === today);
  const thisWeek = active(mine).filter((t) => t.due && diffDays(today, t.due) > 0 && diffDays(today, t.due) <= 7).sort(byDue);
  const noDue = active(mine).filter((t) => !t.due);
  const parts = [`📋 ${shortDate(today)} 아침 브리핑`];
  if (events) {
    const td = events.filter((e) => e.date === today), tm = events.filter((e) => e.date === addDays(today, 1));
    parts.push(`\n📅 오늘 일정\n${formatEvents(td)}` + (tm.length ? `\n내일\n${formatEvents(tm)}` : ""));
  }

  if (overdue.length) parts.push(`\n🔴 지연 (${overdue.length})\n` + overdue.map((t) => ` ${line(t)} · ${-diffDays(today, t.due)}일 지남`).join("\n"));
  if (dueToday.length) parts.push(`\n🟠 오늘 마감 (${dueToday.length})\n` + dueToday.map((t) => ` ${line(t)}`).join("\n"));
  if (thisWeek.length) parts.push(`\n🟡 이번 주 (${thisWeek.length})\n` + thisWeek.map((t) => ` ${line(t)}`).join("\n"));
  if (noDue.length) parts.push(`\n⚪ 기한 없음 · 진행 중 (${noDue.length})\n` + noDue.slice(0, 8).map((t) => ` ${line(t)}`).join("\n") + (noDue.length > 8 ? `\n … 외 ${noDue.length - 8}건 (웹페이지에서 전체 보기)` : ""));
  if (!overdue.length && !dueToday.length && !thisWeek.length && !noDue.length) parts.push("\n진행 중인 내 업무가 없습니다. '할일 내용 ~날짜'로 추가하세요.");

  const teamActive = tasks.filter((t) => t.owner && t.owner !== ownerName && t.status === "진행");
  if (teamActive.length) {
    const byOwner = group(teamActive, (t) => t.owner);
    parts.push("\n👥 팀원 업무\n" + Object.entries(byOwner).map(([name, arr]) => ` ${name}: ` + arr.sort(byDue).map((t) => `#${t.id} ${t.title}${t.due ? `(~${shortDate(t.due)}${diffDays(today, t.due) < 0 ? "‼" : ""})` : ""}`).join(", ")).join("\n"));
  }
  if (cands.length) {
    parts.push(`\n❓ 확인 필요 · 후보 (${cands.length}) → '확정 번호' 또는 '무시 번호'\n` + cands.slice(0, 10).map((t) => ` #${t.id} [${t.source}] ${t.title}${t.owner && t.owner !== ownerName ? ` →${t.owner}` : ""}${t.due ? ` (~${shortDate(t.due)})` : ""}${t.requested_by ? ` ·${t.requested_by}` : ""}`).join("\n") + (cands.length > 10 ? `\n … 외 ${cands.length - 10}건` : ""));
  }
  if (reports.length) {
    parts.push("\n📝 팀원 보고 (어제)\n" + reports.map((r) => ` ${r.name}: ${oneLine(r.text, 120)}`).join("\n"));
  }
  const missing = team.filter((m) => m.active !== "N" && m.daily_report !== "N" && !reports.some((r) => r.user_id === m.user_id));
  if (team.length && reports.length && missing.length) parts.push(` (미보고: ${missing.map((m) => m.name).join(", ")})`);
  parts.push("\n오늘 할 일을 새로 정리하려면 '정리'라고 답해 주세요.");
  return parts.join("\n");
}

/** 저녁: 일일업무보고 초안 (복사해서 쓰는 용도) */
export function composeDailyReportDraft({ tasks, reports = [], today, ownerName, tomorrow }) {
  const mine = tasks.filter((t) => isMine(t, ownerName));
  const doneToday = mine.filter((t) => t.status === "완료" && String(t.completed_at || "").slice(0, 10) === today);
  const inProgress = mine.filter((t) => t.status === "진행");
  const tmr = inProgress.filter((t) => t.due && t.due <= tomorrow).sort(byDue);
  const rest = inProgress.filter((t) => !tmr.includes(t)).sort(byDue);
  const parts = [`📄 일일업무보고 초안 · ${today.replace(/-/g, ".")}(${dowLabel(today)}) · ${ownerName || ""}`.trim()];
  parts.push("\n[금일 완료]\n" + (doneToday.length ? doneToday.map((t) => ` - ${t.title}`).join("\n") : " - (없음) → '완료 번호'로 표시하면 여기 들어갑니다"));
  parts.push("\n[진행 중]\n" + (rest.length ? rest.slice(0, 12).map((t) => ` - ${t.title}${t.due ? ` (~${shortDate(t.due)})` : ""}`).join("\n") : " - (없음)"));
  parts.push("\n[내일 예정]\n" + (tmr.length ? tmr.map((t) => ` - ${t.title}${t.due ? ` (~${shortDate(t.due)})` : ""}`).join("\n") : " - (없음)"));
  if (reports.length) parts.push("\n[팀원 보고]\n" + reports.map((r) => ` - ${r.name}: ${oneLine(r.text, 150)}`).join("\n"));
  const teamOverdue = tasks.filter((t) => t.owner && t.owner !== ownerName && t.status === "진행" && t.due && diffDays(today, t.due) < 0);
  if (teamOverdue.length) parts.push("\n[팀 지연]\n" + teamOverdue.map((t) => ` - ${t.owner}: ${t.title} (~${shortDate(t.due)})`).join("\n"));
  return parts.join("\n");
}

/** 팀원에게: 기한 임박/지연 리마인드 */
export function composeMemberReminder({ tasks, today, name }) {
  const mine = tasks.filter((t) => t.owner === name && t.status === "진행");
  const overdue = mine.filter((t) => t.due && diffDays(today, t.due) < 0).sort(byDue);
  const soon = mine.filter((t) => t.due && diffDays(today, t.due) >= 0 && diffDays(today, t.due) <= 1).sort(byDue);
  if (!overdue.length && !soon.length) return "";
  const parts = [`⏰ ${name}님, 기한 확인해 주세요`];
  if (overdue.length) parts.push("지연:\n" + overdue.map((t) => ` ${line(t)} · ${-diffDays(today, t.due)}일 지남`).join("\n"));
  if (soon.length) parts.push("오늘·내일 마감:\n" + soon.map((t) => ` ${line(t)}`).join("\n"));
  parts.push("끝낸 일은 '완료 번호'라고 답장해 주세요.");
  return parts.join("\n");
}

export function composeTeamAsk({ today }) {
  return `📝 ${shortDate(today)} 오늘 한 일을 한 줄씩 답장해 주세요.\n(예: 견적서 초안 완료, A사 미팅 준비 중)\n답장은 그대로 팀장에게 정리되어 전달됩니다.`;
}

export function composeTaskList({ tasks, today, title = "목록" }) {
  if (!tasks.length) return `${title}: 없음`;
  return `${title} (${tasks.length})\n` + tasks.sort(byDue).map((t) => ` ${line(t)}${t.status === "후보" ? " [후보]" : ""}${t.status === "보류" ? " [보류]" : ""}${t.due && diffDays(today, t.due) < 0 && t.status === "진행" ? " ‼" : ""}`).join("\n");
}

export function byDue(a, b) { return (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : a.id - b.id; }
function group(arr, keyFn) { const o = {}; for (const x of arr) (o[keyFn(x)] ||= []).push(x); return o; }
function oneLine(s, n) { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; }
