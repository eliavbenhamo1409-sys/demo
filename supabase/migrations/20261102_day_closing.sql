-- סגירת יום: one warehouse day on one screen. Worked out here and not in the browser, so the nightly
-- job and the page can't tell two stories, and a closed day stays what it was when it closed.
-- A day is a calendar day in Israel. Columns other migrations add (orders.promised_on, movements.exit_pass)
-- are read through to_jsonb, so this runs the same whichever of them landed first.

create or replace function day_summary(target date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
        join agents a on a.id = o.agent_id
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
        select 'fault_resolved', f.resolved_at, f.description, p.name, null, null
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
end $$;

-- The closed days. Only the job below writes here, so a day can't be rewritten afterwards.
create table day_closings (
  day date primary key,
  summary jsonb not null,
  closed_at timestamptz not null default now()
);
alter table day_closings enable row level security;
create policy "admin read day closings" on day_closings for select to authenticated using (true);
revoke all on table day_closings from anon;
revoke insert, update, delete, truncate on table day_closings from authenticated;

-- Closes every day that ended and has no closing yet, so a night the job missed closes on its next run.
create or replace function close_days() returns void
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  first_open date;
  closing date;
begin
  select coalesce(max(c.day) + 1, (select (min(m.created_at) at time zone 'Asia/Jerusalem')::date from movements m), today)
    into first_open
    from day_closings c;
  for closing in select generate_series(first_open::timestamp, (today - 1)::timestamp, interval '1 day')::date loop
    insert into day_closings (day, summary) values (closing, day_summary(closing)) on conflict (day) do nothing;
  end loop;
end $$;

revoke execute on function day_summary(date) from public, anon;
grant execute on function day_summary(date) to authenticated;
revoke execute on function close_days() from public, anon, authenticated;

-- Every hour, because cron runs on UTC and Israel moves its clocks: the first run after local midnight closes the day.
create extension if not exists pg_cron;
select cron.schedule('day-closing', '5 * * * *', 'select public.close_days()');

select close_days();
