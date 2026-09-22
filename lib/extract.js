// lib/extract.js — 규칙 기반 할 일 추출 (AI 없음: 본문이 외부로 나가지 않는다)
//
// 원칙: 놓치는 것보다 후보가 조금 많은 편이 낫다. 뽑힌 항목은 모두 '후보' 상태로 들어가고,
// 아침 브리핑/웹페이지에서 "확정/무시" 한 번으로 정리한다.

import { parseKoreanDate, parseKoreanTime } from "./dates.js";

/** 남이 나에게(또는 내가 남에게) 시키는 표현 */
export const REQUEST_CUES = [
  "부탁", "요청", "해주세요", "해 주세요", "해주시", "해 주시", "주세요", "주시면", "주시기", "주십시오", "주시길",
  "바랍니다", "바래요", "바랍니", "해주십", "확인 부탁", "확인부탁", "확인해", "회신", "답변", "답장", "제출", "전달해", "보내주", "보내 주",
  "공유해", "공유 부탁", "검토", "승인", "결재", "작성해", "작성 부탁", "준비해", "준비 부탁", "정리해", "정리 부탁", "처리해", "처리 부탁",
  "까지", "마감", "기한", "납기", "데드라인", "필요합니다", "필요해요", "가능할까요", "가능하실까요", "가능한지", "될까요", "부탁드", "요청드",
  "해줘", "해 줘", "해줄래", "해줄 수", "해 줄 수", "챙겨", "잊지", "리마인드", "예약", "신청", "등록해", "입력해", "발송", "송부",
];

/** 내가 남에게 "하겠다"고 약속하는 표현 → 내 할 일 */
export const COMMIT_CUES = [
  "드리겠습니다", "드릴게요", "드릴께요", "하겠습니다", "할게요", "할께요", "보내드리", "보내 드리", "전달드리", "공유드리", "회신드리",
  "정리해서", "확인해보겠", "확인해 보겠", "알아보겠", "준비하겠", "처리하겠", "진행하겠", "제출하겠", "챙기겠", "예정입니다", "예정이에요",
];

/** 이미 끝난 일 / 안내문 → 할 일 아님 */
export const DONE_CUES = [
  "완료했", "완료됐", "완료되었", "처리했", "처리됐", "처리되었", "보냈습니다", "보내드렸", "전달했", "전달드렸", "제출했", "제출됐",
  "확인했습니다", "확인됐", "확인되었", "감사합니다", "수고하셨", "고생하셨", "잘 받았", "접수되었", "접수됐", "발송되었", "발송했",
  "완료 되었", "완료 했", "끝났", "마쳤",
];

const NOISE_SUBJECT = /\(광고\)|\[광고\]|newsletter|뉴스레터|unsubscribe|수신거부|자동\s*발신|noreply|no-reply|do-not-reply/i;
const NOISE_FROM = /noreply|no-reply|donotreply|newsletter|notification|alert|mailer-daemon|postmaster/i;

/** 문장 나누기: 줄바꿈, 마침표/물음표/느낌표(뒤에 공백 또는 끝) */
export function splitSentences(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?。])\s+|(?<=다\.)|(?<=요\.)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

export function hasAny(text, cues) {
  const t = String(text || "");
  return cues.some((c) => t.includes(c));
}

