// src/imaging/fingerprint.js — UnitPrint: 태그 없는 개체 지문 (기준선 구현)
//
// 원리: 같은 공정으로 만든 제품도 가죽 결·직조·인쇄 도트 같은 표면 미세패턴은 개체마다 다르다.
// 지정된 부위를 가까이 찍은 사진에서 조명 성분을 걷어낸 대역통과(band-pass) 지도를 만들고,
// 재촬영 사진과 정규화 상호상관(NCC)으로 비교한다. 위치·크기·회전의 작은 차이는 탐색으로 흡수한다.
//
// 한계(정직하게): 학습된 지문 모델이 아니라 고전적 템플릿 정합이다. 같은 부위를 비슷한 거리·각도로
// 찍어야 하고(촬영 가이드 프레임 필수), 큰 원근 왜곡·마모·오염에는 약하다. 실사용 전 실제 제품으로
// 동일개체/다른개체 점수 분포를 측정해 임계값을 다시 정해야 한다.
import { resizeGray, bilinear } from "./decode.js";

export const FP_SIZE = 160; // 기술자 한 변
const CROP = 0.6; // 짧은 변 대비 중앙 크롭 비율
const PREP_SHORT = Math.round(FP_SIZE / CROP * 1.05); // 샘플링 간격이 ~1px 되도록 먼저 축소

function prep(gray) {
  const s = PREP_SHORT / Math.min(gray.w, gray.h);
  return resizeGray(gray, Math.max(1, Math.round(gray.w * s)), Math.max(1, Math.round(gray.h * s)));
}

function sample(pre, scale, angleDeg) {
  const side = Math.min(pre.w, pre.h) * CROP * scale;
  const step = side / FP_SIZE;
  const cx = (pre.w - 1) / 2, cy = (pre.h - 1) / 2;
  const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const out = new Float32Array(FP_SIZE * FP_SIZE);
  const half = (FP_SIZE - 1) / 2;
  for (let v = 0; v < FP_SIZE; v++) for (let u = 0; u < FP_SIZE; u++) {
    const du = (u - half) * step, dv = (v - half) * step;
    out[v * FP_SIZE + u] = bilinear(pre, cx + du * ca - dv * sa, cy + du * sa + dv * ca);
  }
  return out;
}

function boxBlur(src, n, r) {
  // 적분 영상으로 (2r+1)^2 평균
  const I = new Float64Array((n + 1) * (n + 1));
  for (let y = 0; y < n; y++) {
    let row = 0;
    for (let x = 0; x < n; x++) { row += src[y * n + x]; I[(y + 1) * (n + 1) + x + 1] = I[y * (n + 1) + x + 1] + row; }
  }
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(n, y + r + 1);
    for (let x = 0; x < n; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(n, x + r + 1);
      const s = I[y1 * (n + 1) + x1] - I[y0 * (n + 1) + x1] - I[y1 * (n + 1) + x0] + I[y0 * (n + 1) + x0];
      out[y * n + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

function bandpass(map) {
  const fine = boxBlur(map, FP_SIZE, 1);
  const coarse = boxBlur(map, FP_SIZE, 6);
  const out = new Float32Array(map.length);
  let m = 0;
  for (let i = 0; i < out.length; i++) { out[i] = fine[i] - coarse[i]; m += out[i]; }
  m /= out.length;
  let v = 0;
  for (let i = 0; i < out.length; i++) { out[i] -= m; v += out[i] * out[i]; }
  const sd = Math.sqrt(v / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= sd;
  return { map: out, texture_energy: sd };
}

/** 등록용 기술자: int8 로 양자화해 base64 로 저장 */
export function makeFingerprint(gray) {
  const pre = prep(gray);
  const { map, texture_energy } = bandpass(sample(pre, 1, 0));
  const q = new Int8Array(map.length);
  for (let i = 0; i < map.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(map[i] * 32)));
  return { version: 1, size: FP_SIZE, data: Buffer.from(q.buffer).toString("base64"), texture_energy: Math.round(texture_energy * 100) / 100 };
}

function loadFingerprint(fp) {
  const buf = Buffer.from(fp.data, "base64");
  const q = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / 32;
  return out;
}

const WIN = 128; // 비교 창 (프로브 중앙)
const MARGIN = (FP_SIZE - WIN) / 2; // 16 → 이동 탐색 범위 ±16px

function nccAt(ref, probe, dx, dy) {
  let s = 0, sr = 0, sr2 = 0, sp = 0, sp2 = 0;
  for (let y = 0; y < WIN; y++) {
    const ry = (MARGIN + y + dy) * FP_SIZE + MARGIN + dx;
    const py = (MARGIN + y) * FP_SIZE + MARGIN;
    for (let x = 0; x < WIN; x++) {
      const a = ref[ry + x], b = probe[py + x];
      s += a * b; sr += a; sr2 += a * a; sp += b; sp2 += b * b;
    }
  }
  const n = WIN * WIN;
  const cov = s - (sr * sp) / n;
  const den = Math.sqrt((sr2 - (sr * sr) / n) * (sp2 - (sp * sp) / n));
  return den > 0 ? cov / den : 0;
}

function bestShift(ref, probe) {
  let best = { score: -1, dx: 0, dy: 0 };
  for (let dy = -MARGIN; dy <= MARGIN; dy += 2) for (let dx = -MARGIN; dx <= MARGIN; dx += 2) {
    const sc = nccAt(ref, probe, dx, dy);
    if (sc > best.score) best = { score: sc, dx, dy };
  }
  const c = best;
  for (let dy = Math.max(-MARGIN, c.dy - 1); dy <= Math.min(MARGIN, c.dy + 1); dy++) for (let dx = Math.max(-MARGIN, c.dx - 1); dx <= Math.min(MARGIN, c.dx + 1); dx++) {
    const sc = nccAt(ref, probe, dx, dy);
    if (sc > best.score) best = { score: sc, dx, dy };
  }
  return best;
}

export const DEFAULT_MATCH_THRESHOLD = 0.3;

/**
 * 등록 지문과 새 사진 비교. 크기 3단계 × 회전 3단계 × 이동(±16px)을 탐색해 최대 NCC 를 쓴다.
 * @returns {{score:number, match:boolean, transform:{scale:number,angle:number,dx:number,dy:number}}}
 */
export function matchFingerprint(fp, probeGray, threshold = DEFAULT_MATCH_THRESHOLD) {
  const ref = loadFingerprint(fp);
  const pre = prep(probeGray);
  let best = { score: -1, scale: 1, angle: 0, dx: 0, dy: 0 };
  for (const scale of [0.93, 1, 1.07]) for (const angle of [-4, 0, 4]) {
    const { map } = bandpass(sample(pre, scale, angle));
    const r = bestShift(ref, map);
    if (r.score > best.score) best = { score: r.score, scale, angle, dx: r.dx, dy: r.dy };
  }
  const score = Math.round(best.score * 1000) / 1000;
  return { score, match: score >= threshold, transform: { scale: best.scale, angle: best.angle, dx: best.dx, dy: best.dy } };
}
