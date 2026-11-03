begin;
set local statement_timeout = '280s';
set local session_replication_role = replica;
create function pg_temp.at_il(d date, minutes int) returns timestamptz language sql as
$f$ select (d + make_interval(mins => minutes, secs => floor(random() * 60)::int)) at time zone 'Asia/Jerusalem' $f$;
create function pg_temp.sid(kind text, n bigint) returns uuid language sql immutable as
$f$ select (kind || '00000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $f$;
create function pg_temp.gauss() returns numeric language sql as
$f$ select (sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()))::numeric $f$;
create function pg_temp.nice(v numeric) returns numeric language sql immutable as $f$
 select case when v < 10 then greatest(1, ceil(v)) when v < 50 then round(v / 5) * 5 when v < 200 then round(v / 10) * 10 else round(v / 50) * 50 end $f$;
create function pg_temp.shut() returns date[] language sql immutable as
$f$ select array['2026-03-03','2026-04-01','2026-04-02','2026-04-03','2026-04-05','2026-04-06','2026-04-07','2026-04-08','2026-04-21','2026-04-22','2026-05-21','2026-05-22','2026-09-11','2026-09-13','2026-09-20','2026-09-21','2026-09-25','2026-10-02']::date[] $f$;
create function pg_temp.work_day(d0 date) returns date language plpgsql as $f$
declare d date := d0;
begin
  while extract(dow from d) in (5, 6) or d = any(pg_temp.shut()) loop d := d + 1; end loop;
  return d;
end $f$;

create temp table h_mov (n serial primary key, kind movement_type, product_id uuid, qty numeric, moved_at timestamptz, worker uuid, supplier uuid, reference text, note text, line_id uuid) on commit drop;
create temp table h_led (id uuid primary key, sku text, unit text, price numeric, cat text, sup uuid, sup_name text, a numeric, r numeric default 0, cover numeric, slow boolean, s numeric, s0 numeric, mn numeric, lot numeric, since date, kind text) on commit drop;
create temp table h_sup (id uuid primary key, name text, gap int, base int, dates date[]) on commit drop;

do $$
declare
  t0 constant date := date '2025-11-02';
  last_day constant date := date '2026-11-02';
  n_days constant int := last_day - t0 + 1;
  dd date; i int; s_free numeric; s_fixed numeric; scale numeric; bal numeric; lo numeric; hi numeric; q numeric; delta numeric; rr record;
  pr h_led; dates date[]; cyc date[]; outs numeric[]; first_i int; want int;
  w_dispatch uuid[]; w_recv uuid[]; w_mgr uuid[]; w_cnt uuid[]; w_osher uuid; o record; w uuid; note_txt text;
