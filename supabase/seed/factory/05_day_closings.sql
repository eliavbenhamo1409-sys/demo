begin;
set local statement_timeout = '280s';
create temp table t_q (product_id uuid primary key, qty numeric) on commit drop;
insert into t_q select id, 0 from products;
create temp table t_lines on commit drop as select l.product_id, l.qty, o.created_at, case when o.status = 'open' then 'infinity'::timestamptz else o.closed_at end as until from order_lines l join orders o on o.id = l.order_id;
create index on t_lines (created_at);
do $$
declare
  d date; day_start timestamptz; day_end timestamptz; s jsonb; st jsonb; m record; n int := 0;
begin
  for d in select generate_series(date '2025-11-02', date '2026-11-02', interval '1 day')::date loop
    day_start := d::timestamp at time zone 'Asia/Jerusalem';
    day_end := (d + 1)::timestamp at time zone 'Asia/Jerusalem';
    for m in select product_id, type, qty from movements where created_at >= day_start and created_at < day_end order by created_at, id loop
      if m.type = 'in' then update t_q set qty = qty + m.qty where product_id = m.product_id;
      elsif m.type = 'out' then update t_q set qty = greatest(qty - m.qty, 0) where product_id = m.product_id;
      elsif m.type = 'adjust' then update t_q set qty = m.qty where product_id = m.product_id;
      end if;
    end loop;
    -- The shelf as it stood that night, the few that needed a hand.
    select coalesce(jsonb_agg(r order by r.state = 'low', r.state = 'out', r.name), '[]'::jsonb) into st from (
      select p.id as product_id, p.name, p.unit, t.qty, least(coalesce(h.q, 0), t.qty) as reserved, p.min_qty, case when t.qty <= 0 then 'out' else 'low' end as state
      from products p join t_q t on t.product_id = p.id
      left join (select product_id, sum(qty) as q from t_lines where created_at < day_end and until >= day_end group by 1) h on h.product_id = p.id
      where p.min_qty > 0 and p.created_at < day_end and t.qty - coalesce(h.q, 0) < p.min_qty and (t.qty > 0 or d > date '2026-10-20')
      order by (t.qty - coalesce(h.q, 0)) / p.min_qty limit 3 + abs(hashtext(d::text)) % 8) r;
    s := jsonb_set(day_summary(d), '{stock}', st);
    insert into day_closings (day, summary, closed_at) values (d, s, ((d + 1)::timestamp + interval '5 minutes') at time zone 'Asia/Jerusalem')
    on conflict (day) do update set summary = excluded.summary, closed_at = excluded.closed_at;
    n := n + 1;
  end loop;
end $$;
select count(*) days, min(day) a, max(day) b, pg_size_pretty(sum(pg_column_size(summary))) size, (select jsonb_array_length(summary->'moved') from day_closings where day = '2026-10-29') moved_lines, (select jsonb_array_length(summary->'stock') from day_closings where day = '2026-10-29') stock_lines from day_closings;
commit;
