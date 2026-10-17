// server.js — 실행 진입점. 첫 실행이면 데모 테넌트와 키를 만들어 콘솔에 한 번 출력한다.
import http from "node:http";
import { loadConfig } from "./src/config.js";
import { Store } from "./src/store.js";
import { createHandler } from "./src/app.js";
import { createTenant, issueKey } from "./src/auth.js";

const cfg = loadConfig();
const store = new Store({ dir: cfg.DATA_DIR });

if (!store.list("tenants").length) {
  const t = createTenant(store, { name: "demo-platform" });
  const keys = ["platform", "inspector", "admin"].map((role) => [role, issueKey(store, { tenantId: t.id, role, label: "bootstrap" }).key]);
  console.log("\n[TrueUnit] 첫 실행: 데모 테넌트와 API 키를 만들었습니다. 다시 보여 주지 않으니 지금 보관하세요.");
  for (const [role, key] of keys) console.log(`  ${role.padEnd(9)} ${key}`);
  console.log("");
}
if (!cfg.ANTHROPIC_API_KEY) console.log("[TrueUnit] ANTHROPIC_API_KEY 가 없어 AI 분석 없이 동작합니다. 모든 건이 사람 검수로 갑니다.");

const server = http.createServer(createHandler({ cfg, store }));
server.listen(cfg.PORT, () => console.log(`[TrueUnit] http://localhost:${cfg.PORT}  (검수 콘솔: /console)`));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    server.close();
    await store.flush();
    process.exit(0);
  });
}
