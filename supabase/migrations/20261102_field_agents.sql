-- Field agents: who sells, what the catalogue shows, and the stock an order holds for a customer.
-- products.qty stays what is physically on the shelf. products.reserved is what open orders hold.
-- What an agent can still promise is qty - reserved.

alter table products
  add column reserved numeric(14,3) not null default 0 check (reserved >= 0),
  add column in_catalog boolean not null default true,
  add column description text,
  add column price numeric(12,2) check (price >= 0),
  add column image_path text;

create table agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create type order_status as enum ('open','delivered','cancelled');

create table orders (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity (start with 1001) unique,
  -- The phone's own id for this order, so a retry on a bad connection can't place it twice.
  request_id uuid not null unique,
  agent_id uuid not null references agents(id) on delete restrict,
  customer text not null check (btrim(customer) <> ''),
  customer_phone text,
  note text,
  status order_status not null default 'open',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index orders_status_idx on orders(status, created_at desc);
create index orders_agent_idx on orders(agent_id, created_at desc);

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  qty numeric(14,3) not null check (qty > 0),
  -- The price when the order was placed; a later price change doesn't touch it.
  unit_price numeric(12,2),
  -- Set when the order is delivered: the stock movement this line became.
  movement_id uuid references movements(id) on delete set null,
  unique (order_id, product_id)
);
create index order_lines_product_idx on order_lines(product_id);
create index order_lines_movement_idx on order_lines(movement_id);

-- The sites read; only the functions below write orders, so a reservation can't drift from its order.
alter table agents enable row level security;
alter table orders enable row level security;
alter table order_lines enable row level security;
create policy "anon read agents" on agents for select to anon, authenticated using (true);
create policy "admin add agents" on agents for insert to authenticated with check (true);
create policy "admin edit agents" on agents for update to authenticated using (true) with check (true);
create policy "anon read orders" on orders for select to anon, authenticated using (true);
create policy "anon read order lines" on order_lines for select to anon, authenticated using (true);
alter publication supabase_realtime add table agents, orders, order_lines;

-- Recounts instead of adding and subtracting, so `reserved` can never drift.
-- Locks first, in one order: a statement reading after the lock sees whatever the previous holder committed.
create or replace function recount_reserved(ids uuid[]) returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from products where id = any(ids) order by id for update;
  update products p
    set reserved = coalesce((
      select sum(l.qty) from order_lines l join orders o on o.id = l.order_id
      where l.product_id = p.id and o.status = 'open'
    ), 0)
    where p.id = any(ids);
end $$;

-- Places an order and holds its stock, all or nothing. Refused lines come back as JSON in the error's detail.
create or replace function create_order(request uuid, agent uuid, customer_name text, phone text, order_note text, items jsonb)
returns orders language plpgsql security definer set search_path = public as $$
declare
  placed orders;
  lines jsonb;
  short jsonb;
  ids uuid[];
begin
  if not exists (select 1 from agents where id = agent and active) then raise exception 'הסוכן לא פעיל'; end if;
  if coalesce(btrim(customer_name), '') = '' then raise exception 'חסר שם לקוח'; end if;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) = 0 then raise exception 'אין שורות בהזמנה'; end if;

  select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty)), array_agg(product_id)
    into lines, ids
    from (
      select (x->>'product_id')::uuid as product_id, sum((x->>'qty')::numeric) as qty
      from jsonb_array_elements(items) x group by 1
    ) merged;

  -- Two agents after the same last units queue up here, in one order so they can't deadlock.
  perform 1 from products where id = any(ids) order by id for update;

  -- Read after the lock: a retry of an order that did land returns it instead of placing it again.
  select * into placed from orders where request_id = request;
  if found then return placed; end if;

  select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'name', p.name, 'wanted', l.qty, 'available', greatest(coalesce(p.qty - p.reserved, 0), 0)))
    into short
    from jsonb_to_recordset(lines) as l(product_id uuid, qty numeric)
    left join products p on p.id = l.product_id
    where p.id is null or not p.in_catalog or l.qty <= 0 or l.qty > p.qty - p.reserved;
  if short is not null then
    raise exception 'חסר במלאי' using detail = short::text;
  end if;

  insert into orders (request_id, agent_id, customer, customer_phone, note)
    values (request, agent, btrim(customer_name), nullif(btrim(phone), ''), nullif(btrim(order_note), ''))
    returning * into placed;
  insert into order_lines (order_id, product_id, qty, unit_price)
    select placed.id, l.product_id, l.qty, p.price
    from jsonb_to_recordset(lines) as l(product_id uuid, qty numeric)
    join products p on p.id = l.product_id;
  perform recount_reserved(ids);
  return placed;
end $$;

-- The goods left: each line becomes an out movement and the hold is released, in one transaction.
create or replace function deliver_order(target_order uuid, by_worker uuid default null, receipt uuid default null)
returns orders language plpgsql security definer set search_path = public as $$
declare
  o orders;
  agent_name text;
  line order_lines;
  moved uuid;
begin
  select * into o from orders where id = target_order for update;
  if not found then raise exception 'ההזמנה לא נמצאה'; end if;
  if o.status <> 'open' then raise exception 'ההזמנה כבר טופלה'; end if;
  perform 1 from products where id in (select product_id from order_lines where order_id = o.id) order by id for update;
  select name into agent_name from agents where id = o.agent_id;
  for line in select * from order_lines where order_id = o.id loop
    insert into movements (type, product_id, qty, worker_id, reference, note, document_id)
      values ('out', line.product_id, line.qty, by_worker, 'הזמנה ' || o.number, 'ללקוח: ' || o.customer || ' · סוכן: ' || agent_name, receipt)
      returning id into moved;
    update order_lines set movement_id = moved where id = line.id;
  end loop;
  update orders set status = 'delivered', closed_at = now() where id = o.id returning * into o;
  perform recount_reserved(array(select product_id from order_lines where order_id = o.id));
  return o;
end $$;

-- Releases the hold. Stock itself never moved, so nothing else changes.
create or replace function cancel_order(target_order uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare
  o orders;
begin
  select * into o from orders where id = target_order for update;
  if not found then raise exception 'ההזמנה לא נמצאה'; end if;
  if o.status <> 'open' then raise exception 'ההזמנה כבר טופלה'; end if;
  update orders set status = 'cancelled', closed_at = now() where id = o.id returning * into o;
  perform recount_reserved(array(select product_id from order_lines where order_id = o.id));
  return o;
end $$;

revoke execute on function recount_reserved(uuid[]) from public, anon, authenticated;
revoke execute on function create_order(uuid, uuid, text, text, text, jsonb) from public;
revoke execute on function deliver_order(uuid, uuid, uuid) from public;
revoke execute on function cancel_order(uuid) from public;
grant execute on function create_order(uuid, uuid, text, text, text, jsonb) to anon, authenticated;
grant execute on function deliver_order(uuid, uuid, uuid) to anon, authenticated;
grant execute on function cancel_order(uuid) to anon, authenticated;

-- Product photos for the catalogue. Everyone reads, the signed-in admin manages.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos','product-photos', true, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;
create policy "anon read product photos" on storage.objects for select to anon, authenticated using (bucket_id = 'product-photos');
create policy "admin upload product photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and (storage.extension(name)) in ('jpg','jpeg','png','webp','heic','heif'));
create policy "admin replace product photos" on storage.objects for update to authenticated using (bucket_id = 'product-photos');
create policy "admin delete product photos" on storage.objects for delete to authenticated using (bucket_id = 'product-photos');
