-- 오토리몰 schema (Postgres / Supabase). 금액은 원 단위 정수(소수 없음), currency 'KRW'.
-- 첫 마이그레이션. 모든 timestamptz는 UTC.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------- 회원 ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  nickname text,
  phone text,
  role text not null default 'member' check (role in ('member','admin')),
  tier text not null default 'basic' check (tier in ('basic','plus','vip')),
  tier_amount_12m integer not null default 0,          -- 최근 12개월 구매액(원), 크론 갱신
  referral_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  recipient text not null, phone text not null,
  zip text not null, addr1 text not null, addr2 text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on addresses (user_id);
create unique index addresses_one_default on addresses (user_id) where is_default;

-- ---------- 카탈로그 ----------
create table categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references categories(id) on delete set null,
  slug text not null unique, name text not null, sort integer not null default 0
);
create index on categories (parent_id);

create table suppliers (                               -- 관리자 전용 (도매매 등)
  id uuid primary key default gen_random_uuid(),
  name text not null, site text, note text,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category_id uuid not null references categories(id) on delete restrict,
  title text not null,
  summary text,
  origin text, maker text, model text,
  status text not null default 'draft' check (status in ('draft','on_sale','soldout','hidden')),
  return_fee integer not null default 0,               -- 단순 변심 왕복 반품비(원), 상세·장바구니·주문서에 표시 (fix1)
  extra_fee_island integer not null default 0,         -- 제주·도서산간 추가 배송비
  ship_days_min smallint not null default 1, ship_days_max smallint not null default 2,  -- 출고 영업일 (fix2 도착 예정일)
  view_count integer not null default 0, sales_count integer not null default 0,
  review_count integer not null default 0, avg_rating numeric(3,2) not null default 0,
  like_count integer not null default 0,
  popularity numeric not null default 0,               -- 크론: 매출·수량·조회·후기 가중
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on products (category_id, status);
create index on products (popularity desc);
create index products_title_trgm on products using gin (title gin_trgm_ops);

create table product_options (                         -- SKU
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,                                  -- 예: '350ml / 블랙'
  attrs jsonb not null default '{}',                   -- {"size":"350ml","color":"블랙"}
  price integer not null check (price >= 0),
  compare_price integer,                                -- 정가(할인율 표시용)
  stock integer not null default 0 check (stock >= 0),
  sort integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on product_options (product_id);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  url text not null, alt text, kind text not null default 'gallery' check (kind in ('card','gallery','detail','spec','notice')),
  sort integer not null default 0
);
create index on product_images (product_id, kind, sort);

create table product_specs (                           -- 제공고시 + 실측 (fix4)
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  label text not null,                                 -- '높이', '용량', '무게'
  claimed text not null,                               -- 공급처 표기 '1.18L'
  measured numeric, unit text,                         -- 관리자 실측 1150, 'ml'
  tolerance_pct numeric not null default 5,            -- 오차 허용 %
  measured_at timestamptz, measured_by uuid references profiles(id),
  sort integer not null default 0
);
create index on product_specs (product_id);

create table supplier_products (                       -- 관리자 전용: 공급가·공급처 상품번호
  product_id uuid primary key references products(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  supplier_no text not null, raw_title text,
  cost integer not null, supplier_ship integer not null default 0,
  market_min integer, note text,
  updated_at timestamptz not null default now()
);

create table price_history (                           -- 30일 최저가 (fix5)
  option_id uuid not null references product_options(id) on delete cascade,
  day date not null,
  price integer not null,
  primary key (option_id, day)
);

-- ---------- 참여 ----------
create table likes (
  user_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create table recent_views (
  user_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create table restock_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  option_id uuid not null references product_options(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','notified','cancelled')),
  created_at timestamptz not null default now(),
  unique (user_id, option_id)
);
create index on restock_alerts (option_id, status);

create table questions (                               -- 상품 Q&A
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null, answer text, answered_at timestamptz,
  is_private boolean not null default false,
  created_at timestamptz not null default now()
);
create index on questions (product_id, created_at desc);

-- ---------- 장바구니 ----------
create table carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references profiles(id) on delete cascade,  -- null = 비회원(쿠키 id)
  guest_token text unique,
  updated_at timestamptz not null default now()
);
create table cart_items (
  cart_id uuid not null references carts(id) on delete cascade,
  option_id uuid not null references product_options(id) on delete cascade,
  qty integer not null check (qty between 1 and 99),
  added_at timestamptz not null default now(),
  primary key (cart_id, option_id)
);

-- ---------- 혜택 ----------
create table coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique,                                    -- null = 다운로드형
  name text not null,
  scope text not null check (scope in ('product','cart')),
  discount_type text not null check (discount_type in ('pct','amount')),
  value integer not null check (value > 0),
  min_order_amount integer not null default 0, max_discount integer,
  target_product_ids uuid[] not null default '{}',
  valid_from timestamptz not null, valid_to timestamptz not null,
  total_qty integer, issued_count integer not null default 0,     -- 과발급 방지: issued_count < total_qty 조건부 update
  per_user_qty integer not null default 1,
  stock_linked_option_id uuid references product_options(id) on delete set null,  -- 재고 연동 (fix5)
  created_at timestamptz not null default now(),
  check (valid_to > valid_from)
);
create table user_coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  coupon_id uuid not null references coupons(id) on delete cascade,
  status text not null default 'available' check (status in ('available','used','expired')),
  used_order_id uuid,
  issued_at timestamptz not null default now()
);
create index on user_coupons (user_id, status);
create index on user_coupons (coupon_id);

create table point_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('earn_purchase','earn_review','earn_compensation','use','refund','expire','admin')),
  amount integer not null,                             -- 적립 +, 사용/소멸 -
  balance_after integer not null,
  ref_type text, ref_id uuid,
  expires_at timestamptz,                              -- 적립분만
  created_at timestamptz not null default now()
);
create index on point_ledger (user_id, created_at desc);
create index on point_ledger (expires_at) where expires_at is not null;

