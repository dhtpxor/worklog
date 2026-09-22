// api/events.js — 달력 탭. GET ?from&to  /  POST {op:'add'|'update'|'delete', id, event}
import { GasClient } from "../lib/gas.js";
import { SheetCalendar } from "../lib/calendar.js";
import { readJson, checkPin, ok, fail } from "../lib/http.js";
import { todayISO, parseKoreanDate, parseKoreanTime } from "../lib/dates.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  const gas = new GasClient(); const cal = new SheetCalendar({ gas });
  try {
    const today = todayISO();
    if (req.method === "GET") {
      const from = String(req.query?.from || today), to = String(req.query?.to || from);
      return ok(res, { today, events: await cal.listEvents({ start: from, end: to }) });
    }
    if (req.method !== "POST") return res.status(405).end();
    const b = await readJson(req);
    const e = b.event || {};
    if (b.op === "add") {
      let date = e.date; if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) { const d = parseKoreanDate(e.dateText || "", today); if (!d) return fail(res, "날짜를 못 읽었습니다", 400); date = d.due; }
      const startTime = /^\d{2}:\d{2}$/.test(e.startTime || "") ? e.startTime : parseKoreanTime(e.timeText || "");
      return ok(res, await cal.createEvent({ title: e.title, date, startTime, endTime: /^\d{2}:\d{2}$/.test(e.endTime || "") ? e.endTime : "", location: e.location || "", description: e.description || "" }));
    }
    if (b.op === "update") return ok(res, await cal.updateEvent(+b.id, e));
    if (b.op === "delete") { await cal.deleteEvent(+b.id); return ok(res, true); }
    return fail(res, "unknown op", 400);
  } catch (err) { return fail(res, err); }
}
