// lib/commands.js — 봇이 받은 메시지 처리 (1:1 명령, 그룹방 자동 수집, 팀원 등록/보고)
import { parseKoreanDate, todayISO, addDays, shortDate } from "./dates.js";
import { extractTasks, findMentions, toTitle, stripMemberName, stripDateWords } from "./extract.js";
import { composeMorningBrief, composeDailyReportDraft, composeTaskList, isMine } from "./brief.js";
import { Notifier } from "./notify.js";
import { extractAny } from "./ai/assistant.js";

export const HELP_OWNER = `🤖 사용법 (팀장)
정리                    대화하며 할 일 정리하기 (봇이 순서대로 물어봄)
할일 내용 ~9/30        내 할 일 추가 (날짜는 '내일', '금요일까지'도 됨)
지시 홍길동 내용 ~9/30  팀원에게 업무 지시 (봇이 그 팀원에게도 알림)
목록 / 오늘 / 팀 / 후보  보기
완료 12 · 보류 12 · 삭제 12 · 미룸 12 내일 · 담당 12 홍길동
확정 12 · 무시 12        자동으로 뽑힌 후보 정리
브리핑 · 보고             아침 브리핑 / 일일업무보고 초안 지금 받기
팀원등록 홍길동 hong@회사.co.kr   팀원 등록 (이메일을 적으면 리마인드·보고 요청이 메일로 감)
아무 말이나 적어도 됩니다: "영희님 회의록 목요일까지 공유해주세요" → 이영희 업무로 등록`;

export const HELP_MEMBER = `🤖 사용법
등록 홍길동   내 이름 등록 (처음 한 번)
목록          내가 맡은 업무
완료 12       끝낸 업무 표시
보고 내용     오늘 한 일 보고 (저녁에 봇이 물어볼 때 그냥 답장해도 됨)`;

/**
 * @param {object} p
 * @param {object} p.event   네이버웍스 콜백 이벤트 (type, source{userId, channelId}, content{type,text})
 * @param {object} p.gas     GasClient
 * @param {object} p.works   WorksClient (팀원 알림용)
 * @param {object} p.cfg     env
 * @param {Date}   [p.now]
 * @returns {Promise<{reply?: string, added?: Array}>}
 */
export async function handleEvent({ event, gas, works, mailer, cfg, now = new Date(), forceOwner = false }) {
  if (!event || event.type !== "message") return {};
  const text = String(event.content?.text || "").trim();
  if (!text) return {};
  const userId = event.source?.userId || "";
  const channelId = event.source?.channelId || "";
  const today = todayISO(now);
  const st = await gas.getState(["owner_user_id", "ask_date"]);
  const isOwner = forceOwner || (Boolean(st.owner_user_id) && st.owner_user_id === userId);
  const notifier = new Notifier({ works, mailer, cfg, ownerUserId: st.owner_user_id });
  const team = await gas.listTeam();
  const me = team.find((m) => m.user_id === userId);
  const ownerName = cfg.OWNER_NAME;

  // ── 관리자 등록 ─────────────────────────────
  let m;
  if ((m = text.match(/^관리자\s+(\S+)$/))) {
    if (!cfg.ADMIN_PIN) return { reply: "ADMIN_PIN 환경변수가 비어 있어 등록할 수 없습니다." };
    if (m[1] !== cfg.ADMIN_PIN) return { reply: "PIN이 다릅니다." };
    await gas.setState({ owner_user_id: userId });
    return { reply: `관리자로 등록했습니다 (${ownerName || "이름 미설정"}). 이제부터 이 방에서 명령을 받습니다.\n\n${HELP_OWNER}` };
  }

  // ── 그룹방: 자동 수집만 (답장 없음) ─────────────
  if (channelId) {
    const senderName = isOwner ? ownerName : (me?.name || "");
    const found = await extractAny({ text, sender: senderName, isOwner, team, ownerName, base: today, source: "네이버웍스", sourceRef: `방 ${channelId.slice(0, 6)}`, cfg, gas });
    if (!found.length) return {};
    const added = await gas.addTasks(found.map((t) => ({ ...t, status: "후보" })));
    return { added };
  }

  // ── 1:1 ────────────────────────────────────
  if (isOwner) {
    const dialog = await loadDialog(gas, userId);
    if (dialog) return dialogStep({ text, dialog, gas, works: notifier, team, ownerName, today, userId });
    if (/^(정리|리스트업|리스트 업|정리하자|정리 시작|시작|할일정리|할 일 정리)$/.test(text)) return startDialog({ gas, userId, today });
    return ownerCommand({ text, gas, works: notifier, cfg, team, ownerName, today, now, userId });
  }
  return memberCommand({ text, gas, cfg, team, me, userId, today, askDate: st.ask_date, ownerName, notifier });
}

