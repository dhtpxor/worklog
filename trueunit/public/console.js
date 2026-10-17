// 검수 콘솔 — 검수사(inspector) 또는 관리자(admin) 키로 접속
const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString("ko-KR")}원` : "—");
const when = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const KEY = "trueunit.key";
const S = { key: null, me: null, view: "queue", selected: null, blobUrls: [] };

function getKey() { try { return sessionStorage.getItem(KEY); } catch { return S.key; } }
function setKey(k) { S.key = k; try { k ? sessionStorage.setItem(KEY, k) : sessionStorage.removeItem(KEY); } catch {} }

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { authorization: `Bearer ${getKey()}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error("키가 올바르지 않습니다"); }
  if (!res.ok) throw new Error(data?.error?.message || `요청 실패 (${res.status})`);
  return data;
}
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.append(t); setTimeout(() => t.remove(), 2600);
}

const STATUS = {
  collecting: ["촬영 중", ""], analyzing: ["분석 중", ""], in_review: ["검수 대기", "warn"], passed: ["자동 통과", "good"],
  authentic: ["✓ 진품", "good"], counterfeit: ["✕ 가품", "bad"], inconclusive: ["판정 보류", "warn"],
};
const statusBadge = (s) => `<span class="badge ${STATUS[s]?.[1] || ""}">${esc(STATUS[s]?.[0] || s)}</span>`;
const BAND = { low: ["낮음", "good"], medium: ["중간", "warn"], high: ["높음", "bad"] };
const bandBadge = (b) => (b ? `<span class="badge ${BAND[b][1]}">위험 ${BAND[b][0]}</span>` : "");
const ANOM = { none: ["이상 없음", "good"], minor: ["작은 차이", "warn"], major: ["큰 이상", "bad"], cannot_assess: ["판단 불가", ""] };

// ---------- 로그인 ----------
function renderLogin(err = "") {
  $("#tabs").classList.add("hidden"); $("#logout").classList.add("hidden"); $("#who").textContent = "";
  main.innerHTML = `
    <div class="card stack" style="max-width:460px;margin:40px auto">
      <h2>검수 콘솔 접속</h2>
      <p class="small muted">검수사 키(tu_i_…) 또는 관리자 키(tu_a_…)를 넣어 주세요. 키는 이 브라우저 탭을 닫으면 지워집니다.</p>
      <form id="login" class="stack">
        <label class="field"><span>API 키</span><input class="input mono" name="key" autocomplete="off" required></label>
        ${err ? `<p class="small" style="color:var(--bad)">${esc(err)}</p>` : ""}
        <button class="btn btn-primary">접속</button>
      </form>
    </div>`;
  $("#login").addEventListener("submit", async (e) => {
    e.preventDefault();
    setKey(new FormData(e.target).get("key").trim());
    await boot().catch((er) => renderLogin(er.message));
  });
}
function logout() { setKey(null); S.me = null; renderLogin(); }
$("#logout").addEventListener("click", logout);

async function boot() {
  if (!getKey()) return renderLogin();
  S.me = await api("GET", "/v1/me");
  if (S.me.role === "platform") { setKey(null); throw new Error("플랫폼 키로는 콘솔을 쓸 수 없습니다. 검수사 또는 관리자 키를 넣어 주세요."); }
  $("#who").textContent = `${S.me.tenant.name} · ${S.me.role === "admin" ? "관리자" : "검수사"}`;
  $("#tabs").classList.remove("hidden"); $("#logout").classList.remove("hidden");
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", S.me.role !== "admin"));
  show(S.view);
}

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
function show(view) {
  S.view = view; S.selected = null;
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  ({ queue: viewQueue, cases: viewCases, claims: viewClaims, metrics: viewMetrics, settings: viewSettings, guide: viewGuide })[view]().catch((e) => { main.innerHTML = `<div class="card">${esc(e.message)}</div>`; });
}

