// src/services/units.js — UnitPrint 등록·대조. 등록한 플랫폼이 아니어도 unit id 로 대조할 수 있다
// (플랫폼을 옮겨 다니는 개체의 재검수 생략). 다른 플랫폼에는 대조 결과와 공개 정보만 보인다.
import { newId, nowIso } from "../store.js";
import { makeFingerprint, matchFingerprint } from "../imaging/fingerprint.js";
import { emit } from "../webhooks.js";
import { bytesFromBase64, analyzeBytes } from "./images.js";
import { notFound, conflict, HttpError } from "./errors.js";
import { getOwnedCase } from "./cases.js";

const MIN_TEXTURE = 3; // band-pass 표준편차. 이보다 낮으면 무늬가 거의 없는 면이라 지문으로 못 쓴다

function fingerprintInput(ctx, image_base64) {
  const buf = bytesFromBase64(image_base64, ctx.cfg.MAX_IMAGE_BYTES);
  const a = analyzeBytes(buf);
  if (!a.quality.ok) throw new HttpError(422, "poor_quality", a.quality.issues.filter((i) => i.severity === "block").map((i) => i.message).join(" "));
  return a;
}

export function registerUnit(ctx, tenant, body = {}) {
  const a = fingerprintInput(ctx, body.image_base64);
  const fp = makeFingerprint(a.gray);
  if (fp.texture_energy < MIN_TEXTURE) throw new HttpError(422, "low_texture", "표면 무늬가 거의 보이지 않습니다. 가죽 결·직조가 보이는 부위를 더 가까이 찍어 주세요.");
  let caseDoc = null;
  if (body.case_id) {
    caseDoc = getOwnedCase(ctx, tenant, body.case_id);
    if (caseDoc.unit_id) throw conflict("이미 개체가 연결된 거래 건입니다");
  }
  const unit = ctx.store.insert("units", {
    id: newId("unit"),
    tenant_id: tenant.id,
    sku: String(body.sku || "").slice(0, 120),
    spot: String(body.spot || "").slice(0, 120), // 촬영 부위 설명 (예: "왼쪽 옆면 로고 아래 3cm")
    external_ref: String(body.external_ref || "").slice(0, 200),
    source: ["outbound", "inspection", "brand"].includes(body.source) ? body.source : "inspection",
    case_id: caseDoc?.id || null,
    fingerprint: fp,
    created_at: nowIso(),
  });
  if (caseDoc) ctx.store.update("cases", caseDoc.id, { unit_id: unit.id });
  return unit;
}

export function verifyUnit(ctx, tenant, unitId, body = {}) {
  const unit = ctx.store.get("units", unitId);
  if (!unit) throw notFound("개체");
  const a = fingerprintInput(ctx, body.image_base64);
  const owner = ctx.store.get("tenants", unit.tenant_id);
  const threshold = owner?.settings.unitprint.match_threshold ?? 0.3;
  const r = matchFingerprint(unit.fingerprint, a.gray, threshold);
  const check = ctx.store.insert("unit_checks", {
    id: newId("uchk"),
    unit_id: unit.id,
    unit_tenant_id: unit.tenant_id,
    checker_tenant_id: tenant.id,
    purpose: ["return", "resale", "claim", "other"].includes(body.purpose) ? body.purpose : "other",
    score: r.score,
    match: r.match,
    threshold,
    created_at: nowIso(),
  });
  const linkedCase = unit.case_id ? ctx.store.get("cases", unit.case_id) : null;
  const result = {
    check_id: check.id,
    unit_id: unit.id,
    sku: unit.sku,
    spot: unit.spot,
    match: r.match,
    score: r.score,
    threshold,
    previously_verified_authentic: !!linkedCase && ["authentic", "passed"].includes(linkedCase.status),
  };
  emit({ store: ctx.store, tenant, type: "unit.checked", data: result, fetchImpl: ctx.fetchImpl });
  return result;
}

export function publicUnit(u) {
  return { id: u.id, sku: u.sku, spot: u.spot, external_ref: u.external_ref, source: u.source, case_id: u.case_id, texture_energy: u.fingerprint.texture_energy, created_at: u.created_at };
}