async function ownerCommand({ text, gas, works, cfg, team, ownerName, today, now, userId }) {
  let m;
  const all = () => gas.listTasks();
  if (/^(도움말|도움|help|\?)$/i.test(text)) return { reply: HELP_OWNER };

  if ((m = text.match(/^(할일|할 일|todo)\s+([\s\S]+)$/i))) return addTask({ body: m[2], gas, works, team, ownerName, today, defaultOwner: ownerName });
  if ((m = text.match(/^(지시|요청|배정)\s+(\S+)\s+([\s\S]+)$/))) {
    const member = matchMember(m[2], team);
    if (!member) return { reply: `'${m[2]}' 팀원을 못 찾았습니다. '팀'으로 목록을 보거나 '팀원등록 이름'으로 먼저 등록하세요.` };
    return addTask({ body: m[3], gas, works, team, ownerName, today, defaultOwner: member.name, forcedMember: member, requestedBy: ownerName });
  }
  if ((m = text.match(/^팀원등록\s+(\S+)((?:\s+\S+)*)$/))) {
    const rest = m[2].trim().split(/\s+/).filter(Boolean);
    const email = rest.find((x) => /@/.test(x)) || "";
    const role = rest.find((x) => !/@/.test(x)) || "";
    const saved = await gas.upsertTeam({ name: m[1], role, email, active: "Y", daily_report: "Y" });
    return { reply: `팀원 '${saved.name}' 등록${email ? ` · ${email} (리마인드·보고 요청 메일)` : " · 이메일 없음 (리마인드를 받으려면 '팀원등록 이름 이메일')"}` };
  }
  if ((m = text.match(/^팀원삭제\s+(\S+)$/))) {
    const member = matchMember(m[1], team);
    if (!member) return { reply: "그 이름의 팀원이 없습니다." };
    await gas.upsertTeam({ ...member, active: "N" });
    return { reply: `'${member.name}' 비활성 처리했습니다.` };
  }
  if (/^팀$/.test(text)) {
    const tasks = (await all()).filter((t) => t.status === "진행" && t.owner && t.owner !== ownerName);
    const lines = team.filter((t) => t.active !== "N").map((mm) => {
      const mine = tasks.filter((t) => t.owner === mm.name);
      return ` ${mm.name}${mm.user_id || mm.email ? "" : " (알림 미연결)"}: ${mine.length ? mine.map((t) => `#${t.id} ${t.title}${t.due ? `(~${shortDate(t.due)})` : ""}`).join(", ") : "-"}`;
    });
    return { reply: lines.length ? "👥 팀원\n" + lines.join("\n") : "등록된 팀원이 없습니다. '팀원등록 이름'" };
  }
  if (/^(목록|전체|리스트)$/.test(text)) {
    const tasks = (await all()).filter((t) => t.status === "진행" && isMine(t, ownerName));
    return { reply: composeTaskList({ tasks, today, title: "내 업무" }) };
  }
  if (/^오늘$/.test(text)) {
    const tasks = (await all()).filter((t) => t.status === "진행" && isMine(t, ownerName) && t.due && t.due <= today);
    return { reply: composeTaskList({ tasks, today, title: "오늘까지" }) };
  }
  if (/^후보$/.test(text)) {
    const tasks = (await all()).filter((t) => t.status === "후보");
    return { reply: composeTaskList({ tasks, today, title: "후보 (확정 번호 / 무시 번호)" }) };
  }
  if (/^보류목록$/.test(text)) {
    const tasks = (await all()).filter((t) => t.status === "보류");
    return { reply: composeTaskList({ tasks, today, title: "보류" }) };
  }
  if (/^브리핑$/.test(text)) {
    const tasks = await all();
    const reports = await gas.listReports({ date: addDays(today, -1) });
    return { reply: composeMorningBrief({ tasks, team, reports, today, ownerName }) };
  }
  if (/^(보고|일일보고|보고서)$/.test(text)) {
    const tasks = await all();
    const reports = await gas.listReports({ date: today });
    return { reply: composeDailyReportDraft({ tasks, reports, today, ownerName, tomorrow: addDays(today, 1) }) };
  }
  if ((m = text.match(/^(완료|끝|done)\s+([\d\s,]+)$/i))) return setStatus({ ids: nums(m[2]), status: "완료", gas, today, extra: { completed_at: new Date(now).toISOString() } });
  if ((m = text.match(/^(확정|승인|ok)\s+([\d\s,]+)$/i))) return setStatus({ ids: nums(m[2]), status: "진행", gas, today, only: "후보" });
  if ((m = text.match(/^(무시|삭제|취소|del)\s+([\d\s,]+)$/i))) return setStatus({ ids: nums(m[2]), status: "삭제", gas, today });
  if ((m = text.match(/^(보류|hold)\s+([\d\s,]+)$/i))) return setStatus({ ids: nums(m[2]), status: "보류", gas, today });
  if ((m = text.match(/^(재개|다시)\s+([\d\s,]+)$/i))) return setStatus({ ids: nums(m[2]), status: "진행", gas, today });
  if ((m = text.match(/^(미룸|연기|기한)\s+(\d+)\s+(.+)$/))) {
    const d = parseKoreanDate(m[3], today);
    if (!d) return { reply: `날짜를 못 읽었습니다: '${m[3]}' (예: 내일, 9/30, 금요일)` };
    const t = await gas.updateTask(+m[2], { due: d.due });
    return { reply: `#${t.id} 기한 → ${shortDate(d.due, today)}` };
  }
  if ((m = text.match(/^(담당|배정변경)\s+(\d+)\s+(\S+)$/))) {
    const member = m[3] === "나" || m[3] === ownerName ? { name: ownerName, user_id: "" } : matchMember(m[3], team);
    if (!member) return { reply: `'${m[3]}' 팀원을 못 찾았습니다.` };
    const t = await gas.updateTask(+m[2], { owner: member.name, owner_user_id: member.user_id || "" });
    if (member.name !== ownerName) await works.toMember(member, `📌 새 업무: #${t.id} ${t.title}${t.due ? ` (~${shortDate(t.due)})` : ""}\n끝내면 '완료 ${t.id}'라고 답장해 주세요.`, `새 업무 #${t.id} ${t.title}`).catch(() => {});
    return { reply: `#${t.id} 담당 → ${member.name}` };
  }
  if ((m = text.match(/^(제목|수정)\s+(\d+)\s+(.+)$/))) {
    const t = await gas.updateTask(+m[2], { title: m[3].trim() });
    return { reply: `#${t.id} 제목 → ${t.title}` };
  }
  // 명령이 아니면: 메모로 보고 할 일 추출 → 없으면 통째로 내 할 일
  const found = extractTasks({ text, sender: ownerName, isOwner: true, team, ownerName, base: today, source: "직접", sourceRef: "봇 메모" });
  if (found.length) {
    const added = await gas.addTasks(found.map((t) => ({ ...t, status: "진행", owner: t.owner || ownerName })));
    return { reply: "메모에서 할 일로 등록:\n" + added.map((t) => ` #${t.id} ${t.title}${t.owner !== ownerName ? ` →${t.owner}` : ""}${t.due ? ` (~${shortDate(t.due, today)})` : ""}`).join("\n") + "\n(원치 않으면 '무시 번호')", added };
  }
  return addTask({ body: text, gas, works, team, ownerName, today, defaultOwner: ownerName, quiet: true });
}

