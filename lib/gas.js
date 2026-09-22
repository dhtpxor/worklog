// lib/gas.js — 구글 시트(Apps Script 웹 앱) 클라이언트. 시트가 곧 데이터베이스다.
import { env } from "./env.js";

export class GasClient {
  constructor({ url = env.GAS_URL, token = env.GAS_TOKEN, fetchImpl = globalThis.fetch, timeoutMs = 25000 } = {}) {
    this.url = url; this.token = token; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  get enabled() { return Boolean(this.url); }

  async call(action, payload = {}) {
    if (!this.url) throw new Error("GAS_URL 이 비어 있습니다 (Vercel 환경변수)");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(this.url, {
        method: "POST", redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, token: this.token, ...payload }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === "AbortError" ? "구글 시트 응답 없음(타임아웃)" : `구글 시트 연결 실패: ${e.message}`);
    }
    clearTimeout(timer);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`구글 시트 응답이 JSON이 아닙니다 (HTTP ${res.status}): ${text.slice(0, 120)}`); }
    if (!json.ok) throw new Error(`구글 시트 오류: ${json.error || "unknown"}`);
    return json.data;
  }

  ping() { return this.call("ping"); }
  listTasks({ status, owner } = {}) { return this.call("list_tasks", { status, owner }); }
  addTasks(tasks) { return this.call("add_tasks", { tasks }); }
  updateTask(id, patch) { return this.call("update_task", { id, patch }); }
  listTeam() { return this.call("list_team"); }
  upsertTeam(member) { return this.call("upsert_team", { member }); }
  getState(keys) { return this.call("get_state", { keys }); }
  setState(values) { return this.call("set_state", { values }); }
  addReport(report) { return this.call("add_report", { report }); }
  listReports({ date, since } = {}) { return this.call("list_reports", { date, since }); }
  log(type, detail) { return this.call("log", { type, detail: String(detail).slice(0, 500) }).catch(() => {}); }
  listEvents({ start, end } = {}) { return this.call("list_events", { start, end }); }
  addEvent(event) { return this.call("add_event", { event }); }
  updateEvent(id, patch) { return this.call("update_event", { id, patch }); }
}

/** 테스트용: 메모리 안에서 동작하는 가짜 시트 */
export class MemoryGas {
  constructor() { this.tasks = []; this.team = []; this.state = {}; this.reports = []; this.logs = []; this.events = []; this.nextId = 1; this.nextEv = 1; }
  get enabled() { return true; }
  async ping() { return { ok: true }; }
  async listTasks({ status, owner } = {}) {
    return this.tasks.filter((t) => (!status || t.status === status) && (!owner || t.owner === owner)).map((t) => ({ ...t }));
  }
  async addTasks(tasks) {
    const now = new Date().toISOString();
    const added = tasks.map((t) => ({ status: "후보", due: "", due_time: "", owner: "", owner_user_id: "", requested_by: "", source: "직접", source_ref: "", snippet: "", ...t, id: this.nextId++, created_at: now, updated_at: now, completed_at: "" }));
    this.tasks.push(...added);
    return added.map((t) => ({ ...t }));
  }
  async updateTask(id, patch) {
    const t = this.tasks.find((x) => x.id === +id);
    if (!t) throw new Error(`구글 시트 오류: task ${id} 없음`);
    Object.assign(t, patch, { updated_at: new Date().toISOString() });
    return { ...t };
  }
  async listTeam() { return this.team.map((m) => ({ ...m })); }
  async upsertTeam(member) {
    const i = this.team.findIndex((m) => (member.user_id && m.user_id === member.user_id) || m.name === member.name);
    if (i >= 0) Object.assign(this.team[i], member); else this.team.push({ active: "Y", daily_report: "Y", role: "", email: "", user_id: "", ...member });
    return { ...this.team[i >= 0 ? i : this.team.length - 1] };
  }
  async getState(keys) { const o = {}; for (const k of keys) o[k] = this.state[k] ?? ""; return o; }
  async setState(values) { Object.assign(this.state, values); return values; }
  async addReport(r) { this.reports.push({ received_at: new Date().toISOString(), ...r }); return r; }
  async listReports({ date, since } = {}) { return this.reports.filter((r) => (!date || r.date === date) && (!since || r.date >= since)); }
  async log(type, detail) { this.logs.push({ type, detail }); }
  async listEvents({ start, end } = {}) { return this.events.filter((e) => e.deleted !== "Y" && (!start || e.date >= start) && (!end || e.date <= end)).map((e) => ({ ...e })); }
  async addEvent(event) { const now = new Date().toISOString(); const e = { id: this.nextEv++, title: "", date: "", start_time: "", end_time: "", location: "", description: "", deleted: "", ...event, created_at: now, updated_at: now }; this.events.push(e); return { ...e }; }
  async updateEvent(id, patch) { const e = this.events.find((x) => x.id === +id); if (!e) throw new Error(`구글 시트 오류: event ${id} 없음`); Object.assign(e, patch, { updated_at: new Date().toISOString() }); return { ...e }; }
}
