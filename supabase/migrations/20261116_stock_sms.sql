-- A product that falls under its minimum or runs out sends the manager an SMS, to the phone the login and exit codes
-- already go to (super_admins). The levels are the stock page's, in its order of need:
--   ok < low (מתחת למינימום) < short (חסר להזמנות) < out (אזל)
-- and a message goes out when a product's level gets worse.
--
-- stock_alerts            one row per product whose level got worse through the apps; the stock-sms edge function takes them
--                         and writes what came of each (sent, resolved, expired, not_configured, failed, limit, no_phone)
-- sms_outbox              every message the function sent or tried to send, with its text; the daily limit counts it
-- super_admins.stock_sms  a manager can be left out of these messages and still get the codes
--
-- Calm by rule:
--   * The level is weighed once per product per transaction, at commit, from before the first change to after the last,
--     so a delivery that releases an order and takes the goods in two steps is one change, not a false alarm.
--   * Only stock that moved: a new minimum typed by the manager is not news to them.
--   * Only through the apps: SQL scripts and seeds carry no request and stay silent (a script that does carry one can
--     `set local app.stock_sms = 'off'`).
--   * The same product at the same level is told once in twelve hours; the function waits eight seconds so one exit is
--     one message, and sends at most ten messages a day to a phone.
-- The text goes out through Twilio with the edge function's own secrets: Supabase's phone provider only sends login codes.

alter table public.super_admins add column if not exists stock_sms boolean not null default true;

-- The stock page's levelOf (src/app/inventory/page.tsx), word for word.
create or replace function public.stock_level(p_qty numeric, p_reserved numeric, p_min numeric)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when coalesce(p_qty, 0) <= 0 then 'out'
    when coalesce(p_qty, 0) - coalesce(p_reserved, 0) < 0 then 'short'
    when coalesce(p_min, 0) > 0 and coalesce(p_qty, 0) - coalesce(p_reserved, 0) < p_min then 'low'
    else 'ok'
  end
$function$;

create or replace function public.stock_level_rank(p_level text)
 returns integer
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_level when 'out' then 3 when 'short' then 2 when 'low' then 1 else 0 end
$function$;

create table if not exists public.stock_alerts (
  id bigint generated always as identity primary key,
  product_id uuid references public.products(id) on delete cascade,
  level text not null check (level in ('low', 'short', 'out', 'test')),
  from_level text check (from_level in ('ok', 'low', 'short', 'out')),
  qty numeric,
  reserved numeric,
  min_qty numeric,
  created_at timestamptz not null default now(),
  taken_at timestamptz,
  outcome text check (outcome in ('sent', 'resolved', 'expired', 'not_configured', 'failed', 'limit', 'no_phone')),
  detail text,
  check ((level = 'test') = (product_id is null))
);
create index if not exists stock_alerts_recent on public.stock_alerts (product_id, level, created_at desc);
create index if not exists stock_alerts_waiting on public.stock_alerts (created_at) where taken_at is null;
alter table public.stock_alerts enable row level security;
revoke all on table public.stock_alerts from anon, authenticated;

create table if not exists public.sms_outbox (
  id bigint generated always as identity primary key,
  phone text not null,
  body text not null,
  alert_ids bigint[] not null default '{}',
  status text not null check (status in ('sent', 'failed', 'not_configured', 'limit')),
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists sms_outbox_phone_day on public.sms_outbox (phone, created_at desc);
alter table public.sms_outbox enable row level security;
revoke all on table public.sms_outbox from anon, authenticated;

create or replace function public.products_stock_sms()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  seen text;
  cur record;
  was text;
  became text;
begin
  if new.qty is not distinct from old.qty and new.reserved is not distinct from old.reserved then return null; end if;
  begin
    -- Fired at commit, in the order of the changes: the first one of a product holds its state before the transaction,
    -- the table holds its state after it. Later changes of the same product were already weighed.
    seen := coalesce(current_setting('app.stock_sms_seen', true), '');
    if position(new.id::text in seen) > 0 then return null; end if;
    perform set_config('app.stock_sms_seen', seen || new.id::text || ',', true);

    select qty, reserved, min_qty into cur from products where id = new.id;
    if not found then return null; end if;
    was := stock_level(old.qty, old.reserved, old.min_qty);
    became := stock_level(cur.qty, cur.reserved, cur.min_qty);
    if stock_level_rank(became) <= stock_level_rank(was) then return null; end if;

    -- Only what happened through the apps.
    if nullif(current_setting('request.jwt.claims', true), '') is null then return null; end if;
    if current_setting('app.stock_sms', true) = 'off' then return null; end if;

    -- The same product at the same level is told once in twelve hours (a message that never went out doesn't count).
    if exists (
      select 1 from stock_alerts
       where product_id = new.id and level = became and created_at > now() - interval '12 hours'
         and (taken_at is null or outcome = 'sent')
    ) then
      return null;
    end if;

    insert into stock_alerts (product_id, level, from_level, qty, reserved, min_qty)
    values (new.id, became, was, cur.qty, cur.reserved, cur.min_qty);

    -- One call per transaction; pg_net sends it once the transaction has committed.
    if current_setting('app.stock_sms_called', true) is distinct from 'yes' then
      perform set_config('app.stock_sms_called', 'yes', true);
      perform net.http_post(
        url := 'https://iruwqnlqlaffriskowcq.supabase.co/functions/v1/stock-sms',
        body := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 60000
      );
    end if;
  exception when others then
    -- A message must never cost a movement.
    raise warning 'stock sms: %', sqlerrm;
  end;
  return null;
end $function$;

drop trigger if exists products_stock_sms on public.products;
create constraint trigger products_stock_sms
  after update of qty, reserved on public.products
  deferrable initially deferred
  for each row execute function public.products_stock_sms();

-- The edge function's one read: takes every waiting alert with its product as it stands now, and the phones to tell.
create or replace function public.stock_sms_take()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  alerts jsonb;
  phones jsonb;
  day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
begin
  -- Half an hour late is old news; the stock page holds the state.
  update stock_alerts set taken_at = now(), outcome = 'expired'
   where taken_at is null and created_at < now() - interval '30 minutes';

  with taken as (
    update stock_alerts set taken_at = now()
     where taken_at is null
    returning id, product_id, level, from_level, created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'level', t.level,
           'from_level', t.from_level,
           'product_id', t.product_id,
           'name', p.name,
           'unit', p.unit,
           'qty', p.qty,
           'reserved', p.reserved,
           'min_qty', p.min_qty,
           'now', case when p.id is null then null else stock_level(p.qty, p.reserved, p.min_qty) end
         ) order by t.created_at, t.id), '[]'::jsonb)
    into alerts
    from taken t
    left join products p on p.id = t.product_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'phone', s.phone,
           'today', (select count(*) from sms_outbox o where o.phone = s.phone and o.status = 'sent' and o.created_at >= day_start)
         )), '[]'::jsonb)
    into phones
    from super_admins s
   where s.stock_sms;

  return jsonb_build_object('alerts', alerts, 'phones', phones);
end $function$;

-- A test message to every manager phone, to check the Twilio secrets from SQL: select stock_sms_test();
create or replace function public.stock_sms_test()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into stock_alerts (level) values ('test');
  perform net.http_post(
    url := 'https://iruwqnlqlaffriskowcq.supabase.co/functions/v1/stock-sms',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
end $function$;

revoke all on function public.stock_sms_take() from public, anon, authenticated;
revoke all on function public.stock_sms_test() from public, anon, authenticated;
revoke all on function public.products_stock_sms() from public, anon, authenticated;
grant execute on function public.stock_sms_take() to service_role;
