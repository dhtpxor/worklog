// api/ical.js — 폰 기본 캘린더에서 '구독'할 수 있는 iCal 주소: https://<주소>/api/ical?key=<TICK_KEY>
import { env } from "../lib/env.js";
import { GasClient } from "../lib/gas.js";
import { SheetCalendar, buildIcsFeed } from "../lib/calendar.js";
import { todayISO, addDays } from "../lib/dates.js";

export default async function handler(req, res) {
  if (!env.TICK_KEY || String(req.query?.key || "") !== env.TICK_KEY) return res.status(401).end("key");
  try {
    const today = todayISO();
    const events = await new SheetCalendar({ gas: new GasClient() }).listEvents({ start: addDays(today, -90), end: addDays(today, 365) });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    return res.status(200).end(buildIcsFeed(events));
  } catch (e) { return res.status(500).end(String(e.message)); }
}
