begin;
set local statement_timeout = '120s';
set local session_replication_role = replica;
create temp table h_place (sku text, place text, qty numeric, turn int, primary key (sku, place)) on commit drop;
create temp table h_p on commit drop as select id, sku, unit, price, qty, case when unit = 'מטר' then 6 else 1 end as per from products where qty > 0;
do $$
declare
  fixed constant text[] := array['SHT-2-1225','SHT-3-1530','SHT-BK-15','SHT-TRD-3','SHT-PRF-2','PRF-4040','PRF-4040-BK','FRM-70','243535521','2A35Q4R','TEE-4040','FLT-5005','TUB-4040','TUB-6030','TUB-50','CUT-5L','GSK-EPDM','BRK-4040','TNT-M6'];
  g record; p record; racks text[]; ri int; lev int; used numeric; left_q numeric; part numeric; w numeric; turn int; spots text[]; si int; lanes int; cap int;
begin
  insert into h_place select h.sku, x.place, round(h.qty * x.share / h.per) * h.per, x.turn from h_p h join (values
    ('SHT-2-1225','A-1/1',.6,1),('SHT-2-1225','A-1/2',.4,2),('SHT-3-1530','A-2/1R',1,1),('SHT-BK-15','A-2/1L',.5,1),('SHT-BK-15','A-2/2L',.5,2),('SHT-TRD-3','A-3/1R',.5,1),('SHT-TRD-3','A-3/1L',.5,2),('SHT-PRF-2','A-3/2',1,1),
    ('PRF-4040','B-1/1',.6,1),('PRF-4040','B-1/2',.4,2),('PRF-4040-BK','B-1/3',1,1),('FRM-70','B-1/4',1,1),('243535521','B-2/1',.6,1),('243535521','B-2/2',.4,2),('2A35Q4R','B-2/3',1,1),('TEE-4040','B-2/4',1,1),('FLT-5005','B-2/4',1,1),
    ('TUB-4040','B-3/1',1,1),('TUB-6030','B-3/2',1,1),('TUB-50','B-3/3',1,1),('CUT-5L','C-1/1R',1,1),('GSK-EPDM','C-2/1',.6,1),('GSK-EPDM','C-2/2',.4,2),('BRK-4040','C-3/1R',.6,1),('BRK-4040','C-3/1L',.4,2),('TNT-M6','C-3/2L',1,1)
  ) x(sku, place, share, turn) on x.sku = h.sku;
  update h_place t set qty = t.qty + d.diff from (
    select h.sku, h.qty - sum(pl.qty) diff, max(pl.turn) last_turn from h_p h join h_place pl on pl.sku = h.sku group by h.sku, h.qty) d
  where d.sku = t.sku and d.last_turn = t.turn and d.diff <> 0;

  for g in select * from (values
    ('^TUB', array['B-3','B-4','B-5','D-1'], 4), ('^PRF', array['D-2'], 1), ('^(ANG|CHN|FLT|TEE)', array['D-3','D-4','D-5'], 1), ('^RND', array['G-5'], 2),
    ('^WIN-45', array['E-1','E-2'], 1), ('^WIN-60', array['E-3','E-4'], 1), ('^DOR', array['E-5'], 1), ('^CWL', array['G-1','G-2'], 1), ('^(PRG|SLT|LOU|RAL|FNC)', array['G-3','G-4'], 1)
  ) v(rx, racks, start_level) loop
    racks := g.racks; ri := 1; lev := g.start_level; used := 0;
    for p in select * from h_p where sku ~ g.rx and not sku = any(fixed) order by price desc loop
      left_q := ceil(p.qty / p.per); turn := 1;
      while left_q > 0 loop
        part := least(left_q, 300);
        w := case when part <= 110 or g.rx = '^RND' then .34 else .5 end;
        if used + w > 1.03 then lev := lev + 1; used := 0; end if;
        if lev > 4 then lev := 1; ri := ri + 1; end if;
        if ri > array_length(racks, 1) then raise exception 'out of shelves for %', g.rx; end if;
        insert into h_place values (p.sku, racks[ri] || '/' || lev, part * p.per, turn);
        used := used + w; left_q := left_q - part; turn := turn + 1;
        if left_q > 0 then lev := lev + 1; used := 0; end if;
      end loop;
    end loop;
  end loop;

  select array_agg(s order by l, r, side desc) into spots from (
    select r, l, side, 'A-' || r || '/' || l || side as s from generate_series(1, 5) r, generate_series(1, 4) l, unnest(array['R','L']) side
    where 'A-' || r || '/' || l || side <> all (array['A-1/1R','A-1/1L','A-1/2R','A-1/2L','A-2/1R','A-2/1L','A-2/2L','A-3/1R','A-3/1L','A-3/2R','A-3/2L'])) t;
  si := 1;
  for p in select * from h_p where sku ~ '^SHT' and not sku = any(fixed) and price < 3000 order by price desc loop
    left_q := p.qty; turn := 1;
    while left_q > 0 loop
      part := case when left_q > 170 then 150 else left_q end;
      if si > array_length(spots, 1) then raise exception 'out of sheet spots'; end if;
      insert into h_place values (p.sku, spots[si], part, turn);
      si := si + 1; left_q := left_q - part; turn := turn + 1;
    end loop;
  end loop;
  si := 1;
  for p in select * from h_p where sku ~ '^SHT' and not sku = any(fixed) and price >= 3000 order by price desc loop
    insert into h_place values (p.sku, (array['F-01','F-02','F-03'])[1 + (si - 1) % 3], p.qty, 1);
    si := si + 1;
  end loop;

  select array_agg(s order by r, l, side desc) into spots from (select r, l, side, 'C-' || r || '/' || l || side as s from generate_series(4, 5) r, generate_series(1, 4) l, unnest(array['R','L']) side) t;
  si := 1;
  for p in select * from h_p where sku ~ '^ACP' order by price desc loop
    left_q := p.qty; turn := 1;
    while left_q > 0 loop
      part := case when left_q > 200 then 170 else left_q end;
      insert into h_place values (p.sku, spots[least(si, 16)], part, turn) on conflict (sku, place) do update set qty = h_place.qty + excluded.qty;
      si := si + 1; left_q := left_q - part; turn := turn + 1;
    end loop;
  end loop;

  insert into h_place select sku, case when sku ~ 'WH|GR' then 'F-05' else 'F-04' end, qty, 1 from h_p where sku ~ '^COL';
  select array_agg(s order by r, l, side desc) into spots from (select r, l, side, 'C-' || r || '/' || l || side as s from generate_series(1, 3) r, generate_series(1, 4) l, unnest(array['R','L']) side) t
    where s <> all (array['C-1/1R','C-2/1R','C-2/1L','C-2/2R','C-2/2L','C-3/1R','C-3/1L','C-3/2L','C-3/2R']);
  si := 1; lanes := 0;
  for p in select * from h_p where (sku ~ '^(ACC|BLT|TNT|BRK|CAP|SCR|GSK|CUT|OIL|BLD|WLD|FLM)') and not sku = any(fixed) order by sku loop
    if lanes = 3 then si := si + 1; lanes := 0; end if;
    if si > array_length(spots, 1) then raise exception 'out of small spots'; end if;
    insert into h_place values (p.sku, spots[si], p.qty, 1);
    lanes := lanes + 1;
  end loop;
