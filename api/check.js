// api/check.js — 설정 점검: 어떤 환경변수가 비었는지, 시트/네이버웍스/메일 연결이 되는지 한 번에 확인
import { env } from "../lib/env.js";
import { GasClient } from "../lib/gas.js";
import { WorksClient } from "../lib/works.js";
import { testMailLogin } from "../lib/mail.js";
import { Mailer } from "../lib/mailer.js";
import { geminiJson } from "../lib/ai/gemini.js";
import { claudeJson } from "../lib/ai/claude.js";
import { getSpend } from "../lib/ai/router.js";
import { checkPin, ok } from "../lib/http.js";

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  const r = { env: {}, sheet: null, works: null, mail: null, smtp: null, owner: null, gemini: null, claude: null, calendar: null, aiSpend: null };
  for (const k of ["GAS_URL", "GAS_TOKEN", "OWNER_NAME", "ADMIN_PIN", "TICK_KEY", "WORKS_CLIENT_ID", "WORKS_CLIENT_SECRET", "WORKS_SERVICE_ACCOUNT", "WORKS_PRIVATE_KEY", "WORKS_BOT_ID", "WORKS_BOT_SECRET", "MAIL_HOST", "MAIL_USER", "MAIL_PASS", "SMTP_HOST", "OWNER_EMAIL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"]) {
    r.env[k] = env[k] ? "설정됨" : "비어 있음";
  }
  const gas = new GasClient();
  try { await gas.ping(); const st = await gas.getState(["owner_user_id", "brief_date", "mail_last_uid"]); r.sheet = { ok: true }; r.owner = st.owner_user_id ? { registered: true, brief_date: st.brief_date, mail_last_uid: st.mail_last_uid } : { registered: false, hint: "네이버웍스 봇을 쓸 때만 필요. 봇 1:1 방에서 '관리자 <ADMIN_PIN>'" }; }
  catch (e) { r.sheet = { ok: false, error: e.message }; }
  const works = new WorksClient();
  if (works.enabled) { try { await works.token(); r.works = { ok: true }; } catch (e) { r.works = { ok: false, error: e.message }; } }
  else r.works = { ok: false, error: "WORKS_* 환경변수 미설정 (네이버웍스 없이 사용 중이면 정상)" };
  if (env.MAIL_ENABLED) { try { r.smtp = await new Mailer().verify(); } catch (e) { r.smtp = { ok: false, error: e.message }; } }
  else r.smtp = { ok: false, error: "MAIL_USER/MAIL_PASS 미설정 (알림 메일 안 감)" };
  if (env.MAIL_ENABLED) { try { r.mail = await testMailLogin(); } catch (e) { r.mail = { ok: false, error: e.message }; } }
  else r.mail = { ok: false, error: "MAIL_USER/MAIL_PASS 미설정 (메일 수집 안 함)" };
  const ping = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
  if (env.GEMINI_ENABLED) { try { await geminiJson({ cfg: env, system: "JSON {ok:true} 만 출력", prompt: "ping", schema: ping }); r.gemini = { ok: true, model: env.GEMINI_MODEL }; } catch (e) { r.gemini = { ok: false, error: e.message }; } } else r.gemini = { ok: false, error: "GEMINI_API_KEY 미설정" };
  if (env.CLAUDE_ENABLED) { try { await claudeJson({ cfg: env, system: "record 도구로 {ok:true} 기록", prompt: "ping", schema: ping }); r.claude = { ok: true, model: env.CLAUDE_MODEL }; } catch (e) { r.claude = { ok: false, error: e.message }; } } else r.claude = { ok: false, error: "ANTHROPIC_API_KEY 미설정" };
  try { const n = (await gas.listEvents({})).length; r.calendar = { ok: true, events: n, icalUrl: env.TICK_KEY ? `/api/ical?key=${env.TICK_KEY}` : "(TICK_KEY 필요)" }; } catch (e) { r.calendar = { ok: false, error: e.message + " (Code.gs 를 최신으로 바꾸고 setup 을 다시 실행했는지 확인)" }; }
  try { r.aiSpend = await getSpend(gas); } catch {}
  return ok(res, r);
}
