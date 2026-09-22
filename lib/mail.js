// lib/mail.js — 메일플러그 IMAP 에서 새 메일 읽기 (읽음 표시는 건드리지 않는다: BODY.PEEK)
import { env } from "./env.js";

/**
 * lastUid 이후의 새 메일을 최대 limit 건 가져온다.
 * 첫 실행(lastUid=0)은 최근 3일치만 본다.
 * @returns {{ messages: Array<{uid, subject, from, fromName, date, text}>, maxUid: number }}
 */
export async function fetchNewMail({ lastUid = 0, limit = 40, sinceDays = 3, cfg = env } = {}) {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({
    host: cfg.IMAP_HOST, port: cfg.IMAP_PORT, secure: true, logger: false,
    auth: { user: cfg.IMAP_USER, pass: cfg.IMAP_PASS },
  });
  const messages = []; let maxUid = lastUid;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const query = lastUid > 0 ? { uid: `${lastUid + 1}:*` } : { since: new Date(Date.now() - sinceDays * 86400000) };
      let uids = await client.search(query, { uid: true });
      uids = (uids || []).filter((u) => u > lastUid).sort((a, b) => a - b);
      if (uids.length === 0) return { messages, maxUid };
      uids = uids.slice(-limit);
      for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
        maxUid = Math.max(maxUid, msg.uid);
        let parsed;
        try { parsed = await simpleParser(msg.source); } catch { parsed = null; }
        const env0 = msg.envelope || {};
        const fromObj = (env0.from && env0.from[0]) || {};
        const text = parsed ? (parsed.text || stripHtml(parsed.html || "")) : "";
        messages.push({
          uid: msg.uid,
          subject: parsed?.subject || env0.subject || "",
          from: fromObj.address || parsed?.from?.value?.[0]?.address || "",
          fromName: fromObj.name || parsed?.from?.value?.[0]?.name || fromObj.address || "",
          date: (parsed?.date || env0.date || new Date()).toISOString(),
          text: String(text).slice(0, 6000),
        });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return { messages, maxUid };
}

export async function testMailLogin(cfg = env) {
  const { ImapFlow } = await import("imapflow");
  if (!cfg.IMAP_ENABLED) throw new Error("IMAP 설정이 없습니다 (IMAP_HOST/IMAP_USER/IMAP_PASS)");
  const client = new ImapFlow({ host: cfg.IMAP_HOST, port: cfg.IMAP_PORT, secure: true, logger: false, auth: { user: cfg.IMAP_USER, pass: cfg.IMAP_PASS } });
  await client.connect();
  const box = await client.mailboxOpen("INBOX");
  const n = box.exists;
  await client.logout().catch(() => {});
  return { ok: true, inbox: n };
}

export function stripHtml(html) {
  return String(html).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
}
