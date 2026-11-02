-- Demo history: a year of an aluminium profiles and sheets warehouse, from 2025-11-02 to the morning of 2026-11-02,
-- so the "בוקה" control room has months to show. Run once on the demo project, after demo_factory.sql.
--
-- Nothing here moves today's stock. products.qty stays exactly what it was: the history is built backwards from it,
-- so every product's running balance lands on the quantity it really had when its real movements begin. That is why
-- triggers are off for this transaction: movements_apply would add the year to the shelf a second time, and
-- movements_guard would ask for a receipt photo that a made-up exit can't have.
-- The nine open orders at the end do hold stock, through recount_reserved, the same way create_order does.
--
-- Every row has an id starting de?00000, so it can be told from real rows and taken out again:
--   delete from order_lines where id::text like 'de300000-%';
--   delete from orders      where id::text like 'de200000-%';
--   delete from faults      where id::text like 'de400000-%';
--   delete from movements   where id::text like 'de100000-%';
--   select recount_reserved(array(select id from products));
-- Running it twice does nothing the second time.
begin;
set local session_replication_role = replica;

create function pg_temp.at_il(d date, minutes int) returns timestamptz language sql immutable as
$f$ select (d + make_interval(mins => minutes)) at time zone 'Asia/Jerusalem' $f$;

