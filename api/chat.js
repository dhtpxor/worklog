// api/chat.js — 웹페이지 '대화' 탭. 네이버웍스 봇과 같은 명령/대화형 정리를 PIN 인증으로 쓴다.
//   POST { text }  →  { reply, added }
import { env } from "../lib/env.js";
import { GasClient } from "../lib/gas.js";
import { WorksClient } from "../lib/works.js";
import { Mailer } from "../lib/mailer.js";
import { handleEvent, HELP_OWNER } from "../lib/commands.js";
import { Notifier } from "../lib/notify.js";
import { SheetCalendar } from "../lib/calendar.js";
import { assistantReply } from "../lib/ai/assistant.js";
import { getSpend } from "../lib/ai/router.js";
import { readJson, checkPin, ok, fail } from "../lib/http.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  if (req.method === "GET") {
    let spend = {}; try { spend = await getSpend(new GasClient()); } catch {}
    return ok(res, { ai: env.AI_ENABLED, gemini: env.GEMINI_ENABLED, claude: env.CLAUDE_ENABLED, calendar: true, budgetKrw: env.AI_BUDGET_KRW, spend,
      greeting: env.AI_ENABLED ? `안녕하세요, ${env.OWNER_NAME || ""}님. 무엇이든 말씀하세요.\n예) "내일 3시 A사 미팅 잡아줘", "이번 주 뭐 해야 하지?", "김철수한테 견적서 금요일까지 시켜줘", "오늘 일정 알려줘"` : `안녕하세요, ${env.OWNER_NAME || ""}님. 무엇을 도와드릴까요?\n'정리'라고 하면 오늘 할 일을 같이 정리하고, 그냥 할 일을 적어도 등록됩니다.`, help: HELP_OWNER });
  }
  if (req.method !== "POST") return res.status(405).end();
  const body = await readJson(req);
  const text = String(body.text || "").trim();
  if (!text) return fail(res, "내용이 비어 있습니다", 400);
  const gas = new GasClient();
  try {
    // 짧은 고정 명령(완료 12, 목록, 정리 …)은 AI 없이 바로 처리한다 — 빠르고 공짜
    const isCommand = /^(도움말|help|목록|전체|오늘|팀|후보|보류목록|브리핑|보고|일일보고|정리|끝|취소|없음|(완료|확정|무시|삭제|보류|재개|미룸|담당|제목|할일|지시|팀원등록|팀원삭제|관리자)\s)/i.test(text) || /^\d+$/.test(text);
    const st = await gas.getState([`dialog_web`]);
    if (env.AI_ENABLED && !isCommand && !st.dialog_web) {
      const r = await assistantReply({ text, history: Array.isArray(body.history) ? body.history : [], gas, cal: new SheetCalendar({ gas }), cfg: env, notifier: new Notifier({ works: new WorksClient(), mailer: new Mailer(), cfg: env, ownerUserId: (await gas.getState(["owner_user_id"])).owner_user_id }) });
      return ok(res, { reply: r.reply, provider: r.provider, costKrw: r.costKrw, added: [] });
    }
    const r = await handleEvent({ event: { type: "message", source: { userId: "web" }, content: { type: "text", text } }, gas, works: new WorksClient(), mailer: new Mailer(), cfg: env, forceOwner: true });
    return ok(res, { reply: r.reply || "(처리했습니다)", provider: "rule", added: r.added || [] });
  } catch (e) { return fail(res, e); }
}
