/**
 * ════════════════════════════════════════════════════════════
 * 업무 비서 — Google Apps Script (구글 시트가 데이터베이스)
 * ────────────────────────────────────────────────────────────
 * 셋업:
 *   1) 빈 구글 시트 생성 (제목: 업무 비서 데이터)
 *   2) 메뉴: 확장 프로그램 → Apps Script → 기본 코드 지우고 이 파일 전체 붙여넣기
 *   3) 아래 API_TOKEN 값을 아무 긴 문자열로 바꾸기 (Vercel 의 GAS_TOKEN 과 똑같이)
 *   4) 함수 선택 → setup → 실행 (권한 승인). 탭 5개 생성 확인
 *   5) 배포 → 새 배포 → 웹 앱 → 실행: 나 / 액세스: 모든 사용자 → URL 복사 → Vercel 의 GAS_URL
 *   6) Vercel 배포가 끝난 뒤: 아래 TICK_URL 을 채우고, 함수 선택 → installTriggers → 실행
 *      (매시간 Vercel 의 /api/tick 을 불러 메일 수집·브리핑·리마인드를 돌린다)
 * ════════════════════════════════════════════════════════════
 */

const API_TOKEN = "여기를-긴-비밀문자열로-바꾸세요";      // ★ Vercel 환경변수 GAS_TOKEN 과 동일하게
const TICK_URL  = "";                                        // ★ 예) https://내프로젝트.vercel.app/api/tick?key=<TICK_KEY>

const SHEETS = { TASKS: "tasks", TEAM: "team", REPORTS: "reports", STATE: "state", LOG: "log", EVENTS: "events" };
const TASK_COLS = ["id", "title", "owner", "owner_user_id", "requested_by", "due", "due_time", "status", "source", "source_ref", "snippet", "created_at", "updated_at", "completed_at"];
const TEAM_COLS = ["name", "user_id", "role", "active", "daily_report", "email"];
const REPORT_COLS = ["date", "name", "user_id", "text", "received_at"];
const STATE_COLS = ["key", "value"];
const LOG_COLS = ["at", "type", "detail"];
const EVENT_COLS = ["id", "title", "date", "start_time", "end_time", "location", "description", "deleted", "created_at", "updated_at"];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet(ss, SHEETS.TASKS, TASK_COLS);
  ensureSheet(ss, SHEETS.TEAM, TEAM_COLS);
  ensureSheet(ss, SHEETS.REPORTS, REPORT_COLS);
  ensureSheet(ss, SHEETS.STATE, STATE_COLS);
  ensureSheet(ss, SHEETS.LOG, LOG_COLS);
  ensureSheet(ss, SHEETS.EVENTS, EVENT_COLS);
  Logger.log("Setup complete!");
  return "Setup complete";
}

/** 매시간 /api/tick 호출 트리거 설치 (한 번만 실행) */
function installTriggers() {
  if (!TICK_URL) throw new Error("TICK_URL 을 먼저 채우세요");
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "tick") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("tick").timeBased().everyHours(1).create();
  Logger.log("매시간 tick 트리거 설치됨");
  return tick();
}

function tick() {
  if (!TICK_URL) return "TICK_URL 비어 있음";
  const r = UrlFetchApp.fetch(TICK_URL, { muteHttpExceptions: true, followRedirects: true });
  Logger.log(r.getResponseCode() + " " + r.getContentText().slice(0, 300));
  return r.getContentText();
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  // 머리글은 항상 다시 써서 새 열(email 등)이 추가돼도 맞춰진다. 열 순서는 바뀌지 않는다.
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  let body = {};
  try {
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    else if (e && e.parameter) body = e.parameter;
  } catch (err) { return json({ ok: false, error: "bad json" }); }
  const action = body.action || "ping";
  if (action !== "ping" && body.token !== API_TOKEN) return json({ ok: false, error: "token" });
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const data = route(action, body);
    return json({ ok: true, data: data });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally { try { lock.releaseLock(); } catch (_) {} }
}

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function route(action, b) {
  switch (action) {
    case "ping": return { pong: true, at: new Date().toISOString() };
    case "list_tasks": return listTasks(b);
    case "add_tasks": return addTasks(b.tasks || []);
    case "update_task": return updateTask(b.id, b.patch || {});
    case "list_team": return readRows(SHEETS.TEAM, TEAM_COLS);
    case "upsert_team": return upsertTeam(b.member || {});
    case "get_state": return getState(b.keys || []);
    case "set_state": return setState(b.values || {});
    case "add_report": return addReport(b.report || {});
    case "list_reports": return listReports(b);
    case "log": { appendRow(SHEETS.LOG, LOG_COLS, { at: new Date().toISOString(), type: b.type, detail: b.detail }); return true; }
    case "list_events": return listEvents(b);
    case "add_event": return addEvent(b.event || {});
    case "update_event": return updateEvent(b.id, b.patch || {});
    default: throw new Error("unknown action: " + action);
  }
}

