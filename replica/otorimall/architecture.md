# Architecture: 오토리몰 (무신사 핵심 기능의 단일 상점판)

Date: 2026-10-17 · 입력: `replica/recon.md`, `replica/features.csv`, `replica/fixes.md`, 오토리몰 아티팩트(https://claude.ai/artifact/D7KumW8NekMjiWJPCKx118)

## 0. 현재 오토리몰과 적용 범위

**지금 있는 것**: 정적 HTML 한 장(아티팩트). 상품 12개(텀블러·캠핑·반려동물·수납·차량·욕실, 도매매 공급), 카테고리 칩, 상품 상세(이미지·제공고시·배송/반품 안내), localStorage 장바구니, "오픈 준비 중" 주문 차단, 판매자 보기(공급가·이익) 토글. 사업자·통신판매업 미등록. 백엔드 없음. 상세 이미지 일부는 공급처 외부 URL(esmplus) 직링크.

**무신사에서 가져오는 것** (단일 상점에 맞는 핵심 루프만):
- 탐색: 카테고리·검색·정렬·필터, 인기순(판매·조회·후기 가중) 랭킹 — 브랜드/스냅/멀티스토어는 제외
- 상품 상세: 옵션(SKU)·재고, 후기(별점·사진·도움돼요), Q&A, 누적 판매·조회, 좋아요, 재입고 알림, 최근 본 상품
- 구매: 장바구니 → 주문서(배송지·쿠폰·적립금·PG 결제) → 주문 완료 → 주문내역·배송 추적 → 취소·교환·반품
- 회원: 가입/로그인, 배송지, 쿠폰함, 적립금(후기 적립·구매 적립), 단순 등급 2~3단계 (레벨 1~9는 과함)
- 운영(관리자, 단일 판매자): 상품·옵션·재고 등록, 주문 처리·송장 입력, 클레임 승인, 문의 응대, 쿠폰 발행

**entrepreneur 수정 5개를 오토리몰 식으로 번역** (fixes.md 참조):
1. 반품 타임라인 + 환불 예정일 + 검수 SLA 초과 시 자동 적립금; **왕복 반품비를 상품 상세·장바구니·주문서에 금액으로 표시**(지금은 "부담해 주셔야 합니다" 문장뿐)
2. 도착 예정일 약속 + 지연 보상 자동 지급; 송장 등록 후 24시간 미스캔이면 "아직 발송 전" 표시와 취소 허용
3. 문의 티켓 상태(접수/담당/답변)와 예상 답변 시각, 사람 응답 SLA 공개
4. 사이즈 불일치 → 일반 상품에서는 **치수·용량·무게 실측 검증**: 공급처 표기와 실측을 나란히 보여주고, 오차 초과 시 반품비 무료 규칙 자동 적용
5. 적립·쿠폰 규칙 공개 페이지, 변경 시 예고, 쿠폰은 재고 연동, 상품 페이지에 최근 30일 최저가

**제외**: 브랜드·스냅·랭킹 아카이브·레벨 1~9·판매자 센터(멀티 셀러)·무신사페이·라이브·래플·글로벌.

## 1. Stack

| layer | choice | why |
| --- | --- | --- |
| web | Next.js 15 (App Router) + TypeScript | 상품·주문 페이지는 서버 렌더링이 SEO와 PG 콜백 처리에 유리. 사용자 저장소(worklog, teyeon-app)가 이미 Vercel 기반 |
| styling | Tailwind + 디자인 토큰(replica-design 단계) | 현재 오토리몰 팔레트(돌색·먹색·슬레이트, Paperlogy 폰트)를 토큰으로 옮김 |
| database | Postgres on Supabase | 관리형, RLS로 회원 데이터 접근 제어, Storage로 상품 이미지 호스팅(외부 직링크 제거) |
| ORM | Drizzle | 마이그레이션이 SQL 파일로 남아 검토 가능 |
| auth | Supabase Auth (이메일 + 카카오 OAuth) | 한국 소비자 가입 전환율은 카카오 로그인이 좌우. 카카오는 Supabase 기본 provider |
| payments | 토스페이먼츠 결제위젯 (카드·간편결제·계좌이체) | Stripe는 국내 사업자 카드 매입이 안 됨. 토스는 사업자등록 후 계약, 테스트 키로 먼저 개발 |
| email | Resend | 주문·배송·클레임 알림. 알림톡(카카오)은 사업자 등록 후 should |
| 배송 조회 | 스마트택배(sweettracker) 공개 API | 택배사 공통 조회. 도착 예정일·지연 판정의 근거 |
| jobs | Vercel Cron | 배송 추적 갱신, 지연 보상, 적립금 소멸, 30일 최저가 집계, 후기 요청 메일 |
| files | Supabase Storage | 상품 이미지·후기 사진·실측 사진 |
| hosting | Vercel + otorimall.com | 사용자가 도메인을 보유한 것으로 가정(확인 필요) |

하나의 DB, 마이크로서비스 없음. 도매매 공급 정보(공급가·상품번호)는 관리자 전용 테이블로만 둔다.

## 2. Schema

Tables: 32. Access rules: Supabase RLS. `profiles`·`addresses`·`carts`·`orders`·`claims`·`tickets`·`reviews`·`likes`·`restock_alerts`·`user_coupons`·`point_ledger`·`notifications`는 `user_id = auth.uid()`만 읽기/쓰기, 관리자(`profiles.role = 'admin'`)는 전부. `products`·`product_options`·`categories`·`coupons`(공개 쿠폰)·`price_history`·`policy_pages`는 공개 읽기, 관리자만 쓰기. `suppliers`·`supplier_products`·`settlements`는 관리자만. 전체 SQL은 `schema.sql`.

핵심 제약(UI가 아니라 DB가 막아야 하는 것):
- 재고 초과 주문: `product_options.stock` 차감은 `update ... where stock >= qty` 한 문장으로, 0행이면 실패.
- 쿠폰 과발급: `coupons.issued_count < total_qty`를 같은 방식으로, 재고 연동 쿠폰은 `stock_linked_option_id`의 재고 이하로만 발급.
- 결제 중복: `payments.provider_tx_id unique`, 토스 웹훅은 멱등.
- 반송장 기한: `claims.deadline_at` = 접수 + 9일, 크론이 만료 처리.
- 지연 보상 중복: `compensations (order_id, kind) unique`.

## 3. API (route handlers / server actions)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /api/products | 목록·검색·필터·정렬(인기/가격/신상/후기) | 공개 | q, cat, sort, min, max, page | products[] + facets | F01 |
| GET /api/products/[slug] | 상세 + 옵션·재고·실측·후기요약·30일 최저가·반품비 | 공개 | slug | product | F01 F02 |
| POST /api/products/[id]/like | 좋아요 토글 | 회원 | - | liked, count | F06 |
| POST /api/products/[id]/restock-alert | 옵션 재입고 알림 | 회원 | option_id | ok | F06 |
| GET/POST /api/products/[id]/reviews | 후기 목록 / 작성(구매 확인) | 공개 / 구매자 | type, rating, body, photos, measured(json) | review | F04 |
| POST /api/reviews/[id]/helpful | 도움돼요 | 회원 | - | count | F04 |
| GET/POST /api/products/[id]/questions | Q&A | 공개 / 회원 | body | question | - |
| GET/PUT /api/cart | 장바구니 (회원 DB, 비회원 쿠키→로그인 시 병합) | 누구나 | items[] | cart + 반품비·배송비 합계 | F01 |
| POST /api/checkout/quote | 쿠폰·적립금·등급 적용 금액 계산 | 회원 | items, coupon_ids, points | 금액 내역, 도착 예정일 | F01 F05 |
| POST /api/orders | 주문 생성(pending) + 재고 선점 | 회원 | quote 결과, address_id | order_no, amount | F01 |
| POST /api/payments/confirm | 토스 결제 승인 → paid | 회원 | paymentKey, orderId, amount | order | F01 |
| POST /api/webhooks/toss | 결제 상태 웹훅(멱등) | 토스 | event | 200 | F01 |
| GET /api/orders, /[id] | 주문내역·상세·상태 타임라인·도착 예정일 | 본인 | - | orders | F03 |
| POST /api/orders/[id]/cancel | 출고 전 취소 + 재고 복구 + 환불 | 본인 | reason | order | F03 |
| POST /api/orders/[id]/claims | 교환·반품 접수(사유·회수방법·반송장) | 본인 | type, reason, pickup, option_id | claim + 환불 예정일 | F03 fix1 |
| POST /api/claims/[id]/tracking | 반송장 입력 | 본인 | tracking_no | claim | fix1 |
| GET/POST /api/tickets, /[id]/messages | 문의 티켓·메시지(주문 자동 첨부) | 본인 | subject, body, order_id | ticket + 예상 답변 시각 | fix3 |
| GET /api/me, PUT | 프로필·등급·적립금 요약 | 본인 | - | me | S16 |
| GET/POST/PUT/DELETE /api/me/addresses | 배송지 | 본인 | address | - | S11 |
| GET /api/me/coupons, POST /register | 쿠폰함·코드 등록 | 본인 | code | user_coupon | S18 fix5 |
| GET /api/me/points | 적립 내역·소멸 예정 | 본인 | - | ledger | S19 |
| GET /api/me/notifications, PUT read | 알림함 | 본인 | - | - | S25 |
| GET /api/policies/benefits | 적립·쿠폰·등급 공식 공개(변경 예고 포함) | 공개 | - | policy | fix5 |
| **admin** /api/admin/products (CRUD), /options, /images, /measurements | 상품·옵션·실측 등록 | 관리자 | - | - | P02 fix4 |
| /api/admin/orders, /[id]/ship | 주문 목록·송장 입력(→ 추적 시작) | 관리자 | carrier, tracking_no | - | P03 fix2 |
| /api/admin/claims/[id] (approve/reject) | 클레임 처리(거부 시 사진 필수) | 관리자 | decision, photos | - | P03 fix1 |
| /api/admin/tickets/[id]/reply | 문의 답변 | 관리자 | body | - | fix3 |
| /api/admin/coupons | 쿠폰 발행(재고 연동 옵션) | 관리자 | - | - | fix5 |
| /api/admin/policies | 혜택 규칙 수정(예고일 필수) | 관리자 | - | - | fix5 |

Webhooks in: 토스페이먼츠(결제 승인·취소·가상계좌 입금). Webhooks out: 없음.
Jobs (Vercel Cron):
- `track-shipments` 30분: 스마트택배 조회 → `shipments.status/events` 갱신, 송장 등록 24h 미스캔이면 `not_scanned` 표시, 도착 예정일 경과 시 `compensations` 생성 + 적립금 자동 지급(fix2)
- `claim-sla` 1시간: 입고 후 영업일 2일 초과 검수는 자동 적립금(fix1), 반송장 9일 미입력 클레임 만료
- `price-history` 매일 03:00: 옵션별 판매가 스냅샷 → 30일 최저가(fix5)
- `points-expire` 매일: 유효기간 지난 적립금 소멸 + 30일 전 알림
- `review-nudge` 매일: 배송완료 3일 후 후기 요청 알림(실측 제보 포함)
- `ticket-sla` 1시간: 24h 미답변 티켓 관리자 알림(fix3)

## 4. The parts that bite

- **사업자·PG 전제**: 토스 실결제, 알림톡, 통신판매업 표기는 사업자등록 뒤에만 가능. 그 전까지는 테스트 키와 "오픈 준비 중" 플래그로 개발·검증.
- **시간대**: 모든 시각 UTC 저장, 표시는 Asia/Seoul. "영업일" 계산(출고 1~2일, 검수 2일)은 주말·공휴일 테이블 필요.
- **멱등성**: 토스 웹훅과 승인 API는 둘 다 올 수 있음. `payments.provider_tx_id unique` + 상태 머신 전이만 허용.
- **경쟁 조건**: 재고 선점은 주문 생성 트랜잭션에서 조건부 update, 결제 실패·15분 미결제 시 크론이 복구.
- **금액 계산**: 쿠폰(상품/장바구니)·적립금·등급 할인의 적용 순서를 한 함수(`quote`)에 고정, 주문에 내역 스냅샷 저장. 부분 환불 시 할인 안분.
- **공급처 이미지**: esmplus 직링크는 언제든 깨짐. 빌드 단계에서 Storage로 이관하되, 공급처 저작권 범위를 사용자가 확인해야 함.
- **실측(fix4)**: 관리자가 직접 재야 데이터가 생김. 입고 샘플 1개 기준으로 시작, 구매자 제보는 후기에서 수집.
- **개인정보**: 배송지·연락처는 RLS + 주문 완료 후 N년 보관 규칙(전자상거래법 5년) 명시, 탈퇴 시 주문 기록은 익명화.
- **검색**: 12개 상품이면 Postgres `ilike` + `pg_trgm`으로 충분. 랭킹은 크론이 점수 컬럼 갱신.

## 5. Build order

1. **Vertical slice** (스택 증명): S01 홈·S03 목록·S08 상세·S10 장바구니·S11 주문서·S12 완료·S13 주문내역. 테이블: profiles, categories, products, product_options, product_images, carts, cart_items, addresses, orders, order_items, payments. 라우트: products, cart, checkout/quote, orders, payments/confirm, webhooks/toss(테스트 키). 현재 12개 상품을 시드로 이관.
2. **Must-haves**: 가입/카카오 로그인(S15), 배송 추적·취소(S13, shipments), 교환·반품(S14, claims), 후기·사진·도움돼요(S09·S20), 쿠폰함·적립금(S18·S19), 마이페이지(S16), 관리자 상품·주문·클레임 화면(P02·P03), 알림함(S25).
3. **Should-haves**: Q&A, 좋아요·재입고 알림·최근 본(S17·S27), 인기순 랭킹, 검색 필터, 등급 2~3단계, 후기 적립 규칙, Resend 메일.
4. **Fixes (entrepreneur)**: fix1 반품 타임라인·반품비 표시·검수 SLA 보상 → fix2 도착 예정일·지연 보상·미스캔 표시 → fix3 티켓 상태·SLA → fix5 혜택 공개 페이지·재고 연동 쿠폰·30일 최저가 → fix4 실측 검증·오차 반품비 무료. (fix1·2·5는 테이블이 1~2단계에 이미 있으므로 UI·크론만 추가)

각 마일스톤 끝에 `/replica-test`로 플로우 F01~F06을 다시 돌린다.

## 6. 사용자 확인 필요

- 저장소: `dhtpxor/otorimall`이 GitHub에 없음. 빌드 단계 전에 만들어서 Claude GitHub App에 허용해 주시거나, worklog 안의 하위 폴더로 갈지 결정.
- 도메인: otorimall.com 소유 여부와 등록처(DNS 변경 권한).
- 사업자등록·통신판매업 신고 예정 시점(토스 계약·실결제·알림톡의 선행 조건).
- 카카오 로그인 사용 여부(카카오 개발자 앱 등록 필요).
- 공급처(도매매) 상세 이미지의 재호스팅 허용 범위.
