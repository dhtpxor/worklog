// lib/calendar.js — 나만의 달력 (구글 시트 events 탭에 저장). 조회·등록·수정·삭제 + iCal 구독 피드
import crypto from "node:crypto";
import { addDays, shortDate } from "./dates.js";

export class SheetCalendar {
  constructor({ gas }) { this.gas = gas; }
  get enabled() { return Boolean(this.gas?.enabled); }

  /** start~end (YYYY-MM-DD, 양끝 포함) 일정. 시간순 정렬 */
  async listEvents({ start, end }) {
    const rows = await this.gas.listEvents({ start, end: end || start });
    return rows.map(norm).sort(byStart);
  }
  /** date: YYYY-MM-DD, startTime/endTime: HH:MM (없으면 종일). 끝 시간 없으면 1시간 */
  async createEvent({ title, date, startTime = "", endTime = "", location = "", description = "" }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("날짜는 YYYY-MM-DD");
    if (startTime && !endTime) endTime = plusHour(startTime);
    const e = await this.gas.addEvent({ title: String(title || "").trim() || "(제목 없음)", date, start_time: startTime, end_time: endTime, location, description });
    return { ok: true, ...norm(e) };
  }
  async updateEvent(id, patch) { const p = { ...patch }; if (p.startTime !== undefined) { p.start_time = p.startTime; delete p.startTime; } if (p.endTime !== undefined) { p.end_time = p.endTime; delete p.endTime; } return norm(await this.gas.updateEvent(+id, p)); }
  async deleteEvent(id) { await this.gas.updateEvent(+id, { deleted: "Y" }); return true; }
}

function plusHour(t) { const [h, m] = t.split(":").map(Number); return `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }
function norm(e) {
  const time = String(e.start_time || ""); const endTime = String(e.end_time || "");
  return { id: e.id, title: e.title || "", date: String(e.date || "").slice(0, 10), time, endTime, allDay: !time, location: e.location || "", description: e.description || "" };
}
function byStart(a, b) { return (a.date + (a.time || "00:00")) < (b.date + (b.time || "00:00")) ? -1 : 1; }

/** 브리핑용 한 줄 표시 */
export function formatEvents(events, { emptyText = "일정 없음" } = {}) {
  if (!events?.length) return emptyText;
  return events.map((e) => ` ${e.allDay ? "종일" : e.time + (e.endTime ? "~" + e.endTime : "")} ${e.title}${e.location ? ` @${e.location}` : ""}`).join("\n");
}

/** 폰 캘린더 구독용 iCal 피드 */
export function buildIcsFeed(events, { name = "업무 비서" } = {}) {
  const esc = (x) => String(x || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\;");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//worklog//업무 비서//KO", `X-WR-CALNAME:${esc(name)}`, "X-WR-TIMEZONE:Asia/Seoul"];
  for (const e of events) {
    const d = e.date.replace(/-/g, "");
    const dt = e.allDay ? `DTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, "")}` : `DTSTART;TZID=Asia/Seoul:${d}T${e.time.replace(":", "")}00\r\nDTEND;TZID=Asia/Seoul:${d}T${(e.endTime || plusHour(e.time)).replace(":", "")}00`;
    lines.push("BEGIN:VEVENT", `UID:worklog-${e.id || crypto.randomUUID()}@worklog`, `DTSTAMP:${stamp}`, dt, `SUMMARY:${esc(e.title)}`, e.location ? `LOCATION:${esc(e.location)}` : "", e.description ? `DESCRIPTION:${esc(e.description)}` : "", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).join("\r\n") + "\r\n";
}

export function describeEvent(e, today) { return `${shortDate(e.date, today)} ${e.allDay ? "종일" : e.time + (e.endTime ? "~" + e.endTime : "")} ${e.title}${e.location ? ` @${e.location}` : ""}`; }

/** 테스트용 (시트 없이) */
export class MemoryCalendar {
  constructor(events = []) { this.events = events.map((e, i) => ({ id: i + 1, allDay: !e.time, endTime: "", location: "", ...e })); this.created = []; this.next = this.events.length + 1; }
  get enabled() { return true; }
  async listEvents({ start, end }) { return this.events.filter((e) => e.date >= start && e.date <= (end || start)).sort(byStart); }
  async createEvent(p) { const e = { id: this.next++, title: p.title, date: p.date, time: p.startTime || "", endTime: p.endTime || (p.startTime ? plusHour(p.startTime) : ""), allDay: !p.startTime, location: p.location || "", description: p.description || "" }; this.created.push(e); this.events.push(e); return { ok: true, ...e }; }
  async updateEvent(id, patch) { const e = this.events.find((x) => x.id === +id); if (!e) throw new Error("없음"); Object.assign(e, patch); if (patch.startTime !== undefined) { e.time = patch.startTime; e.allDay = !patch.startTime; } if (patch.endTime !== undefined) e.endTime = patch.endTime; return e; }
  async deleteEvent(id) { this.events = this.events.filter((x) => x.id !== +id); return true; }
}
