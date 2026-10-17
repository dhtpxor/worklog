const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEY = "precheck.key";
const form = $("#form");
try { form.key.value = sessionStorage.getItem(KEY) || ""; } catch {}

fetch("/v1/health").then((r) => r.json()).then((h) => { $("#aiState").textContent = h.ai ? "AI 분석 켜짐" : "AI 분석 꺼짐 (키워드 규칙만)"; }).catch(() => {});

const VERDICT = { block: ["✕ 판매 불가", "상품을 올리지 마세요."], review: ["⚠ 확인 필요", "아래 항목을 확인한 뒤 올리세요."], ok: ["✓ 걸린 규칙 없음", "자동 검사에서 문제를 찾지 못했습니다."] };
const SEV = { block: ["bad", "✕ 판매 불가"], review: ["warn", "⚠ 확인"], info: ["", "ⓘ 안내"] };
const AREA = { trademark: "상표·지재권", kc: "KC 인증", food_drug: "식품·의약품", customs: "통관·반입", listing: "상품 페이지" };
const SRC = { title: "상품명", description: "설명", options: "옵션", ai: "AI" };

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  try { sessionStorage.setItem(KEY, f.get("key")); } catch {}
  const body = {
    product: {
      title: f.get("title"), description: f.get("description"), source_country: f.get("source_country"),
      image_urls: String(f.get("image_urls") || "").split("\n").map((s) => s.trim()).filter(Boolean),
    },
    settings: { food_agency_registered: f.get("food_agency_registered") === "on" },
  };
  $("#run").disabled = true; $("#run").textContent = "검사 중…";
  try {
    const res = await fetch("/v1/precheck", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${f.get("key")}` }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `요청 실패 (${res.status})`);
    render(data);
  } catch (err) {
    $("#result").innerHTML = `<div class="card">${esc(err.message)}</div>`;
  } finally {
    $("#run").disabled = false; $("#run").textContent = "검사하기";
  }
});

function render(r) {
  const [label, sub] = VERDICT[r.verdict];
  $("#result").innerHTML = `
    <div class="verdict ${r.verdict}" role="status"><span>${label}</span><span class="small" style="font-weight:500">${sub}</span></div>
    ${r.checks.length ? `<div class="card">${r.checks.map(checkHtml).join("")}</div>` : ""}
    ${r.required_notices.length ? `<div class="card stack"><h3>상품 페이지 표시 의무</h3>${r.required_notices.map((n) => `<p class="small">${esc(n.text)}</p><p class="small"><a href="${esc(n.verify_at)}" target="_blank" rel="noopener noreferrer">원문 확인 (국가기술표준원)</a></p>`).join("")}</div>` : ""}
    <div class="card small muted stack">
      <p>AI 분석: ${r.ai_used ? `사용 (${esc(r.ai.meta.model)})` : r.ai_skipped ? "판매 불가 규칙에 걸려 생략" : r.ai_error ? `실패 — ${esc(r.ai_error.message)}` : "꺼짐"}</p>
      ${r.images.length ? `<p>이미지: ${r.images.map((i) => (i.ok ? "받음" : `실패(${esc(i.error)})`)).join(", ")}</p>` : ""}
      <p class="faint">${esc(r.disclaimer)}</p>
    </div>`;
}

function checkHtml(c) {
  const [cls, sev] = SEV[c.severity];
  return `<div class="check-item stack" style="--gap:4px">
    <div class="row"><span class="badge ${cls}">${sev}</span><span class="badge">${esc(AREA[c.area] || c.area)}</span>${c.needs_confirmation ? `<span class="badge">확인 필요 규칙</span>` : ""}</div>
    <h3>${esc(c.title)}</h3>
    <p class="small">${esc(c.action)}</p>
    ${c.evidence.map((e) => `<div class="ev">${esc(SRC[e.source] || e.source)} · ${esc(e.text)}</div>`).join("")}
    <p class="small faint">근거: ${esc(c.basis)}</p>
  </div>`;
}
