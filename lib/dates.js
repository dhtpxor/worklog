// lib/dates.js — 한국 시간(KST) 도우미 + 한국어 날짜 표현 해석
// 외부 라이브러리 없이 동작한다. 모든 날짜 문자열은 'YYYY-MM-DD'.

export const TZ = "Asia/Seoul";
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** 현재(또는 주어진) 시각을 KST 기준 구성요소로 돌려준다. */
export function kst(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = +get("year"), m = +get("month"), d = +get("day");
  let hh = +get("hour"); if (hh === 24) hh = 0;
  const mm = +get("minute");
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y, m, d, hh, mm, dow, iso: iso(y, m, d) };
}

export function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function todayISO(now = new Date()) { return kst(now).iso; }

/** 'YYYY-MM-DD' + n일 (UTC 정오 기준으로 계산해 DST/시간대 영향 없음) */
export function addDays(dateISO, n) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d, 12) + n * 86400000;
  const x = new Date(t);
  return iso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

export function dowOf(dateISO) {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function dowLabel(dateISO) { return DOW_KO[dowOf(dateISO)]; }

/** 두 날짜의 차이(일). b - a */
export function diffDays(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function lastDayOfMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

export function isValidISO(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m);
}

/** 'M/D', '9월 30일' 등 화면 표시용 짧은 형식 */
export function shortDate(dateISO, base) {
  if (!dateISO) return "";
  const [, m, d] = dateISO.split("-").map(Number);
  let s = `${m}/${d}(${dowLabel(dateISO)})`;
  if (base) {
    const diff = diffDays(base, dateISO);
    if (diff === 0) s += " 오늘";
    else if (diff === 1) s += " 내일";
    else if (diff < 0) s += ` ${-diff}일 지남`;
  }
  return s;
}

const DOW_MAP = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 0 };

