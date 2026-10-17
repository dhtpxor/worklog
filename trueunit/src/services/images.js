// src/services/images.js — 업로드 이미지 공통 처리: base64 → 바이트 → 디코드 → 품질/해시
import { decodeImage, toGray } from "../imaging/decode.js";
import { assessQuality } from "../imaging/quality.js";
import { dHash, hashIsInformative } from "../imaging/hash.js";
import { bad, HttpError } from "./errors.js";

export function bytesFromBase64(input, maxBytes) {
  if (typeof input !== "string" || !input) throw bad("image_base64 가 필요합니다");
  const b64 = input.replace(/^data:[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/=\s_-]+$/.test(b64.slice(0, 200))) throw bad("image_base64 형식이 올바르지 않습니다");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw bad("이미지가 비어 있습니다");
  if (buf.length > maxBytes) throw new HttpError(413, "image_too_large", `이미지는 ${Math.round(maxBytes / 1024 / 1024)}MB 이하만 받습니다`);
  return buf;
}

export function analyzeBytes(buf) {
  let img;
  try {
    img = decodeImage(buf);
  } catch (e) {
    throw new HttpError(e.status || 415, "unsupported_image", e.message || "이미지를 읽지 못했습니다");
  }
  const gray = toGray(img);
  return { type: img.type, gray, quality: assessQuality(gray), dhash: dHash(gray), informative: hashIsInformative(gray) };
}