/** 팀원 이름/직급 언급 찾기. team: [{name}], text 안에 '홍길동', '길동님', '홍길동 대리', '@홍길동' 등 */
export function findMentions(text, team = []) {
  const t = String(text || "");
  const out = [];
  for (const m of team) {
    const name = String(m.name || "").trim();
    if (!name) continue;
    const short = name.length >= 3 ? name.slice(1) : name; // 성 뺀 이름 (김철수 → 철수)
    const names = short !== name && short.length >= 2 ? [name, short] : [name];
    // 성+이름(3자 이상)은 뒤에 무엇이 와도 언급으로 본다("김철수가", "김철수한테").
    // 이름만(2자)은 님/씨/직급이 붙거나 단어가 끝나야 한다("철수님", "철수 대리").
    const hit = names.some((n) => {
      const tail = n.length >= 3 ? "" : `(님|씨|\\s*(${RANKS})|[^가-힣]|$)`;
      return new RegExp(`(^|[^가-힣])${escapeRe(n)}${tail}`).test(t) || t.includes(`@${n}`);
    });
    if (hit) out.push(m);
  }
  return out;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const RANKS = "대리|주임|사원|과장|차장|부장|팀장|실장|이사|매니저|PM|프로|책임|선임|수석";

/** 문장에서 특정 팀원 이름(님/씨/직급 포함)과 '시키기/맡기기' 같은 꼬리를 떼어낸다 */
export function stripMemberName(text, member) {
  const name = String(member?.name || "").trim();
  if (!name) return text;
  const short = name.length >= 3 ? name.slice(1) : name;
  let s = String(text);
  for (const n of [name, short]) {
    if (n.length < 2) continue;
    s = s.replace(new RegExp(`@?${escapeRe(n)}(님|씨)?(\\s*(${RANKS})님?)?(에게|한테|께|이|가|은|는|랑|와|과)?[,\\s]*`, "g"), " ");
  }
  s = s.replace(/\s*(시키기|시킬\s*것|시켜야\s*함|시켜야\s*됨|맡기기|맡길\s*것|요청하기|요청할\s*것|부탁하기|지시하기|지시)\s*$/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/** 문장을 할 일 제목으로 다듬기 */
export function toTitle(sentence, { team = [], maxLen = 70 } = {}) {
  let s = String(sentence || "").replace(/\s+/g, " ").trim();
  s = s.replace(/^(안녕하세요|안녕하십니까|수고 많으십니다|수고하십니다|고생 많으십니다|네|넵|넹|예|알겠습니다|알겠어요|확인했습니다|감사합니다)[,.!~\s]*/g, "");
  s = s.replace(/^(@?[가-힣]{2,4}(님|씨|\s?(대리|주임|사원|과장|차장|부장|팀장|실장|이사|매니저|프로|책임|선임|수석)님?)[,~!\s]*)+/, "");
  s = s.replace(/^(저희|우리|제가|내가|혹시|그리고|그럼|일단|우선|먼저|다름이 아니라|다름이아니라)[,\s]+/, "");
  s = s.replace(/[.!?。~]+$/g, "").trim();
  // 꼬리 정중 표현 정리
  s = s.replace(/\s*(좀|한번|한 번)?\s*(부탁\s*드립니다|부탁드려요|부탁드립니당|부탁합니다|부탁해요|부탁드리겠습니다|부탁 드립니다|바랍니다|바래요|요청드립니다|요청 드립니다|요청드려요|해주세요|해 주세요|해주시기 바랍니다|해주시길 바랍니다|해 주시기 바랍니다|해주시면 감사하겠습니다|해 주시면 감사하겠습니다|해주십시오|해주실 수 있을까요|해 주실 수 있을까요|해주실래요|해줘|해 줘|해줄래|주세요|주시기 바랍니다|주시면 감사하겠습니다|가능할까요|가능하실까요|될까요)\s*$/g, "");
  s = s.replace(/\s*(드리겠습니다|드릴게요|하겠습니다|할게요|할께요|예정입니다)\s*$/g, "");
  s = s.replace(/[,]\s*$/g, "").trim();
  // 꼬리가 동사 어간으로 끝나면 명사형으로 ("제안서 보내" → "제안서 보내기")
  const VERB_TAIL = { 보내: "보내기", 보내드리: "보내기", 전달해: "전달", 전달드리: "전달", 공유해: "공유", 공유드리: "공유", 작성해: "작성", 준비해: "준비", 정리해: "정리", 처리해: "처리", 확인해: "확인", 검토해: "검토", 제출해: "제출", 회신해: "회신", 회신드리: "회신", 올려: "올리기", 알려: "알려주기", 챙겨: "챙기기", 등록해: "등록", 입력해: "입력", 예약해: "예약", 신청해: "신청", 수정해: "수정", 진행해: "진행", 참석해: "참석" };
  for (const [k, v] of Object.entries(VERB_TAIL)) { if (s.endsWith(k)) { s = s.slice(0, -k.length) + v; break; } }
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
  return s;
}

/**
 * 메시지 한 건에서 할 일 후보를 뽑는다.
 * @param {object} p
 * @param {string} p.text        본문
 * @param {string} p.sender      보낸 사람 이름 (없으면 "")
 * @param {boolean} p.isOwner    보낸 사람이 나(관리자)인지
 * @param {Array}  p.team        팀원 목록 [{name, user_id}]
 * @param {string} p.ownerName   내 이름
 * @param {string} p.base        기준일 'YYYY-MM-DD'
 * @param {string} p.source      "메일" | "네이버웍스" | "카카오톡" | "직접"
 * @param {string} p.sourceRef   메일 제목 / 방 이름
 * @param {string} [p.subject]   메일 제목(있으면 제목을 우선 사용)
 * @returns {Array<{title, owner, owner_user_id, requested_by, due, due_time, source, source_ref, snippet}>}
 */
export function extractTasks(p) {
  const { text = "", sender = "", isOwner = false, team = [], ownerName = "", base, source = "직접", sourceRef = "", subject = "" } = p;
  const out = [];
  const seen = new Set();
  const full = `${subject}\n${text}`;
  if (source === "메일" && (NOISE_SUBJECT.test(subject) || NOISE_FROM.test(sender))) return out;

  const ownerMention = ownerName && findMentions(full, [{ name: ownerName }]).length > 0;
  const sentences = splitSentences(text);
  const fallbackDue = parseKoreanDate(full, base);

  for (const s of sentences) {
    if (hasAny(s, DONE_CUES) && !hasAny(s, ["까지", "마감", "기한"])) continue;
    const isRequest = hasAny(s, REQUEST_CUES);
    const isCommit = hasAny(s, COMMIT_CUES);
    if (!isRequest && !isCommit) continue;

    const mentions = findMentions(s, team);
    let owner = "", ownerUserId = "", requestedBy = sender;

    if (mentions.length && (isOwner || !isCommit)) {
      // 팀원이 언급됨: 그 팀원의 일 (내가 시킨 것, 또는 남이 팀원에게 요청한 것)
      owner = mentions[0].name; ownerUserId = mentions[0].user_id || "";
    } else if (isOwner) {
      // 내가 쓴 글: "~하겠습니다" 같은 약속만 내 일
      if (!isCommit) continue;
      owner = ownerName; ownerUserId = ""; requestedBy = "";
    } else {
      // 남이 쓴 글에서 요청 표현 → 내 일 (팀원이 "제가 하겠습니다"라고 한 것은 그 팀원의 일)
      const senderMember = team.find((m) => m.name && m.name === sender);
      if (isCommit && !isRequest && senderMember) { owner = senderMember.name; ownerUserId = senderMember.user_id || ""; requestedBy = ""; }
      else { owner = ownerName; ownerUserId = ""; }
    }

    const dueHit = parseKoreanDate(s, base) || (sentences.length <= 3 ? fallbackDue : null);
    const sForTitle = dueHit ? stripDateWords(s, dueHit.matched) : s;
    const title = source === "메일" && subject && !mentions.length ? cleanSubject(subject) : toTitle(sForTitle, { team });
    if (!title || title.length < 2) continue;
    const key = `${owner}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title, owner, owner_user_id: ownerUserId, requested_by: requestedBy,
      due: dueHit ? dueHit.due : "", due_time: parseKoreanTime(s),
      source, source_ref: sourceRef, snippet: s.slice(0, 200),
      _ownerMentioned: ownerMention,
    });
    if (source === "메일" && !mentions.length) break; // 메일은 제목 기준 1건이면 충분
  }
  return out;
}

/** 제목에서 날짜 표현("9/30까지", "내일 오전까지")을 뗀다 */
export function stripDateWords(text, matched) {
  let s = String(text || "");
  if (matched) s = s.replace(new RegExp(`${escapeRe(matched)}\\s*(오전|오후|중|내|안|전|에|까지|까지는|까지로|이내|이내로|중으로|안으로)*\\s*(까지|까지는|까지로)?(요|이요|입니다|예요|에요)?(?![가-힣])`), " ");
  s = s.replace(/\s*(까지|까지는|까지로)\s+/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

export function cleanSubject(subject) {
  return String(subject || "").replace(/^\s*((re|fw|fwd|답장|전달|회신)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().slice(0, 80);
}
