import test from "node:test";
import assert from "node:assert/strict";
import { MemoryGas } from "../lib/gas.js";
import { MemoryWorks } from "../lib/works.js";
import { handleEvent } from "../lib/commands.js";
import { runTick } from "../lib/jobs.js";

const cfg = { OWNER_NAME: "박팀장", ADMIN_PIN: "1234", WORKDAYS: [1, 2, 3, 4, 5], BRIEF_HOUR: 8, REMIND_HOUR: 9, ASK_HOUR: 17, EVENING_HOUR: 18, MAIL_ENABLED: false, WORKS_ENABLED: true };
const now = new Date("2026-09-22T01:00:00Z"); // KST 10:00 화
const msg = (userId, text, channelId) => ({ type: "message", source: { userId, channelId }, content: { type: "text", text } });

async function setup() {
  const gas = new MemoryGas(); const works = new MemoryWorks();
  const say = (u, t, ch) => handleEvent({ event: msg(u, t, ch), gas, works, cfg, now });
  await say("owner", "관리자 1234");
  return { gas, works, say };
}

test("관리자 등록과 명령", async () => {
  const { gas, works, say } = await setup();
  assert.equal(gas.state.owner_user_id, "owner");
  let r = await say("owner", "할일 A사 견적서 보내기 ~금요일");
  assert.match(r.reply, /#1 등록 · 내 업무 · ~9\/25/);
  r = await say("owner", "팀원등록 김철수");
  r = await say("kim", "등록 김철수");
  assert.equal(gas.team[0].user_id, "kim");
  r = await say("owner", "지시 철수 주간보고 취합 ~내일");
  assert.match(r.reply, /#2 등록 · 김철수 \(알림 보냄\)/);
  assert.equal(works.sent.at(-1).to, "kim");
  r = await say("owner", "목록");
  assert.match(r.reply, /#1 A사 견적서 보내기/);
  assert.doesNotMatch(r.reply, /#2/);
  r = await say("owner", "팀");
  assert.match(r.reply, /김철수: #2 주간보고 취합/);
  r = await say("kim", "완료 2");
  assert.equal(gas.tasks[1].status, "완료");
  assert.match(works.sent.at(-1).text, /✅ 김철수: #2/);
  r = await say("owner", "미룸 1 다음 주 월요일");
  assert.equal(gas.tasks[0].due, "2026-09-28");
  r = await say("owner", "완료 1");
  assert.equal(gas.tasks[0].status, "완료");
  assert.ok(gas.tasks[0].completed_at);
});

test("명령이 아닌 메모 → 할 일 추출", async () => {
  const { gas, say } = await setup();
  await say("owner", "팀원등록 이영희");
  const r = await say("owner", "영희님 회의록 정리해서 목요일까지 공유해주세요");
  assert.match(r.reply, /메모에서 할 일로 등록/);
  assert.equal(gas.tasks[0].owner, "이영희");
  assert.equal(gas.tasks[0].due, "2026-09-24");
  const r2 = await say("owner", "우유 사기");
  assert.match(r2.reply, /#2 등록 · 내 업무/);
});

test("그룹방: 답장 없이 후보만 쌓음", async () => {
  const { gas, say } = await setup();
  await say("owner", "팀원등록 김철수");
  await say("kim", "등록 김철수");
  const r = await say("someone", "박팀장님 계약서 검토 부탁드립니다 9/30까지요", "room1");
  assert.equal(r.reply, undefined);
  assert.equal(gas.tasks.length, 1);
  assert.equal(gas.tasks[0].status, "후보");
  assert.equal(gas.tasks[0].owner, "박팀장");
  const r2 = await say("owner", "확정 1");
  assert.match(r2.reply, /→ 진행/);
  assert.equal(gas.tasks[0].status, "진행");
});

test("대화형 정리 모드", async () => {
  const { gas, say } = await setup();
  await say("owner", "팀원등록 김철수");
  let r = await say("owner", "정리");
  assert.match(r.reply, /할 일 정리를 시작/);
  r = await say("owner", "A사 견적서 보내기 ~내일\n김철수 주간보고 시키기\n회의실 예약");
  assert.match(r.reply, /등록했어요/);
  assert.equal(gas.tasks.length, 3);
  assert.equal(gas.tasks[1].owner, "김철수");
  r = await say("owner", "끝");
  assert.match(r.reply, /기한이 없는 항목이 2개/);
  assert.match(r.reply, /#2 '주간보고' 언제까지/);
  r = await say("owner", "금요일");
  assert.equal(gas.tasks[1].due, "2026-09-25");
  assert.match(r.reply, /#3 '회의실 예약' 언제까지/);
  r = await say("owner", "없음");
  assert.match(r.reply, /정리 끝! 오늘 등록한 3건/);
  assert.equal(gas.state.dialog_owner, "");
  r = await say("owner", "목록");
  assert.match(r.reply, /#1 A사 견적서 보내기/);
});

test("팀원 일일보고 + 정기 작업(브리핑/리마인드/저녁)", async () => {
  const { gas, works, say } = await setup();
  await say("owner", "팀원등록 김철수");
  await say("kim", "등록 김철수");
  await say("owner", "지시 김철수 견적서 작성 ~어제");
  gas.tasks[0].due = "2026-09-21";
  await say("owner", "할일 보고서 작성 ~오늘");

  // 10시: 브리핑 + 리마인드
  let out = await runTick({ gas, works, cfg, now });
  assert.deepEqual(out.done, ["brief:works", "remind:1"]);
  const brief = works.sent.find((s) => s.to === "owner" && s.text.includes("아침 브리핑"));
  assert.match(brief.text, /🟠 오늘 마감 \(1\)/);
  assert.match(brief.text, /김철수: #1 견적서 작성\(~9\/21\(월\)‼\)/);
  assert.match(works.sent.find((s) => s.to === "kim").text, /1일 지남/);
  // 같은 날 다시 → 중복 발송 없음
  const n = works.sent.length;
  out = await runTick({ gas, works, cfg, now });
  assert.equal(works.sent.length, n);

  // 17시: 보고 요청 → 팀원 답장이 보고로 저장
  const eve = new Date("2026-09-22T08:30:00Z");
  out = await runTick({ gas, works, cfg, now: eve });
  assert.ok(out.done.includes("ask:1"));
  const r = await say("kim", "견적서 초안 작성 중, 내일 마무리 예정");
  assert.match(r.reply, /보고 저장/);
  assert.equal(gas.reports[0].text, "견적서 초안 작성 중, 내일 마무리 예정");

  // 18시: 저녁 초안에 팀원 보고 포함
  await say("owner", "완료 2");
  out = await runTick({ gas, works, cfg, now: new Date("2026-09-22T09:30:00Z") });
  assert.ok(out.done.includes("evening:works"));
  const draft = works.sent.at(-1).text;
  assert.match(draft, /일일업무보고 초안/);
  assert.match(draft, /\[금일 완료\]\n - 보고서 작성/);
  assert.match(draft, /김철수: 견적서 초안 작성 중/);
  // 주말엔 안 보냄
  const sat = new Date("2026-09-26T01:00:00Z");
  out = await runTick({ gas, works, cfg, now: sat });
  assert.deepEqual(out.done, []);
});

test("메일 수집 → 후보", async () => {
  const { gas, works } = await setup();
  const fetchMail = async ({ lastUid }) => ({ maxUid: 10, messages: lastUid ? [] : [
    { uid: 9, subject: "RE: 계약서 검토 요청", from: "a@x.com", fromName: "A사 김대리", date: "2026-09-22T00:00:00Z", text: "9/30까지 검토 부탁드립니다." },
    { uid: 10, subject: "(광고) 세일", from: "noreply@shop.com", fromName: "shop", date: "2026-09-22T00:00:00Z", text: "지금 신청하세요" },
  ] });
  const out = await runTick({ gas, works, cfg: { ...cfg, MAIL_ENABLED: true, MAIL_USER: "me@x.com" }, fetchMail, now: new Date("2026-09-22T12:00:00Z") });
  assert.ok(out.done[0].includes("후보 1건"), out.done.join());
  assert.equal(gas.tasks[0].title, "계약서 검토 요청");
  assert.equal(gas.tasks[0].due, "2026-09-30");
  assert.equal(gas.state.mail_last_uid, "10");
});
