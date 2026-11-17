-- ════════════════════════════════════════════════════════════════════════════
-- The assistant (העוזר): a reading layer made for it, the daily scan, alerts
-- with their evidence and log, and the budget.
--
-- Four rules hold here, in the database, and not in a prompt:
--   1. The assistant reads through schema `ai` alone, as a role that can only
--      read, inside a read-only transaction. Every answer carries where it came
--      from and when.
--   2. It changes nothing in stock, orders or approvals. No function in this
--      file writes to those tables; the exit gate and its code stay as they are.
--   3. Shortages, purchase quantities and unusual events are calculated in SQL
--      (ai.reorder, ai.events, ai.snapshot). The model only words them.
--   4. Every alert keeps its evidence, state, owner and log; every question is
--      logged and priced against a daily budget.
--
-- The handshake: a signed-in manager asks the database for a ticket
-- (assistant_open). The server that talks to the model holds no database key of
-- its own: it shows the ticket, and the database answers with who is asking,
-- what may be read (the catalogue of schema `ai`, with its comments) and how much
-- of today's budget is left (assistant_handshake).
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists ai;
revoke all on schema ai from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_reader') then
    create role ai_reader nologin noinherit;
  end if;
end $$;
grant ai_reader to postgres;
grant usage on schema ai to ai_reader;

-- ── Settings ────────────────────────────────────────────────────────────────
create table if not exists public.assistant_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  manager_name text not null default '',
  briefing_hour smallint not null default 8 check (briefing_hour between 0 and 23),
  model text not null default 'gpt-5.5',
  daily_budget_usd numeric(8, 2) not null default 5,
  hourly_questions integer not null default 40,
  -- USD per million tokens, by model.
  prices jsonb not null default '{"gpt-5.5":{"in":5,"cached":0.5,"out":30},"gpt-5.4":{"in":2.5,"cached":0.25,"out":15},"gpt-5.4-mini":{"in":0.75,"cached":0.075,"out":4.5}}'::jsonb,
  -- A purchase covers open orders, the minimum, and this many days of the last month's pace.
  cover_days integer not null default 14,
  -- Above its minimum, but gone within this many days at that pace.
  soon_days integer not null default 7,
  -- A count that differs from the books by at least this much (₪, list price) is an event.
  count_gap_worth numeric not null default 1000,
  -- An exit with no order behind it, this many times the product's usual exit and worth at least big_out_worth.
  big_out_factor numeric not null default 3,
  big_out_worth numeric not null default 20000,
  -- Where the morning scan asks for its wording.
  brain_url text,
  updated_at timestamptz not null default now()
);
insert into public.assistant_settings (id, manager_name, brain_url)
values (1, 'אליאב', 'https://worker-nine-rose.vercel.app')
on conflict (id) do nothing;

-- ── Small helpers of the reading layer ──────────────────────────────────────
create or replace function ai.today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Jerusalem')::date $$;
comment on function ai.today() is 'Today in Israel. Use it instead of current_date.';

create or replace function ai.n(x numeric) returns text
language sql immutable as $$ select rtrim(rtrim(to_char(round(coalesce(x, 0), 2), 'FM999,999,999,990.00'), '0'), '.') $$;

create or replace function ai.lasts(days integer) returns text
language sql immutable as $$
  select case when days is null then null when days <= 0 then 'ייגמר היום' when days = 1 then 'יספיק ליום אחד' when days = 2 then 'יספיק ליומיים' else 'יספיק ל-' || days || ' ימים' end
$$;

-- ── The reading layer ───────────────────────────────────────────────────────
-- No phone numbers, no emails, no keys: only what a question about the warehouse needs.

create or replace view ai.products as
select p.id, p.sku, p.name, p.category, p.unit,
       p.qty as on_shelf, p.reserved, p.qty - p.reserved as available, p.min_qty as minimum,
       -- The same four levels as public.stock_level and the stock page.
       case when p.qty <= 0 then 'out' when p.qty - p.reserved < 0 then 'short' when p.min_qty > 0 and p.qty - p.reserved < p.min_qty then 'low' else 'ok' end as level,
       p.price, round(p.qty * p.price, 2) as worth,
       p.location, s.name as supplier, p.in_catalog
from public.products p
left join public.suppliers s on s.id = p.primary_supplier_id;
comment on view ai.products is 'One row per product, with its stock now. מוצרים ומלאי.';
comment on column ai.products.on_shelf is 'units physically in the warehouse';
comment on column ai.products.reserved is 'units held for open orders';
comment on column ai.products.available is 'on_shelf - reserved; negative = orders exceed the shelf';
comment on column ai.products.minimum is 'reorder point; 0 = none set';
comment on column ai.products.level is 'out (אזל) | short (חסר להזמנות: reserved > on_shelf) | low (מתחת למינימום) | ok';
comment on column ai.products.price is '₪ list price per unit (מחירון). There is no purchase cost in the system';
comment on column ai.products.worth is '₪ on_shelf * price';
comment on column ai.products.supplier is 'main supplier name';

create or replace view ai.movements as
with m as (
  select mv.*, count(*) filter (where mv.type = 'adjust') over (partition by mv.product_id order by mv.created_at, mv.id) as grp
  from public.movements mv
), r as (
  select m.*, sum(case m.type when 'in' then m.qty when 'out' then -m.qty when 'adjust' then m.qty else 0 end)
              over (partition by m.product_id, m.grp order by m.created_at, m.id) as after
  from m
), d as (
  select r.*, r.after - lag(r.after, 1, 0::numeric) over (partition by r.product_id order by r.created_at, r.id) as delta
  from r
)
select d.id, d.created_at,
       (d.created_at at time zone 'Asia/Jerusalem')::date as day,
       extract(hour from d.created_at at time zone 'Asia/Jerusalem')::int as hour,
       d.type::text as type,
       d.product_id, p.name as product, p.category, p.unit,
       d.qty, d.delta, round(abs(d.delta) * p.price, 2) as worth,
       w.name as worker, s.name as supplier, doc.customer, o.number as order_number,
       d.document_id is not null as has_receipt,
       d.exit_pass is not null as approved_without_receipt,
       d.place, d.note
