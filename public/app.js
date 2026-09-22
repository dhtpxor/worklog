// public/app.js — 업무 비서 웹페이지 (빌드 없음, 그냥 정적 파일)
const $ = (s) => document.querySelector(s);
const state = { pin: "", data: null, tab: "chat", chat: [], cal: { y: 0, m: 0, sel: "", events: [] } };
try { state.chat = JSON.parse(localStorage.getItem("worklog_chat") || "[]").slice(-80); } catch {}
try { state.pin = localStorage.getItem("worklog_pin") || ""; } catch {}

function toast(msg, ms = 2200) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), ms); }
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "x-pin": state.pin, "Content-Type": "application/json", ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (r.status === 401) { showLogin(j.error || "PIN 오류"); throw new Error(j.error || "PIN"); }
  if (!j.ok) throw new Error(j.error || "오류");
  return j.data;
}
function showLogin(err = "") { $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); $("#login-err").textContent = err; }
async function load() {
  try {
    state.data = await api("/api/tasks");
    $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
    $("#today").textContent = fmtDate(state.data.today, state.data.today);
    render();
  } catch (e) { if (!/PIN/.test(e.message)) toast("불러오기 실패: " + e.message, 4000); }
}
$("#login-form").addEventListener("submit", (e) => { e.preventDefault(); state.pin = $("#pin").value.trim(); try { localStorage.setItem("worklog_pin", state.pin); } catch {} load(); });
$("#reload").addEventListener("click", load);
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { state.tab = b.dataset.tab; render(); }));

