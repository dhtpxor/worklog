# TrueUnit API

모든 요청과 응답은 JSON 입니다. 인증은 `Authorization: Bearer <키>` 헤더로 합니다.
오류 응답은 `{ "error": { "code": "...", "message": "..." } }` 형태입니다.

| 키 접두어 | 역할 | 쓰는 곳 |
|---|---|---|
| `tu_p_` | platform | 플랫폼 서버 → 거래 건, 보증, 개체 지문 |
| `tu_i_` | inspector | 검수 콘솔 → 대기열, 판정, 청구 처리 |
| `tu_a_` | admin | 모든 기능 + 지표, 설정, 이벤트 |

## 거래 건

### `POST /v1/cases` (platform)
```json
{
  "category": "sneakers",
  "brand": "Nike",
  "model_hint": "Dunk Low Panda",
  "external_ref": "order-123",
  "listing": { "price": 139000, "market_price": 159000, "title": "...", "url": "https://..." },
  "seller": { "id": "u_42", "account_age_days": 420, "completed_sales": 31, "past_disputes": 0, "confirmed_counterfeits": 0 }
}
```
응답 201: 거래 건 + `capture_url`. `category` 는 `sneakers` 또는 `handbags`. `market_price` 가 없으면 같은 모델의 과거 진품 거래 중앙값(5건 이상)을 씁니다.

### `POST /v1/cases/:id/images` (platform)
판매자 링크 대신 플랫폼이 직접 사진을 올릴 때 씁니다.
```json
{ "checkpoint": "size_tag", "image_base64": "<JPEG 또는 PNG, data URL 도 가능>" }
```
응답: `{ image: { id, checkpoint, quality: { ok, score, issues[] } }, guide }`. `quality.ok` 가 false 면 다시 찍어야 합니다. 체크포인트 목록은 `GET /v1/catalog`.

### `POST /v1/cases/:id/submit` (platform)
AI 분석과 위험 점수를 계산합니다. 응답의 `status` 는 `passed`(자동 통과) 또는 `in_review`(검수 대기).
```json
"assessment": {
  "score": 72, "band": "high", "recommendation": "escalate_priority",
  "ai_assessed": true, "complete": true, "missing_checkpoints": [], "hard_flags": ["price_far_below_market"],
  "evidence": [{ "code": "ai_major", "points": 31.7, "message": "사이즈 태그(안쪽) — 큰 이상: ...", "checkpoint": "size_tag" }],
  "recapture": [{ "checkpoint_id": "box_label", "instruction": "..." }]
}
```
`recommendation`: `pass` | `escalate` | `escalate_priority`. 가품 확정은 검수사 판정(`verdict`)으로만 나옵니다.

### `GET /v1/cases/:id`, `GET /v1/cases?status=in_review&limit=50` (platform, inspector)

## 판매자 촬영 링크 (인증 없음, 링크 토큰이 권한)
- `GET /capture/:token` — 모바일 촬영 페이지
- `GET /v1/capture/:token` — 체크포인트와 업로드 현황
- `POST /v1/capture/:token/images` — 위와 같은 본문
- `POST /v1/capture/:token/submit` — 제출. 판매자에게는 점수를 돌려주지 않습니다

## 검수 (inspector)
- `GET /v1/queue` — 우선 검수 → 점수 높은 순 → 오래된 순
- `GET /v1/review/cases/:id` — 사진 목록, AI 부위별 관찰, 판매자 정보 포함
- `GET /v1/images/:id` — 이미지 원본
- `POST /v1/review/cases/:id/verdict`
```json
{ "verdict": "counterfeit", "flagged_checkpoints": ["size_tag"], "note": "...", "inspector_name": "김검수" }
```
`verdict`: `authentic` | `counterfeit` | `inconclusive`. 가품 판정에는 근거 부위가 하나 이상 필요합니다.

## 보증
- `POST /v1/cases/:id/guarantee/quote` (platform) → `{ eligible, reasons[], rate_bps, fee_krw, coverage_krw, basis }`
- `POST /v1/cases/:id/guarantee` (platform) `{ "payer": "buyer" | "platform", "expected_fee_krw": 2224 }` → 보증. 견적 이후 금액이 바뀌었으면 409
- `GET /v1/guarantees` (platform, inspector)
- `POST /v1/guarantees/:id/claims` (platform) `{ "reason": "..." }` → 재검수 상태의 청구
- `GET /v1/claims`, `POST /v1/claims/:id/resolve` (inspector) `{ "outcome": "counterfeit_confirmed" | "not_confirmed", "note": "..." }`

보증 조건(기본값): 카테고리 활성, 위험 점수 25 미만, 필수 부위 완비, AI 분석 완료, 강한 위험 신호 없음, 카테고리 한도 이하. 검수사가 진품으로 판정한 건은 점수와 관계없이 할인 요율(×0.7)로 보증할 수 있습니다. 손해율이 기준(기본 50%, 발행 30건 이상)을 넘으면 그 카테고리 보증이 자동 중단됩니다.

## 개체 지문 (UnitPrint)
- `POST /v1/units` (platform)
```json
{ "sku": "DD1391-100", "spot": "왼쪽 옆면 로고 아래 3cm", "source": "outbound", "case_id": "case_…", "image_base64": "..." }
```
표면 무늬가 보이는 같은 부위를 가까이 찍어야 합니다. 무늬가 거의 없거나 흐리면 422.
- `POST /v1/units/:id/verify` (platform, 등록한 플랫폼이 아니어도 가능) `{ "purpose": "return" | "resale" | "claim", "image_base64": "..." }` → `{ match, score, threshold, previously_verified_authentic }`

## 관리 (admin)
- `GET /v1/metrics`, `GET /v1/settings`, `PATCH /v1/settings`, `GET /v1/events`

## 웹훅
설정의 `webhook.url` 로 이벤트를 POST 합니다. 이벤트: `case.assessed`, `case.verdict`, `guarantee.issued`, `claim.opened`, `claim.resolved`, `guarantee.category_suspended`, `unit.checked`.

헤더 `X-TrueUnit-Signature: t=<unix초>,v1=<hex>` 의 `v1` 은 `HMAC-SHA256(secret, "<t>.<본문>")` 입니다. 5분 넘은 서명은 거절하세요. 검증 예시는 `src/webhooks.js` 의 `verifySignature`.