from d
join public.products p on p.id = d.product_id
left join public.workers w on w.id = d.worker_id
left join public.suppliers s on s.id = d.supplier_id
left join public.documents doc on doc.id = d.document_id
left join public.order_lines ol on ol.movement_id = d.id
left join public.orders o on o.id = ol.order_id;
comment on view ai.movements is 'Every stock movement since 2025-11. תנועות מלאי: in = goods received from a supplier, out = goods left to a customer, adjust = a stock count, fault = a fault report (moves no stock).';
comment on column ai.movements.day is 'date in Israel';
comment on column ai.movements.hour is 'hour of day in Israel, 0-23';
comment on column ai.movements.qty is 'quantity written on the movement; for adjust it is the counted total';
comment on column ai.movements.delta is 'signed change of the stock: +in, -out, counted minus expected for adjust, 0 for fault';
comment on column ai.movements.worth is '₪ abs(delta) * list price';
comment on column ai.movements.customer is 'from the receipt, for out';
comment on column ai.movements.order_number is 'the order this exit delivered, if any';
comment on column ai.movements.has_receipt is 'a photographed delivery note is archived';
comment on column ai.movements.approved_without_receipt is 'left with no receipt, on a head manager''s one-time code';

create or replace view ai.orders as
select o.id, o.number, o.customer, a.name as agent, o.status::text as status,
       (o.created_at at time zone 'Asia/Jerusalem')::date as created_day,
       o.promised_on,
       (o.closed_at at time zone 'Asia/Jerusalem')::date as closed_day,
       coalesce(o.status = 'open' and o.promised_on < ai.today(), false) as late,
       case when o.status = 'open' and o.promised_on < ai.today() then ai.today() - o.promised_on else 0 end as days_late,
       l.lines, l.total, o.note
from public.orders o
left join public.agents a on a.id = o.agent_id
left join lateral (
  select count(*)::int as lines, round(sum(ol.qty * coalesce(ol.unit_price, p.price)), 2) as total
  from public.order_lines ol join public.products p on p.id = ol.product_id
  where ol.order_id = o.id
) l on true;
comment on view ai.orders is 'Customer orders. הזמנות לקוחות. Sales = orders with status delivered, dated by closed_day.';
comment on column ai.orders.status is 'open | delivered | cancelled';
comment on column ai.orders.agent is 'field agent who took it; null = placed by the office';
comment on column ai.orders.promised_on is 'promised delivery date';
comment on column ai.orders.closed_day is 'day it was delivered or cancelled';
comment on column ai.orders.late is 'open and past its promised date';
comment on column ai.orders.total is '₪ at list price';

create or replace view ai.order_lines as
select o.number as order_number, o.customer, o.status::text as order_status, o.promised_on,
       (o.created_at at time zone 'Asia/Jerusalem')::date as created_day,
       (o.closed_at at time zone 'Asia/Jerusalem')::date as closed_day,
       ol.product_id, p.name as product, p.category, p.unit, ol.qty,
       coalesce(ol.unit_price, p.price) as unit_price,
       round(ol.qty * coalesce(ol.unit_price, p.price), 2) as total
from public.order_lines ol
join public.orders o on o.id = ol.order_id
join public.products p on p.id = ol.product_id;
comment on view ai.order_lines is 'The products inside each order. שורות הזמנה. Use it for what sold, to whom, by product or category.';

create or replace view ai.faults as
select f.id, f.description, p.name as product, f.asset as machine, f.status::text as status,
       (f.created_at at time zone 'Asia/Jerusalem')::date as day,
       rw.name as reported_by, aw.name as assigned_to, f.instruction,
       f.acknowledged_at is not null as acknowledged,
       (f.resolved_at at time zone 'Asia/Jerusalem')::date as resolved_day, f.resolution, f.resolved_by,
       case when f.status = 'open' then ai.today() - (f.created_at at time zone 'Asia/Jerusalem')::date end as days_open
from public.faults f
left join public.products p on p.id = f.product_id
left join public.workers rw on rw.id = f.reported_by
left join public.workers aw on aw.id = f.assigned_to;
comment on view ai.faults is 'Faults reported by workers. תקלות: status open | resolved; assigned_to null = nobody holds it.';

create or replace view ai.suppliers as
select s.id, s.name,
       (select count(*)::int from public.products p where p.primary_supplier_id = s.id) as products,
       (select (max(m.created_at) at time zone 'Asia/Jerusalem')::date from public.movements m where m.supplier_id = s.id and m.type = 'in') as last_delivery_day,
       (select count(distinct m.document_id)::int from public.movements m where m.supplier_id = s.id and m.type = 'in' and m.created_at > now() - interval '90 days') as deliveries_90d,
       (select count(*)::int from public.supplier_items i where i.supplier_id = s.id and i.status = 'pending') as names_waiting
from public.suppliers s;
comment on view ai.suppliers is 'Suppliers. ספקים. names_waiting = names from their delivery notes not yet tied to a product. No lead times or purchase prices exist in the system.';

create or replace view ai.workers as
select w.id, w.name, w.role, w.active from public.workers w;
comment on view ai.workers is 'Warehouse workers. עובדים.';

create or replace view ai.shelves as
select p.name as product, p.category, sh.place, sh.qty, (sh.placed_at at time zone 'Asia/Jerusalem')::date as placed_day
from public.shelf_stock sh join public.products p on p.id = sh.product_id;
comment on view ai.shelves is 'Where each product stands. מיקומים: place like A-1/2R (aisle-rack/level side).';

create or replace view ai.requests as
select r.kind::text as kind, r.status::text as status, coalesce(nullif(btrim(r.proposed_name), ''), r.external_name) as name, r.qty, r.customer,
       w.name as worker, (r.created_at at time zone 'Asia/Jerusalem')::date as day
from public.item_requests r left join public.workers w on w.id = r.worker_id;
comment on view ai.requests is 'Lines a worker could not match on a receipt and sent to the manager. status pending = waits for approval.';

