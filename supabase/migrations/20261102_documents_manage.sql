-- The תיעוד page edits and deletes archive records. Scoped to `authenticated`: the admin signs in
-- and the worker app runs as `anon`, so the phones still can't change or remove a document.
-- Faults need no table policy here, "anon all faults" already covers them.
create policy "admin edit documents" on documents for update to authenticated using (true) with check (true);
create policy "admin delete documents" on documents for delete to authenticated using (true);
create policy "admin delete delivery notes" on storage.objects for delete to authenticated using (bucket_id = 'delivery-notes');
create policy "admin delete fault photos" on storage.objects for delete to authenticated using (bucket_id = 'fault-photos');