create table benefit_policies (                        -- 공개 혜택 규칙 + 변경 예고 (fix5)
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  body jsonb not null,                                 -- {tiers:[...], review_points:{...}, purchase_rate:...}
  announced_at timestamptz not null, effective_at timestamptz not null,
  check (effective_at >= announced_at + interval '30 days')
);

-- ---------- 주문 ----------
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  user_id uuid not null references profiles(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','paid','preparing','shipped','delivered','cancelled','refunded')),
  product_amount integer not null, discount_amount integer not null default 0,
  coupon_discount integer not null default 0, tier_discount integer not null default 0,
  points_used integer not null default 0, shipping_fee integer not null default 0,
  paid_amount integer not null, currency text not null default 'KRW',
  quote jsonb not null,                                -- 금액 계산 내역 스냅샷
  address jsonb not null,                              -- 배송지 스냅샷
  promised_arrival date,                               -- 도착 예정일 (fix2)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  paid_at timestamptz
);
create index on orders (user_id, created_at desc);
create index on orders (status);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  option_id uuid not null references product_options(id) on delete restrict,
  product_snapshot jsonb not null,                     -- title, option name, image, return_fee
  unit_price integer not null, qty integer not null check (qty > 0),
  applied_coupon_id uuid references user_coupons(id) on delete set null,
  status text not null default 'ordered'
    check (status in ('ordered','cancelled','exchange_requested','return_requested','refunded','completed'))
);
create index on order_items (order_id);
create index on order_items (option_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null default 'toss',
  method text, provider_tx_id text not null unique,    -- 멱등
  amount integer not null,
  status text not null check (status in ('ready','paid','cancelled','partial_refunded','failed')),
  raw jsonb, paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index on payments (order_id);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  carrier text not null, tracking_no text not null,
  status text not null default 'registered'
    check (status in ('registered','not_scanned','in_transit','out_for_delivery','delivered','exception')),
  events jsonb not null default '[]',
  registered_at timestamptz not null default now(), first_scan_at timestamptz, delivered_at timestamptz,
  last_checked_at timestamptz,
  unique (carrier, tracking_no)
);
create index on shipments (order_id);
create index on shipments (status) where status <> 'delivered';

