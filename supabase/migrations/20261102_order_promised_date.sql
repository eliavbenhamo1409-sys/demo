-- The day the agent promised the customer delivery. The warehouse works to this date.
alter table orders add column promised_on date;
create index orders_promised_idx on orders(promised_on) where status = 'open';

-- Orders from before this date existed: a closed one kept its promise the day it closed.
update orders set promised_on = coalesce(closed_at, created_at + interval '3 days')::date where promised_on is null;

-- `promised` comes last with a default so a phone still on the previous version keeps ordering; the catalogue always sends it.
drop function create_order(uuid, uuid, text, text, text, jsonb);
create function create_order(request uuid, agent uuid, customer_name text, phone text, order_note text, items jsonb, promised date default null)
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

  -- After the retry check: an order that landed yesterday stays landed even though its date has passed.
  if promised < (now() at time zone 'Asia/Jerusalem')::date then raise exception 'תאריך המסירה כבר עבר'; end if;

  select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'name', p.name, 'wanted', l.qty, 'available', greatest(coalesce(p.qty - p.reserved, 0), 0)))
    into short
    from jsonb_to_recordset(lines) as l(product_id uuid, qty numeric)
    left join products p on p.id = l.product_id
    where p.id is null or not p.in_catalog or l.qty <= 0 or l.qty > p.qty - p.reserved;
  if short is not null then
    raise exception 'חסר במלאי' using detail = short::text;
  end if;

  insert into orders (request_id, agent_id, customer, customer_phone, note, promised_on)
    values (request, agent, btrim(customer_name), nullif(btrim(phone), ''), nullif(btrim(order_note), ''), promised)
    returning * into placed;
  insert into order_lines (order_id, product_id, qty, unit_price)
    select placed.id, l.product_id, l.qty, p.price
    from jsonb_to_recordset(lines) as l(product_id uuid, qty numeric)
    join products p on p.id = l.product_id;
  perform recount_reserved(ids);
  return placed;
end $$;

revoke execute on function create_order(uuid, uuid, text, text, text, jsonb, date) from public;
grant execute on function create_order(uuid, uuid, text, text, text, jsonb, date) to anon, authenticated;

-- So the API sees the new function at once.
notify pgrst, 'reload schema';
