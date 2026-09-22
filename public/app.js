// public/app.js — 업무 비서 웹페이지 (빌드 없음, 그냥 정적 파일)
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = { pin: "", data: null, tab: "chat", chat: [], cal: { y: 0, m: 0, sel: "", events: [] } };
try { state.chat = JSON.parse(localStorage.getItem("worklog_chat") || "[]").slice(-80); } catch {}
try { state.pin = localStorage.getItem("worklog_pin") || ""; } catch {}

// ── 아이콘 ──────────────────────────────────────────────────
const svg = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
const I = {
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  user: svg('<circle cx="12" cy="8" r="3.4"/><path d="M5 20c.7-3.6 3.6-5.5 7-5.5s6.3 1.9 7 5.5"/>'),
  pause: svg('<path d="M9.5 5v14M14.5 5v14"/>'),
  play: svg('<path d="M7 4.8l12 7.2-12 7.2z"/>'),
  trash: svg('<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7"/>'),
  check: svg('<path d="M4.5 12.5l5 5 10-11"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>'),
  inbox: svg('<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M4 13l2.2-7.2A2 2 0 0 1 8.1 4.5h7.8a2 2 0 0 1 1.9 1.3L20 13v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>'),
};

// ── 공통 ────────────────────────────────────────────────────
function toast(msg, ms = 2200) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), ms); }
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "x-pin": state.pin, "Content-Type": "application/json", ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (r.status === 401) { showLogin(j.error || "PIN 이 맞지 않습니다"); throw new Error(j.error || "PIN"); }
  if (!j.ok) throw new Error(j.error || "오류");
  return j.data;
}
function showLogin(err = "") {
  $("#login").classList.remove("hidden"); $("#app").classList.add("hidden");
  $("#tabbar-wrap").hidden = true; $("#login-err").textContent = err;
  setTimeout(() => $("#pin").focus(), 60);
}
async function load() {
  try {
    state.data = await api("/api/tasks");
    $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#tabbar-wrap").hidden = false;
    $("#today").textContent = fmtDate(state.data.today, state.data.today);
    render();
  } catch (e) { if (!/PIN/.test(e.message)) toast("불러오기 실패: " + e.message, 4000); }
}
$("#login-form").addEventListener("submit", (e) => { e.preventDefault(); state.pin = $("#pin").value.trim(); try { localStorage.setItem("worklog_pin", state.pin); } catch {} load(); });
$("#reload").addEventListener("click", load);
$("#tabbar").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (!b) return; state.tab = b.dataset.tab; render(); b.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); });

// ── 날짜 ────────────────────────────────────────────────────
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n) => String(n).padStart(2, "0");
function diffDays(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
function fmtDate(iso, today) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  let s = `${m}/${d}(${dow})`;
  if (today) { const k = diffDays(today, iso); if (k === 0) s += " 오늘"; else if (k === 1) s += " 내일"; else if (k < 0) s += ` ${-k}일 지남`; }
  return s;
}
function dueClass(t, today) { if (!t.due || t.status !== "진행") return ""; const k = diffDays(today, t.due); return k < 0 ? " over" : k === 0 ? " today" : ""; }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
const evTime = (e) => (e.allDay ? "종일" : e.time + (e.endTime ? "–" + e.endTime : ""));