create table claims (                                  -- 취소·교환·반품 (fix1)
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('cancel','exchange','return')),
  reason_code text not null, reason_text text,
  is_seller_fault boolean not null default false,      -- 하자·오배송·실측 오차 초과 → 반품비 0
  fee_amount integer not null default 0,
  pickup_method text check (pickup_method in ('auto_pickup','self_ship')),
  return_tracking_no text, exchange_option_id uuid references product_options(id),
  status text not null default 'requested'
    check (status in ('requested','pickup_scheduled','in_transit','received','inspecting','approved','rejected','refunded','completed','expired')),
  reject_reason text, reject_photos text[],            -- 거부 시 사진 필수(앱 레이어 검증)
  deadline_at timestamptz,                             -- 반송장 입력 기한(접수+9일)
  received_at timestamptz, inspected_at timestamptz, refund_due_at timestamptz,  -- 환불 예정일
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on claims (user_id, created_at desc);
create index on claims (status);

create table compensations (                           -- 자동 보상 (fix1·fix2), 중복 방지
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  kind text not null check (kind in ('delivery_delay','inspection_delay')),
  amount integer not null, ledger_id uuid references point_ledger(id),
  created_at timestamptz not null default now(),
  unique (order_id, kind)
);

-- ---------- 후기 ----------
create table reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  order_item_id uuid not null unique references order_items(id) on delete cascade,  -- 구매 1건당 1후기
  type text not null default 'general' check (type in ('general','month','photo')),
  rating smallint not null check (rating between 1 and 5),
  body text not null,
  measured jsonb,                                      -- 구매자 실측 제보 {"높이":{"value":31.5,"unit":"cm"}} (fix4)
  helpful_count integer not null default 0,
  status text not null default 'visible' check (status in ('visible','blinded','rejected')),
  point_awarded integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on reviews (product_id, status, created_at desc);
create index on reviews (user_id);
create table review_images (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews(id) on delete cascade,
  url text not null, sort integer not null default 0
);
create table review_helpful (
  review_id uuid not null references reviews(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  primary key (review_id, user_id)
);

-- ---------- 문의 (fix3) ----------
create table tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  subject text not null,
  status text not null default 'open' check (status in ('open','assigned','answered','closed')),
  assigned_to uuid references profiles(id),
  sla_due_at timestamptz not null,                     -- 접수 + 24h(영업시간 기준)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on tickets (user_id, created_at desc);
create index on tickets (status, sla_due_at);
create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null, attachments text[],
  created_at timestamptz not null default now()
);
create index on ticket_messages (ticket_id, created_at);

-- ---------- 알림 ----------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('restock','shipping','delay_compensation','claim','coupon','points_expiring','ticket_reply','review_request')),
  payload jsonb not null default '{}',
  read_at timestamptz, created_at timestamptz not null default now()
);
create index on notifications (user_id, read_at, created_at desc);

-- ---------- RLS (요약; 전체 정책은 두 번째 마이그레이션) ----------
alter table profiles enable row level security;
create policy profiles_self on profiles for select using (id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy profiles_self_update on profiles for update using (id = auth.uid());
-- addresses, carts, cart_items, orders, order_items, payments, shipments, claims, tickets, ticket_messages,
-- reviews(본인 쓰기·공개 읽기), likes, recent_views, restock_alerts, user_coupons, point_ledger, notifications:
--   select/insert/update using (user_id = auth.uid()) + admin 전체.
-- products, product_options, product_images, product_specs, categories, coupons(code is null), price_history,
-- benefit_policies, questions(is_private=false): 공개 select, admin만 쓰기.
-- suppliers, supplier_products: admin만.
