-- Applied 2026-10-31 via MCP execute_sql.
-- Fault reports may carry a photo taken by the worker; stored in the public 'fault-photos' bucket.
alter table public.faults add column if not exists photo_path text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fault-photos','fault-photos', true, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;
create policy "anon read fault photos" on storage.objects for select to anon, authenticated using (bucket_id = 'fault-photos');
create policy "anon upload fault photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'fault-photos' and (storage.extension(name)) in ('jpg','jpeg','png','webp','heic','heif'));