// ---------- 검수 대기 / 전체 거래 ----------
async function viewQueue() { return listAndDetail(await api("GET", "/v1/queue"), "검수할 건이 없습니다."); }
async function viewCases() {
  const status = S.casesFilter || "";
  const data = await api("GET", `/v1/cases?limit=100${status ? `&status=${status}` : ""}`);
  await listAndDetail(data, "거래 건이 없습니다.", `
    <select class="input" id="flt" aria-label="상태로 거르기">
      <option value="">모든 상태</option>
      ${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${k === status ? "selected" : ""}>${l}</option>`).join("")}
    </select>`);
  $("#flt").addEventListener("change", (e) => { S.casesFilter = e.target.value; show("cases"); });
}

async function listAndDetail({ cases }, emptyMsg, filterHtml = "") {
  main.innerHTML = `
    <div class="split">
      <div class="stack">${filterHtml}<ul class="list" id="list">${cases.length ? cases.map(itemHtml).join("") : `<li class="empty">${emptyMsg}</li>`}</ul></div>
      <div id="detail">${cases.length ? `<div class="card empty">왼쪽에서 건을 고르세요.</div>` : ""}</div>
    </div>`;
  main.querySelectorAll("[data-case]").forEach((b) => b.addEventListener("click", () => openCase(b.dataset.case)));
  if (cases[0]) openCase(cases[0].id);
}
function itemHtml(c) {
  const a = c.assessment;
  return `<li><button class="list-item" data-case="${esc(c.id)}">
    <div class="top"><strong>${esc([c.brand, c.model_hint].filter(Boolean).join(" ") || c.category)}</strong>${a ? `<span class="mono">${a.score}점</span>` : ""}</div>
    <div class="row small" style="margin-top:4px">${statusBadge(c.status)}${a ? bandBadge(a.band) : ""}${a?.recommendation === "escalate_priority" ? `<span class="badge bad">우선</span>` : ""}<span class="faint">${when(c.submitted_at || c.created_at)}</span></div>
  </button></li>`;
}

async function openCase(id) {
  S.selected = id;
  main.querySelectorAll("[data-case]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.case === id)));
  S.blobUrls.forEach(URL.revokeObjectURL); S.blobUrls = [];
  const d = await api("GET", `/v1/review/cases/${id}`);
  const a = d.assessment;
  const aiBy = Object.fromEntries((d.ai?.checkpoints || []).map((c) => [c.checkpoint_id, c]));
  const priceRatio = d.listing.price && d.listing.market_price ? Math.round((d.listing.price / d.listing.market_price) * 100) : null;
  const canJudge = d.status === "in_review";
  $("#detail").innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div class="stack" style="--gap:4px">
            <h2>${esc([d.brand, d.model_hint].filter(Boolean).join(" ") || d.category)}</h2>
            <div class="row small">${statusBadge(d.status)}${a?.audit_sample || d.ai?.audit_sample ? `<span class="badge brand">품질 감사 표본</span>` : ""}<span class="mono faint">${esc(d.id)}</span></div>
          </div>
          ${a ? `<div style="text-align:right"><div class="score">${a.score}</div><div class="small muted">위험 점수 · ${bandBadge(a.band)}</div></div>` : ""}
        </div>
        <dl class="kv" style="margin-top:12px">
          <dt>가격</dt><dd>${won(d.listing.price)}${d.listing.market_price ? ` <span class="muted">(시세 ${won(d.listing.market_price)}${priceRatio ? `, ${priceRatio}%` : ""})</span>` : ""}</dd>
          <dt>판매자</dt><dd>${esc(d.seller.id || "—")} · 가입 ${d.seller.account_age_days ?? "—"}일 · 거래 ${d.seller.completed_sales ?? "—"} · 분쟁 ${d.seller.past_disputes ?? "—"} · 가품 이력 ${d.seller.confirmed_counterfeits ?? "—"}</dd>
          <dt>외부 참조</dt><dd class="mono">${esc(d.external_ref || "—")}</dd>
          ${/^https?:\/\//i.test(d.listing.url || "") ? `<dt>판매글</dt><dd><a href="${esc(d.listing.url)}" target="_blank" rel="noopener noreferrer">열기</a></dd>` : ""}
        </dl>
      </div>
      ${a ? `<div class="card"><div class="card-title"><h3>점수 근거</h3></div>
        ${a.evidence.length ? `<ul class="evidence">${a.evidence.map((e) => `<li><span class="pts">+${e.points}</span><span>${esc(e.message)}</span></li>`).join("")}</ul>` : `<p class="muted small">가산 항목이 없습니다.</p>`}
        ${d.ai?.observation ? `<p class="small" style="margin-top:10px"><strong>AI 종합 관찰</strong> · ${esc(d.ai.observation)}</p>` : ""}
        ${d.ai?.error ? `<p class="small" style="margin-top:8px;color:var(--warn)">AI 분석 실패: ${esc(d.ai.error.message)}</p>` : ""}
        ${d.ai?.meta ? `<p class="small faint" style="margin-top:6px">AI ${esc(d.ai.meta.model)} · 입력 ${d.ai.meta.usage.input_tokens.toLocaleString()} / 출력 ${d.ai.meta.usage.output_tokens.toLocaleString()} 토큰</p>` : ""}
        <p class="small faint" style="margin-top:6px">AI 관찰은 참고 자료입니다. 판정은 검수사가 직접 사진을 보고 내립니다.</p>
      </div>` : ""}
      <div class="cp-grid">${d.checkpoints.map((cp) => cpHtml(cp, d.images.filter((i) => i.checkpoint === cp.id), aiBy[cp.id], canJudge)).join("")}</div>
      ${canJudge ? verdictFormHtml() : d.verdict ? `<div class="card"><h3>판정</h3><p style="margin-top:6px">${statusBadge(d.verdict.verdict)} <span class="small muted">${when(d.verdict.decided_at)}</span></p></div>` : ""}
    </div>`;
  // 이미지는 인증 헤더가 필요해 blob 으로 받아 붙인다
  $("#detail").querySelectorAll("img[data-img]").forEach(async (im) => {
    const res = await fetch(`/v1/images/${im.dataset.img}`, { headers: { authorization: `Bearer ${getKey()}` } });
    if (!res.ok) return;
    const u = URL.createObjectURL(await res.blob());
    S.blobUrls.push(u); im.src = u;
    im.addEventListener("click", () => { const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${u}" alt="">`; lb.addEventListener("click", () => lb.remove()); document.body.append(lb); });
  });
  if (canJudge) $("#verdict").addEventListener("submit", (e) => submitVerdict(e, id));
}

function cpHtml(cp, imgs, ai, canJudge) {
  const issues = imgs.flatMap((i) => i.quality.issues.map((x) => x.message));
  return `<div class="cp">
    <div class="cp-head"><strong class="small">${esc(cp.label)}${cp.required ? "" : ` <span class="faint">(선택)</span>`}</strong>${ai ? `<span class="badge ${ANOM[ai.anomaly][1]}">${ANOM[ai.anomaly][0]}</span>` : imgs.length ? "" : `<span class="badge ${cp.required ? "warn" : ""}">사진 없음</span>`}</div>
    <div class="cp-photos">${imgs.length ? imgs.map((i) => `<img data-img="${esc(i.id)}" alt="${esc(cp.label)} 사진" loading="lazy">`).join("") : `<div class="cp-empty">사진 없음</div>`}</div>
    <div class="cp-body stack" style="--gap:6px">
      ${ai ? `<p>${esc(ai.observations)}</p>${ai.inspector_note ? `<p class="muted">메모: ${esc(ai.inspector_note)}</p>` : ""}<p class="faint">AI 확신도 ${Math.round(ai.confidence * 100)}%</p>` : ""}
      ${issues.length ? `<p class="small" style="color:var(--warn)">${esc([...new Set(issues)].join(" "))}</p>` : ""}
      ${canJudge ? `<label class="check"><input type="checkbox" name="flag" value="${esc(cp.id)}" form="verdict"> 근거 부위로 표시</label>` : ""}
    </div>
  </div>`;
}

function verdictFormHtml() {
  return `<form class="card stack" id="verdict">
    <h3>검수 판정</h3>
    <div class="row">
      <label class="check"><input type="radio" name="verdict" value="authentic" required> 진품</label>
      <label class="check"><input type="radio" name="verdict" value="counterfeit"> 가품</label>
      <label class="check"><input type="radio" name="verdict" value="inconclusive"> 판정 보류</label>
    </div>
    <p class="small muted">가품 판정에는 위 사진 카드에서 근거 부위를 하나 이상 표시해야 합니다.</p>
    <label class="field"><span>검수사 이름</span><input class="input" name="inspector_name" maxlength="60"></label>
    <label class="field"><span>메모 (플랫폼에 전달되지 않습니다)</span><textarea class="input" name="note" rows="3" maxlength="2000"></textarea></label>
    <div><button class="btn btn-primary">판정 저장</button></div>
  </form>`;
}

async function submitVerdict(e, id) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { verdict: fd.get("verdict"), flagged_checkpoints: fd.getAll("flag"), note: fd.get("note"), inspector_name: fd.get("inspector_name") };
  try {
    await api("POST", `/v1/review/cases/${id}/verdict`, body);
    toast("판정을 저장했습니다");
    show(S.view);
  } catch (err) { toast(err.message); }
}

