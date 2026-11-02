-- Applied 2026-11-01 via MCP execute_sql.
-- Receipt lines the worker could not settle alone. Nothing leaves stock until the manager decides.
create type item_request_kind as enum ('unknown','new_product');
create type item_request_status as enum ('pending','approved','rejected');
create table item_requests (
  id uuid primary key default gen_random_uuid(),
  kind item_request_kind not null,
  status item_request_status not null default 'pending',
  external_name text not null,
  normalized_name text generated always as (normalize_name(external_name)) stored,
  proposed_name text,
  qty numeric(14,3) not null check (qty > 0),
  customer text,
  reference text,
  note text,
  worker_note text,
  worker_id uuid references workers(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  movement_id uuid references movements(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index item_requests_status_idx on item_requests(status, created_at desc);
create index item_requests_name_idx on item_requests(normalized_name) where status = 'approved';
create index item_requests_worker_idx on item_requests(worker_id);
create index item_requests_product_idx on item_requests(product_id);
create index item_requests_movement_idx on item_requests(movement_id);
alter table item_requests enable row level security;
create policy "anon all item_requests" on item_requests for all to anon, authenticated using (true) with check (true);
alter publication supabase_realtime add table item_requests;

-- One transaction, so an approval can never close the request without the stock movement (or issue it twice).
create or replace function approve_item_request(request_id uuid, target_product_id uuid) returns item_requests language plpgsql set search_path = public as $$
declare
  req item_requests;
  moved uuid;
begin
  select * into req from item_requests where id = request_id and status = 'pending' for update;
  if not found then raise exception 'הבקשה כבר טופלה'; end if;
  insert into movements (type, product_id, qty, worker_id, reference, note, external_name)
    values ('out', target_product_id, req.qty, req.worker_id, req.reference, req.note, req.external_name)
    returning id into moved;
  update item_requests set status = 'approved', product_id = target_product_id, movement_id = moved, resolved_at = now()
    where id = request_id returning * into req;
  return req;
end $$;
grant execute on function approve_item_request(uuid, uuid) to anon, authenticated;