create or replace view ai.reorder as
with cfg as (
  select cover_days, soon_days from public.assistant_settings where id = 1
), use as (
  select m.product_id, sum(m.qty) as out_30d
  from public.movements m
  where m.type = 'out' and m.created_at > now() - interval '30 days'
  group by 1
), held as (
  select ol.product_id, count(distinct o.id)::int as open_orders, min(o.promised_on) as nearest
  from public.order_lines ol join public.orders o on o.id = ol.order_id
  where o.status = 'open'
  group by 1
), last_in as (
  select distinct on (m.product_id) m.product_id, m.created_at as last_at, m.qty
  from public.movements m where m.type = 'in'
  order by m.product_id, m.created_at desc
), base as (
  select p.id as product_id, p.sku, p.name as product, p.category, p.unit, s.name as supplier,
         case when p.qty <= 0 then 'out' when p.qty - p.reserved < 0 then 'short' when p.min_qty > 0 and p.qty - p.reserved < p.min_qty then 'low' else 'ok' end as level,
         p.qty as on_shelf, p.reserved, p.qty - p.reserved as available, p.min_qty as minimum,
         round(coalesce(u.out_30d, 0) / 30.0, 2) as daily_use,
         coalesce(h.open_orders, 0) as open_orders, h.nearest as nearest_promise,
         (li.last_at at time zone 'Asia/Jerusalem')::date as last_in_day, li.qty as last_in_qty,
         cfg.cover_days, cfg.soon_days
  from public.products p
  cross join cfg
  left join public.suppliers s on s.id = p.primary_supplier_id
  left join use u on u.product_id = p.id
  left join held h on h.product_id = p.id
  left join last_in li on li.product_id = p.id
)
select b.product_id, b.sku, b.product, b.category, b.unit, b.supplier, b.level,
       case b.level when 'out' then 'אזל' when 'short' then 'חסר להזמנות' when 'low' then 'מתחת למינימום' else 'ייגמר בקרוב' end as reason,
       case when b.level in ('out', 'short') then 3 when b.level = 'low' then 2 else 1 end as urgency,
       b.on_shelf, b.reserved, b.available, b.minimum, b.daily_use,
       case when b.daily_use > 0 then floor(greatest(b.available, 0) / b.daily_use)::int end as days_left,
       greatest(ceil(b.reserved + b.minimum + b.cover_days * b.daily_use - b.on_shelf), 1)::int as suggested_qty,
       b.open_orders, b.nearest_promise, b.last_in_day, b.last_in_qty, b.cover_days
from base b
where b.level <> 'ok' or (b.daily_use > 0 and greatest(b.available, 0) / b.daily_use < b.soon_days);
comment on view ai.reorder is 'What to order now, calculated: every product that is out, short for orders, under its minimum, or gone within a week at the last month''s pace. מה צריך להזמין. Always read purchase advice from here.';
comment on column ai.reorder.urgency is '3 = out or short for orders, 2 = under minimum, 1 = running out soon';
comment on column ai.reorder.daily_use is 'average units leaving per day over the last 30 days';
comment on column ai.reorder.days_left is 'days the available stock lasts at daily_use; null = nothing left in 30 days';
comment on column ai.reorder.suggested_qty is 'units to order = reserved + minimum + cover_days * daily_use - on_shelf';
comment on column ai.reorder.open_orders is 'open orders that hold this product';
comment on column ai.reorder.nearest_promise is 'the earliest promised date among them';

create or replace view ai.events as
with cfg as (
  select count_gap_worth, big_out_factor, big_out_worth from public.assistant_settings where id = 1
), typical as (
  select m.product_id, avg(m.qty) as avg_out, count(*) as n
  from public.movements m
  where m.type = 'out' and m.created_at > now() - interval '180 days'
  group by 1
), flagged as (
  select mv.*, round(t.avg_out, 1) as usual_out,
         mv.approved_without_receipt as r_no_receipt,
         mv.type = 'adjust' and mv.worth >= cfg.count_gap_worth as r_count_gap,
         mv.type in ('out', 'adjust') and mv.hour not between 5 and 19 as r_night,
         mv.type = 'out' and mv.order_number is null and coalesce(t.n, 0) >= 5 and mv.qty >= cfg.big_out_factor * t.avg_out and mv.worth >= cfg.big_out_worth as r_big_out
  from ai.movements mv
  cross join cfg
  left join typical t on t.product_id = mv.product_id
  where mv.created_at > now() - interval '30 days'
)
select f.id as movement_id, f.created_at, f.day, f.hour, f.type, f.product_id, f.product, f.unit, f.qty, f.delta, f.worth,
       f.worker, f.customer, f.note, f.usual_out,
       array_remove(array[
         case when f.r_no_receipt then 'no_receipt' end,
         case when f.r_count_gap then 'count_gap' end,
         case when f.r_big_out then 'big_out' end,
         case when f.r_night then 'night' end
       ], null) as reasons,
       case when f.r_no_receipt and f.worth >= 5000 then 3 when f.r_no_receipt or f.r_count_gap or f.r_big_out then 2 else 1 end as severity
from flagged f
where f.r_no_receipt or f.r_count_gap or f.r_night or f.r_big_out;
comment on view ai.events is 'Unusual stock movements of the last 30 days, calculated. אירועים חריגים. reasons: no_receipt (left with no receipt, on a manager''s code), count_gap (a count far from the books), big_out (an exit with no order, far above the product''s usual), night (outside 05:00-20:00).';
comment on column ai.events.usual_out is 'the product''s average exit over 180 days';
comment on column ai.events.severity is '3 high, 2 check, 1 note';

