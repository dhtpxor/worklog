// test/helpers.js — 합성 이미지 생성 (결정적 난수)
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

/** 가죽 결 비슷한 표면 텍스처 (seed 가 다르면 다른 개체) */
export function texture(w, h, seed) {
  const r = rng(seed);
  const base = new Float32Array(w * h);
  for (let i = 0; i < base.length; i++) base[i] = gauss(r);
  // 두 번 흐려서 결의 크기를 만든 뒤 원래 잡음 일부와 섞는다
  const blur = (src, rad) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += src[yy * w + xx]; n++; }
      }
      out[y * w + x] = s / n;
    }
    return out;
  };
  const b = blur(base, 2);
  const px = new Float32Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = 128 + 55 * b[i] * 3 + 6 * base[i];
  // 완만한 조명 기울기
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] += (x / w - 0.5) * 30;
  return { w, h, px };
}

/** 같은 표면을 다시 찍은 것처럼: 이동, 밝기/대비, 잡음 */
export function recapture(img, { dx = 0, dy = 0, gain = 1, bias = 0, noise = 0, seed = 99 } = {}) {
  const r = rng(seed);
  const { w, h, px } = img;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(w - 1, Math.max(0, x + dx)), sy = Math.min(h - 1, Math.max(0, y + dy));
    out[y * w + x] = px[sy * w + sx] * gain + bias + noise * gauss(r);
  }
  return { w, h, px: out };
}

export function grayToJpeg(img, quality = 85) {
  const data = Buffer.alloc(img.w * img.h * 4);
  for (let i = 0; i < img.px.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(img.px[i])));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return jpeg.encode({ data, width: img.w, height: img.h }, quality).data;
}

export function grayToPng(img) {
  const png = new PNG({ width: img.w, height: img.h });
  for (let i = 0; i < img.px.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(img.px[i])));
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

export function flat(w, h, v = 128) {
  return { w, h, px: new Float32Array(w * h).fill(v) };
}

/** 상품 사진처럼 큰 형태(사각형·원)가 있는 장면 + 표면 텍스처 */
export function scene(w, h, seed) {
  const r = rng(seed * 7919 + 1);
  const img = texture(w, h, seed);
  for (let k = 0; k < 6; k++) {
    const x0 = r() * w, y0 = r() * h, rw = (0.15 + r() * 0.35) * w, rh = (0.15 + r() * 0.35) * h, v = (r() - 0.5) * 120, circle = r() < 0.5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inside = circle ? ((x - x0) / rw) ** 2 + ((y - y0) / rh) ** 2 < 1 : x >= x0 && x < x0 + rw && y >= y0 && y < y0 + rh;
      if (inside) img.px[y * w + x] += v;
    }
  }
  return img;
}