// ── 렌더 ────────────────────────────────────────────────────
function render() {
  $$("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  $$(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== `tab-${state.tab}`));
  const { tasks, team, today, ownerName, reports } = state.data;
  const live = tasks.filter((t) => t.status !== "삭제");
  const mine = (t) => !t.owner || t.owner === ownerName;
  $("#n-cands").textContent = live.filter((t) => t.status === "후보").length || "";

  if (state.tab === "chat") renderChat();
  if (state.tab === "cal") renderCal();

  if (state.tab === "today") {
    const act = live.filter((t) => t.status === "진행" && mine(t));
    const over = act.filter((t) => t.due && diffDays(today, t.due) < 0);
    const td = act.filter((t) => t.due === today);
    const wk = act.filter((t) => t.due && diffDays(today, t.due) > 0 && diffDays(today, t.due) <= 7);
    const rest = act.filter((t) => !over.includes(t) && !td.includes(t) && !wk.includes(t));
    const done = live.filter((t) => t.status === "완료" && mine(t) && String(t.completed_at).slice(0, 10) === today);
    const teamAct = live.filter((t) => t.status === "진행" && !mine(t));
    const html = [
      scheduleCard(),
      sec("지연", over, "red"), sec("오늘", td, "amber"), sec("이번 주", wk), sec("기한 없음", rest.sort(byDue)),
      teamAct.length ? head("팀원 진행 중", teamAct.length) + list(teamAct.sort(byDue).map((t) => row(t))) : "",
      done.length ? sec("오늘 완료", done, "green") : "",
    ].join("");
    $("#today-list").innerHTML = html.trim() ? html
      : empty(I.check, "오늘 챙길 일이 없습니다.<br>위 칸에 적어 넣거나, 대화 탭에서 '정리'라고 말해 보세요.");
  }

  if (state.tab === "cands") {
    const c = live.filter((t) => t.status === "후보").sort((a, b) => b.id - a.id);
    $("#cands-list").innerHTML = c.length ? list(c.map((t) => row(t, true)))
      : empty(I.inbox, "후보가 없습니다.<br>메일·캡처·대화를 가져오면 여기에 쌓입니다.");
  }

  if (state.tab === "all") {
    const fo = $("#f-owner"); const owners = [...new Set(live.map((t) => t.owner).filter(Boolean))];
    if (fo.options.length !== owners.length + 1) fo.innerHTML = `<option value="">담당 전체</option>` + owners.map((o) => `<option>${esc(o)}</option>`).join("");
    const st = $("#f-status").value, ow = fo.value, q = $("#f-q").value.trim();
    const arr = live.filter((t) => (!st || t.status === st) && (!ow || t.owner === ow) && (!q || (t.title + t.snippet + t.requested_by).includes(q))).sort(byDue);
    $("#all-list").innerHTML = arr.length ? list(arr.map((t) => row(t))) : empty(I.inbox, "조건에 맞는 항목이 없습니다.");
  }

  if (state.tab === "team") {
    const rows = team.filter((m) => m.active !== "N").map((m) => {
      const n = live.filter((t) => t.status === "진행" && t.owner === m.name);
      const over = n.filter((t) => t.due && diffDays(today, t.due) < 0).length;
      const conn = m.user_id ? "네이버웍스 봇" : m.email ? esc(m.email) : "알림 없음";
      return `<div class="member">
        <span class="avatar">${esc(m.name.slice(-2))}</span>
        <div class="info">
          <div><b>${esc(m.name)}</b>${m.role ? ` <span class="faint small">${esc(m.role)}</span>` : ""}</div>
          <div class="small muted">진행 ${n.length}건${over ? ` · <span class="due over">지연 ${over}</span>` : ""} <span class="sep">·</span> ${conn}</div>
        </div>
        <div class="acts">
          <button class="quiet icon" data-act="team-email" data-name="${esc(m.name)}" data-v="${esc(m.email || "")}" title="이메일">${I.mail}</button>
          <button class="quiet icon" data-act="team-report" data-name="${esc(m.name)}" data-v="${m.daily_report === "N" ? "Y" : "N"}" title="${m.daily_report === "N" ? "일일보고 켜기" : "일일보고 끄기"}" style="${m.daily_report === "N" ? "opacity:.4" : ""}">${I.sun}</button>
          <button class="danger icon" data-act="team-off" data-name="${esc(m.name)}" title="목록에서 빼기">${I.trash}</button>
        </div></div>`;
    });
    $("#team-list").innerHTML = rows.length ? list(rows) : empty(I.user, "등록된 팀원이 없습니다.<br>위에서 이름과 이메일을 넣어 등록하세요.");
    const byDate = {}; for (const r of reports) (byDate[r.date] ||= []).push(r);
    $("#reports").innerHTML = Object.keys(byDate).sort().reverse().map((d) =>
      `<div class="card"><div class="card-head"><b>${fmtDate(d, today)} 팀원 보고</b></div>${byDate[d].map((r) => `<div class="small" style="margin-bottom:4px"><b>${esc(r.name)}</b> <span class="muted">${esc(r.text)}</span></div>`).join("")}</div>`).join("");
  }
}

function scheduleCard() {
  const { today, events } = state.data;
  if (!events) return "";
  if (events.error) return `<div class="card"><div class="small err">달력을 불러오지 못했습니다: ${esc(events.error)}</div></div>`;
  const td = events.filter((e) => e.date === today), tm = events.filter((e) => e.date !== today);
  if (!td.length && !tm.length) return "";
  const line = (e) => `<div class="evrow"><span class="when">${evTime(e)}</span><span class="what">${esc(e.title)}${e.location ? ` <span class="faint small">@${esc(e.location)}</span>` : ""}</span></div>`;
  return `<div class="card">
    <div class="card-head"><b>오늘 일정</b><span class="faint small">${td.length}건</span></div>
    ${td.length ? td.map(line).join("") : `<div class="small muted">없음</div>`}
    ${tm.length ? `<hr class="divider"><div class="small muted" style="margin-bottom:4px">내일</div>${tm.map(line).join("")}` : ""}
  </div>`;
}

const byDue = (a, b) => ((a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : a.id - b.id);
const list = (rows) => `<div class="list">${rows.join("")}</div>`;
const head = (title, n, cls = "") => `<div class="section ${cls}"><span class="dot"></span>${title}<span class="count">${n}</span></div>`;
const sec = (title, arr, cls = "") => (arr.length ? head(title, arr.length, cls) + list(arr.map((t) => row(t))) : "");
const empty = (icon, html) => `<div class="card"><div class="empty">${icon}<div>${html}</div></div></div>`;

function row(t, cand = false) {
  const { today, ownerName } = state.data;
  const done = t.status === "완료";
  const meta = [];
  if (t.owner && t.owner !== ownerName) meta.push(`<span class="tag person">${esc(t.owner)}</span>`);
  if (t.due) meta.push(`<span class="due${dueClass(t, today)}">${fmtDate(t.due, today)}${t.due_time ? " " + t.due_time : ""}</span>`);
  if (t.requested_by) meta.push(`<span>${esc(t.requested_by)} 요청</span>`);
  if (t.status === "보류") meta.push(`<span class="tag warn">보류</span>`);
  if (cand) meta.push(`<span class="tag">${esc(t.source)}</span>`);
  const acts = cand
    ? `<button class="sm" data-act="confirm">확정</button><button class="danger icon" data-act="dismiss" title="무시">${I.trash}</button>`
    : `<button class="quiet icon" data-act="due" title="기한">${I.calendar}</button>
       <button class="quiet icon" data-act="owner" title="담당">${I.user}</button>
       ${t.status === "진행" ? `<button class="quiet icon" data-act="hold" title="보류">${I.pause}</button>`
         : t.status === "보류" ? `<button class="quiet icon" data-act="resume" title="재개">${I.play}</button>` : ""}
       <button class="danger icon" data-act="dismiss" title="삭제">${I.trash}</button>`;
  return `<div class="task${done ? " done" : ""}" data-id="${t.id}">
    ${cand ? "" : `<input type="checkbox" class="check" ${done ? "checked" : ""} data-act="toggle" title="완료" aria-label="완료">`}
    <div class="body">
      <div class="title"><span class="num">#${t.id}</span>${esc(t.title)}</div>
      ${meta.length ? `<div class="meta">${meta.join("")}</div>` : ""}
      ${cand && t.snippet ? `<div class="quote">${esc(t.snippet)}</div>` : ""}
    </div>
    <div class="acts">${acts}</div>
  </div>`;
}

// ── 동작 ────────────────────────────────────────────────────
document.body.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act;
  const rowEl = b.closest(".task"); const id = rowEl ? +rowEl.dataset.id : 0;
  try {
    if (act === "toggle") await update(id, { status: b.checked ? "완료" : "진행" });
    else if (act === "confirm") await update(id, { status: "진행" });
    else if (act === "dismiss") { if (!confirm("이 항목을 지울까요?")) return; await update(id, { status: "삭제" }); }
    else if (act === "hold") await update(id, { status: "보류" });
    else if (act === "resume") await update(id, { status: "진행" });
    else if (act === "due") { const v = prompt("기한 (내일 / 금요일 / 9월 30일 / 2026-10-01, 비우면 없음)", ""); if (v === null) return; await update(id, v.trim() ? { dueText: v.trim() } : { due: "" }); }
    else if (act === "owner") { const v = prompt("담당자 이름 (비우면 나)", ""); if (v === null) return; await update(id, { owner: v.trim() }); }
    else if (act === "team-off") { if (!confirm("팀원을 목록에서 뺄까요? 기록은 남습니다.")) return; await team({ name: b.dataset.name, active: "N" }); }
    else if (act === "team-email") { const v = prompt(`${b.dataset.name} 이메일`, b.dataset.v || ""); if (v === null) return; await team({ name: b.dataset.name, email: v.trim() }); }
    else if (act === "team-report") await team({ name: b.dataset.name, daily_report: b.dataset.v });
  } catch (err) { toast("실패: " + err.message, 4000); }
});
async function update(id, patch) { await api("/api/tasks", { method: "POST", body: JSON.stringify({ op: "update", id, patch }) }); toast("저장했습니다"); await load(); }
async function team(member) { await api("/api/tasks", { method: "POST", body: JSON.stringify({ op: "team", member }) }); toast("저장했습니다"); await load(); }

