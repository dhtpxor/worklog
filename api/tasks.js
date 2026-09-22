// api/tasks.js — 웹페이지용. GET: 전체 데이터, POST: {op, id, patch | task}
import { env } from "../lib/env.js";
import { GasClient } from "../lib/gas.js";
import { WorksClient } from "../lib/works.js";
import { Mailer } from "../lib/mailer.js";
import { Notifier } from "../lib/notify.js";
import { SheetCalendar } from "../lib/calendar.js";
import { readJson, checkPin, ok, fail } from "../lib/http.js";
import { todayISO, addDays, parseKoreanDate, shortDate } from "../lib/dates.js";
import { toTitle } from "../lib/extract.js";
import { matchMember } from "../lib/commands.js";

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  const gas = new GasClient();
  try {
    const today = todayISO();
    if (req.method === "GET") {
      const cal = new SheetCalendar({ gas });
      const [tasks, team, reports, events] = await Promise.all([gas.listTasks(), gas.listTeam(), gas.listReports({ since: addDays(today, -7) }),
        cal.listEvents({ start: today, end: addDays(today, 1) }).catch((e) => ({ error: e.message }))]);
      return ok(res, { today, ownerName: env.OWNER_NAME, tasks: tasks.filter((t) => t.status !== "삭제"), team, reports, events, ai: env.AI_ENABLED, gemini: env.GEMINI_ENABLED, calendar: true });
    }
    if (req.method !== "POST") return res.status(405).end();
    const body = await readJson(req);
    const team = await gas.listTeam();
    if (body.op === "add") {
      const t = body.task || {};
      let due = t.due || "";
      if (!due && t.dueText) { const d = parseKoreanDate(t.dueText, today); if (d) due = d.due; }
      const member = t.owner && t.owner !== env.OWNER_NAME ? matchMember(t.owner, team) : null;
      const [added] = await gas.addTasks([{ title: toTitle(t.title) || String(t.title || "").trim(), owner: member ? member.name : env.OWNER_NAME, owner_user_id: member?.user_id || "", requested_by: member ? env.OWNER_NAME : "", due, due_time: t.due_time || "", status: t.status || "진행", source: "직접", source_ref: "웹", snippet: t.snippet || "" }]);
      if (member) { const st = await gas.getState(["owner_user_id"]); const n = new Notifier({ works: new WorksClient(), mailer: new Mailer(), cfg: env, ownerUserId: st.owner_user_id }); await n.toMember(member, `📌 새 업무: #${added.id} ${added.title}${due ? ` (~${shortDate(due, today)})` : ""}\n끝내면 '완료 ${added.id}'라고 답장해 주세요.`, `새 업무 #${added.id} ${added.title}`).catch(() => {}); }
      return ok(res, added);
    }
    if (body.op === "update") {
      const patch = { ...(body.patch || {}) };
      if (patch.dueText !== undefined) { const d = parseKoreanDate(patch.dueText, today); if (!d) return fail(res, `날짜를 못 읽었습니다: ${patch.dueText}`, 400); patch.due = d.due; delete patch.dueText; }
      if (patch.status === "완료") patch.completed_at = new Date().toISOString();
      if (patch.owner !== undefined) { const member = matchMember(patch.owner, team); patch.owner = member ? member.name : (patch.owner || env.OWNER_NAME); patch.owner_user_id = member?.user_id || ""; }
      return ok(res, await gas.updateTask(+body.id, patch));
    }
    if (body.op === "team") {
      return ok(res, await gas.upsertTeam(body.member));
    }
    return fail(res, "unknown op", 400);
  } catch (e) { return fail(res, e); }
}
