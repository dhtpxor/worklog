// lib/mailer.js — 메일플러그 SMTP 로 알림 메일 보내기 (아침 브리핑, 일일보고 초안, 팀원 리마인드/보고 요청)
import { env } from "./env.js";

export const REPORT_SUBJECT = "[업무비서 보고]"; // 팀원이 이 제목으로 답장하면 보고로 저장된다

export class Mailer {
  constructor({ cfg = env, transport } = {}) { this.cfg = cfg; this._t = transport || null; }
  get enabled() { return Boolean(this.cfg.MAIL_USER && this.cfg.MAIL_PASS); }

  async transport() {
    if (this._t) return this._t;
    const nodemailer = (await import("nodemailer")).default;
    this._t = nodemailer.createTransport({
      host: this.cfg.SMTP_HOST, port: this.cfg.SMTP_PORT, secure: this.cfg.SMTP_PORT === 465,
      auth: { user: this.cfg.MAIL_USER, pass: this.cfg.MAIL_PASS },
    });
    return this._t;
  }

  /** 텍스트 메일. to 가 비면 나(MAIL_USER)에게 */
  async send({ to, subject, text }) {
    const t = await this.transport();
    const info = await t.sendMail({
      from: `"업무 비서" <${this.cfg.MAIL_USER}>`, to: to || this.cfg.MAIL_USER,
      subject: subject.startsWith("[업무비서") ? subject : `[업무비서] ${subject}`,
      text,
    });
    return info?.messageId || true;
  }

  async verify() { const t = await this.transport(); await t.verify(); return { ok: true }; }
}

/** 테스트용 */
export class MemoryMailer {
  constructor() { this.sent = []; }
  get enabled() { return true; }
  async send(m) { this.sent.push(m); return true; }
  async verify() { return { ok: true }; }
}

/** 답장 메일에서 인용문(>) · 원문 구분선 아래를 잘라 본문만 남긴다 */
export function stripReply(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) break;
    if (/^-{2,}\s*(Original Message|원본 메일|원본 메시지)/i.test(l) || /^(On .+ wrote:|.+님이 작성:|.+에 .+ 작성:)\s*$/.test(l) || /^-{3,}\s*$/.test(l) || /^From:\s|^보낸 사람:\s|^발신:\s/.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}