begin
  if exists (select 1 from movements where id::text like 'de100000-%') then raise exception 'already seeded'; end if;
  perform setseed(0.3107);
  select array_agg(id) into w_dispatch from workers where name in ('שחר אלמקאייס','דביר חיימוב','אביתר זגורי','סהר טולדנו','ליאל סויסה','מתן רוזנבלט','ניב לוצקי');
  select array_agg(id) into w_recv from workers where name in ('יהלי קרסנטי','ניב לוצקי','מתן רוזנבלט');
  w_recv := w_recv || (select id from workers where name = 'יהלי קרסנטי');
  select array_agg(id) into w_mgr from workers where name in ('נועם נאמן','עידו פרידלנדר');
  w_cnt := w_mgr || w_recv;
  select id into w_osher from workers where name = 'אושר קלנטר';

  for o in select ord.id, ord.number, ord.customer, ord.closed_at, a.name as agent from orders ord join agents a on a.id = ord.agent_id where ord.id::text like 'de200000-%' and ord.status = 'delivered' loop
    w := case when random() < .025 then null when random() < .1 and o.closed_at > timestamptz '2026-03-20' then w_osher else w_dispatch[1 + floor(random() * 7)::int] end;
    insert into h_mov (kind, product_id, qty, moved_at, worker, reference, note, line_id)
    select 'out', l.product_id, l.qty, o.closed_at, w, 'הזמנה ' || o.number, 'ללקוח: ' || o.customer || ' · סוכן: ' || o.agent, l.id from order_lines l where l.order_id = o.id;
  end loop;

  insert into h_led (id, sku, unit, price, cat, sup, sup_name, a, r, cover, slow, since, kind)
  select p.id, p.sku, p.unit, p.price, p.category, p.primary_supplier_id, s.name,
    coalesce((select sum(m2.qty) from h_mov m2 where m2.product_id = p.id), 0),
    coalesce((select sum(ol.qty) from order_lines ol join orders ro on ro.id = ol.order_id and ro.status = 'open' where ol.product_id = p.id), 0),
    62 * exp(0.33 * pg_temp.gauss()) * case when s.name in ('נמל מתכות יבוא ושיווק','קומפוזיט פאנל יבוא') then 1.35 else 1 end,
    abs(hashtext(p.sku || 'slow')) % 11 = 0 and p.category in ('לוחות','פרופילים','פרגולות ומעקות') and p.sku !~ '^(SHT-BR|SHT-MIR)',
    case when p.sku = 'SHT-6082-20' then date '2026-02-01' when p.sku in ('ACP-FR-GR','ACP-4-BZ') then date '2026-04-01' when p.sku ~ '^PRG-20060' then date '2026-05-01' end,
    case when p.sku ~ '^COL' then 'col' when p.sku ~ '^(CUT|OIL|BLD|WLD|FLM)' then 'con' when p.sku in ('SHT-BR-15','SHT-MIR-1') then 'dead' else 'std' end
  from products p join suppliers s on s.id = p.primary_supplier_id;

  select sum(a / 365 * cover * price) filter (where kind = 'std' and not slow), sum(r * price) + coalesce(sum(a / 365 * (240 + abs(hashtext(sku)) % 180) * price) filter (where slow), 0) into s_free, s_fixed from h_led;
  scale := (8150000 - s_fixed - 34000 - 640000) / s_free;
  update h_led set
    s = case kind when 'dead' then case sku when 'SHT-BR-15' then 46 else 37 end when 'col' then 1 + abs(hashtext(sku)) % 2 + r when 'con' then 3 + abs(hashtext(sku)) % 4
      else case when slow then round(a / 365 * (240 + abs(hashtext(sku)) % 180) + r) else round(a / 365 * cover * scale + r) end end,
    mn = case kind when 'dead' then 5 when 'col' then 1 when 'con' then 2 else pg_temp.nice(a / 365 * 18) end;
  update h_led set s0 = s;
  update h_led set s = r + greatest(1, round(mn * .6)) where sku in ('SHT-3-1530','TUB-8040','ACC-RVT-48','GSK-IN-60','SHT-2-1530','PRF-3030','ACP-4-GR');
  update h_led set s = 0, mn = greatest(mn, 10) where sku = 'SCR-M620' and r = 0;
  update h_led set s = 0 where sku in ('TNT-M8','ANG-10050') and r = 0;
  update h_led set s = greatest(r - 7, 1) where id = (select id from h_led where sku ~ '^(WIN|DOR)' and r >= 12 order by r * price desc limit 1);

  insert into h_sup
  select s.id, s.name, v.gap, v.base, array[]::date[] from suppliers s join (values
   ('מתכות המרכז בע״מ',14,1040),('שחר לוחות ומתכת',14,47880),('הצפון אביזרים',21,7420),('שיחולי הערבה בע״מ',14,30410),('נמל מתכות יבוא ושיווק',28,22060),('ציפויי גליל עליון',14,91870),('קומפוזיט פאנל יבוא',21,5502),('אטמי השפלה',28,2210),('להב־טק כלי חיתוך',45,8841),('גזית מחברים בע״מ',28,66120)) v(n, gap, base) on v.n = s.name;
  update h_sup h set dates = (select array_agg(distinct d) from (
    select x::date d from generate_series(t0, last_day, interval '1 day') x where h.name in ('מתכות המרכז בע״מ','ציפויי גליל עליון') and extract(dow from x) in (1, 4) and x::date <> all (pg_temp.shut())
    union select x::date from generate_series(t0, last_day, interval '1 day') x where h.name = 'שחר לוחות ומתכת' and extract(dow from x) = 2 and x::date <> all (pg_temp.shut())
    union select x::date from generate_series(t0, last_day, interval '1 day') x where h.name in ('הצפון אביזרים','שיחולי הערבה בע״מ') and extract(dow from x) in (0, 3) and x::date <> all (pg_temp.shut())
    union select pg_temp.work_day(t0 + 12 + k * 28 + (abs(hashtext('y' || k)) % 16) - 6) from generate_series(0, 12) k where h.name = 'נמל מתכות יבוא ושיווק'
    union select pg_temp.work_day(t0 + 7 + k * 21 + (abs(hashtext('k' || k)) % 9) - 3) from generate_series(0, 17) k where h.name = 'קומפוזיט פאנל יבוא'
    union select pg_temp.work_day(t0 + 5 + k * 14 + abs(hashtext('a' || k)) % 5) from generate_series(0, 25) k where h.name in ('אטמי השפלה','גזית מחברים בע״מ')
    union select pg_temp.work_day(t0 + 9 + k * 33 + abs(hashtext('t' || k)) % 9) from generate_series(0, 10) k where h.name = 'להב־טק כלי חיתוך'
  ) z where d <= last_day);

  update h_led l set lot = greatest(st.step, ceil(l.a / 365 * sp.gap / st.step) * st.step)
  from (select id, case when unit = 'מטר' then 60 when price >= 2000 then 1 when sku ~ '^(SHT|ACP)' then 5 when sku ~ '^GSK' then 20 when unit = 'אריזה' then 5 when kind = 'con' then 2 else 10 end as step from h_led) st, h_sup sp
  where st.id = l.id and sp.id = l.sup;
  update h_led set lot = 1 where kind = 'col';

  for pr in select * from h_led loop
    select h.dates into dates from h_sup h where h.id = pr.sup;
    outs := array_fill(0::numeric, array[n_days]);
    for rr in select (m2.moved_at at time zone 'Asia/Jerusalem')::date - t0 + 1 as idx, sum(m2.qty) as q from h_mov m2 where m2.product_id = pr.id group by 1 loop
      outs[rr.idx] := rr.q;
    end loop;
    want := 1 + abs(hashtext(pr.sku)) % 3;
    select array_agg(x) into cyc from (select y::date x from generate_series(t0 + 30, last_day - 3, interval '1 day') y where extract(dow from y) not in (5, 6) and y::date <> all (pg_temp.shut()) order by random() limit want) w2;
    bal := pr.s + coalesce((select sum(case m3.type when 'out' then m3.qty when 'in' then -m3.qty else 0 end) from movements m3 where m3.product_id = pr.id), 0);
    lo := greatest(pr.s0 - pr.lot * (.25 + .6 * random()::numeric), pr.mn * 1.1, 1);
    hi := lo + pr.lot * (.85 + .3 * random()::numeric);
    first_i := case when pr.since is null then 1 else pr.since - t0 + 1 end;
    for i in reverse n_days .. first_i + 1 loop
      dd := t0 + i - 1;
      bal := bal + outs[i];
      if dd = any(dates) and bal >= hi then
        q := greatest(pr.lot, floor((bal - lo) / pr.lot) * pr.lot);
        if bal - q >= 0 then
          insert into h_mov (kind, product_id, qty, moved_at, worker, supplier) values ('in', pr.id, q, pg_temp.at_il(dd, 430), w_recv[1 + floor(random() * 4)::int], pr.sup);
          bal := bal - q;
        end if;
      end if;
      if pr.kind = 'con' and extract(dow from dd) = 0 and extract(day from dd) <= 7 and dd <> all (pg_temp.shut()) then
        insert into h_mov (kind, product_id, qty, moved_at, worker, note) values ('adjust', pr.id, bal, pg_temp.at_il(dd, 395), w_cnt[1 + floor(random() * 6)::int], 'ניפוק לרצפת הייצור');
        bal := bal + 1 + floor(random() * 2);
      elsif dd = date '2026-01-02' or dd = any(cyc) then
        insert into h_mov (kind, product_id, qty, moved_at, worker, note) values ('adjust', pr.id, bal,
          case when dd = date '2026-01-02' then pg_temp.at_il(dd, 420 + floor(random() * 380)::int) else pg_temp.at_il(dd, 390 + floor(random() * 28)::int) end,
          w_cnt[1 + floor(random() * 6)::int], case when dd = date '2026-01-02' then 'ספירה שנתית' else 'ספירת מחזור' end);
        delta := case when pr.kind = 'std' and random() < .2 and pr.price < 900 then (1 + floor(random() * greatest(1, bal * .012))) * case when random() < .65 then -1 else 1 end else 0 end;
        if bal - delta >= 1 then bal := bal - delta; end if;
      end if;
    end loop;
    bal := bal + outs[first_i];
    if pr.since is null then
      insert into h_mov (kind, product_id, qty, moved_at, worker, note) values ('adjust', pr.id, bal, pg_temp.at_il(t0, 420 + floor(random() * 300)::int), w_cnt[1 + floor(random() * 6)::int], 'ספירת פתיחה');
    elsif bal > 0 then
      insert into h_mov (kind, product_id, qty, moved_at, worker, supplier) values ('in', pr.id, bal, pg_temp.at_il(pg_temp.work_day(pr.since), 450), w_recv[1], pr.sup);
    end if;
  end loop;

  -- One truck, one note. A supplier numbers notes across all its customers, so ours are never consecutive.
  with days as (
    select d2.supplier, d2.day, sp.base + sum(3 + abs(hashtext(d2.supplier::text || d2.day::text)) % 14) over (partition by d2.supplier order by d2.day) as num,
      430 + (abs(hashtext(d2.supplier::text || d2.day::text)) % 170) as start_min
    from (select distinct mv.supplier, (mv.moved_at at time zone 'Asia/Jerusalem')::date as day from h_mov mv where mv.kind = 'in') d2 join h_sup sp on sp.id = d2.supplier
  ), ranked as (
    select mv.n, dy.num, dy.start_min, dy.day, sum(12 + abs(hashtext(mv.n::text)) % 40) over (partition by mv.supplier, dy.day order by mv.n) as secs
    from h_mov mv join days dy on dy.supplier = mv.supplier and dy.day = (mv.moved_at at time zone 'Asia/Jerusalem')::date where mv.kind = 'in'
  )
  update h_mov h set reference = 'תעודה ' || x.num, moved_at = ((x.day + make_interval(mins => x.start_min, secs => x.secs)) at time zone 'Asia/Jerusalem')
  from ranked x where x.n = h.n;

  insert into movements (id, type, product_id, qty, worker_id, supplier_id, reference, note, created_at)
  select pg_temp.sid('de1', n), kind, product_id, qty, worker, supplier, reference, note, moved_at from h_mov;
  update order_lines l set movement_id = pg_temp.sid('de1', h.n) from h_mov h where h.line_id = l.id;

  update products p set qty = l.s, min_qty = l.mn from h_led l where l.id = p.id;
  perform recount_reserved(array(select id from products));
  update products p set updated_at = x.at from (select product_id, max(created_at) as at from movements group by 1) x where x.product_id = p.id;
