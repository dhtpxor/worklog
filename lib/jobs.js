// lib/jobs.js — 정기 작업: 메일 수집(+팀원 보고 답장), 아침 브리핑, 팀원 리마인드, 저녁 보고 요청/초안
// 알림 채널: 네이버웍스 봇(설정된 경우) + 이메일(메일플러그 SMTP, 설정된 경우). 둘 다 없으면 웹페이지에서만 본다.
import { kst, addDays } from "./dates.js";
import { extractTasks } from "./extract.js";
import { extractAny } from "./ai/assistant.js";
import { composeMorningBrief, composeDailyReportDraft, composeMemberReminder, composeTeamAsk } from "./brief.js";
import { Notifier } from "./notify.js";
import { REPORT_SUBJECT, stripReply } from "./mailer.js";

export async function runTick({ gas, works, mailer, cal = null, cfg, fetchMail, now = new Date(), force = "" }) {
  const t = kst(now);
  const today = t.iso;
  const out = { today, hour: t.hh, done: [] };
  const workday = cfg.WORKDAYS.includes(t.dow);
  const st = await gas.getState(["owner_user_id", "mail_last_uid", "brief_date", "remind_date", "ask_date", "evening_date"]);
  const team = await gas.listTeam();
  const ownerName = cfg.OWNER_NAME;
  const notifier = new Notifier({ works, mailer, cfg, ownerUserId: st.owner_user_id });

  // 1) 메일 수집 (매 호출)
  if ((cfg.MAIL_ENABLED && fetchMail) || force === "mail") {
    try {
      const lastUid = +st.mail_last_uid || 0;
      const { messages, maxUid } = await fetchMail({ lastUid });
      const cands = []; let reports = 0;
      for (const msg of messages) {
        const fromAddr = String(msg.from || "").toLowerCase();
        const member = team.find((m) => m.email && m.email.toLowerCase() === fromAddr);
        // 팀원이 "[업무비서 보고]" 제목으로 답장 → 일일보고로 저장
        if (member && /업무비서\s*보고/.test(msg.subject || "")) {
          const body = stripReply(msg.text);
          if (body) { await gas.addReport({ date: kst(new Date(msg.date)).iso, name: member.name, user_id: member.user_id || "", text: body.slice(0, 1000) }); reports++; }
          continue;
        }
        if (/^\[업무비서/.test(msg.subject || "")) continue; // 내가 보낸 알림 메일 자체는 무시
        const senderIsMe = cfg.MAIL_USER && fromAddr === cfg.MAIL_USER.toLowerCase();
        const found = await extractAny({ text: msg.text, subject: msg.subject, sender: member ? member.name : msg.fromName, isOwner: senderIsMe, team, ownerName, base: kst(new Date(msg.date)).iso, source: "메일", sourceRef: msg.subject, cfg, gas });
        cands.push(...found.map((c) => ({ ...c, status: "후보", source_ref: `${msg.subject} · ${msg.fromName}`.slice(0, 120) })));
      }
      if (cands.length) await gas.addTasks(cands);
      if (maxUid > lastUid) await gas.setState({ mail_last_uid: String(maxUid) });
      out.done.push(`mail:${messages.length}통→후보 ${cands.length}건, 보고 ${reports}건`);
    } catch (e) { out.done.push(`mail 오류: ${e.message}`); await gas.log("mail_error", e.message); }
  }

  if (!notifier.channels.length) { out.done.push("알림 채널 없음(네이버웍스 미등록·메일 미설정) — 웹페이지에서 확인"); return out; }

  const hourOk = (h) => t.hh >= h;
  const tasks = await gas.listTasks();
  const live = tasks.filter((x) => x.status !== "삭제");

  // 2) 아침 브리핑
  if (force === "brief" || (workday && hourOk(cfg.BRIEF_HOUR) && st.brief_date !== today)) {
    const reports = await gas.listReports({ date: addDays(today, -1) });
    let events = []; if (cal?.enabled) { try { events = await cal.listEvents({ start: today, end: addDays(today, 1) }); } catch (e) { await gas.log("calendar_error", e.message); } }
    const sent = await notifier.toOwner(composeMorningBrief({ tasks: live, team, reports, today, ownerName, events }), `${today.slice(5).replace("-", "/")} 아침 브리핑`);
    await gas.setState({ brief_date: today });
    out.done.push(`brief:${sent.join("+")}`);
  }
  // 3) 팀원 리마인드
  if (force === "remind" || (workday && hourOk(cfg.REMIND_HOUR) && st.remind_date !== today)) {
    let n = 0;
    for (const m of team.filter((x) => x.active !== "N" && (x.user_id || x.email))) {
      const msg = composeMemberReminder({ tasks: live, today, name: m.name });
      if (msg) { const via = await notifier.toMember(m, msg, "기한 확인 부탁드립니다").catch((e) => { gas.log("remind_error", `${m.name}: ${e.message}`); return ""; }); if (via) n++; }
    }
    await gas.setState({ remind_date: today });
    out.done.push(`remind:${n}`);
  }
  // 4) 저녁: 팀원에게 오늘 한 일 묻기 (메일 답장은 제목 그대로 두고 답장하면 보고로 저장)
  if (force === "ask" || (workday && hourOk(cfg.ASK_HOUR) && st.ask_date !== today)) {
    let n = 0;
    for (const m of team.filter((x) => x.active !== "N" && (x.user_id || x.email) && x.daily_report !== "N")) {
      const via = await notifier.toMember(m, composeTeamAsk({ today }) + (m.user_id ? "" : "\n\n(이 메일에 그대로 '답장'하면 자동으로 저장됩니다. 제목은 바꾸지 마세요.)"), `${REPORT_SUBJECT} ${today.slice(5).replace("-", "/")} 오늘 한 일`).catch((e) => { gas.log("ask_error", `${m.name}: ${e.message}`); return ""; });
      if (via) n++;
    }
    await gas.setState({ ask_date: today });
    out.done.push(`ask:${n}`);
  }
  // 5) 저녁: 나에게 일일보고 초안 (+ 팀원 보고 취합)
  if (force === "evening" || (workday && hourOk(cfg.EVENING_HOUR) && st.evening_date !== today)) {
    const reports = await gas.listReports({ date: today });
    const sent = await notifier.toOwner(composeDailyReportDraft({ tasks: live, reports, today, ownerName, tomorrow: addDays(today, 1) }), `${today.slice(5).replace("-", "/")} 일일업무보고 초안`);
    await gas.setState({ evening_date: today });
    out.done.push(`evening:${sent.join("+")}`);
  }
  return out;
}