end $$;

create temp table h_wait on commit drop as
select m.id, p.sku, m.qty from movements m join products p on p.id = m.product_id
where m.type = 'in' and m.created_at >= '2026-11-02 00:00+02' and p.sku ~ '^(TUB|WIN|ACP|SHT)' order by m.created_at desc limit 3;
update h_place h set qty = h.qty - w.qty from h_wait w where w.sku = h.sku and h.turn = (select max(x.turn) from h_place x where x.sku = h.sku) and h.qty > w.qty;

insert into shelf_stock (product_id, place, qty, placed_at)
select p.id, h.place, h.qty, p.created_at + h.turn * interval '1 minute' from h_place h join products p on p.sku = h.sku where h.qty > 0
on conflict (product_id, place) do update set qty = excluded.qty, placed_at = excluded.placed_at;

update products p set location = x.place from (select distinct on (sku) sku, place from h_place order by sku, turn) x where x.sku = p.sku;
update products set location = 'D-5/3' where sku = 'ANG-10050';
update products set location = 'C-1/3R' where sku = 'TNT-M8';

update movements m set place = case when s2.place is not null and abs(hashtext(m.id::text)) % 8 = 0 then s2.place else s1.place end
from products p
join lateral (select place from h_place h where h.sku = p.sku order by turn limit 1) s1 on true
left join lateral (select place from h_place h where h.sku = p.sku and h.turn = 2 limit 1) s2 on true
where m.type = 'in' and p.id = m.product_id and m.id::text like 'de100000-%' and m.id not in (select id from h_wait);

update orders o set promised_on = case
    when o.status = 'open' then (timestamptz '2026-11-03' + make_interval(days => case when o.number % 11 = 3 then -2 when o.number % 7 = 1 then 1 + o.number % 3 else 2 + abs(hashtext(o.id::text)) % 15 end))::date
    when o.status = 'delivered' then ((o.closed_at at time zone 'Asia/Jerusalem')::date - case when abs(hashtext(o.id::text)) % 100 < 9 then 1 + abs(hashtext(o.id::text)) % 4 else 0 end)
    else ((o.created_at at time zone 'Asia/Jerusalem')::date + 5) end
where o.id::text like 'de200000-%';

select json_build_object('rows', (select count(*) from shelf_stock), 'racks', (select count(distinct split_part(place, '/', 1)) from h_place),
 'over', (select count(*) from (select s.product_id, sum(s.qty) q, p.qty t from shelf_stock s join products p on p.id = s.product_id group by 1, 3) x where q > t),
 'under', (select json_agg(json_build_object('sku', sku, 'gap', gap)) from (select p.sku, p.qty - coalesce(sum(s.qty), 0) gap from products p left join shelf_stock s on s.product_id = p.id group by p.id having p.qty <> coalesce(sum(s.qty), 0)) x),
 'peak', (select json_agg(x) from (select place, count(*) n, sum(qty) q from h_place group by 1 order by 3 desc limit 4) x),
 'promised', (select json_agg(x) from (select number, promised_on from orders where status = 'open' order by promised_on limit 5) x));
commit;
