// lib/ai/router.js — 어느 모델에 보낼지 자동 배분 + 비용 기록 (월 예산: 넘으면 Gemini 만)
import { kst } from "../dates.js";

// 이런 요청은 Claude 로 (분석·작성·긴 글). 그 외 짧은 대화·단순 명령은 Gemini
const HARD = /(분석|보고서|기획|전략|비교|검토|요약|초안|작성해|써\s*줘|써줘|메일\s*(써|작성)|이메일\s*(써|작성)|답장\s*(써|작성)|제안서|계획\s*(세워|짜)|일정\s*짜|장단점|리스크|우선순위|정리해\s*줘|번역|영어로|회의록|왜\s|어떻게\s*하면|조언|추천해|판단|의견)/;

export function pickProvider({ text, cfg, spendKrw = 0, historyLen = 0 }) {
  const hasG = cfg.GEMINI_ENABLED, hasC = cfg.CLAUDE_ENABLED;
  if (!hasG && !hasC) return "";
  if (hasG && !hasC) return "gemini";
  if (hasC && !hasG) return "claude";
  const overBudget = cfg.AI_BUDGET_KRW > 0 && spendKrw >= cfg.AI_BUDGET_KRW;
  if (overBudget) return "gemini";
  const t = String(text || "");
  const hard = t.length > 600 || (HARD.test(t) && t.length > 15) || (historyLen > 16 && t.length > 200);
  return hard ? "claude" : "gemini";
}

export function estimateCostKrw(provider, usage, cfg) {
  const usdIn = provider === "claude" ? cfg.CLAUDE_USD_IN : cfg.GEMINI_USD_IN;
  const usdOut = provider === "claude" ? cfg.CLAUDE_USD_OUT : cfg.GEMINI_USD_OUT;
  const usd = ((usage?.input || 0) * usdIn + (usage?.output || 0) * usdOut) / 1_000_000;
  return Math.round(usd * (cfg.USD_KRW || 1400) * 100) / 100;
}

export function monthKey(now = new Date()) { return kst(now).iso.slice(0, 7); }

export async function getSpend(gas, now = new Date()) {
  const k = `ai_spend_${monthKey(now)}`;
  const st = await gas.getState([k]);
  try { return { key: k, ...(JSON.parse(st[k] || "{}")) }; } catch { return { key: k }; }
}

export async function recordSpend(gas, provider, usage, cfg, now = new Date()) {
  const cur = await getSpend(gas, now);
  const krw = estimateCostKrw(provider, usage, cfg);
  const next = { claude_krw: +(cur.claude_krw || 0), gemini_krw: +(cur.gemini_krw || 0), calls: +(cur.calls || 0) + 1 };
  if (provider === "claude") next.claude_krw = Math.round((next.claude_krw + krw) * 100) / 100; else next.gemini_krw = Math.round((next.gemini_krw + krw) * 100) / 100;
  await gas.setState({ [cur.key]: JSON.stringify(next) });
  return { krw, month: next };
}
