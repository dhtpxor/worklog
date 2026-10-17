// src/imaging/decode.js — JPEG/PNG 바이트 → 회색조 Float32Array, 크기 변환 유틸
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export function sniffType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  return null;
}

/** @returns {{width:number,height:number,rgba:Uint8Array|Buffer,type:string}} */
export function decodeImage(buf) {
  const type = sniffType(buf);
  if (type === "image/jpeg") {
    const img = jpeg.decode(buf, { useTArray: true, maxResolutionInMP: 60, maxMemoryUsageInMB: 768 });
    return { width: img.width, height: img.height, rgba: img.data, type };
  }
  if (type === "image/png") {
    const img = PNG.sync.read(buf);
    return { width: img.width, height: img.height, rgba: img.data, type };
  }
  throw Object.assign(new Error("JPEG 또는 PNG 이미지만 받을 수 있습니다"), { status: 415 });
}

export function toGray({ width, height, rgba }) {
  const g = new Float32Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  return { w: width, h: height, px: g };
}

/** 영역 평균(축소) / 양선형(확대) 리사이즈 */
export function resizeGray(src, tw, th) {
  const { w, h, px } = src;
  const out = new Float32Array(tw * th);
  const sx = w / tw, sy = h / th;
  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < th; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < tw; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        let s = 0;
        for (let yy = y0; yy < y1; yy++) { const row = yy * w; for (let xx = x0; xx < x1; xx++) s += px[row + xx]; }
        out[y * tw + x] = s / ((y1 - y0) * (x1 - x0));
      }
    }
  } else {
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) out[y * tw + x] = bilinear(src, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
  }
  return { w: tw, h: th, px: out };
}

export function bilinear({ w, h, px }, x, y) {
  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x > w - 1) x = w - 1; if (y > h - 1) y = h - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0, fy = y - y0;
  const a = px[y0 * w + x0], b = px[y0 * w + x1], c = px[y1 * w + x0], d = px[y1 * w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** 긴 변이 maxSide 이하가 되도록 축소 (이미 작으면 그대로) */
export function fitGray(gray, maxSide) {
  const s = Math.max(gray.w, gray.h) / maxSide;
  if (s <= 1) return gray;
  return resizeGray(gray, Math.max(1, Math.round(gray.w / s)), Math.max(1, Math.round(gray.h / s)));
}

/** AI 전송용: 긴 변 maxSide 로 줄인 JPEG (이미 작으면 원본) */
export function downscaleJpegForModel(buf, maxSide = 1568, quality = 85) {
  const img = decodeImage(buf);
  const long = Math.max(img.width, img.height);
  if (long <= maxSide && img.type === "image/jpeg") return { data: buf, media_type: "image/jpeg" };
  const s = Math.min(1, maxSide / long);
  const tw = Math.max(1, Math.round(img.width * s)), th = Math.max(1, Math.round(img.height * s));
  const out = Buffer.alloc(tw * th * 4);
  const sx = img.width / tw, sy = img.height / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const p = (yy * img.width + xx) * 4; r += img.rgba[p]; g += img.rgba[p + 1]; b += img.rgba[p + 2]; n++;
      }
      const o = (y * tw + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: jpeg.encode({ data: out, width: tw, height: th }, quality).data, media_type: "image/jpeg" };
}
