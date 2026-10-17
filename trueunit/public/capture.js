// 판매자 촬영 페이지: 체크포인트별 안내 → 사진 선택 → 브라우저에서 축소 → 업로드 → 즉시 화질 피드백 → 제출
const token = location.pathname.split("/").pop();
const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { info: null, previews: {}, busy: {}, results: {} };

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `요청 실패 (${res.status})`);
  return data;
}

/** 긴 변 2400px, JPEG 로 다시 인코딩 (용량 축소 + HEIC 등 변환) */
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("이 사진 형식을 읽을 수 없습니다. 카메라로 다시 찍어 주세요.");
  const s = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * s);
  canvas.height = Math.round(bitmap.height * s);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  return { dataUrl, preview: URL.createObjectURL(blob) };
}

function qualityOf(cp) {
  return state.results[cp.id] || cp.uploaded?.quality || null;
}

function render() {
  const info = state.info;
  if (info.status !== "collecting") {
    app.innerHTML = `<div class="card stack"><h2>제출이 끝난 건입니다</h2><p class="muted">사진 확인은 검수 담당자가 진행합니다. 결과는 거래하신 플랫폼에서 안내됩니다.</p>${recaptureHtml(info.recapture)}</div>`;
    return;
  }
  const req = info.checkpoints.filter((c) => c.required);
  const done = req.filter((c) => qualityOf(c)?.ok).length;
  const ready = done === req.length && !Object.values(state.busy).some(Boolean);
  app.innerHTML = `
    <div class="card stack">
      <h1>${esc(info.category.label)} 진품 확인</h1>
      <p class="muted small">${esc([info.brand, info.model_hint].filter(Boolean).join(" · ") || "상품 정보 없음")}</p>
      <p class="small">안내에 맞춰 부위별로 한 장씩 찍어 주세요. 사진은 진품 확인에만 쓰입니다.</p>
      <div class="row small"><div class="progress" style="flex:1" aria-hidden="true"><div style="width:${Math.round((done / req.length) * 100)}%"></div></div><span>필수 ${done}/${req.length}</span></div>
    </div>
    ${info.checkpoints.map(shotHtml).join("")}
    <div class="card stack">
      <button class="btn btn-primary" id="submit" ${ready ? "" : "disabled"}>제출하기</button>
      <p class="small muted">${ready ? "제출하면 사진을 바꿀 수 없습니다." : "필수 부위 사진이 모두 통과해야 제출할 수 있습니다."}</p>
    </div>`;
  for (const cp of info.checkpoints) {
    app.querySelector(`#f-${cp.id}`).addEventListener("change", (e) => onFile(cp, e.target.files[0]));
  }
  app.querySelector("#submit").addEventListener("click", onSubmit);
}

function shotHtml(cp) {
  const q = qualityOf(cp);
  const busy = state.busy[cp.id];
  const status = busy ? `<span class="badge">올리는 중</span>` : !q ? (cp.required ? `<span class="badge">필수</span>` : `<span class="badge">선택</span>`) : q.ok ? (q.issues.length ? `<span class="badge warn">⚠ 통과(주의)</span>` : `<span class="badge good">✓ 통과</span>`) : `<span class="badge bad">✕ 다시 찍기</span>`;
  const thumb = state.previews[cp.id] ? `<img src="${state.previews[cp.id]}" alt="">` : cp.uploaded ? "올림" : "사진 없음";
  return `
    <section class="card shot">
      <div class="shot-thumb">${thumb}</div>
      <div class="stack" style="--gap:6px">
        <div class="row" style="justify-content:space-between"><h3>${esc(cp.label)}</h3>${status}</div>
        <p class="small muted">${esc(cp.guide)}</p>
        ${q && q.issues.length ? `<ul class="issues">${q.issues.map((i) => `<li>${esc(i.message)}</li>`).join("")}</ul>` : ""}
        <label class="btn file-btn" for="f-${cp.id}">${q ? "다시 찍기" : "사진 찍기"}<input type="file" id="f-${cp.id}" accept="image/*" capture="environment" ${busy ? "disabled" : ""}></label>
      </div>
    </section>`;
}

function recaptureHtml(list) {
  if (!list?.length) return "";
  return `<div class="stack"><h3>추가 촬영 요청</h3><ul class="issues">${list.map((r) => `<li>${esc(r.instruction)}</li>`).join("")}</ul></div>`;
}

async function onFile(cp, file) {
  if (!file) return;
  state.busy[cp.id] = true;
  render();
  try {
    const { dataUrl, preview } = await prepareImage(file);
    state.previews[cp.id] = preview;
    const r = await api("POST", `/v1/capture/${token}/images`, { checkpoint: cp.id, image_base64: dataUrl });
    state.results[cp.id] = r.image.quality;
  } catch (e) {
    alert(e.message);
  } finally {
    state.busy[cp.id] = false;
    render();
  }
}

async function onSubmit(e) {
  e.target.disabled = true;
  e.target.textContent = "확인 중… (최대 1~2분)";
  try {
    const r = await api("POST", `/v1/capture/${token}/submit`);
    app.innerHTML = `<div class="card stack"><h2>제출했습니다</h2><p class="muted">검수가 끝나면 거래하신 플랫폼에서 결과를 알려 드립니다.</p>${recaptureHtml(r.recapture)}</div>`;
  } catch (err) {
    alert(err.message);
    e.target.disabled = false;
    e.target.textContent = "제출하기";
  }
}

api("GET", `/v1/capture/${token}`)
  .then((info) => { state.info = info; render(); })
  .catch((e) => { app.innerHTML = `<div class="card"><h2>링크를 열 수 없습니다</h2><p class="muted">${esc(e.message)}</p></div>`; });
