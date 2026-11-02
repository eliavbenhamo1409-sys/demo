begin;
set local statement_timeout = '120s';
set local session_replication_role = replica;
create temp table viol (product_id uuid, day date) on commit drop;
do $$
declare p record; m record; bal numeric; pass int; n int;
begin
  for pass in 1 .. 3 loop
    delete from viol;
    for p in select id from products loop
      bal := 0;
      for m in select type, qty, created_at from movements where product_id = p.id and type <> 'fault' order by created_at, case type when 'adjust' then 0 when 'in' then 1 else 2 end, id loop
        if m.type = 'adjust' then bal := m.qty; elsif m.type = 'in' then bal := bal + m.qty; else bal := bal - m.qty; end if;
        if bal < 0 then insert into viol values (p.id, (m.created_at at time zone 'Asia/Jerusalem')::date); end if;
      end loop;
    end loop;
    select count(*) into n from viol;
    raise notice 'pass % negatives %', pass, n;
    exit when n = 0;
    -- The truck that day came first thing, right after the count and before the first order left.
    update movements mv set created_at = ((x.day + make_interval(mins => 425, secs => (x.r * 20)::int)) at time zone 'Asia/Jerusalem')
    from (select m2.id, (m2.created_at at time zone 'Asia/Jerusalem')::date as day, row_number() over (partition by m2.supplier_id, m2.reference order by m2.created_at) as r
          from movements m2 where m2.type = 'in' and (m2.supplier_id, m2.reference) in (
            select m3.supplier_id, m3.reference from movements m3 join viol v on v.product_id = m3.product_id and v.day = (m3.created_at at time zone 'Asia/Jerusalem')::date where m3.type = 'in')) x
    where x.id = mv.id;
  end loop;
end $$;
update documents d set created_at = x.at - interval '55 seconds' from (select supplier_id, reference, min(created_at) at from movements where type = 'in' group by 1, 2) x where d.kind = 'in' and d.supplier_id = x.supplier_id and d.reference = x.reference and d.created_at <> x.at - interval '55 seconds';
select count(*) remaining, (select json_agg(json_build_object('s', p.sku, 'd', v.day)) from (select distinct * from viol) v join products p on p.id = v.product_id) left_over from viol;
commit;