create function pg_temp.sid(kind text, n bigint) returns uuid language sql immutable as
$f$ select (kind || '00000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $f$;

create function pg_temp.poisson(l numeric) returns int language plpgsql as $f$
declare k int := 0; p numeric := 1; t numeric := exp(-l);
begin
  loop k := k + 1; p := p * random()::numeric; exit when p <= t; end loop;
  return k - 1;
end $f$;

-- Who buys. kind picks the basket, size scales it, the two months say when a customer came and left (0 is November 2025).
create temp table h_cust (i int primary key, name text, agent int, kind int, weight numeric, size numeric, from_m int, to_m int) on commit drop;
insert into h_cust values
  ( 1,'קבוצת נווה',1,3,9.0,1.5,0,99), ( 2,'אלומיניום הגליל בע״מ',2,1,8.0,1.3,0,99), ( 3,'חלונות זוהר',1,1,6.0,1.0,0,99),
  ( 4,'בניין הכרמל',3,3,6.0,1.4,0,99), ( 5,'מסגריית קדם',1,4,5.5,0.8,0,99), ( 6,'קבלן דרום',4,4,5.0,1.1,0,99),
  ( 7,'מרכז הזגגות',2,1,4.5,0.8,0,99), ( 8,'אגם מעקות',3,2,4.5,0.9,0,99), ( 9,'י.ד. חזיתות בע״מ',4,3,4.0,1.2,0,99),
  (10,'פרגולות השרון',2,2,4.0,0.8,0,99), (11,'תעשיות לביא',1,5,3.5,0.9,0,99), (12,'דלתות ארגמן',3,1,3.2,0.7,0,99),
  (13,'שילוט אור עד',4,5,3.0,0.6,0,99), (14,'גדרות הנגב',4,2,3.0,0.8,0,99), (15,'סטודיו ויטרינה',1,3,2.6,0.6,0,99),
  (16,'מערכות זיגוג ע.מ',2,1,2.4,0.7,0,8), (17,'קורת גג הנדסה',3,4,2.2,0.8,0,99), (18,'ב.ר. קונסטרוקציות',2,4,2.0,0.9,2,99),
  (19,'מפעלי טל מתכת',1,4,1.8,0.7,0,99), (20,'ארגזי רכב הדרום',4,5,1.6,0.6,5,99), (21,'מרפסות הים',3,2,1.4,0.6,7,99),
  (22,'סדנת רמות',2,1,1.2,0.5,0,99), (23,'עבודות פח דיין',1,5,1.2,0.5,0,99), (24,'מעקות יפו',3,2,1.0,0.5,3,99);

-- What each trade takes in one order: a chance for the line and a range for its quantity.
create temp table h_basket (kind int, sku text, lo int, hi int, chance numeric) on commit drop;
insert into h_basket values
  (1,'FRM-70',6,40,.85),(1,'PRF-4040',12,70,.55),(1,'GSK-EPDM',1,3,.45),(1,'SCR-M620',1,3,.45),(1,'BRK-4040',1,5,.35),(1,'SHT-2-1225',2,8,.3),
  (2,'TUB-50',4,22,.7),(2,'TUB-4040',8,36,.7),(2,'FLT-5005',8,30,.55),(2,'2A35Q4R',6,20,.4),(2,'PRF-4040-BK',10,40,.35),(2,'SCR-M620',1,2,.4),
  (3,'SHT-3-1530',2,9,.7),(3,'SHT-BK-15',2,9,.5),(3,'SHT-PRF-2',2,7,.4),(3,'TEE-4040',6,20,.55),(3,'243535521',8,30,.55),(3,'SCR-M620',1,3,.4),
  (4,'TUB-6030',4,22,.7),(4,'TUB-4040',8,30,.6),(4,'2A35Q4R',6,24,.55),(4,'PRF-4040',16,60,.5),(4,'BRK-4040',1,6,.45),(4,'TNT-M6',1,4,.4),
  (5,'SHT-TRD-3',2,8,.65),(5,'SHT-2-1225',2,7,.55),(5,'SHT-BK-15',1,5,.35),(5,'FLT-5005',5,16,.4),(5,'CUT-5L',1,2,.35);

create temp table h_prod on commit drop as
select p.id, p.sku, p.category, p.unit, p.price, p.min_qty,
  -- Where the year must land: a real count, or the shelf with every real movement taken back out of it.
  coalesce(c.qty, p.qty - coalesce(r.moved, 0)) as target,
  coalesce(r.first_at, pg_temp.at_il(date '2026-11-02', 660)) as anchor,
  coalesce(p.primary_supplier_id, (select id from suppliers where name = 'מתכות המרכז בע״מ')) as supplier_id
from products p
left join lateral (
  select min(m.created_at) as first_at,
    sum(case m.type when 'in' then m.qty when 'out' then -m.qty else 0 end) as moved
  from movements m where m.product_id = p.id
) r on true
left join lateral (select m.qty from movements m where m.product_id = p.id and m.type = 'adjust' order by m.created_at limit 1) c on true;

create temp table h_ord (n serial primary key, cust int, agent int, status order_status, created_at timestamptz, closed_at timestamptz, note text, number int) on commit drop;
create temp table h_line (n serial primary key, ord int, sku text, product_id uuid, qty numeric, price numeric) on commit drop;
create temp table h_mov (n serial primary key, kind movement_type, product_id uuid, qty numeric, moved_at timestamptz, worker uuid, supplier uuid, reference text, note text, ext text, line int, fault int) on commit drop;

do $$
declare
  t0 constant date := date '2025-11-02';
  last_day constant date := date '2026-11-02';
  cutoff constant timestamptz := pg_temp.at_il(date '2026-11-02', 660);
  shut constant date[] := array['2026-03-03','2026-04-01','2026-04-02','2026-04-03','2026-04-05','2026-04-06','2026-04-07','2026-04-08',
    '2026-04-21','2026-04-22','2026-05-21','2026-05-22','2026-09-11','2026-09-13','2026-09-20','2026-09-21','2026-09-25','2026-09-27',
    '2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02']::date[];
  season constant numeric[] := array[1.00,1.06,0.88,0.98,1.22,0.74,1.12,1.24,1.34,0.86,0.70,0.94,1.00];
  notes constant text[] := array['פריקה עד 10:00','איסוף עצמי','לתאם עם מנהל הפרויקט','הובלה לאתר','לפצל למשלוחים','חשבונית לפי פרויקט'];
  counts constant date[] := array['2026-01-04','2026-04-12','2026-07-05']::date[];
  w_niv uuid; w_shahar uuid; w_noam uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid;
  d date; close_d date; k int; m int; lam numeric; wait int;
  c h_cust; b h_basket; pr h_prod; ord int; made int; q numeric;
  created timestamptz; closed timestamptz; st order_status;
  bal numeric; high numeric; mid numeric; lot numeric; pace numeric; outs numeric; delta numeric; dow int; days int[];
  f record; descr text; reporter uuid; fn int := 0; opened timestamptz;
begin
  if exists (select 1 from orders where id::text like 'de200000-%') then
    raise notice 'the demo history is already here';
    return;
  end if;
  perform setseed(0.4207);

  select id into w_niv from workers where name = 'ניב לוצקי';
  select id into w_shahar from workers where name = 'שחר אלמקאייס';
  select id into w_noam from workers where name = 'נועם נאמן';
  select id into a1 from agents where name = 'שירה לוי';
  select id into a2 from agents where name = 'איתי מזרחי';
  insert into agents (id, name, phone, created_at) select pg_temp.sid('de5', 1), 'ירדן קופרמן', '050-5553317', pg_temp.at_il(t0, 480)
    where not exists (select 1 from agents where name = 'ירדן קופרמן');
  insert into agents (id, name, phone, created_at) select pg_temp.sid('de5', 2), 'מעיין טרבלסי', '053-5558842', pg_temp.at_il(t0, 480)
    where not exists (select 1 from agents where name = 'מעיין טרבלסי');
  select id into a3 from agents where name = 'ירדן קופרמן';
  select id into a4 from agents where name = 'מעיין טרבלסי';

  /* ── Orders, day by day ──────────────────────────────────── */
  for d in select generate_series(t0, last_day, interval '1 day')::date loop
    dow := extract(dow from d);
    continue when dow = 6 or d = any(shut);
    m := (extract(year from d)::int - 2025) * 12 + extract(month from d)::int - 11;
    lam := 2.15 * season[m + 1] * (1 + 0.006 * m) * case dow when 5 then 0.2 when 4 then 0.92 else 1 end;
    for k in 1 .. pg_temp.poisson(lam) loop
      select * into c from h_cust where m between from_m and to_m order by -ln(random()) / weight limit 1;
      created := pg_temp.at_il(d, 480 + floor(random() * 510)::int);
      wait := 1 + floor(random() * random() * 7)::int;
      close_d := d;
      while wait > 0 loop
        close_d := close_d + 1;
        if extract(dow from close_d) not in (5, 6) and not close_d = any(shut) then wait := wait - 1; end if;
      end loop;
      closed := pg_temp.at_il(close_d, 540 + floor(random() * 390)::int);
      st := 'delivered';
      if random() < 0.045 then
        st := 'cancelled';
        closed := created + make_interval(hours => 2 + floor(random() * 60)::int);
      end if;
      continue when closed >= cutoff;

      insert into h_ord (cust, agent, status, created_at, closed_at, note)
        values (c.i, c.agent, st, created, closed, case when random() < 0.14 then notes[1 + floor(random() * 6)::int] end)
        returning n into ord;
      made := 0;
      for b in select * from h_basket where kind = c.kind and random() < chance order by random() limit 4 loop
        select * into pr from h_prod where sku = b.sku;
        continue when closed >= pr.anchor;
        q := greatest(1, round((b.lo + random() * random() * (b.hi - b.lo)) * c.size));
        insert into h_line (ord, sku, product_id, qty, price) values (ord, b.sku, pr.id, q, pr.price);
        made := made + 1;
      end loop;
      if made = 0 then delete from h_ord where n = ord; end if;
    end loop;
  end loop;

  /* ── What is still open: these hold stock, so they are written by hand, inside each product's margin ── */
  for f in select * from (values
    (date '2026-10-22',  9, 1, 'SHT-PRF-2',   6, 'TEE-4040',    14),
    (date '2026-10-25', 10, 2, 'FRM-70',     12, 'BRK-4040',     8),
    (date '2026-10-26', 11, 4, 'SHT-BK-15',   6, 'FLT-5005',    24),
    (date '2026-10-27',  9, 8, 'TUB-50',     10, 'TUB-4040',    30),
    (date '2026-10-28', 13, 9, 'SHT-TRD-3',   5, '2A35Q4R',     30),
    (date '2026-10-29', 10, 5, 'TUB-6030',   14, 'TNT-M6',       6),
    (date '2026-11-01',  9, 6, 'TUB-4040',   24, 'PRF-4040-BK', 30),
    (date '2026-11-01', 14, 3, 'FRM-70',      8, 'PRF-4040',    24),
    (date '2026-11-02',  8, 10,'FLT-5005',   16, 'BRK-4040',     6)
  ) as v(day, hour, cust, sku_a, qty_a, sku_b, qty_b) loop
    select * into c from h_cust where i = f.cust;
    insert into h_ord (cust, agent, status, created_at) values (c.i, c.agent, 'open', pg_temp.at_il(f.day, f.hour * 60 + 12)) returning n into ord;
    insert into h_line (ord, sku, product_id, qty, price) select ord, sku, id, f.qty_a, price from h_prod where sku = f.sku_a;
    insert into h_line (ord, sku, product_id, qty, price) select ord, sku, id, f.qty_b, price from h_prod where sku = f.sku_b;
  end loop;

  update h_ord o set number = 1001 - x.r from (select n, row_number() over (order by created_at desc) as r from h_ord) x where x.n = o.n;

  /* ── Each delivered line leaves the warehouse when its order closes ── */
  insert into h_mov (kind, product_id, qty, moved_at, worker, reference, note, line)
  select 'out', l.product_id, l.qty, o.closed_at,
    (array[w_niv, w_shahar, null])[1 + (case when h.r < 0.47 then 0 when h.r < 0.88 then 1 else 2 end)],
    'הזמנה ' || o.number, 'ללקוח: ' || cu.name || ' · סוכן: ' || (array['שירה לוי','איתי מזרחי','ירדן קופרמן','מעיין טרבלסי'])[o.agent], l.n
  from h_line l
  join h_ord o on o.n = l.ord and o.status = 'delivered'
  join h_cust cu on cu.i = o.cust
  join lateral (select random() + l.n * 0 as r) h on true;

  /* ── Faults: a worker sets a damaged unit aside. The stock stays, as it does for a real report ── */
  for d in select generate_series(t0 + 3, date '2026-10-20', interval '1 day')::date loop
    dow := extract(dow from d);
    continue when dow in (5, 6) or d = any(shut) or random() > 0.32;
    select * into pr from h_prod where anchor > pg_temp.at_il(d, 900) order by random() * case category when 'פרופילים' then 1 when 'לוחות' then 0.8 else 3 end limit 1;
    descr := case pr.category
      when 'לוחות' then (array['פינה מקופלת בהובלה','שריטות על פני הלוח','לחות בין הלוחות','עובי לא תואם לתעודה'])[1 + floor(random() * 4)::int]
      when 'פרופילים' then (array['פרופיל כפוף בקצה','שריטות באנודייז','אורך קצר מהמוזמן','גוון לא אחיד'])[1 + floor(random() * 4)::int]
      when 'אביזרים' then (array['אריזה הגיעה פתוחה','חסרות יחידות באריזה','הברגה פגומה'])[1 + floor(random() * 3)::int]
      when 'אטמים' then (array['גליל מעוך','גומי סדוק'])[1 + floor(random() * 2)::int]
      else (array['מיכל דולף','אריזה ניזוקה'])[1 + floor(random() * 2)::int]
    end;
    reporter := (array[w_niv, w_shahar, w_niv, w_noam])[1 + floor(random() * 4)::int];
    opened := pg_temp.at_il(d, 450 + floor(random() * 480)::int);
    fn := fn + 1;
    if random() < 0.75 then
      insert into h_mov (kind, product_id, qty, moved_at, worker, note, fault) values ('fault', pr.id, 1 + floor(random() * random() * 4)::int, opened, reporter, descr, fn);
    end if;
    insert into faults (id, product_id, movement_id, description, reported_by, status, created_at, resolved_at)
    values (pg_temp.sid('de4', fn), pr.id, null, descr, reporter, 'resolved', opened, opened + make_interval(hours => 3 + floor(random() * random() * 170)::int));
  end loop;

  /* ── Goods in, worked backwards: every balance lands on the quantity the product really had ── */
  for pr in select * from h_prod loop
    select coalesce(sum(qty), 0) / 365.0 into pace from h_mov where product_id = pr.id and kind = 'out';
    lot := case when pr.unit = 'מטר' then 20 when pr.sku = 'GSK-EPDM' or pr.sku = 'CUT-5L' then 2 when pr.price >= 300 then 5 when pr.unit = 'אריזה' then 5 else 10 end;
    high := greatest(pr.target * 1.3, pr.min_qty * 2.2, pace * 30);
    mid := greatest(pr.target * 0.8, pr.min_qty * 1.15, pace * 12, lot);
    if high < mid + lot then high := mid + lot; end if;
    days := case (select name from suppliers where id = pr.supplier_id)
      when 'מתכות המרכז בע״מ' then array[1, 4]
      when 'שחר לוחות ומתכת' then array[2]
      else array[0, 3]
    end;
    bal := pr.target;
    for d in select generate_series(pr.anchor::date, t0 + 1, interval '-1 day')::date loop
      select coalesce(sum(qty), 0) into outs from h_mov where product_id = pr.id and kind = 'out' and (moved_at at time zone 'Asia/Jerusalem')::date = d;
      bal := bal + outs;
      if bal >= high and extract(dow from d)::int = any(days) and not d = any(shut) then
        q := greatest(lot, floor((bal - mid) / lot) * lot);
        if bal - q < 1 then q := q - lot; end if;
        if q > 0 then
          insert into h_mov (kind, product_id, qty, moved_at, worker, supplier, ext)
          values ('in', pr.id, q, pg_temp.at_il(d, 490 + floor(random() * 25)::int), case when random() < 0.8 then w_niv else w_shahar end, pr.supplier_id,
            (select i.external_name from supplier_items i where i.product_id = pr.id and i.supplier_id = pr.supplier_id and i.status = 'approved' order by i.external_name limit 1));
          bal := bal - q;
        end if;
      end if;
      if d = any(counts) then
        insert into h_mov (kind, product_id, qty, moved_at, worker, note) values ('adjust', pr.id, bal, pg_temp.at_il(d, 430), w_noam, 'ספירה רבעונית');
        delta := case when random() < 0.3 then (1 + floor(random() * 3)) * case when random() < 0.65 then 1 else -1 end else 0 end;
        if bal + delta >= 1 then bal := bal + delta; end if;
      end if;
    end loop;
    insert into h_mov (kind, product_id, qty, moved_at, worker, note) values ('adjust', pr.id, bal, pg_temp.at_il(t0, 420), w_noam, 'ספירת פתיחה');
  end loop;

  -- One delivery note per supplier and day, numbered back from the real notes.
  update h_mov h set reference = 'תעודה ' || x.num from (
    select mv.n, case s.name when 'מתכות המרכז בע״מ' then 1186 when 'שחר לוחות ומתכת' then 48212 else 7730 end
      - dense_rank() over (partition by mv.supplier order by (mv.moved_at at time zone 'Asia/Jerusalem')::date desc) * 3 as num
    from h_mov mv join suppliers s on s.id = mv.supplier
  ) x where x.n = h.n;

  /* ── Into the real tables ────────────────────────────────── */
  insert into movements (id, type, product_id, qty, worker_id, supplier_id, reference, note, external_name, created_at)
  select pg_temp.sid('de1', n), kind, product_id, qty, worker, supplier, reference, note, ext, moved_at from h_mov;

  update faults ft set movement_id = pg_temp.sid('de1', h.n) from h_mov h where h.fault is not null and ft.id = pg_temp.sid('de4', h.fault);

  insert into orders (id, number, request_id, agent_id, customer, customer_phone, note, status, created_at, closed_at)
  overriding system value
  select pg_temp.sid('de2', o.n), o.number, md5('demo-order-' || o.n)::uuid, (array[a1, a2, a3, a4])[o.agent], cu.name,
    '05' || (cu.i % 5) || '-555' || lpad((cu.i * 3137 % 10000)::text, 4, '0'), o.note, o.status, o.created_at, o.closed_at
  from h_ord o join h_cust cu on cu.i = o.cust;

  insert into order_lines (id, order_id, product_id, qty, unit_price, movement_id)
  select pg_temp.sid('de3', l.n), pg_temp.sid('de2', l.ord), l.product_id, l.qty, l.price, case when h.n is not null then pg_temp.sid('de1', h.n) end
  from h_line l left join h_mov h on h.line = l.n;

  -- Two faults still waiting, so the control room has something to hand over.
  insert into faults (id, product_id, description, reported_by, status, created_at)
  select pg_temp.sid('de4', 9001), id, 'שריטות באנודייז', w_shahar, 'open', pg_temp.at_il(date '2026-10-29', 640) from h_prod where sku = 'PRF-4040-BK';
  insert into faults (id, product_id, description, reported_by, status, created_at)
  select pg_temp.sid('de4', 9002), id, 'אריזה הגיעה פתוחה', w_niv, 'open', pg_temp.at_il(date '2026-11-02', 505) from h_prod where sku = 'BRK-4040';

  -- The count of 23.10 is no longer the first one.
  update movements set note = 'ספירת מלאי' where type = 'adjust' and note = 'ספירת פתיחה' and id::text not like 'de100000-%';

  perform recount_reserved(array(select id from products));
end $$;

select 'seeded' as state, (select count(*) from orders where id::text like 'de200000-%') as orders,
  (select count(*) from order_lines where id::text like 'de300000-%') as lines,
  (select count(*) from movements where id::text like 'de100000-%') as movements,
  (select count(*) from faults where id::text like 'de400000-%') as faults;

commit;