$("#quick").addEventListener("submit", async (e) => {
  e.preventDefault();
  let title = $("#q-title").value.trim(); if (!title) return;
  let dueText = "", owner = "";
  const tl = title.match(/[~～]\s*(\S.*)$/); if (tl) { dueText = tl[1]; title = title.slice(0, tl.index).trim(); }
  const at = title.match(/@(\S+)/); if (at) { owner = at[1]; title = title.replace(at[0], "").trim(); }
  try {
    const t = await api("/api/tasks", { method: "POST", body: JSON.stringify({ op: "add", task: { title, dueText, owner } }) });
    $("#q-title").value = "";
    toast(`추가했습니다${t.due ? " · " + fmtDate(t.due, state.data.today) : ""}`);
    await load();
  } catch (err) { toast("실패: " + err.message, 4000); }
});
$("#team-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await team({ name: $("#t-name").value.trim(), role: $("#t-role").value.trim(), email: $("#t-email").value.trim(), active: "Y", daily_report: "Y" });
    $("#t-name").value = ""; $("#t-role").value = ""; $("#t-email").value = "";
  } catch (err) { toast("실패: " + err.message, 4000); }
});
["#f-status", "#f-owner", "#f-q"].forEach((s) => $(s).addEventListener("input", render));

// ── 대화 ────────────────────────────────────────────────────
function saveChat() { try { localStorage.setItem("worklog_chat", JSON.stringify(state.chat.slice(-80))); } catch {} }
function renderChat() {
  const log = $("#chat-log");
  if (!state.chat.length) {
    const name = state.data?.ownerName ? `, ${state.data.ownerName}님` : "";
    state.chat.push({ who: "bot", text: state.data?.ai
      ? `안녕하세요${name}. 무엇이든 말씀하세요.\n\n· "내일 3시 A사 미팅 잡아줘"\n· "이번 주 뭐 해야 하지?"\n· "김철수한테 견적서 금요일까지 시켜줘"`
      : `안녕하세요${name}. 할 일을 적어 주시면 등록합니다.\n'정리'라고 하면 순서대로 여쭤보며 함께 정리합니다.` });
  }
  log.innerHTML = state.chat.map((m) => {
    const body = m.typing ? `<span class="typing"><i></i><i></i><i></i></span>` : esc(m.text);
    const prov = m.provider && m.provider !== "rule"
      ? `<div class="prov">${m.provider === "claude" ? "Claude" : "Gemini"}${m.cost ? ` · ${m.cost < 1 ? "1원 미만" : Math.round(m.cost) + "원"}` : ""}</div>` : "";
    return `<div class="bubble ${m.who}${m.err ? " err" : ""}">${body}${prov}</div>`;
  }).join("");
  log.scrollTop = log.scrollHeight;
}
async function say(text) {
  text = String(text || "").trim(); if (!text) return;
  state.chat.push({ who: "me", text });
  const input = $("#chat-input"); input.value = ""; autoGrow(input);
  const thinking = { who: "bot", text: "", typing: true };
  state.chat.push(thinking); renderChat(); saveChat();
  try {
    const history = state.chat.filter((m) => m !== thinking && !m.typing && !m.err).slice(-13).map((m) => ({ who: m.who, text: m.text }));
    history.pop();
    const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ text, history }) });
    thinking.text = r.reply; thinking.provider = r.provider; thinking.cost = r.costKrw;
    load();
  } catch (e) { thinking.text = "오류: " + e.message; thinking.err = true; }
  thinking.typing = false; renderChat(); saveChat();
}
function autoGrow(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; }
$("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); say($("#chat-input").value); });
$("#chat-input").addEventListener("input", (e) => autoGrow(e.target));
$("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); say($("#chat-input").value); } });
$("#chips").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c) say(c.dataset.say); });

