// api/vision.js — 캡처 이미지 → 텍스트 (Gemini). POST { image: base64, mime }
import { env } from "../lib/env.js";
import { GasClient } from "../lib/gas.js";
import { readJson, checkPin, ok, fail } from "../lib/http.js";
import { aiTranscribeImage } from "../lib/ai/assistant.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  const body = await readJson(req);
  if (!body.image) return fail(res, "image 가 비어 있습니다", 400);
  try { return ok(res, { text: await aiTranscribeImage({ base64: String(body.image).replace(/^data:[^;]+;base64,/, ""), mime: body.mime || "image/png", cfg: env, gas: new GasClient() }) }); }
  catch (e) { return fail(res, e); }
}
