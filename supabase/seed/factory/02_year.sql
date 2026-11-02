begin;
set local statement_timeout = '280s';
set local session_replication_role = replica;

create function pg_temp.at_il(d date, minutes int) returns timestamptz language sql immutable as
$f$ select (d + make_interval(mins => minutes)) at time zone 'Asia/Jerusalem' $f$;
create function pg_temp.sid(kind text, n bigint) returns uuid language sql immutable as
$f$ select (kind || '00000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $f$;
create function pg_temp.poisson(l numeric) returns int language plpgsql as $f$
declare k int := 0; p numeric := 1; t numeric := exp(-l);
begin loop k := k + 1; p := p * random()::numeric; exit when p <= t; end loop; return k - 1; end $f$;
create function pg_temp.gauss() returns numeric language sql as
$f$ select (sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()))::numeric $f$;
create function pg_temp.snap(q numeric, u text) returns numeric language sql immutable as $f$
 select case when u = 'מטר' then greatest(6, round(q / 6) * 6) when q >= 100 then round(q / 10) * 10 when q >= 30 then round(q / 5) * 5 else greatest(1, round(q)) end $f$;
create function pg_temp.nice(v numeric) returns numeric language sql immutable as $f$
 select case when v < 10 then greatest(1, ceil(v)) when v < 50 then round(v / 5) * 5 when v < 200 then round(v / 10) * 10 else round(v / 50) * 50 end $f$;