async function addTask({ body, gas, works, team, ownerName, today, defaultOwner, forcedMember, requestedBy = "", quiet = false }) {
  let raw = body.trim();
  let due = "";
  const tilde = raw.match(/[~～]\s*([^\s~～]+(?:\s*(?:까지|오전|오후|\d{1,2}시(?:\s*반)?|\d{1,2}:\d{2}))?)\s*$/);
  if (tilde) { const d = parseKoreanDate(tilde[1], today); if (d) { due = d.due; raw = raw.slice(0, tilde.index).trim(); } }
  if (!due) { const d = parseKoreanDate(raw, today); if (d && /까지|마감|기한/.test(raw)) { due = d.due; raw = stripDateWords(raw, d.matched); } }
  let member = forcedMember || null;
  if (!member) { const at = raw.match(/@(\S+)/); if (at) { member = matchMember(at[1], team); if (member) raw = raw.replace(at[0], "").trim(); } }
  if (!member && !forcedMember) { const ms = findMentions(raw, team); if (ms.length && /(지시|요청|시키|맡기|부탁)/.test(raw)) member = ms[0]; }
  if (member) raw = stripMemberName(raw, member) || raw;
  const title = toTitle(raw, { team }) || raw;
  const owner = member ? member.name : defaultOwner;
  const [t] = await gas.addTasks([{ title, owner, owner_user_id: member?.user_id || "", requested_by: member ? (requestedBy || ownerName) : "", due, status: "진행", source: "직접", source_ref: "봇" }]);
  let via = "";
  if (member && owner !== ownerName) via = await works.toMember(member, `📌 새 업무: #${t.id} ${t.title}${due ? ` (~${shortDate(due, today)})` : ""}\n끝내면 '완료 ${t.id}'라고 답장해 주세요.`, `새 업무 #${t.id} ${t.title}`).catch(() => "");
  const reply = `#${t.id} 등록 · ${owner === ownerName ? "내 업무" : owner + (via ? " (알림 보냄)" : " (알림 미연결)")}${due ? ` · ~${shortDate(due, today)}` : " · 기한 없음"}${quiet ? "\n(명령이 아니면 그대로 내 할 일로 저장합니다. '도움말' 참고)" : ""}`;
  return { reply, added: [t] };
}

