// lib/kakao.js — 카카오톡 '대화 내보내기' txt 파서 (PC/안드로이드/아이폰 형식 모두)
//
// 지원 형식
//  PC(Windows): "--------------- 2026년 9월 22일 화요일 ---------------" 다음에 "[홍길동] [오후 3:12] 메시지"
//  안드로이드 : "2026년 9월 22일 오후 3:12, 홍길동 : 메시지"
//  아이폰/맥  : "2026. 9. 22. 오후 3:12, 홍길동 : 메시지"
// 연속 줄(줄바꿈 포함 메시지)은 앞 메시지에 붙인다.

import { iso } from "./dates.js";

const RE_DATE_HEADER = /^-*\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*[월화수목금토일]요일\s*-*$/;
const RE_PC = /^\[(.+?)\]\s*\[(오전|오후)\s*(\d{1,2}):(\d{2})\]\s?(.*)$/;
const RE_ANDROID = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*(.+?)\s*:\s?(.*)$/;
const RE_IOS = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*(.+?)\s*:\s?(.*)$/;
const RE_IOS_DATEONLY = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})[:,]?\s*(.*)$/; // "님이 들어왔습니다" 등 시스템 줄

function hhmm(ap, h, m) {
  h = +h; if (ap === "오후" && h < 12) h += 12; if (ap === "오전" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m}`;
}

/** @returns {{title:string, messages:Array<{date,time,sender,text}>}} */
export function parseKakaoExport(raw) {
  const lines = String(raw || "").replace(/^﻿/, "").replace(/\r/g, "").split("\n");
  const messages = [];
  let curDate = "";
  let title = "";
  let last = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (i < 3 && !title && trimmed && !RE_DATE_HEADER.test(trimmed) && !RE_PC.test(trimmed)) {
      const t = trimmed.match(/^(.+?)\s*(님과 카카오톡 대화|카카오톡 대화)/);
      if (t) { title = t[1]; continue; }
    }
    if (/^저장한 날짜\s*:/.test(trimmed) || /^대화 시작일/.test(trimmed)) continue;

    let m;
    if ((m = trimmed.match(RE_DATE_HEADER))) { curDate = iso(+m[1], +m[2], +m[3]); last = null; continue; }
    if ((m = line.match(RE_PC))) {
      last = { date: curDate, time: hhmm(m[2], m[3], m[4]), sender: m[1].trim(), text: m[5] };
      messages.push(last); continue;
    }
    if ((m = line.match(RE_ANDROID)) || (m = line.match(RE_IOS))) {
      last = { date: iso(+m[1], +m[2], +m[3]), time: hhmm(m[4], m[5], m[6]), sender: m[7].trim(), text: m[8] };
      messages.push(last); continue;
    }
    if ((m = line.match(RE_IOS_DATEONLY))) { last = null; continue; } // 시스템 메시지
    if (last && trimmed) { last.text += "\n" + line; continue; }
  }
  // 시스템 메시지 제거
  const filtered = messages.filter((x) => !/^(사진|동영상|이모티콘|삭제된 메시지입니다\.?|파일: .*)$/.test(x.text.trim()));
  return { title, messages: filtered };
}
