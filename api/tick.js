// api/tick.js — 정기 작업 진입점. Apps Script 시간 트리거(매시간)와 Vercel cron(하루 1회)이 부른다.
//   호출: GET /api/tick?key=<TICK_KEY>            (평소)
//         GET /api/tick?key=<TICK_KEY>&force=brief (지금 당장 브리핑; mail/remind/ask/evening 도 가능)
import { env } from "../lib/env.js";
import { GasClient } from "../lib/gas.js";
import { WorksClient } from "../lib/works.js";
import { Mailer } from "../lib/mailer.js";
import { SheetCalendar } from "../lib/calendar.js";
import { fetchNewMail } from "../lib/mail.js";
import { runTick } from "../lib/jobs.js";

export default async function handler(req, res) {
  const key = String(req.query?.key || "");
  const auth = String(req.headers["authorization"] || "");
  const fromCron = env.CRON_SECRET && auth === `Bearer ${env.CRON_SECRET}`;
  if (!fromCron && (!env.TICK_KEY || key !== env.TICK_KEY)) return res.status(401).json({ ok: false, error: "key" });
  const gas = new GasClient();
  const works = new WorksClient();
  try {
    const out = await runTick({ gas, works, mailer: new Mailer(), cal: new SheetCalendar({ gas }), cfg: env, fetchMail: env.IMAP_ENABLED ? fetchNewMail : null, force: String(req.query?.force || "") });
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    await gas.log("tick_error", e.message);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