// ── 날짜 ──
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function diffDays(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
function fmtDate(iso, today) { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; let s = `${m}/${d}(${dow})`; if (today) { const k = diffDays(today, iso); if (k === 0) s += " 오늘"; else if (k === 1) s += " 내일"; else if (k < 0) s += ` ${-k}일 지남`; } return s; }
function dueClass(t, today) { if (!t.due || t.status !== "진행") return ""; const k = diffDays(today, t.due); return k < 0 ? "due-over" : k === 0 ? "due-today" : ""; }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ── 렌더 ──
function render() {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== `tab-${state.tab}`));
  const { tasks, team, today, ownerName, reports } = state.data;
  const live = tasks.filter((t) => t.status !== "삭제");
  const mine = (t) => !t.owner || t.owner === ownerName;
  $("#n-cands").textContent = live.filter((t) => t.status === "후보").length || "";

  if (state.tab === "chat") renderChat();
  if (state.tab === "cal") renderCal();
  if (state.tab === "today") {
    const act = live.filter((t) => t.status === "진행" && mine(t));
    const over = act.filter((t) => t.due && diffDays(today, t.due) < 0), td = act.filter((t) => t.due === today), wk = act.filter((t) => t.due && diffDays(today, t.due) > 0 && diffDays(today, t.due) <= 7), rest = act.filter((t) => !over.includes(t) && !td.includes(t) && !wk.includes(t));
    const done = live.filter((t) => t.status === "완료" && mine(t) && String(t.completed_at).slice(0, 10) === today);
    const teamAct = live.filter((t) => t.status === "진행" && !mine(t));
    const ev = state.data.events;
    const evCard = ev && !ev.error ? `<div class="card"><b>📅 오늘 일정</b>${ev.filter((e) => e.date === today).map((e) => `<div class="small">${e.allDay ? "종일" : e.time + (e.endTime ? "~" + e.endTime : "")} ${esc(e.title)}${e.location ? " @" + esc(e.location) : ""}</div>`).join("") || '<div class="small muted">없음</div>'}${ev.some((e) => e.date !== today) ? `<div class="small muted" style="margin-top:6px">내일</div>` + ev.filter((e) => e.date !== today).map((e) => `<div class="small">${e.allDay ? "종일" : e.time} ${esc(e.title)}</div>`).join("") : ""}</div>` : ev?.error ? `<div class="card small err">캘린더 조회 실패: ${esc(ev.error)}</div>` : "";
    $("#today-list").innerHTML = [
      evCard,
      sec("🔴 지연", over, "red"), sec("🟠 오늘", td, "amber"), sec("🟡 이번 주", wk), sec("⚪ 기한 없음 · 나중", rest.sort(byDue)),
      teamAct.length ? `<div class="group">👥 팀원 진행 중</div>` + teamAct.sort(byDue).map(row).join("") : "",
      done.length ? sec("✅ 오늘 완료", done) : "",
      !act.length && !teamAct.length ? `<p class="muted">진행 중인 업무가 없습니다. 위 칸에 적어 추가하거나, 봇에 '정리'라고 보내 보세요.</p>` : "",
    ].join("");
  }
  if (state.tab === "cands") {
    const c = live.filter((t) => t.status === "후보").sort((a, b) => b.id - a.id);
    $("#cands-list").innerHTML = c.length ? c.map((t) => row(t, true)).join("") : `<p class="muted">후보가 없습니다.</p>`;
  }
  if (state.tab === "all") {
    const fo = $("#f-owner"); const owners = [...new Set(live.map((t) => t.owner).filter(Boolean))];
    if (fo.options.length !== owners.length + 1) fo.innerHTML = `<option value="">담당 전체</option>` + owners.map((o) => `<option>${esc(o)}</option>`).join("");
    const st = $("#f-status").value, ow = fo.value, q = $("#f-q").value.trim();
    const list = live.filter((t) => (!st || t.status === st) && (!ow || t.owner === ow) && (!q || (t.title + t.snippet + t.requested_by).includes(q))).sort(byDue);
    $("#all-list").innerHTML = list.length ? list.map((t) => row(t)).join("") : `<p class="muted">없음</p>`;
  }
  if (state.tab === "team") {
    $("#team-list").innerHTML = team.filter((m) => m.active !== "N").map((m) => {
      const n = live.filter((t) => t.status === "진행" && t.owner === m.name);
      const over = n.filter((t) => t.due && diffDays(today, t.due) < 0).length;
      const conn = m.user_id ? "· 네이버웍스 봇 연결" : m.email ? "· " + esc(m.email) : "· 알림 없음 (이메일을 등록하세요)";
      return `<div class="member"><div><b>${esc(m.name)}</b> <span class="muted small">${esc(m.role || "")} ${conn}</span><div class="small">진행 ${n.length}건${over ? ` · <span class="due-over">지연 ${over}</span>` : ""}</div></div>
        <div class="acts"><button class="small ghost" data-act="team-report" data-name="${esc(m.name)}" data-v="${m.daily_report === "N" ? "Y" : "N"}">${m.daily_report === "N" ? "일일보고 켜기" : "일일보고 끄기"}</button><button class="small ghost" data-act="team-email" data-name="${esc(m.name)}" data-v="${esc(m.email || "")}">이메일</button><button class="small danger" data-act="team-off" data-name="${esc(m.name)}">삭제</button></div></div>`;
    }).join("") || `<p class="muted">팀원이 없습니다.</p>`;
    const byDate = {}; for (const r of reports) (byDate[r.date] ||= []).push(r);
    $("#reports").innerHTML = Object.keys(byDate).sort().reverse().map((d) => `<div class="card"><b>${fmtDate(d, today)} 팀원 보고</b>${byDate[d].map((r) => `<div class="small"><b>${esc(r.name)}</b>: ${esc(r.text)}</div>`).join("")}</div>`).join("");
  }
}
function byDue(a, b) { return (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : a.id - b.id; }
function sec(title, arr, cls = "") { return arr.length ? `<div class="group ${cls}">${title} (${arr.length})</div>` + arr.map((t) => row(t)).join("") : ""; }
function row(t, cand = false) {
  const { today, ownerName } = state.data;
  const done = t.status === "완료";
  return `<div class="task ${done ? "done" : ""}" data-id="${t.id}">
    ${cand ? "" : `<input type="checkbox" ${done ? "checked" : ""} data-act="toggle" title="완료">`}
    <div class="t"><div class="title">#${t.id} ${esc(t.title)}</div>
      <div class="meta">${t.owner && t.owner !== ownerName ? `<span class="tag">👤 ${esc(t.owner)}</span>` : ""}${t.due ? `<span class="${dueClass(t, today)}">~${fmtDate(t.due, today)}${t.due_time ? " " + t.due_time : ""}</span> ` : ""}${t.requested_by ? `· ${esc(t.requested_by)} ` : ""}<span class="tag">${esc(t.source)}</span>${t.source_ref ? esc(t.source_ref) : ""}${t.status === "보류" ? ' <span class="tag">보류</span>' : ""}</div>
      ${cand && t.snippet ? `<div class="snippet">“${esc(t.snippet)}”</div>` : ""}</div>
    <div class="acts">${cand ? `<button class="small" data-act="confirm">확정</button><button class="small danger" data-act="dismiss">무시</button>` : `<button class="small ghost" data-act="due">기한</button><button class="small ghost" data-act="owner">담당</button>${t.status === "진행" ? `<button class="small ghost" data-act="hold">보류</button>` : t.status === "보류" ? `<button class="small ghost" data-act="resume">재개</button>` : ""}<button class="small danger" data-act="dismiss">삭제</button>`}</div>
  </div>`;
}

// ── 동작 ──
document.body.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act; const rowEl = b.closest(".task"); const id = rowEl ? +rowEl.dataset.id : 0;
  try {
    if (act === "toggle") await update(id, { status: b.checked ? "완료" : "진행" });
    else if (act === "confirm") await update(id, { status: "진행" });
    else if (act === "dismiss") { if (!confirm("정말 지울까요?")) { return; } await update(id, { status: "삭제" }); }
    else if (act === "hold") await update(id, { status: "보류" });
    else if (act === "resume") await update(id, { status: "진행" });
    else if (act === "due") { const v = prompt("기한 (예: 내일, 금요일, 9/30, 2026-10-01, 비우면 없음)", ""); if (v === null) return; await update(id, v ? { dueText: v } : { due: "" }); }
    else if (act === "owner") { const v = prompt("담당자 이름 (비우면 나)", ""); if (v === null) return; await update(id, { owner: v.trim() }); }
    else if (act === "team-off") { if (!confirm("팀원을 목록에서 뺄까요? (기록은 남습니다)")) return; await api("/api/tasks", { method: "POST", body: JSON.stringify({ op: "team", member: { name: b.dataset.name, active: "N" } }) }); toast("처리했습니다"); await load(); }
    else if (act === "team-email") { const v = prompt(`${b.dataset.name} 이메일`, b.dataset.v || ""); if (v === null) return; await api("/api/tasks", { method: "POST", body: JSON.stringify({ op: "team", member: { name: b.dataset.name, email: v.trim() } }) }); toast("저장했습니다"); await load(); }
    else if (act === "team-report") { await api("/api/tasks", { method: "POST", body: JSON.stringify({ op: "team", member: { name: b.dataset.name, daily_report: b.dataset.v } }) }); await load(); }
  } catch (err) { toast("실패: " + err.message, 4000); }
});
async function update(id, patch) {
  await api("/api/tasks", { method: "POST", body: JSON.stringify({ op: "update", id, patch }) });
  toast("저장했습니다"); await load();
}
$("#quick").addEventListener("submit", async (e) => {
  e.preventDefault();
  let title = $("#q-title").value.trim(); if (!title) return;
  let dueText = "", owner = "";
  const tl = title.match(/[~～]\s*(\S.*)$/); if (tl) { dueText = tl[1]; title = title.slice(0, tl.index).trim(); }
  const at = title.match(/@(\S+)/); if (at) { owner = at[1]; title = title.replace(at[0], "").trim(); }
  try { const t = await api("/api/tasks", { method: "POST", body: JSON.stringify({ op: "add", task: { title, dueText, owner } }) }); $("#q-title").value = ""; toast(`#${t.id} 추가${t.due ? " · ~" + fmtDate(t.due, state.data.today) : ""}`); await load(); }
  catch (err) { toast("실패: " + err.message, 4000); }
});
$("#team-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ op: "team", member: { name: $("#t-name").value.trim(), role: $("#t-role").value.trim(), email: $("#t-email").value.trim(), active: "Y", daily_report: "Y" } }) }); $("#t-name").value = ""; $("#t-role").value = ""; $("#t-email").value = ""; toast("등록했습니다"); await load(); }
  catch (err) { toast("실패: " + err.message, 4000); }
});
["#f-status", "#f-owner", "#f-q"].forEach((s) => $(s).addEventListener("input", render));

