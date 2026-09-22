import test from "node:test";
import assert from "node:assert/strict";
import { parseKoreanDate, parseKoreanTime, addDays, kst, shortDate } from "../lib/dates.js";

const base = "2026-09-22"; // 화요일

test("절대 날짜", () => {
  assert.equal(parseKoreanDate("9월 30일까지 부탁드립니다", base).due, "2026-09-30");
  assert.equal(parseKoreanDate("2026-10-02 회의", base).due, "2026-10-02");
  assert.equal(parseKoreanDate("10/5 오전 중", base).due, "2026-10-05");
  assert.equal(parseKoreanDate("2026.9.28 제출", base).due, "2026-09-28");
  assert.equal(parseKoreanDate("1월 10일 발표", base).due, "2027-01-10", "지난 월/일은 내년");
  assert.equal(parseKoreanDate("25일까지 회신", base).due, "2026-09-25");
  assert.equal(parseKoreanDate("5일까지 회신", base).due, "2026-10-05", "이미 지난 '일'은 다음 달");
});

test("상대 날짜", () => {
  assert.equal(parseKoreanDate("내일까지", base).due, "2026-09-23");
  assert.equal(parseKoreanDate("모레 오전", base).due, "2026-09-24");
  assert.equal(parseKoreanDate("오늘 중으로", base).due, "2026-09-22");
  assert.equal(parseKoreanDate("금요일까지 주세요", base).due, "2026-09-25");
  assert.equal(parseKoreanDate("화요일까지", base).due, "2026-09-22", "오늘 요일이면 오늘");
  assert.equal(parseKoreanDate("월요일 오전", base).due, "2026-09-28");
  assert.equal(parseKoreanDate("이번 주 목요일", base).due, "2026-09-24");
  assert.equal(parseKoreanDate("이번주 월요일", base).due, "2026-09-28", "이번 주 지난 요일 → 다음 주");
  assert.equal(parseKoreanDate("다음 주 수요일", base).due, "2026-09-30");
  assert.equal(parseKoreanDate("이번 주 내로", base).due, "2026-09-25");
  assert.equal(parseKoreanDate("다음주에 봅시다", base).due, "2026-09-28");
  assert.equal(parseKoreanDate("월말까지", base).due, "2026-09-30");
  assert.equal(parseKoreanDate("다음 달 초", base).due, "2026-10-01");
  assert.equal(parseKoreanDate("ASAP", base).due, "2026-09-22");
  assert.equal(parseKoreanDate("그냥 안부 인사", base), null);
});

test("시각 표현과 시간이 날짜로 오인되지 않음", () => {
  assert.equal(parseKoreanDate("오전 10:30 회의", base), null);
  assert.equal(parseKoreanTime("오후 3시 반까지"), "15:30");
  assert.equal(parseKoreanTime("14:05"), "14:05");
  assert.equal(parseKoreanTime("3시까지"), "15:00");
  assert.equal(parseKoreanTime("오전 9시"), "09:00");
});

test("kst / addDays / shortDate", () => {
  const t = kst(new Date("2026-09-22T23:30:00Z")); // KST 9/23 08:30
  assert.equal(t.iso, "2026-09-23"); assert.equal(t.hh, 8); assert.equal(t.dow, 3);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(shortDate("2026-09-23", base), "9/23(수) 내일");
  assert.equal(shortDate("2026-09-20", base), "9/20(일) 2일 지남");
});
