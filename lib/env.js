// lib/env.js — 환경변수 한곳에서 읽기 (Vercel 프로젝트 설정 → Environment Variables)
const s = (k, d = "") => String(process.env[k] ?? d).trim();

export const env = {
  // 구글 시트(Apps Script 웹 앱)
  GAS_URL: s("GAS_URL"),
  GAS_TOKEN: s("GAS_TOKEN"),
  // 네이버웍스
  WORKS_CLIENT_ID: s("WORKS_CLIENT_ID"),
  WORKS_CLIENT_SECRET: s("WORKS_CLIENT_SECRET"),
  WORKS_SERVICE_ACCOUNT: s("WORKS_SERVICE_ACCOUNT"),
  WORKS_PRIVATE_KEY: s("WORKS_PRIVATE_KEY").replace(/\\n/g, "\n"),
  WORKS_BOT_ID: s("WORKS_BOT_ID"),
  WORKS_BOT_SECRET: s("WORKS_BOT_SECRET"),
  // ── 메일 (둘 다 선택) ────────────────────────────────────────
  // 받기(IMAP): 받은편지함에서 할 일 후보와 팀원 보고 답장을 읽는다
  // 보내기(SMTP): 아침 브리핑·일일보고 초안·팀원 리마인드를 보낸다
  // 회사 메일이 IMAP 을 막아 두었으면 받기만 비우고, 보내기는 개인 Gmail·네이버 메일을 써도 된다.
  // MAIL_* 는 예전 이름. IMAP_*/SMTP_* 가 비어 있을 때만 대신 쓰인다.
  IMAP_HOST: s("IMAP_HOST") || s("MAIL_HOST"),
  IMAP_PORT: +(s("IMAP_PORT") || s("MAIL_PORT") || "993"),
  IMAP_USER: s("IMAP_USER") || s("MAIL_USER"),
  IMAP_PASS: s("IMAP_PASS") || s("MAIL_PASS"),
  SMTP_HOST: s("SMTP_HOST") || s("MAIL_HOST").replace(/^imap\./, "smtp."),
  SMTP_PORT: +(s("SMTP_PORT") || "465"),
  SMTP_USER: s("SMTP_USER") || s("MAIL_USER"),
  SMTP_PASS: s("SMTP_PASS") || s("MAIL_PASS"),
  OWNER_EMAIL: s("OWNER_EMAIL"),      // 비우면 보내는 계정으로 브리핑이 온다
  // 나
  OWNER_NAME: s("OWNER_NAME"),
  ADMIN_PIN: s("ADMIN_PIN"),   // 봇에서 "관리자 <PIN>" / 웹페이지 로그인
  TICK_KEY: s("TICK_KEY"),     // Apps Script 트리거가 /api/tick 을 부를 때 쓰는 열쇠
  CRON_SECRET: s("CRON_SECRET"),
  // 시각(KST, 24시간). 비우면 기본값
  BRIEF_HOUR: +s("BRIEF_HOUR", "8"),
  REMIND_HOUR: +s("REMIND_HOUR", "9"),
  ASK_HOUR: +s("ASK_HOUR", "17"),
  EVENING_HOUR: +s("EVENING_HOUR", "18"),
  WORKDAYS: s("WORKDAYS", "1,2,3,4,5").split(",").map((x) => +x.trim()).filter((x) => x >= 0 && x <= 6),
  // AI (선택) — 둘 다 넣으면 가벼운 건 Gemini, 어려운 건 Claude 로 자동 배분
  GEMINI_API_KEY: s("GEMINI_API_KEY"),
  GEMINI_MODEL: s("GEMINI_MODEL", "gemini-2.5-flash"),
  ANTHROPIC_API_KEY: s("ANTHROPIC_API_KEY"),
  CLAUDE_MODEL: s("CLAUDE_MODEL", "claude-opus-5"),
  AI_BUDGET_KRW: +s("AI_BUDGET_KRW", "10000"),        // 월 Claude 사용 상한(원). 넘으면 그 달은 Gemini 만 쓴다
  USD_KRW: +s("USD_KRW", "1400"),
  GEMINI_USD_IN: +s("GEMINI_USD_IN", "0.30"),          // Gemini 2.5 Flash 기준 100만 토큰당 (모델 바꾸면 같이 바꿀 것)
  GEMINI_USD_OUT: +s("GEMINI_USD_OUT", "2.50"),
  CLAUDE_USD_IN: +s("CLAUDE_USD_IN", "5"),             // Claude Opus 5 기준
  CLAUDE_USD_OUT: +s("CLAUDE_USD_OUT", "25"),
  IMAP_ENABLED: Boolean((s("IMAP_HOST") || s("MAIL_HOST")) && (s("IMAP_USER") || s("MAIL_USER")) && (s("IMAP_PASS") || s("MAIL_PASS"))),
  SMTP_ENABLED: Boolean((s("SMTP_HOST") || s("MAIL_HOST")) && (s("SMTP_USER") || s("MAIL_USER")) && (s("SMTP_PASS") || s("MAIL_PASS"))),
  GEMINI_ENABLED: s("GEMINI_API_KEY") !== "",
  CLAUDE_ENABLED: s("ANTHROPIC_API_KEY") !== "",
  AI_ENABLED: s("GEMINI_API_KEY") !== "" || s("ANTHROPIC_API_KEY") !== "",
  WORKS_ENABLED: ["WORKS_CLIENT_ID", "WORKS_CLIENT_SECRET", "WORKS_SERVICE_ACCOUNT", "WORKS_PRIVATE_KEY", "WORKS_BOT_ID"].every((k) => s(k) !== ""),
};
