// src/imaging/quality.js — 촬영 품질 검사 (AI 없이 즉시 피드백)
// 선명도: 라플라시안 분산, 노출: 평균 밝기와 하이라이트 클리핑 비율, 해상도: 짧은 변.
import { fitGray } from "./decode.js";

export const QUALITY_THRESHOLDS = {
  minShortSide: 600,
  blurBlock: 20,
  blurWarn: 50,
  darkMean: 45,
  brightMean: 220,
  clipFraction: 0.12,
};

export function assessQuality(gray, t = QUALITY_THRESHOLDS) {
  const small = fitGray(gray, 512);
  const { w, h, px } = small;
  let sum = 0, clip = 0;
  for (let i = 0; i < px.length; i++) { sum += px[i]; if (px[i] >= 250) clip++; }
  const mean = sum / px.length;
  let lsum = 0, lsq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const lap = px[i - 1] + px[i + 1] + px[i - w] + px[i + w] - 4 * px[i];
    lsum += lap; lsq += lap * lap; n++;
  }
  const lapVar = n ? lsq / n - (lsum / n) ** 2 : 0;
  const clipFrac = clip / px.length;
  const shortSide = Math.min(gray.w, gray.h);

  const issues = [];
  if (shortSide < t.minShortSide) issues.push({ code: "low_resolution", severity: "block", message: `해상도가 낮습니다 (짧은 변 ${shortSide}px). 더 가까이 또는 원본 화질로 찍어 주세요.` });
  if (lapVar < t.blurBlock) issues.push({ code: "blurry", severity: "block", message: "사진이 흐립니다. 초점을 맞추고 손을 고정한 뒤 다시 찍어 주세요." });
  else if (lapVar < t.blurWarn) issues.push({ code: "slightly_blurry", severity: "warn", message: "선명도가 다소 낮습니다. 가능하면 다시 찍어 주세요." });
  if (mean < t.darkMean) issues.push({ code: "too_dark", severity: "block", message: "너무 어둡습니다. 밝은 곳에서 찍어 주세요." });
  if (mean > t.brightMean) issues.push({ code: "too_bright", severity: "warn", message: "너무 밝습니다. 직사광선을 피해 주세요." });
  if (clipFrac > t.clipFraction) issues.push({ code: "glare", severity: "warn", message: "빛 반사가 큽니다. 각도를 조금 바꿔 반사를 줄여 주세요." });

  const sharpScore = Math.min(1, lapVar / 150);
  const exposureScore = 1 - Math.min(1, Math.abs(mean - 128) / 128);
  const score = Math.round((0.6 * sharpScore + 0.3 * exposureScore + 0.1 * (1 - Math.min(1, clipFrac * 4))) * 100) / 100;
  return {
    ok: !issues.some((i) => i.severity === "block"),
    score,
    issues,
    metrics: { width: gray.w, height: gray.h, laplacian_var: Math.round(lapVar * 10) / 10, mean_brightness: Math.round(mean), clipped_fraction: Math.round(clipFrac * 1000) / 1000 },
  };
}