// ---------- 청구 ----------
async function viewClaims() {
  const { claims } = await api("GET", "/v1/claims");
  main.innerHTML = `<div class="card stack"><h2>보증 청구</h2>${claims.length ? `<div class="table-wrap"><table class="data">
    <thead><tr><th>접수</th><th>거래 건</th><th>사유</th><th>상태</th><th class="num">지급액</th><th></th></tr></thead>
    <tbody>${claims.map((c) => `<tr>
      <td>${when(c.opened_at)}</td><td class="mono">${esc(c.case_id)}</td><td>${esc(c.reason)}</td>
      <td>${c.status === "reinspection" ? `<span class="badge warn">재검수 중</span>` : c.status === "paid" ? `<span class="badge bad">✕ 지급(가품 확정)</span>` : `<span class="badge good">✓ 기각</span>`}</td>
      <td class="num">${c.status === "paid" ? won(c.payout_krw) : "—"}</td>
      <td>${c.status === "reinspection" ? `<div class="row"><button class="btn btn-danger small" data-claim="${esc(c.id)}" data-outcome="counterfeit_confirmed">가품 확정·지급</button><button class="btn small" data-claim="${esc(c.id)}" data-outcome="not_confirmed">기각</button></div>` : ""}</td>
    </tr>`).join("")}</tbody></table></div>` : `<p class="empty">청구가 없습니다.</p>`}</div>`;
  main.querySelectorAll("[data-claim]").forEach((b) => b.addEventListener("click", async () => {
    const note = prompt(b.dataset.outcome === "counterfeit_confirmed" ? "가품 확정 근거를 적어 주세요" : "기각 사유를 적어 주세요");
    if (note === null) return;
    try {
      const r = await api("POST", `/v1/claims/${b.dataset.claim}/resolve`, { outcome: b.dataset.outcome, note });
      toast(r.suspended_categories.length ? `처리했습니다. 손해율 초과로 ${r.suspended_categories.join(", ")} 보증이 중단됐습니다.` : "처리했습니다");
      show("claims");
    } catch (err) { toast(err.message); }
  }));
}

