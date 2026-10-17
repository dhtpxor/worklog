// src/imaging/hash.js — 차분 해시(dHash): 같은 사진의 재사용(다른 판매자·다른 거래)을 찾는다.
import { resizeGray } from "./decode.js";

export function dHash(gray) {
  const s = resizeGray(gray, 9, 8);
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += s.px[y * 9 + x] > s.px[y * 9 + x + 1] ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** 해시가 의미 있을 만큼 화면에 변화가 있는가 (거의 단색이면 해시 충돌이 잦다) */
export function hashIsInformative(gray) {
  const s = resizeGray(gray, 32, 32);
  let m = 0;
  for (const v of s.px) m += v;
  m /= s.px.length;
  let v2 = 0;
  for (const v of s.px) v2 += (v - m) ** 2;
  return Math.sqrt(v2 / s.px.length) > 12;
}

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < 16; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}