-- ── The assistant's own records ─────────────────────────────────────────────
create table if not exists public.assistant_tickets (
  ticket uuid primary key default gen_random_uuid(),
  user_id uuid,
  actor text not null,
  kind text not null default 'chat' check (kind in ('chat', 'system')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.assistant_queries (
  id bigint generated always as identity primary key,
  ticket uuid,
  user_id uuid,
  actor text,
  tool text not null,
  detail jsonb not null default '{}'::jsonb,
  rows integer,
  ms integer,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists assistant_queries_user_time on public.assistant_queries (user_id, created_at desc);

create table if not exists public.assistant_usage (
  id bigint generated always as identity primary key,
  day date not null,
  ticket uuid,
  user_id uuid,
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists assistant_usage_day on public.assistant_usage (day);

create table if not exists public.assistant_alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('shortage', 'purchase', 'event')),
  rule text not null,
  fingerprint text not null,
  severity smallint not null,
  title text not null,
  summary text not null,
  evidence jsonb not null,
  worth numeric,
  entity_type text,
  entity_id uuid,
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved', 'dismissed')),
  owner_worker uuid references public.workers (id) on delete set null,
  owner_label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text
);
create unique index if not exists assistant_alerts_one_open on public.assistant_alerts (fingerprint) where status in ('new', 'in_progress');
create index if not exists assistant_alerts_fingerprint on public.assistant_alerts (fingerprint);
create index if not exists assistant_alerts_status on public.assistant_alerts (status, severity desc);

create table if not exists public.assistant_alert_events (
  id bigint generated always as identity primary key,
  alert_id bigint not null references public.assistant_alerts (id) on delete cascade,
  created_at timestamptz not null default now(),
  actor text not null,
  action text not null,
  note text,
  data jsonb
);
create index if not exists assistant_alert_events_alert on public.assistant_alert_events (alert_id, created_at);

create table if not exists public.assistant_briefings (
  day date primary key,
  facts jsonb not null,
  narrative jsonb,
  created_at timestamptz not null default now(),
  narrated_at timestamptz
);

-- Read by the signed-in manager; written only by the functions below.
alter table public.assistant_settings enable row level security;
alter table public.assistant_tickets enable row level security;
alter table public.assistant_queries enable row level security;
alter table public.assistant_usage enable row level security;
alter table public.assistant_alerts enable row level security;
alter table public.assistant_alert_events enable row level security;
alter table public.assistant_briefings enable row level security;

revoke all on public.assistant_settings, public.assistant_tickets, public.assistant_queries, public.assistant_usage,
              public.assistant_alerts, public.assistant_alert_events, public.assistant_briefings from anon, authenticated;
grant select on public.assistant_settings, public.assistant_queries, public.assistant_usage,
                public.assistant_alerts, public.assistant_alert_events, public.assistant_briefings to authenticated;

drop policy if exists "manager reads assistant settings" on public.assistant_settings;
create policy "manager reads assistant settings" on public.assistant_settings for select to authenticated using (true);
drop policy if exists "manager reads assistant queries" on public.assistant_queries;
create policy "manager reads assistant queries" on public.assistant_queries for select to authenticated using (true);
drop policy if exists "manager reads assistant usage" on public.assistant_usage;
create policy "manager reads assistant usage" on public.assistant_usage for select to authenticated using (true);
drop policy if exists "manager reads assistant alerts" on public.assistant_alerts;
create policy "manager reads assistant alerts" on public.assistant_alerts for select to authenticated using (true);
drop policy if exists "manager reads assistant alert events" on public.assistant_alert_events;
create policy "manager reads assistant alert events" on public.assistant_alert_events for select to authenticated using (true);
drop policy if exists "manager reads assistant briefings" on public.assistant_briefings;
create policy "manager reads assistant briefings" on public.assistant_briefings for select to authenticated using (true);

create or replace view ai.alerts as
select a.id, a.kind, a.rule, a.severity, a.title, a.summary, a.status, a.owner_label as owner,
       (a.first_seen_at at time zone 'Asia/Jerusalem')::date as first_seen_day,
       (a.resolved_at at time zone 'Asia/Jerusalem')::date as resolved_day, a.resolution
from public.assistant_alerts a;
comment on view ai.alerts is 'The alerts the daily scan raised. התראות: kind shortage | purchase | event; status new | in_progress | resolved | dismissed.';

create or replace view ai.snapshot as
select to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') as as_of,
       (select count(*)::int from ai.products) as products,
       (select round(sum(worth)) from ai.products) as stock_worth,
       (select count(*)::int from ai.products where level = 'out') as out_of_stock,
       (select count(*)::int from ai.products where level = 'short') as short_for_orders,
       (select count(*)::int from ai.products where level = 'low') as under_minimum,
       (select count(*)::int from ai.orders where status = 'open') as open_orders,
       (select coalesce(round(sum(total)), 0) from ai.orders where status = 'open') as open_orders_worth,
       (select count(*)::int from ai.orders where late) as late_orders,
       (select count(*)::int from ai.orders where status = 'open' and promised_on = ai.today()) as orders_due_today,
       (select count(*)::int from ai.orders where status = 'delivered' and closed_day = ai.today() - 1) as delivered_yesterday,
       (select count(*)::int from ai.faults where status = 'open') as open_faults,
       (select count(*)::int from ai.faults where status = 'open' and assigned_to is null) as unassigned_faults,
       (select count(*)::int from public.item_requests where status = 'pending') as worker_lines_waiting,
       (select count(*)::int from public.supplier_items where status = 'pending') as supplier_names_waiting,
       mv.*
from (
  select coalesce(round(sum(worth) filter (where type = 'in' and day = ai.today() - 1)), 0) as in_yesterday,
         coalesce(round(sum(worth) filter (where type = 'out' and day = ai.today() - 1)), 0) as out_yesterday,
         coalesce(round(sum(worth) filter (where type = 'in' and day > ai.today() - 7)), 0) as in_7d,
         coalesce(round(sum(worth) filter (where type = 'out' and day > ai.today() - 7)), 0) as out_7d,
         coalesce(round(sum(worth) filter (where type = 'out' and day <= ai.today() - 7)), 0) as out_prev_7d,
         round(100.0 * (sum(worth) filter (where type = 'out' and day > ai.today() - 7) - sum(worth) filter (where type = 'out' and day <= ai.today() - 7))
               / nullif(sum(worth) filter (where type = 'out' and day <= ai.today() - 7), 0))::int as out_change_pct
  from ai.movements
  where day > ai.today() - 14
) mv;
comment on view ai.snapshot is 'One row: where the warehouse stands now. מצב המחסן עכשיו. Money in ₪ at list price; *_7d = the last 7 days including today; out_change_pct = this week''s exits against the week before.';

grant select on all tables in schema ai to ai_reader;
grant execute on function ai.today(), ai.n(numeric), ai.lasts(integer) to ai_reader;

-- ── The reader: one SELECT, as a role that can only read schema ai ──────────
create or replace function ai.run(q text, max_rows integer) returns jsonb
language plpgsql stable security definer set search_path = ai, pg_catalog
as $$
declare
  result jsonb;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from (%s) q limit %s) t', q, max_rows + 1) into result;
  return result;
end $$;
revoke all on function ai.run(text, integer) from public;
grant create on schema ai to ai_reader;
alter function ai.run(text, integer) owner to ai_reader;
revoke create on schema ai from ai_reader;

-- ── Tickets ─────────────────────────────────────────────────────────────────
create or replace function public.assistant_who(p_ticket uuid) returns public.assistant_tickets
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  t public.assistant_tickets;
begin
  select * into t from public.assistant_tickets where ticket = p_ticket and expires_at > now();
  if not found then
    raise exception 'assistant: the ticket is missing or has expired' using errcode = '28000';
  end if;
  return t;
end $$;
revoke all on function public.assistant_who(uuid) from public, anon, authenticated;

create or replace function public.assistant_open() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  t public.assistant_tickets;
  cfg public.assistant_settings;
begin
  if auth.uid() is null then
    raise exception 'assistant: sign in first' using errcode = '28000';
  end if;
  select * into cfg from public.assistant_settings where id = 1;
  if not cfg.enabled then
    raise exception 'assistant: switched off';
  end if;
  delete from public.assistant_tickets where expires_at < now() - interval '1 day';
  insert into public.assistant_tickets (user_id, actor, kind, expires_at)
  values (auth.uid(), coalesce(public.actor_label(), 'מנהל'), 'chat', now() + interval '2 hours')
  returning * into t;
  return jsonb_build_object('ticket', t.ticket, 'expires_at', t.expires_at, 'name', cfg.manager_name, 'actor', t.actor);
end $$;
revoke all on function public.assistant_open() from public, anon;
grant execute on function public.assistant_open() to authenticated;

-- ── The catalogue the model is shown: schema ai, as the database describes it ─
create or replace function public.assistant_catalog() returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'view', 'ai.' || c.relname,
           'about', obj_description(c.oid, 'pg_class'),
           'columns', (select jsonb_agg(a.attname || ' ' || format_type(a.atttypid, null) || coalesce(': ' || col_description(c.oid, a.attnum), '') order by a.attnum)
                         from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
         ) order by c.relname), '[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ai' and c.relkind = 'v';