// ── 공통 ──
function sheet(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function readRows(name, cols) {
  const sh = sheet(name); if (!sh) return [];
  const last = sh.getLastRow(); if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return vals.filter(function (r) { return String(r[0]) !== ""; }).map(function (r) {
    const o = {}; cols.forEach(function (c, i) { o[c] = cell(r[i]); }); return o;
  });
}
function cell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "Asia/Seoul", "yyyy-MM-dd");
  return v === null || v === undefined ? "" : v;
}
function appendRow(name, cols, obj) {
  const sh = sheet(name);
  sh.appendRow(cols.map(function (c) { return obj[c] === undefined || obj[c] === null ? "" : obj[c]; }));
}

// ── tasks ──
function listTasks(b) {
  let rows = readRows(SHEETS.TASKS, TASK_COLS).map(function (t) { t.id = Number(t.id); return t; });
  if (b.status) rows = rows.filter(function (t) { return t.status === b.status; });
  if (b.owner) rows = rows.filter(function (t) { return t.owner === b.owner; });
  return rows;
}
function addTasks(tasks) {
  const sh = sheet(SHEETS.TASKS);
  const last = sh.getLastRow();
  let maxId = 0;
  if (last >= 2) { const ids = sh.getRange(2, 1, last - 1, 1).getValues(); ids.forEach(function (r) { const n = Number(r[0]); if (n > maxId) maxId = n; }); }
  const now = new Date().toISOString();
  const out = [];
  const rows = tasks.map(function (t) {
    const o = { id: ++maxId, title: t.title || "", owner: t.owner || "", owner_user_id: t.owner_user_id || "", requested_by: t.requested_by || "", due: t.due || "", due_time: t.due_time || "", status: t.status || "후보", source: t.source || "직접", source_ref: t.source_ref || "", snippet: t.snippet || "", created_at: now, updated_at: now, completed_at: "" };
    out.push(o);
    return TASK_COLS.map(function (c) { return o[c]; });
  });
  if (rows.length) {
    const range = sh.getRange(last + 1, 1, rows.length, TASK_COLS.length);
    range.setValues(rows);
    range.setNumberFormat("@"); // 날짜가 시트에서 자동 변환되지 않게 문자열로
  }
  return out;
}
function updateTask(id, patch) {
  const sh = sheet(SHEETS.TASKS);
  const last = sh.getLastRow();
  if (last < 2) throw new Error("task " + id + " 없음");
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (Number(ids[i][0]) === Number(id)) {
      const row = i + 2;
      const cur = sh.getRange(row, 1, 1, TASK_COLS.length).getValues()[0];
      const o = {}; TASK_COLS.forEach(function (c, j) { o[c] = cell(cur[j]); });
      Object.keys(patch).forEach(function (k) { if (TASK_COLS.indexOf(k) >= 0 && k !== "id") o[k] = patch[k]; });
      o.updated_at = new Date().toISOString();
      const range = sh.getRange(row, 1, 1, TASK_COLS.length);
      range.setNumberFormat("@");
      range.setValues([TASK_COLS.map(function (c) { return o[c]; })]);
      o.id = Number(o.id);
      return o;
    }
  }
  throw new Error("task " + id + " 없음");
}

