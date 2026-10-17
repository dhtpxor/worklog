// scripts/seed.js — 새 테넌트(플랫폼)와 키 발급: node scripts/seed.js "플랫폼 이름"
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import { createTenant, issueKey } from "../src/auth.js";

const cfg = loadConfig();
const store = new Store({ dir: cfg.DATA_DIR });
const t = createTenant(store, { name: process.argv[2] || "new-platform" });
console.log(`tenant ${t.id} (${t.name})`);
for (const role of ["platform", "inspector", "admin"]) console.log(`  ${role.padEnd(9)} ${issueKey(store, { tenantId: t.id, role, label: "seed" }).key}`);
await store.flush();
