-- Goods leave the warehouse with an archived receipt, or by a super admin who has just proved it
-- with an SMS code. The rule lives here because the public key sits in every browser: whatever a
-- screen refuses can still be sent straight to the API.
--
-- products.qty moves only through the movements_apply trigger, and movements_guard checks each row
-- on its way there, whoever sends it, the functions below included. Nothing here trusts the role
-- `authenticated` alone, since signing up is enough to hold it.

-- Who may take goods out with no receipt. Closed to the public key, like login_phones.
-- Add one with: insert into super_admins (phone, note) values ('972501234567', 'בעלים');
create table super_admins (
  phone text primary key check (phone ~ '^[1-9][0-9]{6,14}$'), -- international, no plus, as auth.users stores it
  note text,
  created_at timestamptz not null default now()
);

-- Each code spent on a receipt-less exit: who, why and when.
create table exit_passes (
  id uuid primary key default gen_random_uuid(),
  -- The session the code opened. Unique, so one code clears one action.
  session_id uuid not null unique,
  user_id uuid not null,
  phone text not null,
  reason text not null,
  -- A movement can carry a pass only inside the transaction that claimed it.
  tx bigint not null default txid_current(),
  created_at timestamptz not null default now()
);

alter table super_admins enable row level security;
alter table exit_passes enable row level security;
revoke all on table super_admins, exit_passes from anon, authenticated;

alter table movements add column exit_pass uuid references exit_passes(id);
create index movements_exit_pass_idx on movements(exit_pass);

-- The one gate. It fires for every role, security definer functions included.
create function guard_movement() returns trigger language plpgsql security definer set search_path = public as $$
declare
  shelf numeric;
  receipt documents;
  photo_tag text;
begin
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
end $$;
create trigger movements_guard before insert on movements for each row execute function guard_movement();

-- The three guards below pass only `postgres`: the owner behind the functions and the triggers, and
-- behind foreign key actions, so deleting a supplier still clears its name from a movement.

-- The stock changes through a movement and nothing else.
create function guard_stock() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'postgres' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.qty > 0 or old.reserved > 0 then raise exception 'אי אפשר למחוק מוצר שיש לו מלאי'; end if;
    return old;
  end if;
  if (new.qty, new.reserved) is distinct from (old.qty, old.reserved) then
    raise exception 'המלאי משתנה רק דרך תנועה';
  end if;
  return new;
end $$;
create trigger products_stock before update or delete on products for each row execute function guard_stock();

-- What moved stock stays as it was written. Its reference and note stay open: the archive and the fault report edit them.
create function guard_movement_history() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'postgres' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'תנועת מלאי לא נמחקת'; end if;
  if (new.type, new.qty, new.document_id, new.exit_pass, new.worker_id, new.created_at)
     is distinct from (old.type, old.qty, old.document_id, old.exit_pass, old.worker_id, old.created_at)
     or (new.product_id <> old.product_id and old.type <> 'fault') then
    raise exception 'תנועת מלאי לא נערכת';
  end if;
  return new;
end $$;
create trigger movements_history before update or delete on movements for each row execute function guard_movement_history();

-- Deleting a receipt would leave its exit undocumented, so it stays. Its customer and number can still be corrected.
create function guard_receipt() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'postgres' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from movements where document_id = old.id and type = 'out') then
      raise exception 'קבלה של הוצאה לא נמחקת';
    end if;
    return old;
  end if;
  if (new.kind, new.storage_path, new.worker_id, new.created_at)
     is distinct from (old.kind, old.storage_path, old.worker_id, old.created_at) then
    raise exception 'התמונה והמועד של קבלה לא נערכים';
  end if;
  return new;
end $$;
create trigger documents_receipt before update or delete on documents for each row execute function guard_receipt();

revoke execute on function guard_movement(), guard_stock(), guard_movement_history(), guard_receipt() from public, anon, authenticated;

-- removeWithPhoto deletes the row first, so a photo goes only once nothing points at it.
drop policy "admin delete delivery notes" on storage.objects;
create policy "admin delete delivery notes" on storage.objects for delete to authenticated
  using (bucket_id = 'delivery-notes' and not exists (select 1 from public.documents d where d.storage_path = objects.name));

-- The worker app and the catalogue only read products, and only ever add movements.
revoke insert, update, delete on products from anon;
revoke update, delete on movements from anon;
revoke delete on movements from authenticated;

-- The manager's decision on a worker's line, so the phones lose it. The line's receipt comes along.
create or replace function approve_item_request(request_id uuid, target_product_id uuid) returns item_requests language plpgsql set search_path = public as $$
declare
  req item_requests;
  moved uuid;
