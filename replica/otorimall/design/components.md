# 오토리몰 컴포넌트 명세 (무신사 UX 패턴, 클린룸)

가져온 것은 구조와 동작이다. 색·서체·마스코트·문구는 오토리몰 것. 무신사의 로고·아이콘·이미지·카피는 쓰지 않았다. 아이콘은 직접 그린 1.7px 스트로크 SVG 심볼.

```
TopBar
  구성      로고(토리) · 상시 검색바(데스크톱) · 좋아요(카운트) · 장바구니(카운트)
  states    sticky(top: safe-area), 스크롤 시 반투명 블러
  a11y      검색바는 <button>, 카운트 0이면 숨김(data-zero)
  used on   all

CategoryChips
  variants  링크 칩(홈 필터), 버튼 칩(후기 유형·최근 검색어)
  states    default, pressed(먹색 채움), disabled(오픈 후 활성)
  used on   S01 S03 S04 S09

TabBar (phone ≤860px)
  탭        홈 · 카테고리 · 검색 · 좋아요(배지) · 마이
  states    aria-current=page, 상품 페이지에서는 숨기고 BuyBar로 대체
  used on   all (phone)

ProductCard
  구성      정방형 이미지 + 하트(우하단) · 브랜드/카테고리 작은 줄 · 2줄 상품명 · 가격(할인율 있으면 빨강 % + 취소선 정가) · 태그(무료배송·원산지)
  variants  grid, rail(150px), rank(순위 배지 28px)
  states    hover 1.03 확대, liked(하트 채움)
  used on   S01 S03 S17 검색 결과·연관 상품

Rail
  동작      가로 스크롤, scroll-snap, 섹션 헤더(제목 + 보조 텍스트/지우기)
  used on   최근 본 상품, 오토리 픽(랭킹), 함께 보면 좋은 상품

SortSelect
  옵션      추천순 · 낮은 가격순 · 높은 가격순 · 신상품순 (인기순은 오픈 후 데이터로)
  used on   S03

Gallery
  구성      1:1 메인 + 64px 썸네일 줄, 썸네일 aria-pressed
  used on   S08

PriceBlock
  구성      할인율(빨강) · 판매가 28px/800 · 취소선 정가 · "최근 30일 최저가" 줄(기록 시작일 표시)  ← fix5
  used on   S08

BenefitRows (dl.rows)
  행        배송(무료 + 도착 예정일 + 지연 자동 적립 설명) · 반품비(변심 왕복 n원 / 하자 0원) · 실측(오차 5% 초과 시 0원)  ← fix1·2·4
  used on   S08

CouponChip
  states    준비 중(점선 테두리, 비활성), 오픈 후 "쿠폰 받기"
  used on   S08

QtyStepper / StickyBuyBar
  데스크톱  수량 → 총액 → [♡][장바구니][구매하기] 52px
  phone     하단 고정 BuyBar [♡][장바구니][구매하기] 48px → OptionSheet
  used on   S08

OptionSheet (bottom sheet, phone / 중앙 모달 desktop)
  구성      상품 요약 · 옵션 칩(단일 옵션) · 수량 · 총액 · 도착 예정 · 반품비 · [장바구니][구매하기]
  a11y      role=dialog, 첫 버튼 포커스, Esc·스크림 클릭으로 닫힘
  used on   S08 phone

SectionTabs (sticky)
  탭        상품정보 · 실측 · 후기(n) · 문의(n) · 배송·반품
  동작      클릭 시 부드러운 스크롤, 스크롤 위치로 aria-selected 동기화
  used on   S08

MeasurementTable                                            ← fix4
  열        항목 · 공급처 표기 · 오토리몰 실측
  states    등록 전(한 줄 안내), 등록 후, 구매자 제보 병기
  used on   S08

ReviewSummary / ReviewEmpty
  구성      평점 big · 별 · 개수 · 유형 칩(전체/사진/한 달/실측 제보) · 빈 상태(적립 규칙 링크)
  used on   S08 S09

TicketList / AskSheet                                       ← fix3
  구성      상태 칩(접수됨) · 제목 · 본문 · 접수일 · 답변 예정일 · 미리보기 안내
  form      제목(60자) · 내용(1000자) · 답변 약속 · [취소][접수]
  used on   S08 S26 마이

ReturnTimeline                                              ← fix1
  5단계     접수(환불 예정일) → 회수 → 입고 → 검수(영업일 2일, 초과 시 자동 적립) → 환불
  used on   S08 배송·반품, 정책 페이지

CartDrawer
  구성      라인(이미지·제목 링크·수량·금액·반품비 줄·삭제) · 합계(상품·배송비·도착 예정·결제 예정) · 주문하기
  states    empty, 오픈 준비 중 안내
  used on   S10

MyTiles / MyList
  타일      등급 · 적립금 · 쿠폰 · 주문  (오픈 전에는 0)
  목록      좋아요 · 장바구니 · 문의 내역 · 혜택·반품·배송 규칙
  used on   S16

PolicyPage                                                  ← fix5
  섹션      배송 약속 · 반품·교환 · 문의 · 적립·쿠폰·등급, 각 "오픈 전 확정" 배지, 30일 예고 원칙
  used on   #policy

Toast / Scrim / EmptyState / Note
  used on   all
```

## 설정값(코드 상단 상수, 오픈 전 확정)
RETURN_FEE 6,000원 · TOLERANCE 5% · SHIP_DAYS 1~2 · TRANSIT_DAYS 1~2 · INSPECT_DAYS 2 · TICKET_SLA_H 24 · DELAY_POINT 1,000원/일

## 빌드 단계로 넘길 것
토큰은 `tokens.json` → Tailwind theme 매핑, 컴포넌트는 위 블록 그대로 React 컴포넌트 단위.
