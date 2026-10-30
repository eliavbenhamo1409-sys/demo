-- Applied to project iruwqnlqlaffriskowcq on 2026-10-30 via MCP (execute_sql). Kept here as the source of truth.
create extension if not exists "pgcrypto";
create type movement_type as enum ('in','out','fault','adjust');
create type mapping_status as enum ('approved','pending');
create type fault_status as enum ('open','resolved');
create table workers (id uuid primary key default gen_random_uuid(), name text not null, role text not null default 'עובד', active boolean not null default true, created_at timestamptz not null default now());
create table suppliers (id uuid primary key default gen_random_uuid(), name text not null unique, contact text, phone text, email text, notes text, created_at timestamptz not null default now());
create table products (id uuid primary key default gen_random_uuid(), sku text not null unique, name text not null, category text, unit text not null default 'יח׳', qty numeric(14,3) not null default 0, min_qty numeric(14,3) not null default 0, location text, primary_supplier_id uuid references suppliers(id) on delete set null, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index products_supplier_idx on products(primary_supplier_id);
create table movements (id uuid primary key default gen_random_uuid(), type movement_type not null, product_id uuid not null references products(id) on delete restrict, qty numeric(14,3) not null check (qty >= 0), worker_id uuid references workers(id) on delete set null, supplier_id uuid references suppliers(id) on delete set null, reference text, note text, created_at timestamptz not null default now());
create index movements_product_idx on movements(product_id, created_at desc);
create index movements_created_idx on movements(created_at desc);
create index movements_worker_idx on movements(worker_id);
create index movements_supplier_idx on movements(supplier_id);
create table faults (id uuid primary key default gen_random_uuid(), product_id uuid references products(id) on delete set null, movement_id uuid references movements(id) on delete set null, description text not null, reported_by uuid references workers(id) on delete set null, status fault_status not null default 'open', created_at timestamptz not null default now(), resolved_at timestamptz);
create index faults_status_idx on faults(status, created_at desc);
create index faults_product_idx on faults(product_id);
create index faults_movement_idx on faults(movement_id);
create index faults_reported_by_idx on faults(reported_by);
create table supplier_items (id uuid primary key default gen_random_uuid(), supplier_id uuid not null references suppliers(id) on delete cascade, external_name text not null, external_sku text, product_id uuid references products(id) on delete set null, status mapping_status not null default 'pending', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (supplier_id, external_name, external_sku));
create index supplier_items_status_idx on supplier_items(status);
create index supplier_items_product_idx on supplier_items(product_id);
create or replace function apply_movement() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'in' then update products set qty = qty + new.qty, updated_at = now() where id = new.product_id;
  elsif new.type = 'out' then update products set qty = greatest(qty - new.qty, 0), updated_at = now() where id = new.product_id;
  elsif new.type = 'adjust' then update products set qty = new.qty, updated_at = now() where id = new.product_id;
  end if;
  return new;
end $$;
create trigger movements_apply after insert on movements for each row execute function apply_movement();
create or replace function touch_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end $$;
create trigger products_touch before update on products for each row execute function touch_updated_at();
create trigger supplier_items_touch before update on supplier_items for each row execute function touch_updated_at();
alter table workers enable row level security; alter table suppliers enable row level security; alter table products enable row level security;
alter table movements enable row level security; alter table faults enable row level security; alter table supplier_items enable row level security;
create policy "anon all workers" on workers for all to anon, authenticated using (true) with check (true);
create policy "anon all suppliers" on suppliers for all to anon, authenticated using (true) with check (true);
create policy "anon all products" on products for all to anon, authenticated using (true) with check (true);
create policy "anon all movements" on movements for all to anon, authenticated using (true) with check (true);
create policy "anon all faults" on faults for all to anon, authenticated using (true) with check (true);
create policy "anon all supplier_items" on supplier_items for all to anon, authenticated using (true) with check (true);
alter publication supabase_realtime add table products, movements, faults, supplier_items, suppliers, workers;
-- trigger functions are not an API surface
revoke execute on function public.apply_movement() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