create temp table h_cust (i int primary key, name text, agent int, trade int, weight numeric, size numeric, from_m int, to_m int) on commit drop;
insert into h_cust values
(1,'קבוצת נווה',1,3,9,1.6,0,99),(2,'אלומיניום הגליל בע״מ',2,1,8,1.4,0,99),(3,'חלונות זוהר',1,1,6,1,0,99),(4,'בניין הכרמל',3,3,6,1.5,0,99),(5,'מסגריית קדם',1,4,5.5,.8,0,99),(6,'קבלן דרום',4,4,5,1.1,0,99),
(7,'מרכז הזגגות',2,1,4.5,.8,0,99),(8,'אגם מעקות',3,2,4.5,.9,0,99),(9,'י.ד. חזיתות בע״מ',4,3,4,1.3,0,99),(10,'פרגולות השרון',2,2,4,.8,0,99),(11,'תעשיות לביא',1,6,3.5,.9,0,99),(12,'דלתות ארגמן',3,1,3.2,.7,0,99),
(13,'שילוט אור עד',4,5,3,.6,0,99),(14,'גדרות הנגב',4,2,3,.8,0,99),(15,'סטודיו ויטרינה',1,3,2.6,.6,0,99),(16,'מערכות זיגוג ע.מ',2,1,2.4,.7,0,8),(17,'קורת גג הנדסה',3,4,2.2,.8,0,99),(18,'ב.ר. קונסטרוקציות',2,4,2,.9,2,99),
(19,'מפעלי טל מתכת',1,4,1.8,.7,0,99),(20,'ארגזי רכב הדרום',4,5,1.6,.6,5,99),(21,'מרפסות הים',3,2,1.4,.6,7,99),(22,'סדנת רמות',2,1,1.2,.5,0,99),(23,'עבודות פח דיין',1,5,1.2,.5,0,99),(24,'מעקות יפו',3,2,1,.5,3,99),
(25,'אלומיניום שקד בע״מ',2,1,3.4,1.1,0,99),(26,'חלונות נוף הגליל',2,1,2.6,.8,0,99),(27,'זגגות המעפילים',3,1,1.8,.6,0,99),(28,'דלתות המסילה',1,1,2,.7,0,99),(29,'ש.י. חלונות ודלתות',4,1,2.4,.8,0,99),(30,'מעבדת הזגג',3,1,1,.4,0,99),
(31,'א.ב. אלומיניום ובניין',1,1,2.8,.9,1,99),(32,'חלונות נתיב השיירה',2,1,1.5,.6,0,99),(33,'אור חלונות מודיעין',1,1,1.6,.6,4,99),(34,'ג.מ. אלומיניום רהט',4,1,1.4,.6,0,99),(35,'חלונות הר חברון',4,1,1.2,.5,2,99),(36,'אלומיניום גיא אוני',2,1,1,.5,0,99),
(37,'חזיתות המרכז בע״מ',1,3,3.2,1.3,0,99),(38,'מגדלי הירדן ביצוע',3,3,2.8,1.7,3,99),(39,'א. שפירא הנדסת חזיתות',1,3,2.2,1.2,0,99),(40,'פרויקטים ג׳י.אס',4,3,1.8,1.1,0,10),(41,'קבוצת הבונים הצפון',2,3,2,1.2,0,99),(42,'חיפויי אילת',4,3,1,.7,0,99),(43,'רום חזיתות',3,3,1.6,1,6,99),
(44,'מעקות עמק חפר',3,2,1.6,.6,0,99),(45,'פרגולות בית הכרם',3,2,1.8,.7,0,99),(46,'גדרות ושערים אשדוד',4,2,1.5,.6,0,99),(47,'צל וגג פרגולות',1,2,2,.7,0,99),(48,'מעקות גלבוע',2,2,1,.5,0,99),(49,'שערי הדרום',4,2,1.2,.6,2,99),
(50,'מסגריית המושבה',1,4,2,.6,0,99),(51,'מסגרות אבן יהודה',3,4,1.4,.5,0,99),(52,'קונסטרוקציות עכו',2,4,1.6,.8,0,99),(53,'מפעלי ברזל ואלומיניום גדרה',4,4,1.6,.8,0,99),(54,'מסגריית אל־נור נצרת',2,4,1.2,.5,0,99),(55,'ח.ר. מבני פלדה',3,4,1.3,.8,4,99),
(56,'פחחות דיוק',1,5,1.8,.6,0,99),(57,'שילוט רקיע',4,5,1.4,.5,0,99),(58,'ארגזי רכב השומרון',1,5,1.2,.6,0,99),(59,'מיזוג ותעלות חורב',3,5,2.4,1,0,99),(60,'תעלות אוויר סביון',1,5,1.8,.8,0,99),(61,'מטבחים תעשייתיים ברק',3,5,1,.5,0,99),
(62,'מכונות חגי',2,6,2.2,.7,0,99),(63,'אוטומציה ירושלים',1,6,1.6,.5,0,99),(64,'רובוטיקה בקעת הירח',2,6,1.4,.6,1,99),(65,'מערכות ייצור ניר',3,6,1.8,.8,0,99),(66,'טכנו־קו מסועים',1,6,2,.7,0,99),(67,'נגב מיגון תעשייתי',4,6,1.3,.6,0,99),(68,'מספנת גליל ים',3,6,1,.9,0,99),
(69,'מחסני אלומיניום באר שבע',4,7,3,1.5,0,99),(70,'אלו־מרכז שיווק',1,7,3.4,1.6,0,99),(71,'מרכז המתכת חדרה',3,7,2.6,1.3,0,99),(72,'מחסן הפרופיל קריות',2,7,2.4,1.2,0,99);

create temp table h_fam (fam text primary key, lo numeric, hi numeric) on commit drop;
insert into h_fam values ('sht1',5,40),('sht2',4,34),('plt',1,6),('mar',1,5),('trd',3,16),('prf',3,14),('pnt',4,20),('ano',3,14),('acp',6,40),('col',1,2),
('tub',8,60),('ang',8,60),('flt',8,60),('tee',8,50),('chn',8,50),('rod',5,40),('tsl',12,120),('win',6,40),('thr',6,36),('dor',4,24),('cwl',8,60),('prg',6,40),('acc',1,8),('gsk',1,8),('con',1,3);
create temp table h_tf (trade int, fam text, w numeric) on commit drop;
insert into h_tf
select t.t, split_part(x, ':', 1), split_part(x, ':', 2)::numeric
from (values (1,'win:9 thr:7 dor:4 gsk:4 acc:6 tub:1.2 sht2:.5 ang:.8 con:.1'),(2,'prg:12 tub:4 flt:2 ang:1.6 acc:2 pnt:.8 trd:.4'),
 (3,'cwl:9 acp:7 pnt:2.5 ano:1.5 gsk:2.5 acc:3 tub:1.4 ang:1.2 sht2:.8 thr:2'),(4,'tub:9 ang:5 flt:4 chn:3 tee:2 sht2:4 trd:2 plt:1 acc:1.2 con:.1'),
 (5,'sht1:8 sht2:8 trd:4 prf:3 pnt:3 acp:2 col:1.1 ang:1 ano:1.5'),(6,'tsl:9 plt:6 rod:4 mar:1.5 acc:3.5 sht2:2 flt:1.5 tub:1.5'),
 (7,'tub:6 ang:4 flt:3 sht1:3 sht2:4 trd:2 chn:2 tee:1.5 tsl:1.5 win:2 acc:1.5 col:1')) t(t, l),
 regexp_split_to_table(t.l, ' ') x;