// ── 가져오기 ────────────────────────────────────────────────
$("#kakao-file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  $("#import-text").value = await f.text();
  document.querySelector('input[name=kind][value=kakao]').checked = true;
  toast(`${f.name} 을 읽었습니다`);
});
async function runImport(dryRun) {
  const text = $("#import-text").value; if (!text.trim()) return toast("내용이 비어 있습니다");
  const kind = document.querySelector("input[name=kind]:checked").value;
  const out = $("#import-result");
  out.innerHTML = `<p class="muted small" style="margin-top:12px">읽는 중…</p>`;
  try {
    const r = await api("/api/import", { method: "POST", body: JSON.stringify({ kind, text, days: +$("#kakao-days").value || 14, dryRun }) });
    const c = r.candidates || [];
    if (!c.length) { out.innerHTML = `<p class="muted small" style="margin-top:12px">할 일로 보이는 문장을 찾지 못했습니다.</p>`; return; }
    out.innerHTML = `<div class="result-head">${c.length}건 ${dryRun ? "찾음 · 아직 저장 안 됨" : "저장됨 · '후보' 탭에서 확정하세요"}</div>`
      + list(c.map((t) => `<div class="task"><div class="body">
          <div class="title">${esc(t.title)}</div>
          <div class="meta">${t.owner ? `<span class="tag person">${esc(t.owner)}</span>` : ""}${t.due ? `<span class="due">${fmtDate(t.due, state.data.today)}</span>` : ""}${t.requested_by ? `<span>${esc(t.requested_by)} 요청</span>` : ""}</div>
          ${t.snippet ? `<div class="quote">${esc(t.snippet)}</div>` : ""}</div></div>`));
    if (!dryRun) await load();
  } catch (err) { out.innerHTML = `<p class="err small" style="margin-top:12px">${esc(err.message)}</p>`; }
}
$("#import-preview").addEventListener("click", (e) => { e.preventDefault(); runImport(true); });
$("#import-run").addEventListener("click", (e) => { e.preventDefault(); runImport(false); });

