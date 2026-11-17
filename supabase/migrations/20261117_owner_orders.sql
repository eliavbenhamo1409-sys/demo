-- The owner places an order from the admin the way an agent does from the catalogue.
-- Such an order belongs to no agent: a direct order (הזמנה ישירה). Only the admin's own login
-- may leave the agent out; the catalogue runs on the public key and keeps naming its agent.

alter table orders alter column agent_id drop not null;

-- Unchanged but the first check: an agent, when given, must still be active.
create or replace function create_order(request uuid, agent uuid, customer_name text, phone text, order_note text, items jsonb, promised date default null)
returns orders language plpgsql security definer set search_path = public as $$
declare
  placed orders;
  lines jsonb;
  short jsonb;
  ids uuid[];
begin
  if agent is null then
    if coalesce(auth.role(), '') <> 'authenticated' then raise exception 'חסר סוכן'; end if;
  elsif not exists (select 1 from agents where id = agent and active) then
    raise exception 'הסוכן לא פעיל';
  end if;
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

-- סגירת יום: a direct order has no agent row, and an inner join would drop it from the day's open orders.
-- The only change from the live body is `left join agents`.
create or replace function day_summary(target date)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  day_start timestamptz := target::timestamp at time zone 'Asia/Jerusalem';
  day_end timestamptz := (target + 1)::timestamp at time zone 'Asia/Jerusalem';
  today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  return jsonb_build_object(
    'day', target,

    -- By product and by who it came from or went to. Quantities never add up across products, only worth does.
    'moved', (
      select coalesce(jsonb_agg(r order by r.worth desc nulls last, r.name), '[]'::jsonb) from (
        select m.type, m.product_id, p.name, p.unit,
          coalesce(s.name, btrim(substring(m.note from 'ללקוח: ([^·]+)'))) as party,
          sum(m.qty) as qty,
          sum(m.qty * p.price) as worth,
          count(*) filter (where m.type = 'out' and m.document_id is null) as no_receipt
        from movements m
        join products p on p.id = m.product_id
        left join suppliers s on s.id = m.supplier_id
        where m.type in ('in', 'out') and m.created_at >= day_start and m.created_at < day_end
        group by 1, 2, 3, 4, 5
      ) r
    ),

    -- What stood open when the day ended: anything that closed later still counts for this day.
    'orders', (
      select coalesce(jsonb_agg(r order by r.created_at), '[]'::jsonb) from (
        select o.id, o.number, o.customer, a.name as agent, o.created_at, to_jsonb(o)->>'promised_on' as promised_on,
          (select count(*) from order_lines l where l.order_id = o.id) as lines
        from orders o
        left join agents a on a.id = o.agent_id
        where o.created_at < day_end and (o.status = 'open' or o.closed_at >= day_end)
      ) r
    ),
    'requests', (
      select coalesce(jsonb_agg(r order by r.created_at), '[]'::jsonb) from (
        select i.id, coalesce(nullif(btrim(i.proposed_name), ''), i.external_name) as name, i.qty, i.customer, w.name as worker, i.created_at
        from item_requests i
        left join workers w on w.id = i.worker_id
        where i.created_at < day_end and (i.status = 'pending' or i.resolved_at >= day_end)
      ) r
    ),
    'faults', (
      select coalesce(jsonb_agg(r order by r.created_at), '[]'::jsonb) from (
        select f.id, f.description, p.name as product, w.name as worker, f.created_at
        from faults f
        left join products p on p.id = f.product_id
        left join workers w on w.id = f.reported_by
        where f.created_at < day_end and (f.status = 'open' or f.resolved_at >= day_end)
      ) r
    ),
    'names', (
      select coalesce(jsonb_agg(r order by r.created_at), '[]'::jsonb) from (
        select i.id, i.external_name as name, s.name as supplier, i.created_at
        from supplier_items i
        join suppliers s on s.id = i.supplier_id
        where i.created_at < day_end and (i.status = 'pending' or i.approved_at >= day_end)
      ) r
    ),

    -- Stock keeps no history, so only today and the night right after it can say what ran out.
    'stock', case when target >= today - 1 then (
      select coalesce(jsonb_agg(r order by r.state = 'low', r.state = 'out', r.name), '[]'::jsonb) from (
        select p.id as product_id, p.name, p.unit, p.qty, p.reserved, p.min_qty,
          case when p.qty - p.reserved < 0 then 'short' when p.qty <= 0 then 'out' else 'low' end as state
        from products p
        where p.qty - p.reserved < 0 or p.qty <= 0 or (p.min_qty > 0 and p.qty - p.reserved < p.min_qty)
      ) r
    ) end,

    -- Only what the admin alone can do. An order counts when no worker carried it out.
    'actions', (
      select coalesce(jsonb_agg(r order by r.at desc), '[]'::jsonb) from (
        select 'request_approved' as kind, i.resolved_at as at, coalesce(p.name, i.external_name) as title, i.customer as detail, i.qty, p.unit
          from item_requests i
          left join products p on p.id = i.product_id
          where i.status = 'approved' and i.resolved_at >= day_start and i.resolved_at < day_end
        union all
        select 'request_rejected', i.resolved_at, coalesce(nullif(btrim(i.proposed_name), ''), i.external_name), i.customer, i.qty, null
          from item_requests i
          where i.status = 'rejected' and i.resolved_at >= day_start and i.resolved_at < day_end
        union all
        select 'name_approved', i.approved_at, i.external_name, s.name, null, null
          from supplier_items i
          join suppliers s on s.id = i.supplier_id
          where i.status = 'approved' and i.approved_at >= day_start and i.approved_at < day_end
        union all
        select 'count', m.created_at, p.name, m.note, m.qty, p.unit
          from movements m
          join products p on p.id = m.product_id
          where m.type = 'adjust' and m.created_at >= day_start and m.created_at < day_end
        union all
        select 'no_receipt', m.created_at, p.name, m.note, m.qty, p.unit
          from movements m
          join products p on p.id = m.product_id
          where m.type = 'out' and to_jsonb(m)->>'exit_pass' is not null and m.created_at >= day_start and m.created_at < day_end
        union all
        select 'fault_resolved', f.resolved_at, f.description, nullif(concat_ws(' · ', p.name, f.resolution), ''), null, null
          from faults f
          left join products p on p.id = f.product_id
          where f.status = 'resolved' and f.resolved_at >= day_start and f.resolved_at < day_end
        union all
        select 'order_delivered', o.closed_at, 'הזמנה ' || o.number, o.customer, null, null
          from orders o
          where o.status = 'delivered' and o.closed_at >= day_start and o.closed_at < day_end
            and not exists (
              select 1 from order_lines l join movements m on m.id = l.movement_id
              where l.order_id = o.id and m.worker_id is not null
            )
      ) r
    )
  );
end $function$;

notify pgrst, 'reload schema';
