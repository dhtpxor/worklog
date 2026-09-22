import test from "node:test";
import assert from "node:assert/strict";
import { parseKakaoExport } from "../lib/kakao.js";
import { importText } from "../api/import.js";

const pc = `A사 담당자 님과 카카오톡 대화
저장한 날짜 : 2026-09-22 10:00

--------------- 2026년 9월 21일 월요일 ---------------
[A사 담당자] [오후 2:03] 팀장님 안녕하세요
[A사 담당자] [오후 2:04] 제안서 수정본 25일까지 보내주실 수 있을까요?
두 줄짜리 메시지 이어짐
[박팀장] [오후 2:10] 네 확인해서 보내드리겠습니다
--------------- 2026년 9월 22일 화요일 ---------------
[A사 담당자] [오전 9:00] 사진
`;
const android = `2026년 9월 21일 오후 2:04, A사 담당자 : 제안서 수정본 25일까지 보내주세요
2026년 9월 21일 오후 2:10, 박팀장 : 넵
`;
const ios = `2026. 9. 21. 오후 2:04, A사 담당자 : 제안서 수정본 25일까지 보내주세요
`;

test("PC 형식", () => {
  const { title, messages } = parseKakaoExport(pc);
  assert.equal(title, "A사 담당자");
  assert.equal(messages.length, 3); // 4건 중 "사진" 제거
  assert.equal(messages[1].date, "2026-09-21");
  assert.equal(messages[1].time, "14:04");
  assert.ok(messages[1].text.includes("두 줄짜리"));
  assert.equal(messages[2].sender, "박팀장");
});

test("안드로이드/아이폰 형식", () => {
  assert.equal(parseKakaoExport(android).messages.length, 2);
  assert.equal(parseKakaoExport(ios).messages[0].date, "2026-09-21");
});

test("가져오기 → 후보 (기한은 메시지 날짜 기준)", async () => {
  const c = await importText({ kind: "kakao", text: pc, team: [], ownerName: "박팀장", today: "2026-09-22" });
  const titles = c.map((x) => x.title);
  assert.ok(titles.some((t) => t.includes("제안서 수정본")), JSON.stringify(c));
  assert.ok(c.every((x) => x.status === "후보" && x.source === "카카오톡"));
  assert.equal(c.find((x) => x.title.includes("제안서")).due, "2026-09-25");
  assert.ok(c.some((x) => x.owner === "박팀장" && x.snippet.includes("보내드리겠습니다")), "내 약속도 잡힘");
});

test("대화 복사본/캡처 텍스트: 발신자 인식 → 내 약속과 남의 요청 구분", async () => {
  const { parseChatLines } = await import("../api/import.js");
  const txt = `A사 김대리: 팀장님 제안서 수정본 25일까지 보내주실 수 있을까요?
박팀장: 네, 목요일까지 보내드리겠습니다
A사 김대리: 감사합니다`;
  assert.equal(parseChatLines(txt).length, 3);
  const c = await importText({ kind: "text", text: txt, team: [], ownerName: "박팀장", today: "2026-09-22" });
  assert.ok(c.some((x) => x.title.includes("제안서 수정본") && x.requested_by === "A사 김대리"), JSON.stringify(c));
  assert.ok(c.some((x) => x.snippet.includes("박팀장:") && x.due === "2026-09-24"), JSON.stringify(c));
  assert.equal(parseChatLines("https://example.com: 링크\n그냥 글").length, 0);
});
