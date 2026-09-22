// lib/notify.js — 알림 보내기: 네이버웍스 봇(있으면) + 이메일(있으면). 둘 다 없으면 웹페이지에서만 본다.
export class Notifier {
  constructor({ works, mailer, cfg, ownerUserId = "" }) { this.works = works; this.mailer = mailer; this.cfg = cfg; this.ownerUserId = ownerUserId; }
  get channels() {
    const c = [];
    if (this.works?.enabled && this.ownerUserId) c.push("works");
    if (this.mailer?.enabled) c.push("mail");
    return c;
  }
  /** 나에게. subject 는 메일 제목 */
  async toOwner(text, subject = "알림") {
    const sent = [];
    if (this.works?.enabled && this.ownerUserId) { await this.works.sendToUser(this.ownerUserId, text); sent.push("works"); }
    if (this.mailer?.enabled) { await this.mailer.send({ to: this.cfg.OWNER_EMAIL || this.cfg.MAIL_USER, subject, text }); sent.push("mail"); }
    return sent;
  }
  /** 팀원에게: 네이버웍스 user_id 가 있으면 봇, 아니면 email */
  async toMember(member, text, subject = "알림") {
    if (this.works?.enabled && member.user_id) { await this.works.sendToUser(member.user_id, text); return "works"; }
    if (this.mailer?.enabled && member.email) { await this.mailer.send({ to: member.email, subject, text }); return "mail"; }
    return "";
  }
}
