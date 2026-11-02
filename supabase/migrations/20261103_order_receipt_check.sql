-- A receipt is read against the order it leaves under. What differs is marked by the worker, the stock
-- follows what really left, and the order keeps the record.
--
-- orders.receipt_read: the receipt was read against the order (true), the reading failed and the worker
-- went on without it (false), or nobody compared them (null: the admin's closing, a phone on an old version).
-- orders.changes: one entry per difference, frozen when the order closes. Empty after a clean reading.
-- `ordered` comes from the order itself, never from the phone.
alter table orders
  add column receipt_read boolean,
  add column changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array');

create function read_diffs(diffs jsonb)
returns table (product_id uuid, name text, read numeric, delivered numeric, manager boolean)
language sql immutable set search_path = public as $$
  select * from jsonb_to_recordset(diffs) as d(product_id uuid, name text, read numeric, delivered numeric, manager boolean);
$$;

-- The goods left: each line becomes an out movement and the hold is released, in one transaction.
-- A line with no entry in `diffs` leaves as ordered, and one marked 0 didn't leave, so it posts nothing.
-- An entry for a product off the order leaves on the same receipt. `manager` entries wait in item_requests.
-- The order closes either way: what didn't leave stops being held, and the agent places it again if it is still wanted.
drop function post_order(uuid, uuid, uuid, uuid, text);
create function post_order(target_order uuid, by_worker uuid, receipt uuid, pass uuid, why text, was_read boolean default null, diffs jsonb default '[]')
returns orders language plpgsql security definer set search_path = public as $$
declare
  o orders;
  agent_name text;
  line order_lines;
  extra record;
  amount numeric;
  moved uuid;
  posted boolean := false;
begin
  select * into o from orders where id = target_order for update;
  if not found then raise exception 'ההזמנה לא נמצאה'; end if;
  if o.status <> 'open' then raise exception 'ההזמנה כבר טופלה'; end if;
  if exists (
    select 1 from read_diffs(diffs) d
    where d.delivered is null or d.delivered < 0 or (d.product_id is null and d.delivered > 0 and d.manager is not true)
  ) then
    raise exception 'שורת חריגה לא תקינה';
  end if;
  perform 1 from products where id in (
    select l.product_id from order_lines l where l.order_id = o.id
    union
    select d.product_id from read_diffs(diffs) d
  ) order by id for update;
  select name into agent_name from agents where id = o.agent_id;

  for line in select * from order_lines where order_id = o.id loop
    select coalesce(sum(d.delivered), line.qty) into amount from read_diffs(diffs) d where d.product_id = line.product_id;
    continue when amount = 0;
    insert into movements (type, product_id, qty, worker_id, reference, note, document_id, exit_pass)
      values ('out', line.product_id, amount, by_worker, 'הזמנה ' || o.number,
              concat_ws(' · ', 'ללקוח: ' || o.customer, 'סוכן: ' || agent_name, 'בלי קבלה: ' || btrim(why),
                        case when amount <> line.qty then 'בהזמנה ' || trim_scale(line.qty) end),
              receipt, pass)
      returning id into moved;
    update order_lines set movement_id = moved where id = line.id;
    posted := true;
  end loop;

  for extra in
    select d.product_id, sum(d.delivered) as total from read_diffs(diffs) d
    where d.delivered > 0 and d.manager is not true
      and not exists (select 1 from order_lines l where l.order_id = o.id and l.product_id = d.product_id)
    group by d.product_id
  loop
    insert into movements (type, product_id, qty, worker_id, reference, note, document_id, exit_pass)
      values ('out', extra.product_id, extra.total, by_worker, 'הזמנה ' || o.number,
              concat_ws(' · ', 'ללקוח: ' || o.customer, 'סוכן: ' || agent_name, 'לא בהזמנה'), receipt, pass);
    posted := true;
  end loop;

  if not posted then raise exception 'לא יצא כלום מההזמנה'; end if;

  update orders set status = 'delivered', closed_at = now(), receipt_read = was_read,
    changes = (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', d.product_id, 'name', d.name, 'ordered', coalesce(l.qty, 0), 'read', d.read,
        'delivered', d.delivered, 'manager', coalesce(d.manager, false)
      )), '[]'::jsonb)
      from read_diffs(diffs) d
      left join order_lines l on l.order_id = o.id and l.product_id = d.product_id
    )
    where id = o.id returning * into o;
  perform recount_reserved(array(select product_id from order_lines where order_id = o.id));
  return o;
end $$;

-- The worker's closing. deliver_order stays for the admin, who confirms a whole order in one step.
create function deliver_order_checked(target_order uuid, by_worker uuid, receipt uuid, was_read boolean, diffs jsonb default '[]')
returns orders language sql security definer set search_path = public as $$
  select * from post_order(target_order, by_worker, receipt, null, null, was_read, diffs);
$$;

revoke execute on function read_diffs(jsonb), post_order(uuid, uuid, uuid, uuid, text, boolean, jsonb) from public, anon, authenticated;
revoke execute on function deliver_order_checked(uuid, uuid, uuid, boolean, jsonb) from public;
grant execute on function deliver_order_checked(uuid, uuid, uuid, boolean, jsonb) to anon, authenticated;
