import test from "node:test";
import assert from "node:assert/strict";
import { texture, recapture, grayToJpeg, grayToPng, flat } from "./helpers.js";
import { decodeImage, toGray, sniffType, downscaleJpegForModel } from "../src/imaging/decode.js";
import { assessQuality } from "../src/imaging/quality.js";
import { dHash, hamming, hashIsInformative } from "../src/imaging/hash.js";
import { makeFingerprint, matchFingerprint } from "../src/imaging/fingerprint.js";

const load = (buf) => toGray(decodeImage(buf));

test("JPEG/PNG 를 판별하고 다른 형식은 거절한다", () => {
  assert.equal(sniffType(grayToJpeg(flat(8, 8))), "image/jpeg");
  assert.equal(sniffType(grayToPng(flat(8, 8))), "image/png");
  assert.throws(() => decodeImage(Buffer.from("GIF89a....")), /JPEG 또는 PNG/);
});

test("선명한 텍스처는 통과, 단색(흐린 사진과 같은 상태)은 막는다", () => {
  const good = assessQuality(load(grayToJpeg(texture(800, 700, 1))));
  assert.equal(good.ok, true, JSON.stringify(good.issues));
  const blurry = assessQuality(load(grayToJpeg(flat(800, 700, 120))));
  assert.equal(blurry.ok, false);
  assert.ok(blurry.issues.some((i) => i.code === "blurry"));
});

test("어둡거나 작은 사진은 막는다", () => {
  const dark = assessQuality(load(grayToJpeg(recapture(texture(800, 700, 2), { gain: 0.15 }))));
  assert.ok(dark.issues.some((i) => i.code === "too_dark"));
  const small = assessQuality(load(grayToJpeg(texture(300, 200, 3))));
  assert.ok(small.issues.some((i) => i.code === "low_resolution"));
});

test("dHash: 재압축한 같은 사진은 가깝고 다른 사진은 멀다", () => {
  const a = texture(400, 300, 10);
  const h1 = dHash(load(grayToJpeg(a, 90)));
  const h2 = dHash(load(grayToJpeg(recapture(a, { bias: 8 }), 60)));
  const h3 = dHash(load(grayToJpeg(texture(400, 300, 11), 90)));
  assert.ok(hamming(h1, h2) <= 4, `same ${hamming(h1, h2)}`);
  assert.ok(hamming(h1, h3) > 12, `diff ${hamming(h1, h3)}`);
  assert.equal(hashIsInformative(load(grayToJpeg(flat(100, 100)))), false);
});

test("UnitPrint: 같은 개체 재촬영(이동·밝기·잡음·회전)은 일치, 다른 개체는 불일치", () => {
  const unitA = texture(700, 520, 101);
  const fp = makeFingerprint(load(grayToJpeg(unitA, 85)));
  const again = recapture(unitA, { dx: 14, dy: -9, gain: 0.85, bias: 25, noise: 9, seed: 7 });
  const same = matchFingerprint(fp, load(grayToJpeg(again, 75)));
  assert.equal(same.match, true, `same score ${same.score}`);
  assert.ok(same.score > 0.6, `same score ${same.score}`);

  // 3도 회전된 재촬영
  const rot = rotate(unitA, 3);
  const rotated = matchFingerprint(fp, load(grayToJpeg(rot, 80)));
  assert.equal(rotated.match, true, `rotated score ${rotated.score}`);

  for (const seed of [202, 303, 404]) {
    const other = matchFingerprint(fp, load(grayToJpeg(texture(700, 520, seed), 85)));
    assert.equal(other.match, false, `other score ${other.score}`);
    assert.ok(other.score < 0.2, `other score ${other.score}`);
  }
});

test("AI 전송용 축소는 긴 변을 1568 이하로 맞춘다", () => {
  const big = grayToPng(texture(2000, 300, 5));
  const out = downscaleJpegForModel(big);
  const img = decodeImage(Buffer.from(out.data));
  assert.equal(out.media_type, "image/jpeg");
  assert.ok(Math.max(img.width, img.height) <= 1568);
});

function rotate(img, deg) {
  const { w, h, px } = img, a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const out = new Float32Array(w * h), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.round(cx + (x - cx) * c - (y - cy) * s), sy = Math.round(cy + (x - cx) * s + (y - cy) * c);
    out[y * w + x] = sx >= 0 && sy >= 0 && sx < w && sy < h ? px[sy * w + sx] : 128;
  }
  return { w, h, px: out };
}
