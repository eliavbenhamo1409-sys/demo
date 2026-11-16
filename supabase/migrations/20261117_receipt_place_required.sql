-- Goods in by a worker say where they were put (2026-11-17, the owner's words: "קליטת סחורה מעובד מחויבת בכתיבה היכן היא מוקמה").
-- The worker's screen asks on its מיקום step; the rule is the database's, for every way in, as with the receipt gate.
-- It holds for a receipt that names a worker, whoever is signed in, and for any receipt sent with no login (the public key).
-- The manager's own receipt in the admin, signed in and with no worker, keeps its place optional.
-- Old rows keep what they have: the rule reads only new rows, and a place once written can't be emptied.

create or replace function public.guard_movement()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  shelf numeric;
  receipt documents;
  photo_tag text;
begin
  if new.type = 'in' and (new.worker_id is not null or auth.role() = 'anon') and coalesce(btrim(new.place), '') = '' then
    raise exception 'חסר מיקום';
  end if;

  if new.exit_pass is not null then
    if not exists (select 1 from exit_passes where id = new.exit_pass and tx = txid_current()) then
      raise exception 'האישור לא תקף';
    end if;
    return new;
  end if;

  if new.type = 'adjust' then
    -- Locked, so the count compared here is still the count movements_apply overwrites.
    select qty into shelf from products where id = new.product_id for update;
    if new.qty < shelf then raise exception 'הורדת כמות בספירה דורשת קוד של מנהל ראשי'; end if;
  elsif new.type = 'out' then
    select * into receipt from documents where id = new.document_id;
    if not found or receipt.kind <> 'out' then raise exception 'חסרה קבלה'; end if;
    select metadata->>'eTag' into photo_tag from storage.objects where bucket_id = 'delivery-notes' and name = receipt.storage_path;
    if not found then raise exception 'תמונת הקבלה לא נמצאה'; end if;
    -- The same file under a new document is an old receipt covering a new exit.
    if exists (
      select 1 from storage.objects o
        join documents d on d.storage_path = o.name and d.id <> receipt.id
        join movements m on m.document_id = d.id
      where o.bucket_id = 'delivery-notes' and o.metadata->>'eTag' = photo_tag
    ) then
      raise exception 'הקבלה הזו כבר שימשה בהוצאה אחרת';
    end if;
  end if;
  return new;
end $function$;

create or replace function public.guard_movement_history()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user = 'postgres' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'תנועת מלאי לא נמחקת'; end if;
  if (new.type, new.qty, new.document_id, new.exit_pass, new.worker_id, new.created_at)
     is distinct from (old.type, old.qty, old.document_id, old.exit_pass, old.worker_id, old.created_at)
     or (new.product_id <> old.product_id and old.type <> 'fault') then
    raise exception 'תנועת מלאי לא נערכת';
  end if;
  -- A worker's receipt keeps where the goods went.
  if new.type = 'in' and new.worker_id is not null and coalesce(btrim(new.place), '') = '' and coalesce(btrim(old.place), '') <> '' then
    raise exception 'חסר מיקום';
  end if;
  return new;
end $function$;
