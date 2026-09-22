import test from "node:test";
import assert from "node:assert/strict";
import { extractTasks, toTitle, findMentions, stripMemberName } from "../lib/extract.js";

const team = [{ name: "김철수", user_id: "u-kim" }, { name: "이영희", user_id: "u-lee" }];
const base = "2026-09-22";
const common = { team, ownerName: "박팀장", base };

test("남이 나에게 요청 → 내 할 일 후보", () => {
  const r = extractTasks({ ...common, text: "안녕하세요 박팀장님, 견적서 검토 부탁드립니다. 금요일까지 회신 주시면 감사하겠습니다.", sender: "홍부장", isOwner: false, source: "네이버웍스", sourceRef: "영업방" });
  assert.ok(r.length >= 1);
  assert.equal(r[0].owner, "박팀장");
  assert.equal(r[0].requested_by, "홍부장");
  assert.equal(r[0].title, "견적서 검토");
  const withDue = r.find((t) => t.due);
  assert.equal(withDue.due, "2026-09-25");
});

test("내가 팀원에게 지시 → 팀원 할 일", () => {
  const r = extractTasks({ ...common, text: "철수님 주간보고 취합해서 내일까지 보내주세요", sender: "박팀장", isOwner: true, source: "네이버웍스" });
  assert.equal(r.length, 1);
  assert.equal(r[0].owner, "김철수");
  assert.equal(r[0].owner_user_id, "u-kim");
  assert.equal(r[0].due, "2026-09-23");
  assert.equal(r[0].requested_by, "박팀장");
});

test("내가 약속한 것 → 내 할 일. 내가 쓴 일반 잡담은 무시", () => {
  const r = extractTasks({ ...common, text: "네, 자료는 제가 내일 오전에 보내드리겠습니다.", sender: "박팀장", isOwner: true });
  assert.equal(r.length, 1); assert.equal(r[0].owner, "박팀장"); assert.equal(r[0].due, "2026-09-23");
  const none = extractTasks({ ...common, text: "점심 뭐 먹을까요 ㅎㅎ", sender: "박팀장", isOwner: true });
  assert.equal(none.length, 0);
});

test("완료 보고는 할 일이 아님", () => {
  const r = extractTasks({ ...common, text: "요청하신 자료 보냈습니다. 확인 부탁드립니다.", sender: "김철수", isOwner: false });
  // 첫 문장은 완료, 둘째 문장 '확인 부탁' 은 내 할 일
  assert.equal(r.length, 1); assert.equal(r[0].title, "확인");
});

test("메일: 제목을 제목으로, 광고/자동발신은 무시", () => {
  const r = extractTasks({ ...common, text: "첨부 계약서 검토 후 9/30까지 회신 바랍니다.", subject: "RE: [A사] 계약서 검토 요청", sender: "A사 담당", isOwner: false, source: "메일", sourceRef: "x" });
  assert.equal(r.length, 1); assert.equal(r[0].title, "[A사] 계약서 검토 요청"); assert.equal(r[0].due, "2026-09-30");
  const ad = extractTasks({ ...common, text: "지금 신청하세요", subject: "(광고) 특가 안내", sender: "newsletter@x.com", isOwner: false, source: "메일" });
  assert.equal(ad.length, 0);
});

test("제목에서 날짜 표현 제거", () => {
  const r = extractTasks({ ...common, text: "박팀장님 계약서 검토 부탁드립니다 9/30까지요", sender: "외부", isOwner: false });
  assert.equal(r[0].title, "계약서 검토");
  assert.equal(r[0].due, "2026-09-30");
  const r2 = extractTasks({ ...common, text: "내일 오전까지 회의 자료 준비해주세요", sender: "외부", isOwner: false });
  assert.equal(r2[0].title, "회의 자료 준비");
  assert.equal(r2[0].due, "2026-09-23");
});

test("toTitle / findMentions", () => {
  assert.equal(toTitle("김철수 대리님, 견적서 좀 부탁드립니다."), "견적서");
  assert.equal(toTitle("회의실 예약해주세요"), "회의실 예약");
  assert.equal(toTitle("제안서 25일까지 보내주세요".replace("25일까지 ", "")), "제안서 보내기");
  assert.equal(toTitle("네, 자료 공유해 주세요"), "자료 공유");
  assert.deepEqual(findMentions("영희씨랑 철수님 같이 봐주세요", team).map((m) => m.name), ["김철수", "이영희"]);
  assert.equal(findMentions("김철수한테 물어보세요", team).length, 1, "성+이름은 조사가 붙어도 인식");
  assert.equal(findMentions("철수정 씨", team).length, 0, "이름만은 다른 단어 일부면 무시");
  assert.equal(stripMemberName("김철수 주간보고 시키기", team[0]), "주간보고");
  assert.equal(stripMemberName("철수님한테 견적서 요청하기", team[0]), "견적서");
});