function nextDow(baseISO, dow, { includeToday = true, weeksAhead = 0 } = {}) {
  const cur = dowOf(baseISO);
  let delta = (dow - cur + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(baseISO, delta + weeksAhead * 7);
}

/** "이번 주 X요일": 이번 주(월~일) 안의 X요일. 이미 지났으면 그대로(지난 날짜) 반환 → 호출부에서 처리. */
function thisWeekDow(baseISO, dow) {
  const cur = dowOf(baseISO);
  const curMon = cur === 0 ? 6 : cur - 1; // 월=0 … 일=6
  const tgtMon = dow === 0 ? 6 : dow - 1;
  return addDays(baseISO, tgtMon - curMon);
}

/**
 * 문장에서 기한(날짜)을 찾는다. 찾으면 { due, matched, kind } 아니면 null.
 * base: 기준일 'YYYY-MM-DD' (메시지 보낸 날). 상대 표현("내일", "금요일까지")은 이 날 기준.
 */
export function parseKoreanDate(text, base) {
  if (!text) return null;
  const t = String(text);
  const [by, bm] = base.split("-").map(Number);
  let m;

  // 2026-09-30 / 2026.9.30 / 2026년 9월 30일 / 2026/9/30
  m = t.match(/(20\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})\s*일?/);
  if (m) return ok(+m[1], +m[2], +m[3], m[0], "절대");

  // 9월 30일
  m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return ok(rollYear(+m[1], +m[2]), +m[1], +m[2], m[0], "절대");

  // 9/30, 9.30 (시간 10:30 이나 소수와 구분: 앞뒤에 숫자가 붙지 않아야 함)
  m = t.match(/(?<![\d:])(\d{1,2})\s*[\/.]\s*(\d{1,2})(?![\d:%])/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) return ok(rollYear(+m[1], +m[2]), +m[1], +m[2], m[0], "절대");

  // 30일까지 / 30일 오전 / 30일 중 / 30일 전
  m = t.match(/(?<![\d월\/.])(\d{1,2})\s*일\s*(까지|오전|오후|중|전|내|안|에)/);
  if (m) {
    const d = +m[1];
    if (d >= 1 && d <= 31) {
      let y = by, mo = bm;
      if (d < kstDay(base)) { mo += 1; if (mo > 12) { mo = 1; y += 1; } } // 이미 지난 날짜면 다음 달
      return ok(y, mo, d, m[0], "이달");
    }
  }

  // 오늘/내일/모레/글피
  m = t.match(/오늘|금일|내일|명일|모레|글피|어제|그저께|그제/);
  if (m) {
    const n = { 오늘: 0, 금일: 0, 내일: 1, 명일: 1, 모레: 2, 글피: 3, 어제: -1, 그저께: -2, 그제: -2 }[m[0]];
    return { due: addDays(base, n), matched: m[0], kind: "상대" };
  }

  // 이번 주 금요일 / 금주 금 / 이번주 내
  m = t.match(/(이번\s*주|금주)\s*(월|화|수|목|금|토|일)(?:요일)?/);
  if (m) {
    let due = thisWeekDow(base, DOW_MAP[m[2]]);
    if (diffDays(base, due) < 0) due = addDays(due, 7); // 이미 지난 요일이면 다음 주 같은 요일
    return { due, matched: m[0], kind: "상대" };
  }
  m = t.match(/(다음\s*주|담주|차주|익주)\s*(월|화|수|목|금|토|일)(?:요일)?/);
  if (m) return { due: addDays(thisWeekDow(base, DOW_MAP[m[2]]), 7), matched: m[0], kind: "상대" };

  m = t.match(/(이번\s*주|금주)\s*(내|안|중|까지)/);
  if (m) return { due: thisWeekDow(base, 5), matched: m[0], kind: "상대" }; // 이번 주 금요일
  m = t.match(/(다음\s*주|담주|차주|익주)\s*(초|월요일)?/);
  if (m) return { due: addDays(thisWeekDow(base, 1), 7), matched: m[0], kind: "상대" }; // 다음 주 월요일

  // 이번 달 말 / 월말
  m = t.match(/(이번\s*달\s*말|이달\s*말|월말)/);
  if (m) return { due: iso(by, bm, lastDayOfMonth(by, bm)), matched: m[0], kind: "상대" };
  m = t.match(/(다음\s*달|익월)\s*(초|말)?/);
  if (m) {
    let y = by, mo = bm + 1; if (mo > 12) { mo = 1; y += 1; }
    return { due: m[2] === "말" ? iso(y, mo, lastDayOfMonth(y, mo)) : iso(y, mo, 1), matched: m[0], kind: "상대" };
  }

  // 금요일까지 / 수요일 오전 / 월욜
  m = t.match(/(월|화|수|목|금|토|일)(?:요일|욜)/);
  if (m) return { due: nextDow(base, DOW_MAP[m[1]], { includeToday: true }), matched: m[0], kind: "상대" };

  // 주말
  m = t.match(/주말/);
  if (m) return { due: nextDow(base, 6, { includeToday: true }), matched: m[0], kind: "상대" };

  // 급함 → 오늘
  m = t.match(/ASAP|asap|급합니다|급해요|긴급|당장|시급/);
  if (m) return { due: base, matched: m[0], kind: "상대" };

  return null;

  function ok(y, mo, d, matched, kind) {
    const s = iso(y, mo, d);
    return isValidISO(s) ? { due: s, matched, kind } : null;
  }
  // 연도 없는 월/일: 기준일보다 60일 이상 과거면 내년으로 본다.
  function rollYear(mo, d) {
    const cand = iso(by, mo, d);
    if (!isValidISO(cand)) return by;
    return diffDays(base, cand) < -60 ? by + 1 : by;
  }
}

function kstDay(baseISO) { return +baseISO.split("-")[2]; }

/** "오전 10시", "14:30", "3시 반" 같은 시각 표현을 'HH:MM'으로. 없으면 "". */
export function parseKoreanTime(text) {
  if (!text) return "";
  let m = String(text).match(/(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/);
  if (m) {
    let h = +m[2];
    const ap = m[1];
    if ((ap === "오후" || ap === "저녁" || ap === "밤") && h < 12) h += 12;
    if (ap === "새벽" && h === 12) h = 0;
    if (!ap && h >= 1 && h <= 6) h += 12; // "3시까지" → 보통 오후 3시
    const mm = m[3] === "반" ? 30 : (m[4] ? +m[4] : 0);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  m = String(text).match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  if (m) return `${String(+m[1]).padStart(2, "0")}:${m[2]}`;
  return "";
}