// ── 가져오기 ──
$("#kakao-file").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; $("#import-text").value = await f.text(); document.querySelector('input[name=kind][value=kakao]').checked = true; toast(`${f.name} 읽음`); });
async function runImport(dryRun) {
  const text = $("#import-text").value; if (!text.trim()) return toast("내용이 비어 있습니다");
  const kind = document.querySelector("input[name=kind]:checked").value;
  const out = $("#import-result"); out.innerHTML = `<p class="muted">처리 중…</p>`;
  try {
    const r = await api("/api/import", { method: "POST", body: JSON.stringify({ kind, text, days: +$("#kakao-days").value || 14, dryRun }) });
    const c = r.candidates || [];
    out.innerHTML = `<p><b>${c.length}건</b> ${dryRun ? "찾음 (아직 저장 안 됨)" : "후보로 저장됨 → '후보' 탭에서 확정/무시"}</p>` + c.map((t) => `<div class="task"><div class="t"><div class="title">${esc(t.title)}</div><div class="meta">${t.owner ? `<span class="tag">👤 ${esc(t.owner)}</span>` : ""}${t.due ? `~${fmtDate(t.due, state.data.today)} ` : ""}${t.requested_by ? "· " + esc(t.requested_by) : ""}</div><div class="snippet">“${esc(t.snippet)}”</div></div></div>`).join("");
    if (!dryRun) await load();
  } catch (err) { out.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}
$("#import-preview").addEventListener("click", (e) => { e.preventDefault(); runImport(true); });
$("#import-run").addEventListener("click", (e) => { e.preventDefault(); runImport(false); });

// ── 대화 ──
function saveChat() { try { localStorage.setItem("worklog_chat", JSON.stringify(state.chat.slice(-80))); } catch {} }
function renderChat() {
  const log = $("#chat-log");
  if (!state.chat.length) state.chat.push({ who: "bot", text: `안녕하세요${state.data?.ownerName ? ", " + state.data.ownerName + "님" : ""}. 무엇을 도와드릴까요?\n'정리'라고 하면 오늘 할 일을 같이 정리하고, 그냥 할 일을 적어도 등록됩니다. 아래 버튼을 눌러도 돼요.` });
  log.innerHTML = state.chat.map((m) => `<div class="msg ${m.who}${m.err ? " err" : ""}">${esc(m.text)}${m.provider && m.provider !== "rule" ? `<div class="prov">${m.provider === "claude" ? "Claude" : "Gemini"}${m.cost ? ` · 약 ${m.cost < 1 ? "1원 미만" : Math.round(m.cost) + "원"}` : ""}</div>` : ""}</div>`).join("");
  log.scrollTop = log.scrollHeight;
}
async function say(text) {
  text = String(text || "").trim(); if (!text) return;
  state.chat.push({ who: "me", text }); renderChat(); saveChat();
  $("#chat-input").value = "";
  const thinking = { who: "bot", text: "…" }; state.chat.push(thinking); renderChat();
  try {
    const history = state.chat.filter((m) => m !== thinking && m.text !== "…" && !m.err).slice(-12).map((m) => ({ who: m.who, text: m.text }));
    history.pop(); // 마지막은 지금 보낸 말
    const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ text, history }) });
    thinking.text = r.reply; thinking.provider = r.provider; thinking.cost = r.costKrw;
    load();
  } catch (e) { thinking.text = "오류: " + e.message; thinking.err = true; }
  renderChat(); saveChat();
}
$("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); say($("#chat-input").value); });
$("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); say($("#chat-input").value); } });
$("#chips").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c) say(c.dataset.say); });