create temp table h_prod on commit drop as
select p.id, p.sku, p.unit, p.price, p.primary_supplier_id as sup, s.name as sup_name,
 case when p.sku ~ '^SHT-(1|1\.5)-' then 'sht1' when p.sku ~ '^SHT-(2|2\.5|3|4|5)-1' then 'sht2' when p.sku ~ '^SHT-(5083|6082)' then 'mar' when p.sku ~ '^SHT-TRD' then 'trd' when p.sku ~ '^SHT-PRF' then 'prf'
  when p.sku ~ '^SHT-(WH|GR|BK-2)' then 'pnt' when p.sku ~ '^SHT-(AN|BR|MIR|BK-15)' then 'ano' when p.sku ~ '^SHT-' then 'plt' when p.sku ~ '^ACP' then 'acp' when p.sku ~ '^COL' then 'col' when p.sku ~ '^TUB' then 'tub'
  when p.sku ~ '^ANG|^2A35' then 'ang' when p.sku ~ '^FLT' then 'flt' when p.sku ~ '^TEE' then 'tee' when p.sku ~ '^CHN|^2435' then 'chn' when p.sku ~ '^RND' then 'rod' when p.sku ~ '^PRF' then 'tsl'
  when p.sku ~ '^WIN-45|^FRM' then 'win' when p.sku ~ '^WIN-60' then 'thr' when p.sku ~ '^DOR' then 'dor' when p.sku ~ '^CWL' then 'cwl' when p.sku ~ '^(PRG|SLT|LOU|RAL|FNC)' then 'prg'
  when p.sku ~ '^GSK' then 'gsk' when p.sku ~ '^(CUT|OIL|BLD|WLD|FLM)' then 'con' else 'acc' end as fam,
 case when p.sku ~ '-W$' then 'W' when p.sku ~ '-G$' then 'G' when p.sku ~ '-B$' then 'B' end as col,
 1.0::numeric as pop, 0 as since_m, 99 as until_m, p.in_catalog
from products p join suppliers s on s.id = p.primary_supplier_id;
update h_prod h set pop = m.pop from (select split_part(x, ':', 1) sku, split_part(x, ':', 2)::numeric pop from regexp_split_to_table('SHT-1-1225:6 SHT-1.5-1225:7 SHT-2-1225:10 SHT-2-1530:7 SHT-2.5-1225:2.5 SHT-3-1225:9 SHT-3-1530:9 SHT-4-1530:6 SHT-5-1530:6 SHT-6-1530:5 SHT-8-1530:4 SHT-10-1530:4 SHT-12-1530:2.5 SHT-15-1530:2 SHT-20-1530:1.5 SHT-25-1530:1 SHT-30-1530:.6 SHT-5-2040:2 SHT-8-2040:1.5 SHT-10-2040:1.2 SHT-5083-6:3 SHT-5083-10:2 SHT-6082-20:1.5 TUB-2020:5 TUB-2525:6 TUB-3030:9 TUB-4040:12 TUB-4040-3:6 TUB-5050:10 TUB-5050-3:6 TUB-6060:5 TUB-8080:3 TUB-10010:1.5 TUB-5025:6 TUB-6030:8 TUB-8040:8 TUB-8040-3:5 TUB-10050:5 TUB-12060:3 TUB-15050:2 TUB-20050:1 TUB-25:4 TUB-30:4 TUB-40:4 TUB-50:5 TUB-60:3 TUB-80:2 TUB-100:1 TUB-4040-BK:4 TUB-5050-WH:3 TUB-8040-GR:3 ANG-4040:2 2A35Q4R:2 FLT-5005:2 FLT-4004:1.6 PRF-4040:3 PRF-3030:2 PRF-4080:1.6 PRF-2020:1.2 PRF-8080:.7 FRM-70:.8 RND-80:.5 COL-1-1250:1.4', ' ') x) m where h.sku = m.sku;
update h_prod set pop = pop * case col when 'G' then 1.1 when 'B' then .55 else 1 end;
update h_prod set pop = pop * .8 where sku ~ '^WIN-45-(MD|TR)';
update h_prod h set pop = h.pop / t.s * case when h.col is not null then 2.2 else 1 end from (select fam, sum(pop) s from h_prod group by 1) t where t.fam = h.fam;
update h_prod set until_m = 5 where sku = 'SHT-BR-15';
update h_prod set until_m = 4 where sku = 'SHT-MIR-1';
update h_prod set since_m = 3 where sku = 'SHT-6082-20';
update h_prod set since_m = 5 where sku in ('ACP-FR-GR','ACP-4-BZ');
update h_prod set since_m = 6 where sku ~ '^PRG-20060';