async function setStatus({ ids, status, gas, today, only, extra = {} }) {
  if (!ids.length) return { reply: "번호를 적어 주세요. 예: 완료 12" };
  const out = [];
  for (const id of ids) {
    try {
      const cur = only ? (await gas.listTasks()).find((t) => t.id === id) : null;
      if (only && cur && cur.status !== only) { out.push(`#${id} 은(는) ${only} 상태가 아닙니다`); continue; }
      const t = await gas.updateTask(id, { status, ...extra });
      out.push(`#${t.id} ${t.title} → ${status}`);
    } catch (e) { out.push(`#${id} 실패: ${e.message}`); }
  }
  return { reply: out.join("\n") };
}

async function memberCommand({ text, gas, cfg, team, me, userId, today, askDate, ownerName, notifier }) {
  let m;
  if ((m = text.match(/^등록\s+(\S+)$/))) {
    const existing = matchMember(m[1], team);
    const saved = await gas.upsertTeam({ ...(existing || { role: "", active: "Y", daily_report: "Y" }), name: existing ? existing.name : m[1], user_id: userId });
    return { reply: `${saved.name}님, 등록됐습니다. 앞으로 업무 지시와 리마인드를 여기로 보내드립니다.\n\n${HELP_MEMBER}` };
  }
  if (!me) return { reply: `아직 등록되지 않은 사용자입니다. '등록 이름' (예: 등록 홍길동) 이라고 보내 주세요.` };
  if (/^(도움말|도움|help|\?)$/i.test(text)) return { reply: HELP_MEMBER };
  if (/^(목록|내업무|내 업무)$/.test(text)) {
    const tasks = (await gas.listTasks()).filter((t) => t.owner === me.name && t.status === "진행");
    return { reply: composeTaskList({ tasks, today, title: `${me.name}님 업무` }) };
  }
  if ((m = text.match(/^(완료|끝|done)\s+([\d\s,]+)$/i))) {
    const ids = nums(m[2]); const out = [];
    for (const id of ids) {
      const t = (await gas.listTasks()).find((x) => x.id === id);
      if (!t || t.owner !== me.name) { out.push(`#${id} 은(는) 내 업무가 아닙니다`); continue; }
      const u = await gas.updateTask(id, { status: "완료", completed_at: new Date().toISOString() });
      out.push(`#${u.id} ${u.title} → 완료`);
      await notifier.toOwner(`✅ ${me.name}: #${u.id} ${u.title} 완료`, `${me.name} 완료: ${u.title}`).catch(() => {});
    }
    return { reply: out.join("\n") };
  }
  if ((m = text.match(/^(보고|report)\s*[:：]?\s*([\s\S]+)$/i)) || askDate === today) {
    const body = m ? m[2].trim() : text;
    await gas.addReport({ date: today, name: me.name, user_id: userId, text: body });
    return { reply: `보고 저장했습니다 (${shortDate(today)}). 추가할 내용은 '보고 내용'으로 더 보내면 됩니다.` };
  }
  // 그 외: 팀원이 "제가 ~하겠습니다" → 본인 업무 후보
  const found = extractTasks({ text, sender: me.name, isOwner: false, team, ownerName, base: today, source: "네이버웍스", sourceRef: "봇 1:1" });
  const mineFound = found.filter((t) => t.owner === me.name);
  if (mineFound.length) {
    const added = await gas.addTasks(mineFound.map((t) => ({ ...t, status: "진행" })));
    return { reply: "내 업무로 등록:\n" + added.map((t) => ` #${t.id} ${t.title}${t.due ? ` (~${shortDate(t.due, today)})` : ""}`).join("\n") };
  }
  return { reply: `무슨 뜻인지 못 알아들었어요.\n\n${HELP_MEMBER}` };
}