// ── 캡처 이미지 OCR (브라우저 안에서만 처리) ──
async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js"; s.onload = res; s.onerror = () => rej(new Error("글자 인식 라이브러리를 불러오지 못했습니다")); document.head.appendChild(s); });
  return window.Tesseract;
}
function preprocess(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.max(1.5, Math.min(3, 2400 / Math.max(img.width, img.height)));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * scale) + 40; c.height = Math.round(img.height * scale) + 40;
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 20, 20, c.width - 40, c.height - 40);
      const d = ctx.getImageData(0, 0, c.width, c.height); const p = d.data;
      for (let i = 0; i < p.length; i += 4) { const g = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114; const v = g < 120 ? Math.max(0, g - 50) : g > 170 ? Math.min(255, g + 40) : g; p[i] = p[i + 1] = p[i + 2] = v; }
      ctx.putImageData(d, 0, 0); c.toBlob(resolve, "image/png");
    };
    img.onerror = () => reject(new Error("이미지를 열 수 없습니다")); img.src = URL.createObjectURL(file);
  });
}
async function fileToBase64(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { const sc = Math.min(1, maxSide / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]); };
    img.onerror = () => reject(new Error("이미지를 열 수 없습니다")); img.src = URL.createObjectURL(file);
  });
}
$("#shot-file").addEventListener("change", async (e) => {
  const files = [...e.target.files]; if (!files.length) return;
  const st = $("#ocr-status");
  if (state.data?.gemini) {
    try {
      const texts = [];
      for (let i = 0; i < files.length; i++) { st.textContent = `AI가 읽는 중 ${i + 1}/${files.length}…`; const r = await api("/api/vision", { method: "POST", body: JSON.stringify({ image: await fileToBase64(files[i]), mime: "image/jpeg" }) }); texts.push(r.text); }
      const ta = $("#import-text"); ta.value = (ta.value ? ta.value + "\n\n" : "") + texts.join("\n\n");
      document.querySelector('input[name=kind][value=text]').checked = true;
      st.textContent = "완료. 아래 글을 확인한 뒤 '미리보기'를 누르세요.";
    } catch (err) { st.textContent = "실패: " + err.message; }
    e.target.value = ""; return;
  }
  try {
    st.textContent = "글자 인식 준비 중…"; const T = await loadTesseract();
    const texts = [];
    for (let i = 0; i < files.length; i++) {
      st.textContent = `읽는 중 ${i + 1}/${files.length}…`;
      const blob = await preprocess(files[i]);
      const r = await T.recognize(blob, "kor+eng", { logger: (m) => { if (m.status === "recognizing text") st.textContent = `읽는 중 ${i + 1}/${files.length} · ${Math.round(m.progress * 100)}%`; } });
      texts.push(r.data.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
    }
    const ta = $("#import-text"); ta.value = (ta.value ? ta.value + "\n\n" : "") + texts.join("\n\n");
    document.querySelector('input[name=kind][value=text]').checked = true;
    st.textContent = `완료. 아래 글을 확인한 뒤 '미리보기'를 누르세요.`;
  } catch (err) { st.textContent = "실패: " + err.message; }
  e.target.value = "";
});

// ── 달력 ──
function pad(n) { return String(n).padStart(2, "0"); }
async function loadCal() {
  const { y, m } = state.cal;
  const from = `${y}-${pad(m)}-01`, to = `${y}-${pad(m)}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`;
  try { const r = await api(`/api/events?from=${from}&to=${to}`); state.cal.events = r.events; } catch (e) { toast("일정 불러오기 실패: " + e.message, 4000); state.cal.events = []; }
  renderCal(false);
}
function renderCal(fetch = true) {
  const today = state.data.today;
  if (!state.cal.y) { const [y, m] = today.split("-").map(Number); state.cal.y = y; state.cal.m = m; state.cal.sel = today; }
  const { y, m, sel, events } = state.cal;
  if (fetch) { loadCal(); return; }
  $("#cal-title").textContent = `${y}년 ${m}월`;
  const first = new Date(Date.UTC(y, m - 1, 1)); const startDow = first.getUTCDay(); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = ["일", "월", "화", "수", "목", "금", "토"].map((d, i) => `<div class="cal-dow ${i === 0 ? "sun" : ""}">${d}</div>`);
  for (let i = 0; i < startDow; i++) cells.push(`<div class="cal-cell other"></div>`);
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`; const ev = events.filter((e) => e.date === iso);
    const dow = (startDow + d - 1) % 7;
    cells.push(`<div class="cal-cell ${iso === today ? "today" : ""} ${iso === sel ? "sel" : ""} ${dow === 0 ? "sun" : ""}" data-date="${iso}"><div class="d">${d}</div>${ev.slice(0, 3).map((e) => `<span class="ev ${e.allDay ? "all" : ""}">${e.allDay ? "" : e.time + " "}${esc(e.title)}</span>`).join("")}${ev.length > 3 ? `<span class="more">+${ev.length - 3}</span>` : ""}</div>`);
  }
  $("#cal-grid").innerHTML = cells.join("");
  const dayEv = events.filter((e) => e.date === sel);
  $("#cal-day-title").textContent = `${fmtDate(sel, today)} 일정 ${dayEv.length ? `(${dayEv.length})` : ""}`;
  $("#cal-day-list").innerHTML = dayEv.length ? dayEv.map((e) => `<div class="evrow" data-ev="${e.id}"><div class="t"><b>${e.allDay ? "종일" : e.time + (e.endTime ? "~" + e.endTime : "")}</b> ${esc(e.title)}${e.location ? ` <span class="muted small">@${esc(e.location)}</span>` : ""}</div><div class="acts"><button class="small ghost" data-act="ev-edit">수정</button><button class="small danger" data-act="ev-del">삭제</button></div></div>`).join("") : `<p class="muted small">없음</p>`;
}
$("#cal-prev").addEventListener("click", () => { state.cal.m--; if (state.cal.m < 1) { state.cal.m = 12; state.cal.y--; } loadCal(); });
$("#cal-next").addEventListener("click", () => { state.cal.m++; if (state.cal.m > 12) { state.cal.m = 1; state.cal.y++; } loadCal(); });
$("#cal-today").addEventListener("click", () => { const [y, m] = state.data.today.split("-").map(Number); state.cal.y = y; state.cal.m = m; state.cal.sel = state.data.today; loadCal(); });
$("#cal-grid").addEventListener("click", (e) => { const c = e.target.closest(".cal-cell[data-date]"); if (c) { state.cal.sel = c.dataset.date; renderCal(false); } });
$("#ev-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await api("/api/events", { method: "POST", body: JSON.stringify({ op: "add", event: { title: $("#ev-title").value.trim(), date: state.cal.sel, timeText: $("#ev-time").value.trim(), location: $("#ev-loc").value.trim() } }) }); $("#ev-title").value = ""; $("#ev-time").value = ""; $("#ev-loc").value = ""; toast("일정 추가"); loadCal(); load(); }
  catch (err) { toast("실패: " + err.message, 4000); }
});
$("#cal-day-list").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return; const id = +b.closest("[data-ev]").dataset.ev; const ev = state.cal.events.find((x) => x.id === id);
  try {
    if (b.dataset.act === "ev-del") { if (!confirm("일정을 지울까요?")) return; await api("/api/events", { method: "POST", body: JSON.stringify({ op: "delete", id } ) }); }
    else { const title = prompt("제목", ev.title); if (title === null) return; const time = prompt("시각 HH:MM (비우면 종일)", ev.time || ""); if (time === null) return; const patch = { title: title.trim() }; if (/^\d{2}:\d{2}$/.test(time.trim())) { patch.startTime = time.trim(); patch.endTime = ""; } else if (!time.trim()) { patch.startTime = ""; patch.endTime = ""; } await api("/api/events", { method: "POST", body: JSON.stringify({ op: "update", id, event: patch }) }); }
    toast("저장했습니다"); loadCal(); load();
  } catch (err) { toast("실패: " + err.message, 4000); }
});

// ── 설정 점검 ──
$("#check-run").addEventListener("click", async () => {
  $("#check-out").textContent = "확인 중…";
  try { const r = await api("/api/check"); $("#check-out").textContent = JSON.stringify(r, null, 2); } catch (e) { $("#check-out").textContent = "실패: " + e.message; }
});

if (state.pin) load(); else showLogin();