create temp table h_ord (n serial primary key, cust int, agent int, status order_status, created_at timestamptz, closed_at timestamptz, note text, number int, who uuid) on commit drop;
create temp table h_line (n serial primary key, ord int, product_id uuid, price numeric, raw numeric, qty numeric, unit text, fam text) on commit drop;
create temp table h_mov (n serial primary key, kind movement_type, product_id uuid, qty numeric, moved_at timestamptz, worker uuid, supplier uuid, reference text, note text, line int) on commit drop;
create temp table h_led (id uuid primary key, sku text, unit text, price numeric, fam text, sup uuid, sup_name text, a numeric, r numeric default 0, cover numeric, s numeric, s0 numeric, mn numeric, lot numeric, since date, until_m int) on commit drop;

do $$
declare
  t0 constant date := date '2025-11-02';
  last_day constant date := date '2026-11-02';
  cutoff constant timestamptz := pg_temp.at_il(date '2026-11-02', 1000);
  -- The factory stops for the holidays themselves and works the days between them at half pace.
  shut constant date[] := array['2026-03-03','2026-04-01','2026-04-02','2026-04-03','2026-04-05','2026-04-06','2026-04-07','2026-04-08','2026-04-21','2026-04-22','2026-05-21','2026-05-22','2026-09-11','2026-09-13','2026-09-20','2026-09-21','2026-09-25','2026-10-02']::date[];
  half constant date[] := array['2026-09-27','2026-09-28','2026-09-29','2026-09-30','2026-10-01']::date[];
  season constant numeric[] := array[1.00,1.06,0.88,0.98,1.22,0.74,1.12,1.24,1.30,0.92,0.94,1.10,1.00];
  notes constant text[] := array['פריקה עד 10:00','איסוף עצמי','לתאם עם מנהל הפרויקט לפני הובלה','הובלה לאתר, יש מנוף','לפצל לשני משלוחים','חשבונית לפי פרויקט','לתאם יום לפני','פריקה בכניסה האחורית','דחוף, העבודה ממתינה','חיתוך לפי רשימה שנשלחה במייל','להעמיס אחרון, יורד ראשון','אישור תשלום אצל הנהלת חשבונות'];
  n_days constant int := last_day - t0 + 1;
  d date; dd date; close_d date; k int; m int; i int; lam numeric; wait int; dow int; j numeric; u numeric; created timestamptz; closed timestamptz; st order_status;
  c h_cust; ord int; colour text; nl int; made int; s_sales numeric; s_coil numeric; factor numeric; s_free numeric; s_fixed numeric; scale numeric; bal numeric; lo numeric; hi numeric; q numeric; delta numeric; rr record;
  pr h_led; dates date[]; outs numeric[]; first_i int;
  w_dispatch uuid[]; w_recv uuid[]; w_mgr uuid[]; w_osher uuid;