export function matchMember(name, team) {
  const n = String(name || "").replace(/(님|씨)$/, "").trim();
  if (!n) return null;
  return team.find((m) => m.active !== "N" && m.name === n) || team.find((m) => m.active !== "N" && (m.name.endsWith(n) || m.name.startsWith(n))) || null;
}
function nums(s) { return String(s).split(/[\s,]+/).map((x) => +x).filter((x) => Number.isInteger(x) && x > 0); }

// ── 대화형 정리 모드 ─────────────────────────────────────────
// 상태는 시트 state 탭에 dialog_<userId> 로 저장 (서버리스라 메모리에 못 둔다)
const DIALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6시간 지나면 자동 종료

async function loadDialog(gas, userId) {
  const st = await gas.getState([`dialog_${userId}`]);
  const raw = st[`dialog_${userId}`];
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || !d.mode || Date.now() - (d.at || 0) > DIALOG_TTL_MS) { await gas.setState({ [`dialog_${userId}`]: "" }); return null; }
    return d;
  } catch { return null; }
}
async function saveDialog(gas, userId, d) { await gas.setState({ [`dialog_${userId}`]: d ? JSON.stringify({ ...d, at: Date.now() }) : "" }); }

export async function startDialog({ gas, userId, today }) {
  await saveDialog(gas, userId, { mode: "listing", ids: [] });
  return { reply: `🗒 ${shortDate(today)} 할 일 정리를 시작할게요.\n머릿속에 있는 일을 편하게 적어 주세요. 한 줄에 하나씩, 여러 줄도 좋아요.\n예)\n A사 견적서 보내기 ~내일\n 김철수 주간보고 취합 시키기\n 회의실 예약\n\n다 적으면 '끝'이라고 보내 주세요. (중간에 관두려면 '취소')` };
}