// ── 캡처 읽기 ───────────────────────────────────────────────
async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js";
    s.onload = res; s.onerror = () => rej(new Error("글자 인식 라이브러리를 불러오지 못했습니다"));
    document.head.appendChild(s);
  });
  return window.Tesseract;
}
function preprocess(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.max(1.5, Math.min(3, 2400 / Math.max(img.width, img.height)));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale) + 40; c.height = Math.round(img.height * scale) + 40;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 20, 20, c.width - 40, c.height - 40);
      const d = ctx.getImageData(0, 0, c.width, c.height); const p = d.data;
      for (let i = 0; i < p.length; i += 4) { const g = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114; const v = g < 120 ? Math.max(0, g - 50) : g > 170 ? Math.min(255, g + 40) : g; p[i] = p[i + 1] = p[i + 2] = v; }
      ctx.putImageData(d, 0, 0); c.toBlob(resolve, "image/png");
    };
    img.onerror = () => reject(new Error("이미지를 열 수 없습니다")); img.src = URL.createObjectURL(file);
  });
}
function fileToBase64(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => reject(new Error("이미지를 열 수 없습니다")); img.src = URL.createObjectURL(file);
  });
}
function appendImported(texts) {
  const ta = $("#import-text");
  ta.value = (ta.value ? ta.value + "\n\n" : "") + texts.join("\n\n");
  document.querySelector('input[name=kind][value=text]').checked = true;
}
$("#shot-file").addEventListener("change", async (e) => {
  const files = [...e.target.files]; if (!files.length) return;
  const st = $("#ocr-status");
  try {
    const texts = [];
    if (state.data?.gemini) {
      for (let i = 0; i < files.length; i++) {
        st.textContent = `AI 가 읽는 중 ${i + 1}/${files.length}…`;
        const r = await api("/api/vision", { method: "POST", body: JSON.stringify({ image: await fileToBase64(files[i]), mime: "image/jpeg" }) });
        texts.push(r.text);
      }
    } else {
      st.textContent = "글자 인식 준비 중…";
      const T = await loadTesseract();
      for (let i = 0; i < files.length; i++) {
        const blob = await preprocess(files[i]);
        const r = await T.recognize(blob, "kor+eng", { logger: (m) => { if (m.status === "recognizing text") st.textContent = `읽는 중 ${i + 1}/${files.length} · ${Math.round(m.progress * 100)}%`; } });
        texts.push(r.data.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
      }
    }
    appendImported(texts);
    st.textContent = "다 읽었습니다. 아래 글을 확인한 뒤 '미리보기'를 누르세요.";
  } catch (err) { st.textContent = "실패: " + err.message; }
  e.target.value = "";
});

// ── 달력 ────────────────────────────────────────────────────
async function loadCal() {
  const { y, m } = state.cal;
  const from = `${y}-${pad(m)}-01`, to = `${y}-${pad(m)}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`;
  try { const r = await api(`/api/events?from=${from}&to=${to}`); state.cal.events = r.events; }
  catch (e) { toast("일정을 불러오지 못했습니다: " + e.message, 4000); state.cal.events = []; }
  renderCal(false);
}
function renderCal(fetch = true) {
  const today = state.data.today;
  if (!state.cal.y) { const [y, m] = today.split("-").map(Number); state.cal.y = y; state.cal.m = m; state.cal.sel = today; }
  if (fetch) { loadCal(); return; }
  const { y, m, sel, events } = state.cal;
  $("#cal-title").textContent = `${y}년 ${m}월`;
  const startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = DOW.map((d, i) => `<div class="cal-dow${i === 0 ? " sun" : ""}">${d}</div>`);
  for (let i = 0; i < startDow; i++) cells.push(`<div class="cal-cell pad"></div>`);
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const ev = events.filter((e) => e.date === iso);
    const dow = (startDow + d - 1) % 7;
    cells.push(`<div class="cal-cell${iso === today ? " today" : ""}${iso === sel ? " sel" : ""}${dow === 0 ? " sun" : ""}" data-date="${iso}" role="button" tabindex="0">
      <div class="d">${d}</div>
      ${ev.slice(0, 2).map((e) => `<span class="cal-ev${e.allDay ? " all" : ""}">${e.allDay ? "" : e.time + " "}${esc(e.title)}</span>`).join("")}
      ${ev.length > 2 ? `<span class="more">+${ev.length - 2}</span>` : ""}</div>`);
  }
  $("#cal-grid").innerHTML = cells.join("");
  const dayEv = events.filter((e) => e.date === sel);
  $("#cal-day-title").textContent = `${fmtDate(sel, today)}${dayEv.length ? ` · ${dayEv.length}건` : ""}`;
  $("#cal-day-list").innerHTML = dayEv.length ? dayEv.map((e) => `<div class="evrow" data-ev="${e.id}">
      <span class="when">${evTime(e)}</span>
      <span class="what">${esc(e.title)}${e.location ? ` <span class="faint small">@${esc(e.location)}</span>` : ""}</span>
      <span class="acts"><button class="quiet icon" data-act="ev-edit" title="수정">${I.calendar}</button><button class="danger icon" data-act="ev-del" title="삭제">${I.trash}</button></span>
    </div>`).join("") : `<div class="small muted">이 날은 일정이 없습니다.</div>`;
}
$("#cal-prev").addEventListener("click", () => { state.cal.m--; if (state.cal.m < 1) { state.cal.m = 12; state.cal.y--; } loadCal(); });
$("#cal-next").addEventListener("click", () => { state.cal.m++; if (state.cal.m > 12) { state.cal.m = 1; state.cal.y++; } loadCal(); });
$("#cal-today").addEventListener("click", () => { const [y, m] = state.data.today.split("-").map(Number); state.cal.y = y; state.cal.m = m; state.cal.sel = state.data.today; loadCal(); });
$("#cal-grid").addEventListener("click", (e) => { const c = e.target.closest(".cal-cell[data-date]"); if (c) { state.cal.sel = c.dataset.date; renderCal(false); } });
$("#cal-grid").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { const c = e.target.closest(".cal-cell[data-date]"); if (c) { e.preventDefault(); state.cal.sel = c.dataset.date; renderCal(false); } } });
$("#ev-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/events", { method: "POST", body: JSON.stringify({ op: "add", event: { title: $("#ev-title").value.trim(), date: state.cal.sel, timeText: $("#ev-time").value.trim(), location: $("#ev-loc").value.trim() } }) });
    $("#ev-title").value = ""; $("#ev-time").value = ""; $("#ev-loc").value = "";
    toast("일정을 추가했습니다"); loadCal(); load();
  } catch (err) { toast("실패: " + err.message, 4000); }
});
$("#cal-day-list").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const id = +b.closest("[data-ev]").dataset.ev;
  const ev = state.cal.events.find((x) => x.id === id);
  try {
    if (b.dataset.act === "ev-del") { if (!confirm("일정을 지울까요?")) return; await api("/api/events", { method: "POST", body: JSON.stringify({ op: "delete", id }) }); }
    else {
      const title = prompt("제목", ev.title); if (title === null) return;
      const time = prompt("시각 HH:MM (비우면 종일)", ev.time || ""); if (time === null) return;
      const patch = { title: title.trim() };
      if (/^\d{1,2}:\d{2}$/.test(time.trim())) { patch.startTime = time.trim().padStart(5, "0"); patch.endTime = ""; }
      else if (!time.trim()) { patch.startTime = ""; patch.endTime = ""; }
      await api("/api/events", { method: "POST", body: JSON.stringify({ op: "update", id, event: patch }) });
    }
    toast("저장했습니다"); loadCal(); load();
  } catch (err) { toast("실패: " + err.message, 4000); }
});

// ── 설정 점검 ───────────────────────────────────────────────
$("#check-run").addEventListener("click", async () => {
  $("#check-out").textContent = "확인 중…";
  try { $("#check-out").textContent = JSON.stringify(await api("/api/check"), null, 2); }
  catch (e) { $("#check-out").textContent = "실패: " + e.message; }
});

if (state.pin) load(); else showLogin();