begin
  if exists (select 1 from orders where id::text like 'de200000-%') then raise exception 'already seeded'; end if;
  perform setseed(0.7319);
  select array_agg(id) into w_dispatch from workers where name in ('שחר אלמקאייס','דביר חיימוב','אביתר זגורי','סהר טולדנו','ליאל סויסה','מתן רוזנבלט','ניב לוצקי');
  select array_agg(id) into w_recv from workers where name in ('יהלי קרסנטי','ניב לוצקי','מתן רוזנבלט');
  w_recv := w_recv || (select id from workers where name = 'יהלי קרסנטי');
  select array_agg(id) into w_mgr from workers where name in ('נועם נאמן','עידו פרידלנדר');
  select id into w_osher from workers where name = 'אושר קלנטר';

  for d in select generate_series(t0, last_day, interval '1 day')::date loop
    dow := extract(dow from d);
    continue when dow = 6 or d = any(shut);
    m := (extract(year from d)::int - 2025) * 12 + extract(month from d)::int - 11;
    lam := 3.48 * season[m + 1] * (1 + 0.006 * m) * case dow when 5 then 0.18 when 4 then 0.92 when 0 then 1.12 else 1 end * case when d = any(half) then .55 else 1 end;
    for k in 1 .. pg_temp.poisson(lam) loop
      select * into c from h_cust where m between from_m and to_m order by -ln(1 - random()) / weight limit 1;
      created := pg_temp.at_il(d, 450 + floor(random() * case when dow = 5 then 240 else 600 end)::int);
      continue when created >= cutoff;
      wait := case when random() < 0.3 then 6 + floor(random() * 18)::int else 1 + floor(random() * random() * 7)::int end;
      close_d := d;
      while wait > 0 loop
        close_d := close_d + 1;
        if extract(dow from close_d) <> 6 and not close_d = any(shut) and (extract(dow from close_d) <> 5 or random() < .25) then wait := wait - 1; end if;
      end loop;
      closed := pg_temp.at_il(close_d, 420 + floor(random() * case when extract(dow from close_d) = 5 then 280 else 560 end)::int);
      st := 'delivered';
      if random() < 0.04 then st := 'cancelled'; closed := created + make_interval(hours => 2 + floor(random() * 72)::int); end if;
      if closed >= cutoff then st := 'open'; closed := null; end if;
      j := exp(0.72 * pg_temp.gauss()) * c.size;
      if random() < 0.012 then j := j * 5; end if;
      j := least(j, 14);
      u := random();
      colour := case when u < .42 then 'W' when u < .85 then 'G' else 'B' end;
      nl := least(3 + pg_temp.poisson(2.4 + least(j, 3)), 10);
      insert into h_ord (cust, agent, status, created_at, closed_at, note, who)
      values (c.i, c.agent, st, created, closed, case when random() < 0.16 then notes[1 + floor(random() * 12)::int] end,
        case when st = 'delivered' and random() > 0.07 then case when random() < .1 and closed > timestamptz '2026-03-20' then w_osher else w_dispatch[1 + floor(random() * 7)::int] end end)
      returning n into ord;
      insert into h_line (ord, product_id, price, raw, unit, fam)
      select ord, p.id, p.price, (f.lo + random() * random() * (f.hi - f.lo)) * case when p.fam = 'col' then 1 else j end, p.unit, p.fam
      from h_prod p join h_tf t on t.fam = p.fam and t.trade = c.trade join h_fam f on f.fam = p.fam
      where m between p.since_m and p.until_m and (p.col is null or p.col = colour or random() < 0.04)
      order by -ln(1 - random()) / (t.w * p.pop) limit nl;
      get diagnostics made = row_count;
      if made = 0 then delete from h_ord where n = ord; end if;
    end loop;
  end loop;

  delete from h_line l where l.ord in (select x.n from h_ord x order by x.created_at limit greatest((select count(*) from h_ord) - 985, 0));
  delete from h_ord o where not exists (select 1 from h_line l where l.ord = o.n);
  update h_ord o set number = 1001 - x.r from (select n, row_number() over (order by created_at desc, n desc) as r from h_ord) x where x.n = o.n;

  select coalesce(sum(l.raw * l.price) filter (where l.fam <> 'col'), 0), coalesce(sum(round(l.raw) * l.price) filter (where l.fam = 'col'), 0) into s_sales, s_coil
    from h_line l join h_ord o on o.n = l.ord where o.status = 'delivered';
  factor := (42000000 - s_coil) / s_sales;
  update h_line set qty = case when fam = 'col' then greatest(1, round(raw)) else pg_temp.snap(raw * factor, unit) end;

  insert into h_mov (kind, product_id, qty, moved_at, worker, reference, note, line)
  select 'out', l.product_id, l.qty, o.closed_at, o.who, 'הזמנה ' || o.number, 'ללקוח: ' || c2.name || ' · סוכן: ' || (array['שירה לוי','איתי מזרחי','ירדן קופרמן','מעיין טרבלסי'])[o.agent], l.n
  from h_line l join h_ord o on o.n = l.ord and o.status = 'delivered' join h_cust c2 on c2.i = o.cust;

  insert into h_led (id, sku, unit, price, fam, sup, sup_name, a, r, cover, since, until_m)
  select p.id, p.sku, p.unit, p.price, p.fam, p.sup, p.sup_name,
    coalesce((select sum(m2.qty) from h_mov m2 where m2.product_id = p.id and m2.kind = 'out'), 0),
    coalesce((select sum(l.qty) from h_line l join h_ord o on o.n = l.ord and o.status = 'open' where l.product_id = p.id), 0)
      + coalesce((select sum(ol.qty) from order_lines ol join orders ro on ro.id = ol.order_id and ro.status = 'open' where ol.product_id = p.id), 0),
    62 * exp(0.33 * pg_temp.gauss()) * case when p.sup_name in ('נמל מתכות יבוא ושיווק','קומפוזיט פאנל יבוא') then 1.45 else 1 end,
    case when p.since_m > 0 then (date '2025-11-01' + make_interval(months => p.since_m))::date end, p.until_m
  from h_prod p;

  select sum(a / 365 * cover * price) filter (where until_m = 99 and fam <> 'col'), sum(r * price) into s_free, s_fixed from h_led;
  scale := (8200000 - s_fixed - 34000 - 1180000) / s_free;
  update h_led set
    s = case when until_m < 99 then case sku when 'SHT-BR-15' then 46 else 38 end when fam = 'col' then 3 + abs(hashtext(sku)) % 2 + r else pg_temp.snap(a / 365 * cover * scale + r, unit) end,
    mn = case when until_m < 99 then 0 when fam = 'col' then 2 else pg_temp.nice(a / 365 * 18) end;
  update h_led set s = greatest(s, 4), mn = greatest(mn, 2) where fam = 'con' and a < 3;
  update h_led set s0 = s;
  update h_led set s = r + greatest(1, round(mn * .6)) where sku in ('SHT-3-1530','TUB-8040','ACC-RVT-48','GSK-IN-60','SHT-2-1530','PRF-3030','ACP-4-GR');
  update h_led set s = 0, mn = greatest(mn, 10) where sku = 'SCR-M620' and r = 0;
  update h_led set s = 0 where sku in ('TNT-M8','ANG-10050') and r = 0;
  update h_led set s = greatest(r - 8, 1) where id = (select id from h_led where fam in ('thr','win') and r >= 12 order by r * price desc limit 1);

  update h_led l set lot = greatest(st.step, ceil(l.a / 365 * st.gap / st.step) * st.step)
  from (select id, case when unit = 'מטר' then 60 when price >= 2000 then 1 when fam in ('sht1','sht2','trd','prf','pnt','ano','acp') then 5 when unit = 'אריזה' then 5 when fam in ('gsk','con') then 2 else 10 end as step,
    case sup_name when 'מתכות המרכז בע״מ' then 14 when 'שחר לוחות ומתכת' then 14 when 'הצפון אביזרים' then 21 when 'שיחולי הערבה בע״מ' then 14 when 'נמל מתכות יבוא ושיווק' then 28 when 'ציפויי גליל עליון' then 14 when 'קומפוזיט פאנל יבוא' then 42 when 'אטמי השפלה' then 28 when 'להב־טק כלי חיתוך' then 45 else 28 end as gap from h_led) st
  where st.id = l.id;
  update h_led set lot = 1 where fam = 'col';

  for pr in select * from h_led loop
    select array_agg(x::date) into dates from generate_series(t0, last_day, interval '1 day') x
    where not x::date = any(shut) and case pr.sup_name
      when 'מתכות המרכז בע״מ' then extract(dow from x) in (1, 4)
      when 'ציפויי גליל עליון' then extract(dow from x) in (1, 4)
      when 'שחר לוחות ומתכת' then extract(dow from x) = 2
      when 'הצפון אביזרים' then extract(dow from x) in (0, 3)
      when 'שיחולי הערבה בע״מ' then extract(dow from x) in (0, 3)
      when 'נמל מתכות יבוא ושיווק' then extract(dow from x) = 3 and (x::date - t0) % 28 < 7
      when 'קומפוזיט פאנל יבוא' then extract(dow from x) = 1 and (x::date - t0) % 42 < 7
      when 'אטמי השפלה' then extract(dow from x) = 2 and (x::date - t0) % 14 < 7
      when 'להב־טק כלי חיתוך' then extract(dow from x) = 3 and (x::date - t0) % 28 < 7
      else extract(dow from x) = 0 and (x::date - t0) % 14 < 7 end;
    outs := array_fill(0::numeric, array[n_days]);
    for rr in select (m2.moved_at at time zone 'Asia/Jerusalem')::date - t0 + 1 as idx, sum(m2.qty) as q from h_mov m2 where m2.product_id = pr.id and m2.kind = 'out' group by 1 loop
      outs[rr.idx] := rr.q;
    end loop;
    bal := pr.s + coalesce((select sum(case m3.type when 'out' then m3.qty when 'in' then -m3.qty else 0 end) from movements m3 where m3.product_id = pr.id), 0);
    -- The shelf swings around the level it holds today, so the stock's line stays level through the year.
    lo := greatest(pr.s0 * (.62 + .2 * random()::numeric) - pr.lot * .3, pr.mn * 1.1, 1);
    hi := lo + pr.lot * (.8 + .5 * random()::numeric);
    first_i := case when pr.since is null then 1 else pr.since - t0 + 1 end;
    for i in reverse n_days .. first_i + 1 loop
      dd := t0 + i - 1;
      bal := bal + outs[i];
      if dd = any(dates) and bal >= hi then
        q := greatest(pr.lot, floor((bal - lo) / pr.lot) * pr.lot);
        if bal - q >= 0 and q > 0 then
          insert into h_mov (kind, product_id, qty, moved_at, worker, supplier) values ('in', pr.id, q, pg_temp.at_il(dd, 430), w_recv[1 + floor(random() * 4)::int], pr.sup);
          bal := bal - q;
        end if;
      end if;
      if dd = date '2026-01-04' or (extract(dow from dd) = 4 and (i / 7) % 26 = abs(hashtext(pr.sku)) % 26) then
        insert into h_mov (kind, product_id, qty, moved_at, worker, note) values ('adjust', pr.id, bal, pg_temp.at_il(dd, 410 + floor(random() * 15)::int), w_mgr[1 + floor(random() * 2)::int], case when dd = date '2026-01-04' then 'ספירה שנתית' else 'ספירת מחזור' end);
        delta := case when pr.until_m = 99 and random() < .2 and pr.price < 900 then (1 + floor(random() * 3)) * case when random() < .6 then -1 else 1 end else 0 end;
        if bal - delta >= 1 then bal := bal - delta; end if;
      end if;
    end loop;
    bal := bal + outs[first_i];
    if pr.since is null then
      insert into h_mov (kind, product_id, qty, moved_at, worker, note) values ('adjust', pr.id, bal, pg_temp.at_il(t0, 420), w_mgr[1], 'ספירת פתיחה');
    elsif bal > 0 then
      insert into h_mov (kind, product_id, qty, moved_at, worker, supplier) values ('in', pr.id, bal, pg_temp.at_il(pr.since, 450), w_recv[1], pr.sup);
    end if;
  end loop;

  with days as (
    select sup_day.supplier, sup_day.day, sup_day.base + row_number() over (partition by sup_day.supplier order by sup_day.day) * sup_day.jump as num,
      430 + (abs(hashtext(sup_day.supplier::text || sup_day.day::text)) % 170) as start_min
    from (select distinct mv.supplier, (mv.moved_at at time zone 'Asia/Jerusalem')::date as day,
      case s.name when 'מתכות המרכז בע״מ' then 1040 when 'שחר לוחות ומתכת' then 47880 when 'הצפון אביזרים' then 7420 when 'שיחולי הערבה בע״מ' then 30410 when 'נמל מתכות יבוא ושיווק' then 22060 when 'ציפויי גליל עליון' then 91870 when 'קומפוזיט פאנל יבוא' then 5502 when 'אטמי השפלה' then 2210 when 'להב־טק כלי חיתוך' then 8841 else 66120 end as base,
      case s.name when 'שחר לוחות ומתכת' then 7 when 'ציפויי גליל עליון' then 4 when 'שיחולי הערבה בע״מ' then 5 else 3 end as jump
      from h_mov mv join suppliers s on s.id = mv.supplier where mv.kind = 'in') sup_day
  ), ranked as (
    select mv.n, dy.num, dy.start_min, row_number() over (partition by mv.supplier, dy.day order by mv.n) as r
    from h_mov mv join days dy on dy.supplier = mv.supplier and dy.day = (mv.moved_at at time zone 'Asia/Jerusalem')::date where mv.kind = 'in'
  )
  update h_mov h set reference = 'תעודה ' || x.num,
    moved_at = (((h.moved_at at time zone 'Asia/Jerusalem')::date + make_interval(mins => x.start_min, secs => x.r * 35)) at time zone 'Asia/Jerusalem')
  from ranked x where x.n = h.n;

  insert into movements (id, type, product_id, qty, worker_id, supplier_id, reference, note, created_at)
  select pg_temp.sid('de1', n), kind, product_id, qty, worker, supplier, reference, note, moved_at from h_mov;
  insert into orders (id, number, request_id, agent_id, customer, customer_phone, note, status, created_at, closed_at)
  overriding system value
  select pg_temp.sid('de2', o.n), o.number, md5('factory-order-' || o.n)::uuid, (array['63bd97d7-e6bd-45aa-a113-96d91b0a489c','ba6eac84-0bb7-44d4-8379-b4d3b72cf5f4','de500000-0000-4000-8000-000000000001','de500000-0000-4000-8000-000000000002']::uuid[])[o.agent], cu.name,
    (array['050','052','053','054','055','058'])[1 + cu.i % 6] || '-555' || lpad((cu.i * 3137 % 10000)::text, 4, '0'), o.note, o.status, o.created_at, o.closed_at
  from h_ord o join h_cust cu on cu.i = o.cust;
  insert into order_lines (id, order_id, product_id, qty, unit_price, movement_id)
  select pg_temp.sid('de3', l.n), pg_temp.sid('de2', l.ord), l.product_id, l.qty, l.price, case when h.n is not null then pg_temp.sid('de1', h.n) end
  from h_line l left join h_mov h on h.line = l.n;

  update products p set qty = l.s, min_qty = l.mn from h_led l where l.id = p.id;
  perform recount_reserved(array(select id from products));
  update products p set updated_at = x.at from (select product_id, max(created_at) as at from movements group by 1) x where x.product_id = p.id;