$$;
revoke all on function public.assistant_catalog() from public, anon, authenticated;

create or replace function public.assistant_budget() returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'limit_usd', s.daily_budget_usd,
    'spent_usd', round(coalesce((select sum(u.cost_usd) from public.assistant_usage u where u.day = (now() at time zone 'Asia/Jerusalem')::date), 0), 4),
    'left_usd', round(greatest(s.daily_budget_usd - coalesce((select sum(u.cost_usd) from public.assistant_usage u where u.day = (now() at time zone 'Asia/Jerusalem')::date), 0), 0), 4),
    'questions_today', (select count(*) from public.assistant_queries q where q.tool = 'question' and q.created_at >= ((now() at time zone 'Asia/Jerusalem')::date::timestamp at time zone 'Asia/Jerusalem'))
  )
  from public.assistant_settings s where s.id = 1;
$$;
revoke all on function public.assistant_budget() from public, anon;
grant execute on function public.assistant_budget() to authenticated;

/** The handshake: who asks, what may be read, how much is left. A question is logged here, before any model is called. */
create or replace function public.assistant_handshake(p_ticket uuid, p_purpose text default 'chat', p_question text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  t public.assistant_tickets;
  cfg public.assistant_settings;
  budget jsonb;
  asked integer;
  refusal text;
begin
  t := public.assistant_who(p_ticket);
  select * into cfg from public.assistant_settings where id = 1;
  budget := public.assistant_budget();
  select count(*) into asked from public.assistant_queries q
   where q.tool = 'question' and q.created_at > now() - interval '1 hour' and q.user_id is not distinct from t.user_id;

  refusal := case
    when not cfg.enabled then 'off'
    when (budget ->> 'left_usd')::numeric <= 0 then 'budget'
    when p_purpose = 'chat' and asked >= cfg.hourly_questions then 'rate'
  end;

  if refusal is null and p_question is not null then
    insert into public.assistant_queries (ticket, user_id, actor, tool, detail)
    values (t.ticket, t.user_id, t.actor, 'question', jsonb_build_object('question', left(p_question, 2000)));
  end if;

  return jsonb_build_object(
    'allowed', refusal is null,
    'refusal', refusal,
    'actor', t.actor,
    'name', cfg.manager_name,
    'model', cfg.model,
    'now', to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI'),
    'weekday', extract(dow from now() at time zone 'Asia/Jerusalem')::int,
    'budget', budget,
    'hourly_questions', cfg.hourly_questions,
    'catalog', case when refusal is null then public.assistant_catalog() end
  );
end $$;
revoke all on function public.assistant_handshake(uuid, text, text) from public;
grant execute on function public.assistant_handshake(uuid, text, text) to anon, authenticated;

/** One read for the model. The transaction turns read-only before anything of the model's runs, and it runs as ai_reader. */
create or replace function public.assistant_sql(p_ticket uuid, p_sql text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  q text;
  cap constant integer := 60;
  started timestamptz := clock_timestamp();
  found_rows jsonb;
  n integer;
begin
  perform set_config('transaction_read_only', 'on', true);
  perform public.assistant_who(p_ticket);

  q := btrim(regexp_replace(coalesce(p_sql, ''), ';\s*$', ''));
  if q !~* '^(select|with)\M' then
    return jsonb_build_object('error', 'Only one SELECT statement is allowed.');
  end if;
  if position(';' in q) > 0 then
    return jsonb_build_object('error', 'One statement only, with no semicolon.');
  end if;
  if length(q) > 6000 then
    return jsonb_build_object('error', 'The query is too long.');
  end if;
  if q ~* '(\mpg_|information_schema|\mset_config\M|\mcurrent_setting\M|\mdblink|\mlo_|\mcopy\M|U&|\m(public|auth|vault|storage|net|cron|extensions|realtime|supabase_functions|graphql)\.)' then
    return jsonb_build_object('error', 'Only the views of schema ai may be read.');
  end if;

  begin
    found_rows := ai.run(q, cap);
  exception when others then
    return jsonb_build_object('error', left(sqlerrm, 400));
  end;

  n := jsonb_array_length(found_rows);
  return jsonb_build_object(
    'rows', case when n > cap then found_rows - cap else found_rows end,
    'row_count', least(n, cap),
    'truncated', n > cap,
    'as_of', to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI'),
    'ms', (extract(epoch from clock_timestamp() - started) * 1000)::int
  );
end $$;
revoke all on function public.assistant_sql(uuid, text) from public;
grant execute on function public.assistant_sql(uuid, text) to anon, authenticated;

/** After an answer: what it cost, and every read it made. The price comes from the settings, never from the caller. */
create or replace function public.assistant_finish(p_ticket uuid, p_purpose text, p_model text, p_input integer, p_cached integer, p_output integer, p_log jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  t public.assistant_tickets;
  cfg public.assistant_settings;
  price jsonb;
  cost numeric;
  entry jsonb;
begin
  t := public.assistant_who(p_ticket);
  select * into cfg from public.assistant_settings where id = 1;
  -- A model the price list does not know is charged as the dearest one on it.
  price := coalesce(cfg.prices -> p_model, (select v from jsonb_each(cfg.prices) e(k, v) order by (v ->> 'out')::numeric desc limit 1));
  cost := (greatest(coalesce(p_input, 0) - coalesce(p_cached, 0), 0) * (price ->> 'in')::numeric
           + coalesce(p_cached, 0) * (price ->> 'cached')::numeric
           + coalesce(p_output, 0) * (price ->> 'out')::numeric) / 1000000.0;

  insert into public.assistant_usage (day, ticket, user_id, purpose, model, input_tokens, cached_tokens, output_tokens, cost_usd)
  values ((now() at time zone 'Asia/Jerusalem')::date, t.ticket, t.user_id, left(p_purpose, 40), left(p_model, 80),
          least(greatest(coalesce(p_input, 0), 0), 5000000), least(greatest(coalesce(p_cached, 0), 0), 5000000), least(greatest(coalesce(p_output, 0), 0), 5000000), cost);

  for entry in select * from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) limit 20 loop
    insert into public.assistant_queries (ticket, user_id, actor, tool, detail, rows, ms, error)
    values (t.ticket, t.user_id, t.actor, 'sql',
            jsonb_build_object('purpose', left(entry ->> 'purpose', 200), 'sql', left(entry ->> 'sql', 6000)),
            (entry ->> 'rows')::int, (entry ->> 'ms')::int, left(entry ->> 'error', 400));
  end loop;

  return public.assistant_budget();
end $$;
revoke all on function public.assistant_finish(uuid, text, text, integer, integer, integer, jsonb) from public;
grant execute on function public.assistant_finish(uuid, text, text, integer, integer, integer, jsonb) to anon, authenticated;

-- ── Alerts: what a person did with them ─────────────────────────────────────
create or replace function public.assistant_alert_act(p_alert bigint, p_action text, p_note text default null, p_worker uuid default null) returns public.assistant_alerts
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  a public.assistant_alerts;
  me text := coalesce(public.actor_label(), 'מנהל');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  worker_name text;
begin
  if auth.uid() is null then
    raise exception 'assistant: sign in first' using errcode = '28000';
  end if;
  select * into a from public.assistant_alerts where id = p_alert for update;
  if not found then
    raise exception 'assistant: no such alert';
  end if;

  if p_action = 'take' then
    update public.assistant_alerts set status = 'in_progress', owner_worker = null, owner_label = me where id = a.id returning * into a;
    insert into public.assistant_alert_events (alert_id, actor, action, note) values (a.id, me, 'take', v_note);
  elsif p_action = 'assign' then
    select w.name into worker_name from public.workers w where w.id = p_worker;
    if worker_name is null then
      raise exception 'assistant: choose a worker';
    end if;
    update public.assistant_alerts set status = 'in_progress', owner_worker = p_worker, owner_label = worker_name where id = a.id returning * into a;
    insert into public.assistant_alert_events (alert_id, actor, action, note, data) values (a.id, me, 'assign', v_note, jsonb_build_object('worker', worker_name));
  elsif p_action in ('resolve', 'dismiss') then
    if v_note is null then
      raise exception 'assistant: a note is required to close an alert';
    end if;
    update public.assistant_alerts
       set status = case p_action when 'resolve' then 'resolved' else 'dismissed' end, resolved_at = now(), resolved_by = me, resolution = v_note
     where id = a.id returning * into a;
    insert into public.assistant_alert_events (alert_id, actor, action, note) values (a.id, me, p_action, v_note);
  elsif p_action = 'note' then
    if v_note is null then
      raise exception 'assistant: the note is empty';
    end if;
    insert into public.assistant_alert_events (alert_id, actor, action, note) values (a.id, me, 'note', v_note);
  elsif p_action = 'reopen' then
    if exists (select 1 from public.assistant_alerts o where o.fingerprint = a.fingerprint and o.id <> a.id and o.status in ('new', 'in_progress')) then
      raise exception 'assistant: an open alert already covers this';
    end if;
    update public.assistant_alerts set status = 'in_progress', resolved_at = null, resolved_by = null, resolution = null where id = a.id returning * into a;
    insert into public.assistant_alert_events (alert_id, actor, action, note) values (a.id, me, 'reopen', v_note);
  else
    raise exception 'assistant: unknown action %', p_action;
  end if;
  return a;
end $$;
revoke all on function public.assistant_alert_act(bigint, text, text, uuid) from public, anon;
grant execute on function public.assistant_alert_act(bigint, text, text, uuid) to authenticated;

-- ── The scan ────────────────────────────────────────────────────────────────
/** Runs every rule, in SQL. Raises, updates and closes alerts; with p_briefing it also freezes the morning's facts. */
create or replace function public.assistant_scan(p_actor text default 'סריקה אוטומטית', p_briefing boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_stamp text := to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI');
  r record;
  cur public.assistant_alerts;
  v_fp text;
  v_kind text;
  v_rule text;
  v_title text;
  v_sum text;
  v_ev jsonb;
  v_id bigint;
  made integer := 0;
  cleared integer := 0;
  v_facts jsonb;
begin
  -- 1. Stock: what is missing and what to order.
  for r in select * from ai.reorder loop
    v_fp := 'stock:' || r.product_id;
    v_kind := case when r.level in ('out', 'short') then 'shortage' else 'purchase' end;
    v_rule := case r.level when 'out' then 'stock_out' when 'short' then 'stock_short' when 'low' then 'stock_low' else 'stock_soon' end;
    v_title := r.reason || ': ' || r.product;
    v_sum := case r.level
      when 'out' then 'אין יחידות על המדף'
        || case when r.reserved > 0 then ', ו-' || ai.n(r.reserved) || ' ' || r.unit || ' משוריינות ' || case when r.open_orders = 1 then 'להזמנה אחת' else 'ל-' || r.open_orders || ' הזמנות' end else '' end || '.'
      when 'short' then 'על המדף ' || ai.n(r.on_shelf) || ' ' || r.unit || ' ומשוריינות ' || ai.n(r.reserved) || ': חסרות ' || ai.n(-r.available) || ' '
        || case when r.open_orders = 1 then 'להזמנה אחת' else 'ל-' || r.open_orders || ' הזמנות' end || '.'
      when 'low' then 'זמין ' || ai.n(r.available) || ' ' || r.unit || ', המינימום ' || ai.n(r.minimum) || '.'
        || coalesce(' בקצב של ' || ai.n(r.daily_use) || ' ליום ' || ai.lasts(r.days_left) || '.', '')
      else 'זמין ' || ai.n(r.available) || ' ' || r.unit || ', יוצא בממוצע ' || ai.n(r.daily_use) || ' ליום: ' || ai.lasts(r.days_left) || '.'
    end || ' מומלץ להזמין ' || ai.n(r.suggested_qty) || ' ' || r.unit || coalesce(' מהספק ' || r.supplier, '') || '.';
    v_ev := jsonb_build_object(
      'source', 'ai.reorder', 'as_of', v_stamp,
      'product_id', r.product_id, 'sku', r.sku, 'product', r.product, 'unit', r.unit, 'supplier', r.supplier, 'level', r.level,
      'on_shelf', r.on_shelf, 'reserved', r.reserved, 'available', r.available, 'minimum', r.minimum,
      'daily_use', r.daily_use, 'days_left', r.days_left, 'suggested_qty', r.suggested_qty, 'cover_days', r.cover_days,
      'open_orders', r.open_orders, 'nearest_promise', r.nearest_promise, 'last_in_day', r.last_in_day, 'last_in_qty', r.last_in_qty,
      'orders', (select coalesce(jsonb_agg(jsonb_build_object('number', o.number, 'customer', o.customer, 'promised_on', o.promised_on, 'qty', ol.qty) order by o.promised_on nulls last), '[]'::jsonb)
                   from public.order_lines ol join public.orders o on o.id = ol.order_id
                  where ol.product_id = r.product_id and o.status = 'open'));

    select * into cur from public.assistant_alerts where fingerprint = v_fp and status in ('new', 'in_progress');
    if found then
      update public.assistant_alerts
         set kind = v_kind, rule = v_rule, severity = r.urgency, title = v_title, summary = v_sum, evidence = v_ev, last_seen_at = now()
       where id = cur.id;
      if cur.rule <> v_rule then
        insert into public.assistant_alert_events (alert_id, actor, action, note, data)
        values (cur.id, p_actor, case when r.urgency > cur.severity then 'worse' else 'better' end, v_title, jsonb_build_object('from', cur.rule, 'to', v_rule));
      end if;
    elsif not exists (
      select 1 from public.assistant_alerts
       where fingerprint = v_fp and rule = v_rule and status = 'dismissed' and resolved_at > now() - interval '7 days'
    ) then
      insert into public.assistant_alerts (kind, rule, fingerprint, severity, title, summary, evidence, entity_type, entity_id)
      values (v_kind, v_rule, v_fp, r.urgency, v_title, v_sum, v_ev, 'product', r.product_id)
      returning id into v_id;
      insert into public.assistant_alert_events (alert_id, actor, action, note) values (v_id, p_actor, 'created', v_sum);
      made := made + 1;
    end if;
  end loop;

  -- A product that came back closes its own alert, and the log says so.
  for cur in
    select a.* from public.assistant_alerts a
     where a.kind in ('shortage', 'purchase') and a.status in ('new', 'in_progress')
       and not exists (select 1 from ai.reorder x where 'stock:' || x.product_id = a.fingerprint)
  loop
    update public.assistant_alerts set status = 'resolved', resolved_at = now(), resolved_by = 'המערכת', resolution = 'המלאי חזר לתקין' where id = cur.id;
    insert into public.assistant_alert_events (alert_id, actor, action, note, data)
    values (cur.id, 'המערכת', 'cleared', 'המלאי חזר לתקין',
            (select jsonb_build_object('on_shelf', p.on_shelf, 'reserved', p.reserved, 'minimum', p.minimum) from ai.products p where p.id = cur.entity_id));
    cleared := cleared + 1;
  end loop;

  -- 2. Unusual movements of the last three days. Each movement is raised once, ever.
  for r in select * from ai.events e where e.created_at > now() - interval '3 days' loop
    v_fp := 'move:' || r.movement_id;
    if exists (select 1 from public.assistant_alerts where fingerprint = v_fp) then
      continue;
    end if;
    v_rule := r.reasons[1];
    v_title := case v_rule when 'no_receipt' then 'יציאה בלי קבלה' when 'count_gap' then 'פער בספירה' when 'big_out' then 'יציאה גדולה מהרגיל' else 'תנועה בשעה חריגה' end || ': ' || r.product;
    v_sum := case when r.type = 'adjust'
        then 'בספירה נמצאו ' || ai.n(r.qty) || ' ' || r.unit || ', ' || ai.n(abs(r.delta)) || case when r.delta < 0 then ' פחות' else ' יותר' end || ' מהרשום, בשווי ' || ai.n(round(r.worth)) || ' ₪ במחירון.'
        else 'יצאו ' || ai.n(r.qty) || ' ' || r.unit || ' בשווי ' || ai.n(round(r.worth)) || ' ₪ במחירון' || coalesce(' ללקוח ' || r.customer, '') || '.'
      end
      || case when 'no_receipt' = any (r.reasons) then ' בלי קבלה, באישור מנהל ראשי.' else '' end
      || case when 'night' = any (r.reasons) then ' בשעה ' || to_char(r.created_at at time zone 'Asia/Jerusalem', 'HH24:MI') || ', מחוץ לשעות העבודה.' else '' end
      || case when 'big_out' = any (r.reasons) then ' יציאה רגילה של המוצר: ' || ai.n(r.usual_out) || ' ' || r.unit || '.' else '' end
      || coalesce(' עובד: ' || r.worker || '.', ' בלי שם עובד.');
    v_ev := jsonb_build_object(
      'source', 'ai.events', 'as_of', v_stamp,
      'movement_id', r.movement_id, 'at', to_char(r.created_at at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI'), 'type', r.type,
      'product_id', r.product_id, 'product', r.product, 'unit', r.unit, 'qty', r.qty, 'delta', r.delta, 'worth', round(r.worth),
      'worker', r.worker, 'customer', r.customer, 'note', r.note, 'usual_out', r.usual_out, 'reasons', to_jsonb(r.reasons));
    insert into public.assistant_alerts (kind, rule, fingerprint, severity, title, summary, evidence, worth, entity_type, entity_id)
    values ('event', v_rule, v_fp, r.severity, v_title, v_sum, v_ev, round(r.worth), 'movement', r.movement_id)
    returning id into v_id;
    insert into public.assistant_alert_events (alert_id, actor, action, note) values (v_id, p_actor, 'created', v_sum);
    made := made + 1;
  end loop;

  if not p_briefing then
    return jsonb_build_object('raised', made, 'cleared', cleared, 'as_of', v_stamp);
  end if;

  -- 3. The morning's facts, frozen as they were found.
  v_facts := jsonb_build_object(
    'day', v_today, 'as_of', v_stamp, 'raised', made, 'cleared', cleared,
    'counts', jsonb_build_object(
      'urgent', (select count(*) from public.assistant_alerts where kind = 'shortage' and status in ('new', 'in_progress')),
      'purchase', (select count(*) from public.assistant_alerts where kind = 'purchase' and status in ('new', 'in_progress')),
      'events', (select count(*) from public.assistant_alerts where kind = 'event' and status in ('new', 'in_progress'))),
    'snapshot', (select to_jsonb(s) from ai.snapshot s),
    'top', (select coalesce(jsonb_agg(to_jsonb(x) order by x.severity desc, x.rank, x.worth desc nulls last, x.id), '[]'::jsonb)
              from (select a.id, a.kind, a.rule, a.severity, a.title, a.summary, a.worth, a.evidence - 'orders' as evidence,
                           case a.kind when 'shortage' then 1 when 'event' then 2 else 3 end as rank
                      from public.assistant_alerts a
                     where a.status in ('new', 'in_progress')
                     order by a.severity desc, case a.kind when 'shortage' then 1 when 'event' then 2 else 3 end, a.worth desc nulls last, a.id
                     limit 12) x),
    'purchase', (select coalesce(jsonb_agg(jsonb_build_object('supplier', g.supplier, 'items', g.items, 'lines', g.lines) order by g.items desc, g.supplier), '[]'::jsonb)
                   from (select coalesce(x.supplier, 'ללא ספק') as supplier, count(*)::int as items,
                                jsonb_agg(jsonb_build_object('product', x.product, 'qty', x.suggested_qty, 'unit', x.unit, 'reason', x.reason) order by x.urgency desc, x.product) as lines
                           from ai.reorder x group by 1) g));

  insert into public.assistant_briefings (day, facts) values (v_today, v_facts)
  on conflict (day) do update set facts = excluded.facts, narrative = null, narrated_at = null, created_at = now();
  return v_facts;
end $$;
revoke all on function public.assistant_scan(text, boolean) from public, anon, authenticated;

/** The manager's own press on סריקה עכשיו. */
create or replace function public.assistant_scan_now(p_briefing boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'assistant: sign in first' using errcode = '28000';
  end if;
  return public.assistant_scan(coalesce(public.actor_label(), 'מנהל'), p_briefing);
end $$;
revoke all on function public.assistant_scan_now(boolean) from public, anon;
grant execute on function public.assistant_scan_now(boolean) to authenticated;

-- ── The briefing, for the server that words it ──────────────────────────────
create or replace function public.assistant_briefing(p_ticket uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  b public.assistant_briefings;
begin
  perform public.assistant_who(p_ticket);
  select * into b from public.assistant_briefings order by day desc limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object('day', b.day, 'facts', b.facts, 'narrative', b.narrative, 'created_at', b.created_at);
end $$;
revoke all on function public.assistant_briefing(uuid) from public;
grant execute on function public.assistant_briefing(uuid) to anon, authenticated;

create or replace function public.assistant_narrate(p_ticket uuid, p_day date, p_narrative jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.assistant_who(p_ticket);
  if pg_column_size(p_narrative) > 20000 then
    raise exception 'assistant: the wording is too long';
  end if;
  update public.assistant_briefings set narrative = p_narrative, narrated_at = now() where day = p_day;
end $$;
revoke all on function public.assistant_narrate(uuid, date, jsonb) from public;
grant execute on function public.assistant_narrate(uuid, date, jsonb) to anon, authenticated;

-- ── What the screen reads ───────────────────────────────────────────────────
/** Everything the assistant's screen shows, in one read: the latest briefing, the alerts and what is left of the budget. */
create or replace function public.assistant_state(p_ticket uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  b public.assistant_briefings;
  cfg public.assistant_settings;
begin
  perform public.assistant_who(p_ticket);
  select * into cfg from public.assistant_settings where id = 1;
  select * into b from public.assistant_briefings order by day desc limit 1;
  return jsonb_build_object(
    'name', cfg.manager_name,
    'briefing_hour', cfg.briefing_hour,
    'now', to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI'),
    'briefing', case when b.day is null then null else jsonb_build_object('day', b.day, 'facts', b.facts, 'narrative', b.narrative, 'created_at', b.created_at) end,
    'alerts', (select coalesce(jsonb_agg(to_jsonb(a) order by (a.status in ('new', 'in_progress')) desc, a.severity desc,
                                         case a.kind when 'shortage' then 1 when 'event' then 2 else 3 end, a.worth desc nulls last, a.id), '[]'::jsonb)
                 from (select x.* from public.assistant_alerts x
                        where x.status in ('new', 'in_progress') or x.resolved_at > now() - interval '7 days'
                        order by (x.status in ('new', 'in_progress')) desc, x.id desc limit 80) a),
    'budget', public.assistant_budget());
end $$;
revoke all on function public.assistant_state(uuid) from public;
grant execute on function public.assistant_state(uuid) to anon, authenticated;

/** One alert's log: who did what, and when. */
create or replace function public.assistant_alert_log(p_ticket uuid, p_alert bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.assistant_who(p_ticket);
  return (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb) from public.assistant_alert_events e where e.alert_id = p_alert);
end $$;
revoke all on function public.assistant_alert_log(uuid, bigint) from public;
grant execute on function public.assistant_alert_log(uuid, bigint) to anon, authenticated;

-- ── The clock ───────────────────────────────────────────────────────────────
/** Every hour: alerts are refreshed; at the briefing hour in Israel the day's briefing is made and sent to be worded. */
create or replace function public.assistant_tick() returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  cfg public.assistant_settings;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_hour integer := extract(hour from now() at time zone 'Asia/Jerusalem');
  b public.assistant_briefings;
  word boolean := false;
  tk uuid;
begin
  select * into cfg from public.assistant_settings where id = 1;
  if not found or not cfg.enabled then
    return;
  end if;
  select * into b from public.assistant_briefings where day = v_today;
  if not found and v_hour >= cfg.briefing_hour then
    perform public.assistant_scan('סריקת הבוקר', true);
    word := true;
  else
    perform public.assistant_scan('סריקה שוטפת', false);
    word := b.day is not null and b.narrative is null and b.created_at > now() - interval '3 hours';
  end if;

  if word and cfg.brain_url is not null then
    insert into public.assistant_tickets (actor, kind, expires_at) values ('סריקת הבוקר', 'system', now() + interval '15 minutes') returning ticket into tk;
    perform net.http_post(
      url := cfg.brain_url || '/api/assistant/briefing',
      body := jsonb_build_object('ticket', tk),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 60000
    );
  end if;
exception when others then
  raise warning 'assistant tick: %', sqlerrm;
end $$;
revoke all on function public.assistant_tick() from public, anon, authenticated;

select cron.schedule('assistant-briefing', '0 * * * *', 'select public.assistant_tick()');
