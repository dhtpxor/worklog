// src/precheck.js — 한 상품 검사의 전체 흐름: 입력 검증 → 텍스트 규칙 → 이미지 수집 → AI → 병합 → 요약
import { textChecks, mergeAi, summarize, DEFAULT_SETTINGS } from "./engine.js";
import { analyzeProduct } from "./ai.js";
import { fetchImage } from "./fetchImage.js";

export class InputError extends Error { constructor(m) { super(m); this.status = 400; this.code = "invalid_request"; } }

export function validateProduct(p) {
  if (!p || typeof p !== "object") throw new InputError("상품 정보가 필요합니다");
  const title = String(p.title || "").trim();
  if (!title) throw new InputError("title(상품명)이 필요합니다");
  const images = Array.isArray(p.image_urls) ? p.image_urls.filter((u) => typeof u === "string" && u.trim()).slice(0, 4) : [];
  return {
    id: String(p.id || "").slice(0, 120),
    title: title.slice(0, 500),
    description: String(p.description || "").slice(0, 20000),
    options: Array.isArray(p.options) ? p.options.map(String).slice(0, 100) : [],
    source_country: ["CN", "JP", "US", "EU", "OTHER"].includes(p.source_country) ? p.source_country : "OTHER",
    source_url: String(p.source_url || "").slice(0, 1000),
    image_urls: images,
  };
}

/** @param {{cfg:object, product:object, settings?:object, aiClient?:object, fetchImpl?:Function, lookup?:Function}} ctx */
export async function runPrecheck({ cfg, product, settings = DEFAULT_SETTINGS, aiClient, fetchImpl, lookup }) {
  const p = validateProduct(product);
  const { findings, brands } = textChecks([
    { source: "title", text: p.title },
    { source: "description", text: p.description },
    { source: "options", text: p.options.join(" / ") },
  ], settings);

  // 텍스트만으로 이미 판매 불가면 AI·이미지 비용을 쓰지 않는다 (설정으로 끌 수 있음)
  const skipAi = cfg.AI_SKIP_WHEN_BLOCKED && summarize(findings).verdict === "block";
  const imageResults = skipAi ? p.image_urls.map(() => ({ ok: false, error: "판매 불가 규칙에 걸려 이미지 검사를 건너뜀" })) : await Promise.all(p.image_urls.map((u) => fetchImage(u, { fetchImpl, lookup })));
  const images = imageResults.filter((r) => r.ok);
  let ai = null, aiMeta = null, aiError = null;
  if (!skipAi) try {
    const out = await analyzeProduct({ cfg, product: p, images, clientImpl: aiClient });
    if (out) { ai = out.result; aiMeta = { model: out.model, usage: out.usage }; }
  } catch (e) {
    aiError = { code: e.code || "ai_error", message: String(e.message || e).slice(0, 200) };
  }
  mergeAi(findings, ai, settings);
  const summary = summarize(findings);
  return {
    id: p.id || null,
    ...summary,
    brands_in_text: brands,
    ai: ai ? { categories: ai.product_categories, notes: ai.notes, meta: aiMeta } : null,
    ai_error: aiError,
    ai_used: !!ai,
    ai_skipped: skipAi,
    images: p.image_urls.map((url, i) => ({ url, ok: imageResults[i].ok, error: imageResults[i].ok ? null : imageResults[i].error })),
    checked_at: new Date().toISOString(),
    disclaimer: "자동 검사는 판매 가능 여부를 보장하지 않습니다. '확인 필요' 표시 규칙과 키프리스·국가기술표준원·식약처 원문을 함께 확인하세요.",
  };
}