begin
  select * into req from item_requests where id = request_id and status = 'pending' for update;
  if not found then raise exception 'הבקשה כבר טופלה'; end if;
  insert into movements (type, product_id, qty, worker_id, reference, note, external_name, document_id)
    values ('out', target_product_id, req.qty, req.worker_id, req.reference, req.note, req.external_name, req.document_id)
    returning id into moved;
  update item_requests set status = 'approved', product_id = target_product_id, movement_id = moved, resolved_at = now()
    where id = request_id returning * into req;
  return req;
end $$;
revoke execute on function approve_item_request(uuid, uuid) from public, anon;
grant execute on function approve_item_request(uuid, uuid) to authenticated;

-- The phone behind this session when it belongs to a super admin, otherwise null.
create function super_admin_phone() returns text language sql stable security definer set search_path = public as $$
  select s.phone from super_admins s join auth.users u on u.phone = s.phone where u.id = auth.uid();
$$;

-- Spends the SMS code that opened this session. A session that began with a password has no `otp`
-- entry however it is refreshed, and a failed action rolls this back, so the code survives a retry.
create function claim_exit_pass(why text) returns uuid language plpgsql security definer set search_path = public as $$
declare
  claims jsonb := auth.jwt();
  caller text := super_admin_phone();
  proved_at numeric;
  pass uuid;
begin
  if caller is null then raise exception 'רק מנהל ראשי יכול להוציא בלי קבלה'; end if;
  if coalesce(btrim(why), '') = '' then raise exception 'חסרה סיבה'; end if;
  select max((entry->>'timestamp')::numeric) into proved_at
    from jsonb_array_elements(claims->'amr') entry where entry->>'method' = 'otp';
  if proved_at is null or proved_at < extract(epoch from now()) - 300 then
    raise exception 'צריך קוד חדש לנייד';
  end if;
  insert into exit_passes (session_id, user_id, phone, reason)
    values ((claims->>'session_id')::uuid, auth.uid(), caller, btrim(why))
    on conflict (session_id) do nothing
    returning id into pass;
  if pass is null then raise exception 'הקוד כבר נוצל. צריך קוד חדש'; end if;
  return pass;
end $$;

-- A receipt-less exit, or a count that lowers the shelf.
create function remove_without_receipt(kind movement_type, product uuid, amount numeric, why text, by_worker uuid default null, customer text default null, ref text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if kind not in ('out', 'adjust') then raise exception 'פעולה לא מוכרת'; end if;
  insert into movements (type, product_id, qty, worker_id, reference, note, exit_pass)
    values (kind, product, amount, by_worker, nullif(btrim(ref), ''),
            concat_ws(' · ', 'ללקוח: ' || nullif(btrim(customer), ''), 'בלי קבלה: ' || btrim(why)),
            claim_exit_pass(why));
end $$;

-- The goods left: each line becomes an out movement and the hold is released, in one transaction.
create function post_order(target_order uuid, by_worker uuid, receipt uuid, pass uuid, why text)
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
    insert into movements (type, product_id, qty, worker_id, reference, note, document_id, exit_pass)
      values ('out', line.product_id, line.qty, by_worker, 'הזמנה ' || o.number,
              concat_ws(' · ', 'ללקוח: ' || o.customer, 'סוכן: ' || agent_name, 'בלי קבלה: ' || btrim(why)), receipt, pass)
      returning id into moved;
    update order_lines set movement_id = moved where id = line.id;
  end loop;
  update orders set status = 'delivered', closed_at = now() where id = o.id returning * into o;
  perform recount_reserved(array(select product_id from order_lines where order_id = o.id));
  return o;
end $$;

create or replace function deliver_order(target_order uuid, by_worker uuid default null, receipt uuid default null)
returns orders language sql security definer set search_path = public as $$
  select * from post_order(target_order, by_worker, receipt, null, null);
$$;

create function deliver_order_no_receipt(target_order uuid, why text)
returns orders language sql security definer set search_path = public as $$
  select * from post_order(target_order, null, null, claim_exit_pass(why), why);
$$;

revoke execute on function claim_exit_pass(text), post_order(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function super_admin_phone(), remove_without_receipt(movement_type, uuid, numeric, text, uuid, text, text), deliver_order_no_receipt(uuid, text) from public, anon;
grant execute on function super_admin_phone(), remove_without_receipt(movement_type, uuid, numeric, text, uuid, text, text), deliver_order_no_receipt(uuid, text) to authenticated;