// ── team ──
function upsertTeam(m) {
  const sh = sheet(SHEETS.TEAM);
  const rows = readRows(SHEETS.TEAM, TEAM_COLS);
  let idx = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((m.user_id && rows[i].user_id === m.user_id) || (rows[i].name === m.name)) { idx = i; break; }
  }
  const merged = { name: "", user_id: "", role: "", active: "Y", daily_report: "Y", email: "" };
  if (idx >= 0) Object.keys(rows[idx]).forEach(function (k) { merged[k] = rows[idx][k]; });
  Object.keys(m).forEach(function (k) { if (TEAM_COLS.indexOf(k) >= 0 && m[k] !== undefined && m[k] !== null) merged[k] = m[k]; });
  const vals = [TEAM_COLS.map(function (c) { return merged[c]; })];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, TEAM_COLS.length).setValues(vals); else sh.appendRow(vals[0]);
  return merged;
}

// ── state ──
function getState(keys) {
  const rows = readRows(SHEETS.STATE, STATE_COLS);
  const o = {};
  keys.forEach(function (k) { o[k] = ""; });
  rows.forEach(function (r) { if (keys.indexOf(r.key) >= 0) o[r.key] = String(r.value); });
  return o;
}
function setState(values) {
  const sh = sheet(SHEETS.STATE);
  const rows = readRows(SHEETS.STATE, STATE_COLS);
  Object.keys(values).forEach(function (k) {
    let found = -1;
    for (let i = 0; i < rows.length; i++) if (rows[i].key === k) { found = i; break; }
    if (found >= 0) sh.getRange(found + 2, 2).setValue(String(values[k]));
    else { sh.appendRow([k, String(values[k])]); rows.push({ key: k, value: String(values[k]) }); }
  });
  return values;
}

// ── reports ──
function addReport(r) {
  appendRow(SHEETS.REPORTS, REPORT_COLS, { date: r.date, name: r.name, user_id: r.user_id, text: r.text, received_at: new Date().toISOString() });
  return r;
}
function listReports(b) {
  let rows = readRows(SHEETS.REPORTS, REPORT_COLS);
  if (b.date) rows = rows.filter(function (r) { return r.date === b.date; });
  if (b.since) rows = rows.filter(function (r) { return r.date >= b.since; });
  return rows;
}

// ── events (나만의 달력) ──
function listEvents(b) {
  ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.EVENTS, EVENT_COLS);
  let rows = readRows(SHEETS.EVENTS, EVENT_COLS).map(function (e) { e.id = Number(e.id); e.date = String(e.date).slice(0, 10); return e; });
  rows = rows.filter(function (e) { return e.deleted !== "Y"; });
  if (b.start) rows = rows.filter(function (e) { return e.date >= b.start; });
  if (b.end) rows = rows.filter(function (e) { return e.date <= b.end; });
  return rows;
}
function addEvent(ev) {
  const sh = ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.EVENTS, EVENT_COLS);
  const last = sh.getLastRow();
  let maxId = 0;
  if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { const n = Number(r[0]); if (n > maxId) maxId = n; });
  const now = new Date().toISOString();
  const o = { id: maxId + 1, title: ev.title || "", date: String(ev.date || "").slice(0, 10), start_time: ev.start_time || "", end_time: ev.end_time || "", location: ev.location || "", description: ev.description || "", deleted: "", created_at: now, updated_at: now };
  const range = sh.getRange(last + 1, 1, 1, EVENT_COLS.length);
  range.setNumberFormat("@");
  range.setValues([EVENT_COLS.map(function (c) { return o[c]; })]);
  return o;
}
function updateEvent(id, patch) {
  const sh = ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.EVENTS, EVENT_COLS);
  const last = sh.getLastRow();
  if (last < 2) throw new Error("event " + id + " 없음");
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (Number(ids[i][0]) === Number(id)) {
      const row = i + 2;
      const cur = sh.getRange(row, 1, 1, EVENT_COLS.length).getValues()[0];
      const o = {}; EVENT_COLS.forEach(function (c, j) { o[c] = cell(cur[j]); });
      Object.keys(patch).forEach(function (k) { if (EVENT_COLS.indexOf(k) >= 0 && k !== "id") o[k] = patch[k]; });
      o.updated_at = new Date().toISOString();
      const range = sh.getRange(row, 1, 1, EVENT_COLS.length);
      range.setNumberFormat("@");
      range.setValues([EVENT_COLS.map(function (c) { return o[c]; })]);
      o.id = Number(o.id); o.date = String(o.date).slice(0, 10);
      return o;
    }
  }
  throw new Error("event " + id + " 없음");
}
