// src/store.js — 단일 프로세스용 JSON 파일 저장소 (MVP).
// 모든 컬렉션을 메모리에 두고, 변경 시 임시 파일에 쓴 뒤 rename 으로 원자적 교체한다.
// 다중 인스턴스 운영 시에는 같은 인터페이스로 Postgres 어댑터를 붙인다 (README 참고).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const COLLECTIONS = ["tenants", "api_keys", "cases", "images", "verdicts", "guarantees", "claims", "units", "unit_checks", "events", "webhook_deliveries"];

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export class Store {
  /** @param {{dir?: string|null}} opts dir 가 없으면 메모리 전용 (테스트) */
  constructor({ dir = null } = {}) {
    this.dir = dir;
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
    this._timer = null;
    this._writing = Promise.resolve();
    if (dir) {
      fs.mkdirSync(path.join(dir, "images"), { recursive: true });
      const file = path.join(dir, "db.json");
      if (fs.existsSync(file)) {
        const loaded = JSON.parse(fs.readFileSync(file, "utf8"));
        for (const c of COLLECTIONS) this.data[c] = loaded[c] || {};
      }
    }
    this.blobs = new Map(); // 메모리 모드용 이미지 바이트
  }

  insert(coll, doc) {
    if (!doc.id) throw new Error("id required");
    if (this.data[coll][doc.id]) throw new Error(`duplicate id ${doc.id}`);
    this.data[coll][doc.id] = doc;
    this._scheduleSave();
    return doc;
  }

  get(coll, id) {
    return this.data[coll][id] || null;
  }

  update(coll, id, patch) {
    const cur = this.data[coll][id];
    if (!cur) throw new Error(`${coll}/${id} not found`);
    const next = { ...cur, ...patch, updated_at: nowIso() };
    this.data[coll][id] = next;
    this._scheduleSave();
    return next;
  }

  /** @param {(doc:any)=>boolean} [pred] */
  list(coll, pred) {
    const all = Object.values(this.data[coll]);
    return pred ? all.filter(pred) : all;
  }

  find(coll, pred) {
    return Object.values(this.data[coll]).find(pred) || null;
  }

  putBlob(id, buf) {
    if (this.dir) fs.writeFileSync(path.join(this.dir, "images", id), buf);
    else this.blobs.set(id, buf);
  }

  getBlob(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    if (this.dir) {
      const p = path.join(this.dir, "images", id);
      return fs.existsSync(p) ? fs.readFileSync(p) : null;
    }
    return this.blobs.get(id) || null;
  }

  _scheduleSave() {
    if (!this.dir || this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._writing = this._writing.then(() => this._saveNow()).catch((e) => console.error("[store] save failed", e));
    }, 50);
  }

  _saveNow() {
    const file = path.join(this.dir, "db.json");
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, file);
  }

  async flush() {
    if (!this.dir) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
      this._writing = this._writing.then(() => this._saveNow());
    }
    await this._writing;
  }
}
