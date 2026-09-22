import test from "node:test";
import assert from "node:assert/strict";
import { MemoryGas } from "../lib/gas.js";
import { MemoryWorks } from "../lib/works.js";
import { MemoryMailer, stripReply } from "../lib/mailer.js";
import { handleEvent } from "../lib/commands.js";
import { runTick } from "../lib/jobs.js";

const cfg = { OWNER_NAME: "박팀장", ADMIN_PIN: "1234", WORKDAYS: [1, 2, 3, 4, 5], BRIEF_HOUR: 8, REMIND_HOUR: 9, ASK_HOUR: 17, EVENING_HOUR: 18, MAIL_ENABLED: true, MAIL_USER: "me@x.com", WORKS_ENABLED: false };
const now = new Date("2026-09-22T01:00:00Z"); // KST 10:00 화
const web = (gas, mailer, text) => handleEvent({ event: { type: "message", source: { userId: "web" }, content: { type: "text", text } }, gas, mailer, cfg, now, forceOwner: true });

test("웹 대화: 관리자 등록 없이 forceOwner 로 명령·정리 모드 동작", async () => {
  const gas = new MemoryGas(); const mailer = new MemoryMailer();
  let r = await web(gas, mailer, "정리");
  assert.match(r.reply, /할 일 정리를 시작/);
  r = await web(gas, mailer, "A사 견적서 ~내일\n회의실 예약");
  r = await web(gas, mailer, "끝");
  assert.match(r.reply, /#2 '회의실 예약' 언제까지/);
  r = await web(gas, mailer, "금요일");
  assert.match(r.reply, /정리 끝/);
  r = await web(gas, mailer, "목록");
  assert.match(r.reply, /#1 A사 견적서/);
});

test("팀원 이메일 등록 → 지시 알림이 메일로", async () => {
  const gas = new MemoryGas(); const mailer = new MemoryMailer();
  let r = await web(gas, mailer, "팀원등록 김철수 kim@x.com 대리");
  assert.match(r.reply, /kim@x.com/);
  assert.equal(gas.team[0].email, "kim@x.com"); assert.equal(gas.team[0].role, "대리");
  r = await web(gas, mailer, "지시 김철수 견적서 작성 ~내일");
  assert.match(r.reply, /김철수 \(알림 보냄\)/);
  assert.equal(mailer.sent[0].to, "kim@x.com");
  assert.match(mailer.sent[0].subject, /새 업무 #1/);
});

test("정기 작업: 브리핑·초안은 내 메일로, 팀원 리마인드·보고 요청은 팀원 메일로, 답장은 보고로 저장", async () => {
  const gas = new MemoryGas(); const mailer = new MemoryMailer(); const works = new MemoryWorks();
  await web(gas, mailer, "팀원등록 김철수 kim@x.com");
  await web(gas, mailer, "지시 김철수 견적서 작성 ~어제");
  await web(gas, mailer, "할일 보고서 작성 ~오늘");
  mailer.sent.length = 0;
  let out = await runTick({ gas, works, mailer, cfg: { ...cfg, MAIL_ENABLED: false }, now });
  assert.deepEqual(out.done, ["brief:mail", "remind:1"]);
  assert.equal(mailer.sent[0].to, "me@x.com"); assert.match(mailer.sent[0].subject, /아침 브리핑/); assert.match(mailer.sent[0].text, /오늘 마감/);
  assert.equal(mailer.sent[1].to, "kim@x.com"); assert.match(mailer.sent[1].text, /1일 지남/);

  // 17시 보고 요청 메일
  out = await runTick({ gas, works, mailer, cfg: { ...cfg, MAIL_ENABLED: false }, now: new Date("2026-09-22T08:30:00Z") });
  assert.ok(out.done.includes("ask:1"));
  const ask = mailer.sent.at(-1);
  assert.match(ask.subject, /\[업무비서 보고\]/); assert.match(ask.text, /답장/);

  // 팀원 답장이 IMAP 으로 들어옴 → 보고 저장, 후보 아님
  const fetchMail = async () => ({ maxUid: 5, messages: [
    { uid: 5, subject: `RE: ${ask.subject}`, from: "kim@x.com", fromName: "김철수", date: "2026-09-22T09:00:00Z", text: "견적서 초안 작성 완료, 내일 검토 요청 예정\n\n> 오늘 한 일을 한 줄씩 답장해 주세요." },
    { uid: 4, subject: "[업무비서] 9/22 아침 브리핑", from: "me@x.com", fromName: "업무 비서", date: "2026-09-22T00:00:00Z", text: "🟠 오늘 마감 부탁드립니다" },
  ] });
  out = await runTick({ gas, works, mailer, cfg, fetchMail, now: new Date("2026-09-22T09:30:00Z") });
  assert.match(out.done[0], /후보 0건, 보고 1건/);
  assert.equal(gas.reports[0].text, "견적서 초안 작성 완료, 내일 검토 요청 예정");
  assert.ok(out.done.includes("evening:mail"));
  assert.match(mailer.sent.at(-1).text, /김철수: 견적서 초안 작성 완료/);
});

test("stripReply", () => {
  assert.equal(stripReply("오늘 한 일\n둘째 줄\n\n2026년 9월 22일 (화) 오후 5:00, 업무 비서 <me@x.com>님이 작성:\n> 인용"), "오늘 한 일\n둘째 줄");
  assert.equal(stripReply("본문\n-----Original Message-----\nFrom: x"), "본문");
});
