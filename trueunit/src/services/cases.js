// src/services/cases.js — 거래 건(case) 흐름: 생성 → 촬영 업로드 → 제출(AI+점수) → 자동 통과 또는 검수 → 판정
import crypto from "node:crypto";
import { newId, nowIso } from "../store.js";
import { getCategory } from "../catalog.js";
import { scoreCase } from "../risk.js";
import { analyzeCheckpoints } from "../ai/vision.js";
import { hamming } from "../imaging/hash.js";
import { emit } from "../webhooks.js";
import { bytesFromBase64, analyzeBytes } from "./images.js";
import { bad, notFound, conflict } from "./errors.js";

const OPEN_STATUSES = ["collecting"];
export const FINAL_STATUSES = ["passed", "authentic", "counterfeit", "inconclusive"];
const DUP_DISTANCE = 4;

const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : NaN);
const str = (v, max = 300) => (v === undefined || v === null ? "" : String(v).slice(0, max));

export function createCase(ctx, tenant, body = {}) {
  const category = getCategory(body.category);
  if (!category) throw bad("category 는 sneakers 또는 handbags 여야 합니다", "unknown_category");
  const listing = { price: num(body.listing?.price), market_price: num(body.listing?.market_price), title: str(body.listing?.title), url: str(body.listing?.url, 1000) };
  if (Number.isNaN(listing.price) || Number.isNaN(listing.market_price)) throw bad("가격은 숫자여야 합니다");
  if (listing.url && !/^https?:\/\//i.test(listing.url)) throw bad("listing.url 은 http(s) 주소여야 합니다");
  const s = body.seller || {};
  const seller = { id: str(s.id, 120), account_age_days: num(s.account_age_days), completed_sales: num(s.completed_sales), past_disputes: num(s.past_disputes), confirmed_counterfeits: num(s.confirmed_counterfeits) };
  for (const k of ["account_age_days", "completed_sales", "past_disputes", "confirmed_counterfeits"]) if (Number.isNaN(seller[k])) throw bad(`seller.${k} 는 숫자여야 합니다`);
  const doc = ctx.store.insert("cases", {
    id: newId("case"),
    tenant_id: tenant.id,
    external_ref: str(body.external_ref, 200),
    category: category.id,
    brand: str(body.brand, 80),
    model_hint: str(body.model_hint, 120),
    listing,
    seller,
    status: "collecting",
    capture_token: crypto.randomBytes(18).toString("base64url"),
    created_at: nowIso(),
  });
  return doc;
}

export function captureUrl(ctx, caseDoc, origin) {
  const base = ctx.cfg.PUBLIC_BASE_URL || origin || "";
  return `${base}/capture/${caseDoc.capture_token}`;
}

export function addImage(ctx, tenant, caseDoc, body = {}) {
  if (!OPEN_STATUSES.includes(caseDoc.status)) throw conflict("이미 제출된 건에는 사진을 더할 수 없습니다", "case_not_open");
  const category = getCategory(caseDoc.category);
  const cp = category.checkpoints.find((c) => c.id === body.checkpoint);
  if (!cp) throw bad(`checkpoint 가 올바르지 않습니다. 가능한 값: ${category.checkpoints.map((c) => c.id).join(", ")}`, "unknown_checkpoint");
  const count = ctx.store.list("images", (i) => i.case_id === caseDoc.id).length;
  if (count >= 40) throw conflict("한 건에 올릴 수 있는 사진 수(40장)를 넘었습니다", "too_many_images");
  const buf = bytesFromBase64(body.image_base64, ctx.cfg.MAX_IMAGE_BYTES);
  const a = analyzeBytes(buf);
  const img = ctx.store.insert("images", {
    id: newId("img"),
    tenant_id: tenant.id,
    case_id: caseDoc.id,
    checkpoint: cp.id,
    content_type: a.type,
    bytes: buf.length,
    quality: a.quality,
    dhash: a.dhash,
    hash_informative: a.informative,
    created_at: nowIso(),
  });
  ctx.store.putBlob(img.id, buf);
  return { image: publicImage(img), guide: cp.guide };
}

export function bestImages(ctx, caseDoc) {
  const best = {};
  for (const img of ctx.store.list("images", (i) => i.case_id === caseDoc.id)) {
    const cur = best[img.checkpoint];
    if (!cur || img.quality.score > cur.quality.score || (img.quality.score === cur.quality.score && img.created_at > cur.created_at)) best[img.checkpoint] = img;
  }
  return best;
}

/** 다른 거래 건에서 거의 같은 사진 찾기. 같은 판매자의 재등록은 제외. 다른 플랫폼 건은 id 를 숨긴다. */
export function findDuplicates(ctx, caseDoc, images) {
  const hits = [];
  const others = ctx.store.list("images", (i) => i.case_id !== caseDoc.id && i.hash_informative);
  for (const img of images) {
    if (!img.hash_informative) continue;
    for (const o of others) {
      if (hamming(img.dhash, o.dhash) > DUP_DISTANCE) continue;
      const oc = ctx.store.get("cases", o.case_id);
      if (!oc) continue;
      const sameTenant = oc.tenant_id === caseDoc.tenant_id;
      if (sameTenant && caseDoc.seller.id && oc.seller.id === caseDoc.seller.id) continue;
      hits.push({ checkpoint: img.checkpoint, other_case_id: sameTenant ? oc.id : "other_platform", distance: hamming(img.dhash, o.dhash) });
    }
  }
  return hits;
}

/** 같은 테넌트·카테고리·모델에서 진품으로 끝난 거래 가격의 중앙값 (5건 이상일 때만) */
export function learnedMedianPrice(ctx, caseDoc) {
  if (!caseDoc.model_hint) return null;
  const prices = ctx.store
    .list("cases", (c) => c.id !== caseDoc.id && c.tenant_id === caseDoc.tenant_id && c.category === caseDoc.category && c.model_hint === caseDoc.model_hint && ["passed", "authentic"].includes(c.status) && c.listing.price > 0)
    .map((c) => c.listing.price)
    .sort((a, b) => a - b);
  if (prices.length < 5) return null;
  const m = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[m] : (prices[m - 1] + prices[m]) / 2;
}

export async function submitCase(ctx, tenant, caseDoc) {
  if (!OPEN_STATUSES.includes(caseDoc.status)) throw conflict("이미 제출된 건입니다", "case_not_open");
  const category = getCategory(caseDoc.category);
  const best = bestImages(ctx, caseDoc);
  if (!Object.keys(best).length) throw bad("사진을 한 장 이상 올려야 제출할 수 있습니다", "no_images");
  ctx.store.update("cases", caseDoc.id, { status: "analyzing", submitted_at: nowIso() });
  try {
    return await runAssessment(ctx, tenant, caseDoc, category, best);
  } catch (e) {
    ctx.store.update("cases", caseDoc.id, { status: "collecting" }); // 다시 제출할 수 있게 되돌린다
    throw e;
  }
}

async function runAssessment(ctx, tenant, caseDoc, category, best) {
  let ai = null, aiMeta = null, aiError = null;
  try {
    const usable = Object.values(best).filter((i) => i.quality.ok);
    const out = await analyzeCheckpoints({
      cfg: ctx.cfg,
      category,
      item: { brand: caseDoc.brand, model_hint: caseDoc.model_hint },
      images: usable.map((i) => ({ checkpoint: i.checkpoint, bytes: ctx.store.getBlob(i.id) })),
      clientImpl: ctx.aiClient,
    });
    if (out) { ai = out.result; aiMeta = { model: out.model, usage: out.usage }; }
  } catch (e) {
    aiError = { code: e.code || "ai_error", message: String(e.message || e).slice(0, 300) };
    console.error("[ai]", aiError.code, aiError.message);
  }

  const assessment = scoreCase({
    category,
    bestImages: best,
    ai,
    listing: caseDoc.listing,
    seller: caseDoc.seller,
    duplicates: findDuplicates(ctx, caseDoc, Object.values(best)),
    learnedMedianPrice: learnedMedianPrice(ctx, caseDoc),
    settings: tenant.settings.risk,
    random: ctx.random,
  });
  assessment.ai_observation = ai?.overall_observation || "";
  assessment.ai_checkpoints = ai?.checkpoints || [];
  assessment.recapture = ai?.recapture || [];
  assessment.ai_meta = aiMeta;
  assessment.ai_error = aiError;
  assessment.assessed_at = nowIso();

  const status = assessment.recommendation === "pass" ? "passed" : "in_review";
  const updated = ctx.store.update("cases", caseDoc.id, { status, assessment, priority: assessment.recommendation === "escalate_priority" });
  emit({ store: ctx.store, tenant, type: "case.assessed", data: publicCase(ctx, updated), fetchImpl: ctx.fetchImpl });
  return updated;
}

export const VERDICTS = ["authentic", "counterfeit", "inconclusive"];

export function recordVerdict(ctx, tenant, caseDoc, auth, body = {}) {
  if (caseDoc.status !== "in_review") throw conflict("검수 대기 중인 건만 판정할 수 있습니다", "not_in_review");
  if (!VERDICTS.includes(body.verdict)) throw bad("verdict 는 authentic, counterfeit, inconclusive 중 하나여야 합니다");
  const category = getCategory(caseDoc.category);
  const flagged = Array.isArray(body.flagged_checkpoints) ? body.flagged_checkpoints.filter((id) => category.checkpoints.some((c) => c.id === id)) : [];
  if (body.verdict === "counterfeit" && !flagged.length) throw bad("가품 판정에는 근거 부위(flagged_checkpoints)를 하나 이상 지정해야 합니다");
  const v = ctx.store.insert("verdicts", {
    id: newId("vrd"),
    tenant_id: tenant.id,
    case_id: caseDoc.id,
    verdict: body.verdict,
    flagged_checkpoints: flagged,
    note: str(body.note, 2000),
    inspector_key_id: auth.keyId,
    inspector_name: str(body.inspector_name, 60),
    ai_band: caseDoc.assessment?.band || null,
    ai_score: caseDoc.assessment?.score ?? null,
    audit_sample: !!caseDoc.assessment?.audit_sample,
    created_at: nowIso(),
  });
  const updated = ctx.store.update("cases", caseDoc.id, { status: body.verdict, verdict_id: v.id, decided_at: v.created_at });
  emit({ store: ctx.store, tenant, type: "case.verdict", data: publicCase(ctx, updated), fetchImpl: ctx.fetchImpl });
  return { case: updated, verdict: v };
}

export function reviewQueue(ctx, tenant) {
  return ctx.store
    .list("cases", (c) => c.tenant_id === tenant.id && c.status === "in_review")
    .sort((a, b) => (b.priority === true) - (a.priority === true) || (b.assessment?.score ?? 0) - (a.assessment?.score ?? 0) || a.submitted_at.localeCompare(b.submitted_at));
}

export function publicImage(img) {
  return { id: img.id, checkpoint: img.checkpoint, quality: { ok: img.quality.ok, score: img.quality.score, issues: img.quality.issues }, created_at: img.created_at };
}

/** 플랫폼 API 응답용 (내부 필드 제외) */
export function publicCase(ctx, c) {
  const verdict = c.verdict_id ? ctx.store.get("verdicts", c.verdict_id) : null;
  return {
    id: c.id,
    external_ref: c.external_ref,
    category: c.category,
    brand: c.brand,
    model_hint: c.model_hint,
    listing: c.listing,
    status: c.status,
    created_at: c.created_at,
    submitted_at: c.submitted_at || null,
    decided_at: c.decided_at || null,
    assessment: c.assessment
      ? {
          score: c.assessment.score,
          band: c.assessment.band,
          recommendation: c.assessment.recommendation,
          ai_assessed: c.assessment.ai_assessed,
          complete: c.assessment.complete,
          missing_checkpoints: c.assessment.missing_checkpoints,
          hard_flags: c.assessment.hard_flags || [],
          evidence: c.assessment.evidence,
          recapture: c.assessment.recapture,
        }
      : null,
    verdict: verdict ? { verdict: verdict.verdict, flagged_checkpoints: verdict.flagged_checkpoints, decided_at: verdict.created_at } : null,
    guarantee_id: c.guarantee_id || null,
    unit_id: c.unit_id || null,
  };
}

export function getOwnedCase(ctx, tenant, id) {
  const c = ctx.store.get("cases", id);
  if (!c || c.tenant_id !== tenant.id) throw notFound("거래 건");
  return c;
}