end $$;

select json_build_object(
 'orders', (select json_object_agg(status, c) from (select status, count(*) c from orders group by 1) s),
 'first_number', (select min(number) from orders),
 'lines', (select count(*) from order_lines),
 'movements', (select json_object_agg(type, c) from (select type, count(*) c from movements group by 1) s),
 'sales_12m', (select round(sum(l.qty * l.unit_price)) from order_lines l join orders o on o.id = l.order_id where o.status = 'delivered'),
 'open_worth', (select round(sum(l.qty * l.unit_price)) from order_lines l join orders o on o.id = l.order_id where o.status = 'open'),
 'stock_worth', (select round(sum(qty * price)) from products),
 'pieces', (select round(sum(case when unit = 'מטר' then qty / 6 else qty end)) from products),
 'cats', (select json_agg(x) from (select category c, count(*) n, round(sum(qty * price)) w, round(sum(case when unit = 'מטר' then qty / 6 else qty end)) p from products group by 1 order by 3 desc) x),
 'months', (select json_agg(x) from (select to_char(m.created_at at time zone 'Asia/Jerusalem','YY-MM') mon, round(sum(m.qty * p.price) filter (where m.type = 'out') / 1000) o, round(sum(m.qty * p.price) filter (where m.type = 'in') / 1000) i from movements m join products p on p.id = m.product_id group by 1 order by 1) x),
 'neg', (select count(*) from products where qty < 0),
 'short', (select count(*) from products where qty - reserved < 0),
 'low', (select count(*) from products where qty > 0 and qty - reserved >= 0 and min_qty > 0 and qty - reserved < min_qty),
 'out', (select count(*) from products where qty <= 0)
) summary;
commit;
