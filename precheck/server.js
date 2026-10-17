import http from "node:http";
import { loadConfig } from "./src/config.js";
import { createHandler } from "./src/app.js";

const cfg = loadConfig();
if (!cfg.PRECHECK_API_KEY) console.warn("[precheck] PRECHECK_API_KEY 가 없어 API 가 모든 요청을 거절합니다. 환경변수로 설정하세요.");
if (!cfg.ANTHROPIC_API_KEY) console.warn("[precheck] ANTHROPIC_API_KEY 가 없어 키워드 규칙만으로 검사합니다 (이미지·다국어 분류 없음).");
console.log(`[precheck] 식품 인터넷 구매대행업 등록: ${cfg.FOOD_AGENCY_REGISTERED ? "예" : "아니오"}`);
http.createServer(createHandler({ cfg })).listen(cfg.PORT, () => console.log(`[precheck] http://localhost:${cfg.PORT}`));
