// src/text.js — 다국어 텍스트 정규화와 키워드 매칭
export function normalize(s) {
  return String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

const ASCII = /^[a-z0-9 :'\-.&+]+$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 정규화된 텍스트에서 키워드 위치들을 찾는다. 영문은 단어 경계, 한중일은 부분 문자열. */
export function findAll(text, kw) {
  const k = normalize(kw);
  if (!k) return [];
  const out = [];
  if (ASCII.test(k)) {
    const re = new RegExp(`(?<![a-z0-9])${esc(k)}(?![a-z0-9])`, "g");
    let m;
    while ((m = re.exec(text))) out.push(m.index);
  } else {
    let i = text.indexOf(k);
    while (i !== -1) { out.push(i); i = text.indexOf(k, i + k.length); }
  }
  return out.map((index) => ({ index, length: k.length, keyword: kw }));
}

export function findAny(text, keywords) {
  return keywords.flatMap((kw) => findAll(text, kw));
}

export function snippet(text, { index, length }, pad = 18) {
  const a = Math.max(0, index - pad), b = Math.min(text.length, index + length + pad);
  return `${a > 0 ? "…" : ""}${text.slice(a, b)}${b < text.length ? "…" : ""}`;
}
