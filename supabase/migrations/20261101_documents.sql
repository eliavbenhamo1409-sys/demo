-- Applied 2026-11-01 via MCP.
-- Archive of the photographed goods-in and goods-out receipts.
-- The bucket is private and read through expiring signed URLs. There is no update or delete policy
-- on the bucket or the table: an archived document can't be replaced or removed from the apps.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-notes','delivery-notes', false, 20971520, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;
create policy "anon read delivery notes" on storage.objects for select to anon, authenticated using (bucket_id = 'delivery-notes');
create policy "anon upload delivery notes" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'delivery-notes' and (storage.extension(name)) in ('jpg','jpeg','png','webp','heic','heif'));

create type document_kind as enum ('in','out');
create table documents (
  id uuid primary key default gen_random_uuid(),
  kind document_kind not null,
  storage_path text not null unique,
  supplier_id uuid references suppliers(id) on delete set null,
  customer text,
  reference text,
  worker_id uuid references workers(id) on delete set null,
  created_at timestamptz not null default now()
);
create index documents_kind_idx on documents(kind, created_at desc);
create index documents_supplier_idx on documents(supplier_id);
create index documents_worker_idx on documents(worker_id);
alter table documents enable row level security;
create policy "anon read documents" on documents for select to anon, authenticated using (true);
create policy "anon add documents" on documents for insert to anon, authenticated with check (true);
alter publication supabase_realtime add table documents;

alter table movements add column document_id uuid references documents(id) on delete set null;
alter table item_requests add column document_id uuid references documents(id) on delete set null;
create index movements_document_idx on movements(document_id);
create index item_requests_document_idx on item_requests(document_id);