end $$;

select json_build_object(
 'movements', (select json_object_agg(type, c) from (select type, count(*) c from movements group by 1) s),
 'stock_worth', (select round(sum(qty * price)) from products), 'open', (select round(sum(l.qty * l.unit_price)) from order_lines l join orders o on o.id = l.order_id where o.status = 'open'),
 'pieces', (select round(sum(case when unit = 'מטר' then qty / 6 else qty end)) from products),
 'cats', (select json_agg(x) from (select category c, count(*) n, round(sum(qty * price)) w, round(sum(case when unit = 'מטר' then qty / 6 else qty end)) p, max(case when unit = 'מטר' then qty / 6 else qty end) mx from products group by 1 order by 3 desc) x),
 'months', (select json_agg(x) from (select to_char(m.created_at at time zone 'Asia/Jerusalem','YY-MM') mon, round(sum(m.qty * p.price) filter (where m.type = 'out') / 1000) o, round(sum(m.qty * p.price) filter (where m.type = 'in') / 1000) i, count(*) filter (where m.type = 'in') il from movements m join products p on p.id = m.product_id group by 1 order by 1) x),
 'round_end', (select round(100.0 * count(*) filter (where qty::int % 5 = 0) / count(*)) from products where qty >= 20),
 'short', (select count(*) from products where qty - reserved < 0), 'low', (select count(*) from products where qty > 0 and qty - reserved >= 0 and min_qty > 0 and qty - reserved < min_qty), 'out', (select count(*) from products where qty <= 0));
commit;