// ---------- 지표 ----------
async function viewMetrics() {
  const m = await api("GET", "/v1/metrics");
  const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);
  const tile = (label, value, hint = "") => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  const g = Object.entries(m.guarantee.by_category);
  main.innerHTML = `<div class="stack">
    <h2>운영 지표</h2>
    <div class="tiles">
      ${tile("판정한 거래", m.cases.assessed.toLocaleString(), `전체 ${m.cases.total.toLocaleString()}건`)}
      ${tile("자동 통과율", pct(m.routing.auto_pass_rate_pct), "사람 검수 없이 체결")}
      ${tile("검수 비율", pct(m.routing.escalation_rate_pct), `우선 검수 ${pct(m.routing.priority_rate_pct)}`)}
      ${tile("가품 포착률", pct(m.quality.counterfeit_caught_in_medium_or_high_pct), "가품 판정 건 중 위험 중간 이상")}
      ${tile("진품 오경보", pct(m.quality.authentic_flagged_high_pct), "진품 판정 건 중 위험 높음")}
      ${tile("감사 표본 오통과", `${m.quality.audit_false_pass}/${m.quality.audit_samples}`, "저위험인데 가품이던 건")}
      ${tile("처리 시간 중앙값", m.turnaround_minutes_median === null ? "—" : `${Math.round(m.turnaround_minutes_median)}분`, "제출 → 판정")}
      ${tile("개체 지문 대조", m.units.checks.toLocaleString(), `일치 ${pct(m.units.match_rate_pct)} · 등록 ${m.units.registered}`)}
    </div>
    <p class="small muted">${esc(m.quality.note)}</p>
    <div class="card stack"><h3>보증 손해율</h3>
      ${g.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>카테고리</th><th class="num">발행</th><th class="num">보증료</th><th class="num">지급</th><th class="num">손해율</th><th>상태</th></tr></thead><tbody>
      ${g.map(([cat, r]) => `<tr><td>${esc(cat)}</td><td class="num">${r.issued}</td><td class="num">${won(r.fees_krw)}</td><td class="num">${won(r.paid_krw)}</td><td class="num">${Math.round(r.loss_ratio * 100)}%</td><td>${m.guarantee.suspended_categories.includes(cat) ? `<span class="badge bad">✕ 중단</span>` : `<span class="badge good">✓ 판매 중</span>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">발행된 보증이 없습니다.</p>`}
    </div>
    <p class="small faint">AI 사용량: 입력 ${m.ai_tokens.input.toLocaleString()} · 출력 ${m.ai_tokens.output.toLocaleString()} 토큰 · AI 미분석 ${m.routing.ai_unavailable}건</p>
  </div>`;
}

// ---------- 설정 ----------
async function viewSettings() {
  const s = await api("GET", "/v1/settings");
  main.innerHTML = `<form class="card stack" id="settings" style="max-width:640px">
    <h2>설정</h2>
    <h3>판정 라우팅</h3>
    <div class="row">
      <label class="field" style="flex:1"><span>자동 통과 기준 (이 점수 미만)</span><input class="input" type="number" min="0" max="100" name="auto_pass_below" value="${s.risk.auto_pass_below}"></label>
      <label class="field" style="flex:1"><span>우선 검수 기준 (이 점수 이상)</span><input class="input" type="number" min="0" max="100" name="priority_at" value="${s.risk.priority_at}"></label>
      <label class="field" style="flex:1"><span>감사 표본 비율 (0~1)</span><input class="input" type="number" step="0.01" min="0" max="1" name="audit_rate" value="${s.risk.audit_rate}"></label>
    </div>
    <h3>보증</h3>
    <div class="row">
      <label class="check"><input type="checkbox" name="cat" value="sneakers" ${s.guarantee.enabled_categories.includes("sneakers") ? "checked" : ""}> 스니커즈</label>
      <label class="check"><input type="checkbox" name="cat" value="handbags" ${s.guarantee.enabled_categories.includes("handbags") ? "checked" : ""}> 명품 가방</label>
    </div>
    <div class="row">
      <label class="field" style="flex:1"><span>보증 가능 점수 (미만)</span><input class="input" type="number" min="0" max="100" name="max_score" value="${s.guarantee.max_score}"></label>
      <label class="field" style="flex:1"><span>중단 손해율</span><input class="input" type="number" step="0.05" min="0" name="max_loss_ratio" value="${s.guarantee.kill_switch.max_loss_ratio}"></label>
      <label class="field" style="flex:1"><span>중단 판단 최소 발행 수</span><input class="input" type="number" min="1" name="min_issued" value="${s.guarantee.kill_switch.min_issued}"></label>
    </div>
    ${s.guarantee.suspended_categories.length ? `<div class="row small"><span class="badge bad">✕ 중단: ${esc(s.guarantee.suspended_categories.join(", "))}</span><label class="check"><input type="checkbox" name="resume"> 다시 판매</label></div>` : ""}
    <h3>개체 지문</h3>
    <label class="field"><span>일치 기준 점수 (0~1, 실제 제품으로 보정 필요)</span><input class="input" type="number" step="0.01" min="0" max="1" name="match_threshold" value="${s.unitprint.match_threshold}"></label>
    <h3>웹훅</h3>
    <label class="field"><span>수신 주소</span><input class="input" name="webhook_url" value="${esc(s.webhook.url)}" placeholder="https://platform.example.com/trueunit/webhook"></label>
    <p class="small muted">서명 비밀값: <span class="mono">${esc(s.webhook.secret)}</span></p>
    <div><button class="btn btn-primary">저장</button></div>
  </form>`;
  $("#settings").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {
      risk: { auto_pass_below: Number(f.get("auto_pass_below")), priority_at: Number(f.get("priority_at")), audit_rate: Number(f.get("audit_rate")) },
      guarantee: { enabled_categories: f.getAll("cat"), max_score: Number(f.get("max_score")), kill_switch: { max_loss_ratio: Number(f.get("max_loss_ratio")), min_issued: Number(f.get("min_issued")) } },
      unitprint: { match_threshold: Number(f.get("match_threshold")) },
      webhook: { url: f.get("webhook_url") },
    };
    if (f.get("resume")) body.guarantee.suspended_categories = [];
    try { await api("PATCH", "/v1/settings", body); toast("저장했습니다"); show("settings"); } catch (err) { toast(err.message); }
  });
}

// ---------- 연동 안내 ----------
async function viewGuide() {
  const base = location.origin;
  main.innerHTML = `<div class="card stack" style="max-width:820px">
    <h2>플랫폼 연동 순서</h2>
    <ol class="small stack" style="padding-left:18px">
      <li>거래가 생기면 거래 건을 만들고, 받은 촬영 링크를 판매자에게 보냅니다.</li>
      <li>판매자가 제출하면 위험 점수가 나옵니다. 낮으면 바로 체결하고, 아니면 검수 대기열로 갑니다.</li>
      <li>결과는 웹훅(case.assessed, case.verdict)으로 받거나 조회 API로 확인합니다.</li>
      <li>보증을 붙이려면 견적을 받은 뒤 그 금액으로 발행합니다.</li>
    </ol>
    <pre class="code">${esc(`# 1) 거래 건 만들기 (플랫폼 키)
curl -X POST ${base}/v1/cases \\
  -H "authorization: Bearer $TU_PLATFORM_KEY" -H "content-type: application/json" \\
  -d '{"category":"sneakers","brand":"Nike","model_hint":"Dunk Low Panda",
       "external_ref":"order-123",
       "listing":{"price":139000,"market_price":159000},
       "seller":{"id":"u_42","account_age_days":420,"completed_sales":31,"past_disputes":0,"confirmed_counterfeits":0}}'
# → { "id": "case_…", "capture_url": "${base}/capture/…" }

# 2) 결과 조회
curl ${base}/v1/cases/case_… -H "authorization: Bearer $TU_PLATFORM_KEY"

# 3) 보증 견적 → 발행
curl -X POST ${base}/v1/cases/case_…/guarantee/quote -H "authorization: Bearer $TU_PLATFORM_KEY"
curl -X POST ${base}/v1/cases/case_…/guarantee -H "authorization: Bearer $TU_PLATFORM_KEY" \\
  -H "content-type: application/json" -d '{"payer":"buyer","expected_fee_krw":2224}'`)}</pre>
    <p class="small muted">전체 API 는 저장소의 docs/API.md 를 보세요.</p>
  </div>`;
}

boot().catch((e) => renderLogin(e.message));
