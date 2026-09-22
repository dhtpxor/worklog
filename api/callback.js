// api/callback.js — 네이버웍스 봇 Callback URL: https://<프로젝트>.vercel.app/api/callback
// 봇이 받은 메시지를 서명 검증 후 처리한다. 네이버웍스는 빠른 200 응답을 기대하므로 답장은 API 로 따로 보낸다.
import { env } from "../lib/env.js";
import { GasClient } from "../lib/gas.js";
import { WorksClient, verifySignature } from "../lib/works.js";
import { Mailer } from "../lib/mailer.js";
import { handleEvent } from "../lib/commands.js";
import { readRaw } from "../lib/http.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ ok: true, hint: "네이버웍스 Callback URL 로 이 주소를 등록하세요 (POST)" });
  if (req.method !== "POST") return res.status(405).end();
  const raw = await readRaw(req);
  if (!verifySignature(raw, req.headers["x-works-signature"])) return res.status(401).json({ ok: false, error: "signature" });
  let event; try { event = JSON.parse(raw); } catch { return res.status(400).json({ ok: false, error: "json" }); }

  const gas = new GasClient();
  const works = new WorksClient();
  try {
    const r = await handleEvent({ event, gas, works, mailer: new Mailer(), cfg: env });
    if (r.reply) {
      const userId = event.source?.userId; const channelId = event.source?.channelId;
      if (works.enabled) { if (channelId) await works.sendToChannel(channelId, r.reply); else await works.sendToUser(userId, r.reply); }
    }
    return res.status(200).json({ ok: true, replied: Boolean(r.reply), added: r.added?.length || 0 });
  } catch (e) {
    await gas.log("callback_error", e.message);
    try { if (works.enabled && event.source?.userId && !event.source?.channelId) await works.sendToUser(event.source.userId, `⚠️ 처리 중 오류: ${e.message}`); } catch {}
    return res.status(200).json({ ok: false, error: e.message }); // 200: 네이버웍스가 재시도 폭주하지 않도록
  }
}