async function dialogStep({ text, dialog, gas, works, team, ownerName, today, userId }) {
  if (/^(취소|그만|중단)$/.test(text)) { await saveDialog(gas, userId, null); return { reply: "정리를 중단했습니다. 지금까지 등록된 항목은 그대로 남아 있어요 ('목록')." }; }

  if (dialog.mode === "listing") {
    if (/^(끝|끝\.|완료|다 했어|다했어|done|그만 적을게|없음)$/i.test(text)) return finishListing({ dialog, gas, userId, today });
    const lines = text.split(/\n+|(?<=[.!?])\s+/).map((l) => l.replace(/^[-•·*\d.)\s]+/, "").trim()).filter((l) => l.length >= 2);
    if (!lines.length) return { reply: "내용이 비어 있어요. 할 일을 적거나 '끝'이라고 보내 주세요." };
    const added = [];
    for (const l of lines) {
      const r = await addTask({ body: l, gas, works, team, ownerName, today, defaultOwner: ownerName, quiet: false });
      if (r.added) added.push(...r.added);
    }
    dialog.ids.push(...added.map((t) => t.id));
    await saveDialog(gas, userId, dialog);
    const summary = added.map((t) => ` #${t.id} ${t.title}${t.owner !== ownerName ? ` →${t.owner}` : ""}${t.due ? ` (~${shortDate(t.due, today)})` : " (기한 없음)"}`).join("\n");
    return { reply: `등록했어요:\n${summary}\n\n더 있으면 계속 적어 주세요. 다 적었으면 '끝'.`, added };
  }

  if (dialog.mode === "ask_due") {
    const id = dialog.queue[0];
    if (/^(없음|없어|모름|모르겠|패스|미정|skip|x|ㄴ)/i.test(text)) return nextDue({ dialog, gas, userId, today, ownerName });
    const d = parseKoreanDate(text, today);
    if (!d) return { reply: `날짜를 못 읽었어요. 예: 내일 / 금요일 / 9/30 / 다음 주 월요일 / 없음\n#${id} 언제까지인가요?` };
    await gas.updateTask(id, { due: d.due });
    return nextDue({ dialog, gas, userId, today, ownerName, prefix: `#${id} → ~${shortDate(d.due, today)}\n` });
  }

  await saveDialog(gas, userId, null);
  return { reply: "정리 상태가 이상해서 초기화했어요. 다시 '정리'라고 보내 주세요." };
}

async function finishListing({ dialog, gas, userId, today }) {
  if (!dialog.ids.length) { await saveDialog(gas, userId, null); return { reply: "등록된 항목이 없어요. 필요할 때 다시 '정리'라고 보내 주세요." }; }
  const tasks = await gas.listTasks();
  const noDue = dialog.ids.filter((id) => { const t = tasks.find((x) => x.id === id); return t && !t.due; });
  if (!noDue.length) { await saveDialog(gas, userId, null); return { reply: wrapUp(tasks, dialog.ids, today) }; }
  const d = { mode: "ask_due", ids: dialog.ids, queue: noDue };
  await saveDialog(gas, userId, d);
  const t = tasks.find((x) => x.id === noDue[0]);
  return { reply: `기한이 없는 항목이 ${noDue.length}개 있어요. 하나씩 물어볼게요.\n#${t.id} '${t.title}' 언제까지인가요? (예: 내일, 금요일, 9/30, 없음)` };
}

async function nextDue({ dialog, gas, userId, today, prefix = "" }) {
  dialog.queue.shift();
  if (!dialog.queue.length) {
    await saveDialog(gas, userId, null);
    const tasks = await gas.listTasks();
    return { reply: prefix + wrapUp(tasks, dialog.ids, today) };
  }
  await saveDialog(gas, userId, dialog);
  const tasks = await gas.listTasks();
  const t = tasks.find((x) => x.id === dialog.queue[0]);
  return { reply: `${prefix}#${t.id} '${t.title}' 언제까지인가요? (예: 내일, 금요일, 9/30, 없음)` };
}

function wrapUp(tasks, ids, today) {
  const mine = tasks.filter((t) => ids.includes(t.id));
  return `✅ 정리 끝! 오늘 등록한 ${mine.length}건\n` + mine.sort(byDueLocal).map((t) => ` #${t.id} ${t.title}${t.owner ? ` [${t.owner}]` : ""}${t.due ? ` ~${shortDate(t.due, today)}` : ""}`).join("\n") + "\n\n내일 아침 브리핑에 정리해서 다시 보여드릴게요. 끝낸 건 '완료 번호'.";
}
function byDueLocal(a, b) { return (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : a.id - b.id; }
