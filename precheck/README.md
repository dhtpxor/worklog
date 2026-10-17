# 구매대행 사전 검사 (precheck)

해외 상품을 쇼핑몰에 올리기 **전에** 상표권·KC 인증·식품/의약품·통관 반입 제한 위험을 자동으로 걸러 주는 서비스입니다.
otorimall 같은 구매대행몰의 상품 등록 단계에 붙이는 것을 전제로 만들었고, 어떤 언어로 만든 쇼핑몰이든 HTTP 로 호출할 수 있습니다.

## 무엇을 검사하나

| 영역 | 예 | 결과 |
|---|---|---|
| 상표 모방 | "샤넬st", "耐克同款", "高仿", "미러급", "スーパーコピー" + 상표명 | 판매 불가 |
| 상표·캐릭터 언급 | 나이키, 산리오, 포켓몬, 라부부 등 | 확인 필요 (정품 증빙 또는 라이선스) |
| 호환 표기 | "아이폰 호환 케이스", "iPhone 対応" | 안내 |
| KC 인증 | 전기용품, 무선기기, 어린이제품 | 확인 필요 + 구매대행 표시 의무 안내 |
| 식품·건강기능식품 | 비타민, 青汁, サプリ | 구매대행업 미등록이면 판매 불가 |
| 반입 차단·의약품 성분 | 멜라토닌, 요힘빈, 시부트라민, 第2類医薬品 | 판매 불가 |
| 통관 반입 제한 | 씨앗, 육포, CBD, 폭죽 | 판매 불가 |
| 상품 페이지 | 원 판매처 워터마크 (AI 사용 시) | 확인 필요 |

검사는 두 단계입니다.
1. **키워드 규칙**: 한국어·중국어(간체/번체)·일본어·영어 표현을 정규화해 찾습니다. 키 없이 항상 동작합니다.
2. **Claude 분석 (선택)**: `ANTHROPIC_API_KEY` 가 있으면 상품 이미지 속 로고·캐릭터, 사전에 없는 상표, 다국어 상품 분류를 보완합니다. 텍스트만으로 이미 판매 불가면 비용을 아끼려고 건너뜁니다.

결론(판매 불가/확인 필요/문제 없음)은 AI 가 아니라 규칙이 냅니다. 모든 결과에 걸린 문구(근거)와 법령 이름이 붙습니다.

## 실행

```bash
cd precheck
npm install
PRECHECK_API_KEY=길고-무작위인-키 npm start      # http://localhost:8790
```

- 브라우저로 `http://localhost:8790` 을 열면 상품 하나를 손으로 검사하는 화면이 나옵니다.
- Docker: `docker build -t precheck . && docker run -p 8790:8790 -e PRECHECK_API_KEY=... precheck`
- 환경변수는 `.env.example` 참고. 식품 구매대행업 등록을 마쳤다면 `FOOD_AGENCY_REGISTERED=true`.

## 쇼핑몰에 붙이는 방법

상품 등록(또는 수집) 직후, 공개하기 전에 쇼핑몰 **서버**에서 호출합니다. 브라우저에서 직접 부르면 API 키가 노출됩니다.

```bash
curl -X POST http://precheck:8790/v1/precheck \
  -H "authorization: Bearer $PRECHECK_API_KEY" -H "content-type: application/json" \
  -d '{"product":{"id":"SKU-123","title":"耐克同款 运动鞋","description":"...","source_country":"CN",
       "options":["黑色 42码"],"image_urls":["https://img.alicdn.com/....jpg"]}}'
```

응답의 `verdict` 로 분기합니다.

| verdict | 쇼핑몰에서 할 일 |
|---|---|
| `block` | 공개하지 않음. `checks[].action` 을 관리자 화면에 표시 |
| `review` | "검수 대기"로 두고 사람이 확인 후 공개 |
| `ok` | 공개 |

```js
// Node 예시 (쇼핑몰 서버)
const r = await fetch(`${PRECHECK_URL}/v1/precheck`, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.PRECHECK_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ product: { id: sku, title, description, source_country: "CN", image_urls } }),
}).then((res) => res.json());
if (r.verdict === "block") await hideProduct(sku, r.checks);
else if (r.verdict === "review") await holdForReview(sku, r.checks);
else await publish(sku);
```

여러 상품은 `POST /v1/precheck/batch` 에 `{"products":[...]}` (최대 20개). 규칙 목록은 `GET /v1/rules`.
KC 대상 가능성이 있으면 `required_notices` 에 상품 페이지 표시 의무 안내가 담깁니다.

## 한계 (꼭 읽어 주세요)

- **판매 가능을 보장하지 않습니다.** 사람이 놓치기 쉬운 것을 먼저 걸러 주는 도구입니다.
- **상표 사전은 일부입니다.** 30여 개 브랜드·캐릭터만 담았습니다. 사전에 없는 상표는 AI 가 짚을 때만 잡히고, 최종 확인은 키프리스에서 해야 합니다. 키프리스 API 연동은 명세를 확인하지 못해 넣지 않았습니다.
- **규칙마다 근거 수준이 다릅니다.** `confidence` 가 `official` 인 규칙(전안법 구매대행 고지, 식품 구매대행업 등록)은 정부 기관 안내로 확인했습니다. 나머지는 업계 안내 수준이거나(`industry`) 확인이 더 필요합니다(`unverified`). 결과에 "확인 필요 규칙"으로 표시됩니다.
- **KC 판단은 "대상일 가능성"까지만 합니다.** KC 없이 구매대행이 안 되는 품목 목록 원문을 확보하지 못했습니다. 품목별 판단은 국가기술표준원 제품안전정보센터에서 하세요.
- **반입 차단 성분은 대표 성분만 넣었습니다.** 식약처 공공데이터 "해외직구식품 국내 반입차단 대상 원료성분" API(무료)로 바꾸는 것이 다음 단계입니다.
- **키워드 오탐**: 흔한 표현과 겹치는 별칭은 일부러 뺐습니다(예: supreme, 애플, 어그, 베이비). 그래도 오탐·누락이 생길 수 있으니 실제 상품으로 돌려 보며 `src/rules/` 를 고치세요.

## 근거 자료
- 전안법 구매대행 표시: 국가기술표준원 https://www.kats.go.kr/content.do?cmsid=227
- 수입식품등 인터넷 구매대행업: 식약처 https://www.mfds.go.kr/brd/m_857/view.do?seq=30357
- 해외직구 위해식품 차단목록: 식품안전나라 https://www.foodsafetykorea.go.kr/portal/fooddanger/foodDirectImportView.do
- 반입차단 원료성분 API: 공공데이터포털 https://www.data.go.kr/data/15132686/openapi.do
