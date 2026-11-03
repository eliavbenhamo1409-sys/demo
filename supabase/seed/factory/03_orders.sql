begin;
set local statement_timeout = '280s';
set local session_replication_role = replica;
create function pg_temp.at_il(d date, minutes int) returns timestamptz language sql as
$f$ select (d + make_interval(mins => minutes, secs => floor(random() * 60)::int)) at time zone 'Asia/Jerusalem' $f$;
create function pg_temp.sid(kind text, n bigint) returns uuid language sql immutable as
$f$ select (kind || '00000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $f$;
create function pg_temp.poisson(l numeric) returns int language plpgsql as $f$
declare k int := 0; p numeric := 1; t numeric := exp(-l);
begin loop k := k + 1; p := p * random()::numeric; exit when p <= t; end loop; return k - 1; end $f$;
create function pg_temp.gauss() returns numeric language sql as
$f$ select (sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()))::numeric $f$;
create function pg_temp.soft(q numeric, u text) returns numeric language plpgsql as $f$
declare r numeric := greatest(1, round(q));
begin
  if u = 'מטר' then return r; end if;
  if r >= 100 and random() < .3 then return round(r / 10) * 10; end if;
  if r >= 30 and random() < .25 then return round(r / 5) * 5; end if;
  return r;
end $f$;
create function pg_temp.shut() returns date[] language sql immutable as
$f$ select array['2026-03-03','2026-04-01','2026-04-02','2026-04-03','2026-04-05','2026-04-06','2026-04-07','2026-04-08','2026-04-21','2026-04-22','2026-05-21','2026-05-22','2026-09-11','2026-09-13','2026-09-20','2026-09-21','2026-09-25','2026-10-02']::date[] $f$;
-- n working days from a date, Sunday to Thursday, holidays out.
create function pg_temp.wd(d0 date, n int) returns date language plpgsql as $f$
declare d date := d0; left_n int := abs(n); stp int := case when n < 0 then -1 else 1 end;
begin
  while left_n > 0 loop
    d := d + stp;
    if extract(dow from d) not in (5, 6) and d <> all (pg_temp.shut()) then left_n := left_n - 1; end if;
  end loop;
  return d;
end $f$;
create function pg_temp.add_line(o int, s text, rw numeric, mm int) returns void language plpgsql as $f$
begin
  insert into h_line (ord, product_id, price, raw, unit, fam)
  select o, p.id, p.price, rw, p.unit, p.fam from h_prod p
  where p.sku = s and mm between p.since_m and p.until_m and not exists (select 1 from h_line l where l.ord = o and l.product_id = p.id);
end $f$;
create function pg_temp.add_kit(o int, k text, c text, n numeric, mm int, top boolean) returns void language plpgsql as $f$
declare r record; made int := 0; most int := 1 + floor(random() * 3)::int;
begin
  for r in select * from h_kit where kit = k order by random() loop
    if top then continue when made >= most; else continue when not r.must and random() < .18; end if;
    perform pg_temp.add_line(o, replace(r.part, '%', c), n * r.ratio * (.92 + random()::numeric * .16), mm);
    made := made + 1;
  end loop;
end $f$;

create temp table h_cust (i int primary key, name text, agent int, trade int, weight numeric, size numeric, from_m int, to_m int) on commit drop;
insert into h_cust values
(1,'קבוצת נווה',1,3,9,1.6,0,99),(2,'אלומיניום הגליל בע״מ',2,1,8,1.4,0,99),(3,'חלונות זוהר',1,1,6,1,0,99),(4,'בניין הכרמל',3,3,6,1.5,0,99),(5,'מסגריית קדם',1,4,5.5,.8,0,99),(6,'קבלן דרום',4,4,5,1.1,0,99),
(7,'מרכז הזגגות',2,1,4.5,.8,0,99),(8,'אגם מעקות',3,2,4.5,.9,0,99),(9,'י.ד. חזיתות בע״מ',4,3,4,1.3,0,99),(10,'פרגולות השרון',2,11,4,.8,0,99),(11,'תעשיות לביא',1,6,3.5,.9,0,99),(12,'דלתות ארגמן',3,9,3.2,.7,0,99),
(13,'שילוט אור עד',4,13,3,.6,0,99),(14,'גדרות הנגב',4,12,3,.8,0,99),(15,'סטודיו ויטרינה',1,10,2.6,.6,0,99),(16,'מערכות זיגוג ע.מ',2,1,2.4,.7,0,8),(17,'קורת גג הנדסה',3,4,2.2,.8,0,99),(18,'ב.ר. קונסטרוקציות',2,4,2,.9,2,99),
(19,'מפעלי טל מתכת',1,4,1.8,.7,0,99),(20,'ארגזי רכב הדרום',4,14,1.6,.6,5,99),(21,'מרפסות הים',3,2,1.4,.6,7,99),(22,'סדנת רמות',2,1,1.2,.5,0,99),(23,'עבודות פח דיין',1,5,1.2,.5,0,99),(24,'מעקות יפו',3,2,1,.5,3,99),
(25,'אלומיניום שקד בע״מ',2,1,3.4,1.1,0,99),(26,'חלונות נוף הגליל',2,1,2.6,.8,0,99),(27,'זגגות המעפילים',3,1,1.8,.6,0,99),(28,'דלתות המסילה',1,9,2,.7,0,99),(29,'ש.י. חלונות ודלתות',4,1,2.4,.8,0,99),(30,'מעבדת הזגג',3,1,1,.4,0,99),
(31,'א.ב. אלומיניום ובניין',1,1,2.8,.9,1,99),(32,'חלונות נתיב השיירה',2,1,1.5,.6,0,99),(33,'אור חלונות מודיעין',1,1,1.6,.6,4,99),(34,'ג.מ. אלומיניום רהט',4,1,1.4,.6,0,99),(35,'חלונות הר חברון',4,1,1.2,.5,2,99),(36,'אלומיניום גיא אוני',2,1,1,.5,0,99),
(37,'חזיתות המרכז בע״מ',1,3,3.2,1.3,0,99),(38,'מגדלי הירדן ביצוע',3,3,2.8,1.7,3,99),(39,'א. שפירא הנדסת חזיתות',1,3,2.2,1.2,0,99),(40,'פרויקטים ג׳י.אס',4,3,1.8,1.1,0,10),(41,'קבוצת הבונים הצפון',2,3,2,1.2,0,99),(42,'חיפויי אילת',4,3,1,.7,0,99),(43,'רום חזיתות',3,3,1.6,1,6,99),
(44,'מעקות עמק חפר',3,2,1.6,.6,0,99),(45,'פרגולות בית הכרם',3,11,1.8,.7,0,99),(46,'גדרות ושערים אשדוד',4,12,1.5,.6,0,99),(47,'צל וגג פרגולות',1,11,2,.7,0,99),(48,'מעקות גלבוע',2,2,1,.5,0,99),(49,'שערי הדרום',4,12,1.2,.6,2,99),
(50,'מסגריית המושבה',1,4,2,.6,0,99),(51,'מסגרות אבן יהודה',3,4,1.4,.5,0,99),(52,'קונסטרוקציות עכו',2,4,1.6,.8,0,99),(53,'מפעלי ברזל ואלומיניום גדרה',4,4,1.6,.8,0,99),(54,'מסגריית אל־נור נצרת',2,4,1.2,.5,0,99),(55,'ח.ר. מבני פלדה',3,4,1.3,.8,4,99),
(56,'פחחות דיוק',1,5,1.8,.6,0,99),(57,'שילוט רקיע',4,13,1.4,.5,0,99),(58,'ארגזי רכב השומרון',1,14,1.2,.6,0,99),(59,'מיזוג ותעלות חורב',3,15,2.4,1,0,99),(60,'תעלות אוויר סביון',1,15,1.8,.8,0,99),(61,'מטבחים תעשייתיים ברק',3,5,1,.5,0,99),
(62,'מכונות חגי',2,6,2.2,.7,0,99),(63,'אוטומציה ירושלים',1,6,1.6,.5,0,99),(64,'רובוטיקה בקעת הירח',2,6,1.4,.6,1,99),(65,'מערכות ייצור ניר',3,6,1.8,.8,0,99),(66,'טכנו־קו מסועים',1,6,2,.7,0,99),(67,'נגב מיגון תעשייתי',4,6,1.3,.6,0,99),(68,'מספנת גליל ים',3,8,1,.9,0,99),
(69,'מחסני אלומיניום באר שבע',4,7,3,1.5,0,99),(70,'אלו־מרכז שיווק',1,7,3.4,1.6,0,99),(71,'מרכז המתכת חדרה',3,7,2.6,1.3,0,99),(72,'מחסן הפרופיל קריות',2,7,2.4,1.2,0,99);

create temp table h_fam (fam text primary key, lo numeric, hi numeric) on commit drop;
insert into h_fam values ('sht1',5,40),('sht2',4,34),('plt',1,6),('mar',1,5),('trd',3,16),('prf',3,14),('pnt',4,20),('ano',3,14),('acp',6,40),('col',1,2),
('tub',8,60),('ang',8,60),('flt',8,60),('tee',8,50),('chn',8,50),('rod',5,40),('tsl',12,120),('acc',1,8);
create temp table h_tf (trade int, fam text, w numeric) on commit drop;
insert into h_tf
select t.t, split_part(x, ':', 1), split_part(x, ':', 2)::numeric
from (values (1,'tub:2 ang:1.5 sht2:.6 acc:.6'),(2,'tub:3 flt:2 ang:1'),(3,'acp:7 pnt:2.5 ano:1.5 ang:1.2 tub:1.4 sht2:.8'),(4,'tub:9 ang:5 flt:4 chn:3 tee:2 sht2:4 trd:2 plt:1 acc:1.2'),
 (5,'sht1:8 sht2:8 trd:3 prf:3 pnt:3 ano:1.5 ang:.6'),(6,'tsl:9 plt:6 rod:4 acc:3 sht2:2 flt:1.5'),(7,'tub:6 ang:4 flt:3 sht1:3 sht2:4 trd:2 chn:2 tee:1.5 tsl:1.5 col:.9'),
 (8,'mar:9 plt:4 ang:2 flt:2 tub:2'),(9,'tub:1 ang:1'),(10,'acp:3 ano:2 pnt:2 tub:1'),(11,'tub:3 flt:1.5 ang:1'),(12,'tub:5 flt:2 ang:1.5'),(13,'acp:7 sht1:3 pnt:4 tub:2 ang:1'),(14,'trd:8 sht2:4 ang:3 tub:2 flt:1'),(15,'sht1:10 sht2:3 ang:2 flt:1 col:.7')) t(t, l),
 regexp_split_to_table(t.l, ' ') x;
-- A job in a trade that builds systems takes the whole set of a series, in the proportions the series is built in.
create temp table h_kit (kit text, part text, ratio numeric, must boolean) on commit drop;
insert into h_kit values
('WIN-45','WIN-45-FR-%',1,true),('WIN-45','WIN-45-SA-%',1.7,true),('WIN-45','WIN-45-MD-%',.6,true),('WIN-45','WIN-45-TR-%',.9,true),('WIN-45','ACC-RLR-45',.08,false),('WIN-45','ACC-LCK-45',.05,false),('WIN-45','GSK-BR-45',.04,false),('WIN-45','ACC-SCR-48',.03,false),
('WIN-60','WIN-60-FR-%',1,true),('WIN-60','WIN-60-SA-%',1.25,true),('WIN-60','WIN-60-MU-%',.3,true),('WIN-60','ACC-HNG-60',.05,false),('WIN-60','ACC-HDL-60',.05,false),('WIN-60','ACC-CRN-60',.04,false),('WIN-60','GSK-IN-60',.05,false),('WIN-60','GSK-OUT-60',.05,false),
('DOR-70','DOR-70-FR-%',1,true),('DOR-70','DOR-70-LF-%',.85,true),('DOR-70','DOR-70-TH-%',.2,true),('DOR-70','ACC-HNG-70',.06,false),('DOR-70','ACC-CLS-70',.04,false),
('CWL-50','CWL-50-MU-%',1,true),('CWL-50','CWL-50-TR-%',1.3,true),('CWL-50','CWL-50-PP-%',2.2,true),('CWL-50','CWL-50-CC-%',2.2,true),('CWL-50','GSK-CWL',.1,false),('CWL-50','ACC-BKT-CW',.08,false),('CWL-50','ACC-ANC-10',.06,false),
('PRG-A','PRG-12040-%',1,true),('PRG-A','SLT-10020-%',3.2,true),('PRG-A','ACC-SCR-48',.06,false),('PRG-B','PRG-15060-%',1,true),('PRG-B','LOU-120-%',4,true),('PRG-B','ACC-SCR-48',.06,false),('PRG-C','PRG-20060-%',1,true),('PRG-C','SLT-10020-%',3,true),('PRG-C','ACC-ANC-10',.05,false),
('RAL-G','RAL-BASE-%',1,true),('RAL-G','RAL-TOP-%',.6,true),('RAL-G','ACC-ANC-10',.1,false),('RAL-G','ACC-SIL',.03,false),('RAL-P','RAL-POST-%',1,true),('RAL-P','RAL-TOP-%',1.4,true),('RAL-P','ACC-RLG-PT',.12,false),('RAL-P','ACC-ANC-10',.1,false),
('FNC','FNC-10016-%',1,true),('FNC','RAL-POST-%',.16,true),('FNC','ACC-SCR-48',.04,false);
create temp table h_ks (kit text primary key, lo numeric, hi numeric) on commit drop;
insert into h_ks values ('WIN-45',6,44),('WIN-60',6,40),('DOR-70',4,26),('CWL-50',8,46),('PRG-A',3,18),('PRG-B',3,16),('PRG-C',2,12),('RAL-G',4,24),('RAL-P',6,30),('FNC',10,60);
create temp table h_tk (trade int, kit text, w numeric, p numeric) on commit drop;
insert into h_tk values (1,'WIN-45',.5,.9),(1,'WIN-60',.38,.9),(1,'DOR-70',.12,.9),(2,'RAL-G',.5,.9),(2,'RAL-P',.5,.9),(3,'CWL-50',.85,.55),(3,'WIN-60',.15,.55),(9,'DOR-70',.85,.9),(9,'WIN-60',.15,.9),(10,'WIN-60',.55,.75),(10,'DOR-70',.45,.75),(11,'PRG-A',.4,.9),(11,'PRG-B',.35,.9),(11,'PRG-C',.25,.9),(12,'FNC',1,.9);

create temp table h_prod on commit drop as
select p.id, p.sku, p.unit, p.price,
 case when p.sku ~ '^SHT-(1|1\.5)-' then 'sht1' when p.sku ~ '^SHT-(2|2\.5|3|4|5)-1' then 'sht2' when p.sku ~ '^SHT-(5083|6082)' then 'mar' when p.sku ~ '^SHT-TRD' then 'trd' when p.sku ~ '^SHT-PRF' then 'prf'
  when p.sku ~ '^SHT-(WH|GR|BK-2)' then 'pnt' when p.sku ~ '^SHT-(AN|BR|MIR|BK-15)' then 'ano' when p.sku ~ '^SHT-' then 'plt' when p.sku ~ '^ACP' then 'acp' when p.sku ~ '^COL' then 'col' when p.sku ~ '^TUB' then 'tub'
  when p.sku ~ '^ANG|^2A35' then 'ang' when p.sku ~ '^FLT' then 'flt' when p.sku ~ '^TEE' then 'tee' when p.sku ~ '^CHN|^2435' then 'chn' when p.sku ~ '^RND' then 'rod' when p.sku ~ '^PRF' then 'tsl'
  when p.sku ~ '^(WIN|FRM|DOR|CWL|PRG|SLT|LOU|RAL|FNC)' then 'sys' when p.sku ~ '^GSK' then 'gsk' when p.sku ~ '^(CUT|OIL|BLD|WLD|FLM)' then 'con' else 'acc' end as fam,
 1.0::numeric as pop, 0 as since_m, 99 as until_m
from products p;
update h_prod h set pop = m.pop from (select split_part(x, ':', 1) sku, split_part(x, ':', 2)::numeric pop from regexp_split_to_table('SHT-1-1225:6 SHT-1.5-1225:7 SHT-2-1225:10 SHT-2-1530:7 SHT-2.5-1225:2.5 SHT-3-1225:9 SHT-3-1530:9 SHT-4-1530:6 SHT-5-1530:6 SHT-6-1530:5 SHT-8-1530:4 SHT-10-1530:4 SHT-12-1530:2.5 SHT-15-1530:2 SHT-20-1530:1.5 SHT-25-1530:1 SHT-30-1530:.6 SHT-5-2040:2 SHT-8-2040:1.5 SHT-10-2040:1.2 SHT-5083-6:3 SHT-5083-10:2 SHT-6082-20:1.5 TUB-2020:5 TUB-2525:6 TUB-3030:9 TUB-4040:12 TUB-4040-3:6 TUB-5050:10 TUB-5050-3:6 TUB-6060:5 TUB-8080:3 TUB-10010:1.5 TUB-5025:6 TUB-6030:8 TUB-8040:8 TUB-8040-3:5 TUB-10050:5 TUB-12060:3 TUB-15050:2 TUB-20050:1 TUB-25:4 TUB-30:4 TUB-40:4 TUB-50:5 TUB-60:3 TUB-80:2 TUB-100:1 TUB-4040-BK:4 TUB-5050-WH:3 TUB-8040-GR:3 ANG-4040:2 2A35Q4R:2 FLT-5005:2 FLT-4004:1.6 PRF-4040:3 PRF-3030:2 PRF-4080:1.6 PRF-2020:1.2 PRF-8080:.7 RND-80:.5 COL-1-1250:1.4 ACP-4-WH:3 ACP-4-GR:3 ACP-3-WH:2 ACC-SCR-48:3 ACC-RVT-48:3', ' ') x) m where h.sku = m.sku;
update h_prod h set pop = h.pop / t.s from (select fam, sum(pop) s from h_prod group by 1) t where t.fam = h.fam;
update h_prod set until_m = 5 where sku = 'SHT-BR-15';
update h_prod set until_m = 4 where sku = 'SHT-MIR-1';
update h_prod set since_m = 3 where sku = 'SHT-6082-20';
update h_prod set since_m = 5 where sku in ('ACP-FR-GR','ACP-4-BZ');
update h_prod set since_m = 6 where sku ~ '^PRG-20060';

create temp table h_ord (n serial primary key, cust int, agent int, status order_status, created_at timestamptz, closed_at timestamptz, note text, promised date, number int) on commit drop;
create temp table h_line (n serial primary key, ord int, product_id uuid, price numeric, raw numeric, qty numeric, unit text, fam text) on commit drop;

do $$
declare
  t0 constant date := date '2025-11-02';
  last_day constant date := date '2026-11-02';
  cutoff constant timestamptz := timestamptz '2026-11-02 16:40+02';
  half constant date[] := array['2026-09-27','2026-09-28','2026-09-29','2026-09-30','2026-10-01']::date[];
  season constant numeric[] := array[1.00,1.06,0.88,0.98,1.22,0.74,1.12,1.24,1.30,0.92,0.94,1.10,1.00];
  note_s constant text[] := array['פריקה עד 10:00','איסוף עצמי','להתקשר לפני שיוצאים','דחוף, העבודה עומדת','להעמיס אחרון, יורד ראשון','פריקה בכניסה האחורית','הלקוח שולח נהג','לתאם יום לפני','לא לפני 9','מלגזה אצל הלקוח'];
  note_l constant text[] := array['לתאם עם מנהל הפרויקט לפני הובלה','הובלה לאתר, יש מנוף','חשבונית לפי פרויקט','לספק לפי התקדמות האתר','לוודא גוון מול האצווה הקודמת','חיתוך לפי רשימה שנשלחה במייל','מנהל העבודה מאשר פריקה','קומה 9, יש מנוף עד 14:00'];
  d date; pd date; close_d date; k int; m int; lam numeric; lead int; dow int; j numeric; u numeric; created timestamptz; closed timestamptz; st order_status;
  c h_cust; oid_ int; colour text; kc text; kn numeric; nl int; made int; s_sales numeric; s_coil numeric; factor numeric; shift int; tk text; two text; pk numeric; ks h_ks;
begin
  if exists (select 1 from orders where id::text like 'de200000-%') then raise exception 'already seeded'; end if;
  perform setseed(0.5531);
  for d in select generate_series(t0, last_day, interval '1 day')::date loop
    dow := extract(dow from d);
    continue when dow = 6 or d = any(pg_temp.shut());
    m := (extract(year from d)::int - 2025) * 12 + extract(month from d)::int - 11;
    lam := 3.45 * season[m + 1] * (1 + 0.006 * m) * case dow when 5 then 0.16 when 4 then 0.92 when 0 then 1.12 else 1 end * case when d = any(half) then .55 else 1 end;
    for k in 1 .. pg_temp.poisson(lam) loop
      select * into c from h_cust where m between from_m and to_m order by -ln(1 - random()) / weight limit 1;
      created := pg_temp.at_il(d, 450 + floor(random() * case when dow = 5 then 240 else 600 end)::int);
      continue when created >= cutoff;
      lead := case when random() < 0.3 then 6 + floor(random() * 18)::int else 1 + floor(random() * random() * 7)::int end;
      pd := pg_temp.wd(d, lead);
      u := random();
      shift := case when u < .72 then 0 when u < .85 then -1 - floor(random() * 2)::int else 1 + floor(random() * random() * 5)::int end;
      close_d := pg_temp.wd(pd, shift);
      if close_d <= d then close_d := pg_temp.wd(d, 1); end if;
      if extract(dow from close_d) = 4 and random() < .07 and close_d + 1 <> date '2026-01-02' and close_d + 1 <> all (pg_temp.shut()) then close_d := close_d + 1; end if;
      closed := pg_temp.at_il(close_d, 420 + floor(random() * case when extract(dow from close_d) = 5 then 280 else 560 end)::int);
      st := 'delivered';
      if random() < 0.04 then st := 'cancelled'; closed := pg_temp.at_il(pg_temp.wd(d, 1 + floor(random() * 2)::int), 480 + floor(random() * 480)::int); end if;
      if closed >= cutoff then st := 'open'; closed := null; end if;
      j := exp(0.6 * pg_temp.gauss()) * c.size;
      if c.size >= 1.1 and random() < .03 then j := j * 4; end if;
      j := least(j, 3 + 5 * c.size);
      insert into h_ord (cust, agent, status, created_at, closed_at, note, promised)
      values (c.i, c.agent, st, created, closed, case when random() < 0.18 then case when lead <= 3 then note_s[1 + floor(random() * 10)::int] else note_l[1 + floor(random() * 8)::int] end end, pd)
      returning n into oid_;
      select p into pk from h_tk where trade = c.trade limit 1;
      if random() < coalesce(pk, 0) then
        select kit into tk from h_tk where trade = c.trade order by -ln(1 - random()) / w limit 1;
        u := random();
        colour := case when u < .42 then 'W' when u < .85 then 'G' else 'B' end;
        kc := case when tk ~ '^(DOR|PRG|RAL|FNC)' and colour = 'B' then 'G' when tk = 'CWL-50' and colour = 'W' then 'G' else colour end;
        select * into ks from h_ks where kit = tk;
        kn := (ks.lo + random()::numeric * random()::numeric * (ks.hi - ks.lo)) * j;
        perform pg_temp.add_kit(oid_, tk, kc, kn, m, random() < .28);
        -- A big fabricator's order often carries a second series for the same building.
        if c.trade = 1 and c.size >= .8 and random() < .14 then
          two := case tk when 'WIN-45' then 'WIN-60' else 'WIN-45' end;
          perform pg_temp.add_kit(oid_, two, colour, kn * .7, m, false);
        end if;
        if random() < .4 then
          insert into h_line (ord, product_id, price, raw, unit, fam)
          select oid_, p.id, p.price, (f.lo + random() * random() * (f.hi - f.lo)) * least(j, 2), p.unit, p.fam
          from h_prod p join h_tf t on t.fam = p.fam and t.trade = c.trade join h_fam f on f.fam = p.fam
          where m between p.since_m and p.until_m and p.fam <> 'col' and not exists (select 1 from h_line l where l.ord = oid_ and l.product_id = p.id)
          order by -ln(1 - random()) / (t.w * p.pop) limit 1 + floor(random() * 2)::int;
        end if;
      else
        u := random();
        nl := case when u < .24 then 1 + floor(random() * 2)::int when u < .72 then 3 + floor(random() * 4)::int when u < .94 then 7 + floor(random() * 6)::int else 13 + floor(random() * 10)::int end;
        insert into h_line (ord, product_id, price, raw, unit, fam)
        select oid_, p.id, p.price, (f.lo + random() * random() * (f.hi - f.lo)) * case when p.fam = 'col' then 1 else j end, p.unit, p.fam
        from h_prod p join h_tf t on t.fam = p.fam and t.trade = c.trade join h_fam f on f.fam = p.fam
        where m between p.since_m and p.until_m
        order by -ln(1 - random()) / (t.w * p.pop) limit nl;
      end if;
      select count(*) into made from h_line l where l.ord = oid_;
      if made = 0 then delete from h_ord where n = oid_; end if;
    end loop;
  end loop;

  delete from h_line l where l.ord in (select x.n from h_ord x order by x.created_at limit greatest((select count(*) from h_ord) - 985, 0));
  delete from h_ord o where not exists (select 1 from h_line l where l.ord = o.n);
  update h_ord o set number = 1001 - x.r from (select n, row_number() over (order by created_at desc, n desc) as r from h_ord) x where x.n = o.n;

  select coalesce(sum(l.raw * l.price) filter (where l.fam <> 'col'), 0), coalesce(sum(greatest(1, round(l.raw)) * l.price) filter (where l.fam = 'col'), 0) into s_sales, s_coil
    from h_line l join h_ord o on o.n = l.ord where o.status = 'delivered';
  factor := (42000000 - s_coil) / s_sales;
  update h_line set qty = case when fam = 'col' then greatest(1, round(raw)) else pg_temp.soft(raw * factor, unit) end;

  insert into orders (id, number, request_id, agent_id, customer, customer_phone, note, status, created_at, closed_at, promised_on)
  overriding system value
  select pg_temp.sid('de2', o.n), o.number, md5('factory-v3-' || o.n)::uuid, (array['63bd97d7-e6bd-45aa-a113-96d91b0a489c','ba6eac84-0bb7-44d4-8379-b4d3b72cf5f4','de500000-0000-4000-8000-000000000001','de500000-0000-4000-8000-000000000002']::uuid[])[o.agent], cu.name,
    case when cu.i % 2 = 0 then (array['050','052','053','054','055','058'])[1 + cu.i % 6] || '-555' || lpad((cu.i * 3137 % 10000)::text, 4, '0') else (array['03','04','08','09'])[1 + cu.i % 4] || '-555' || lpad((cu.i * 2741 % 10000)::text, 4, '0') end,
    o.note, o.status, o.created_at, o.closed_at, o.promised
  from h_ord o join h_cust cu on cu.i = o.cust;
  insert into order_lines (id, order_id, product_id, qty, unit_price)
  select pg_temp.sid('de3', l.n), pg_temp.sid('de2', l.ord), l.product_id, l.qty, l.price from h_line l;
end $$;

select json_build_object(
 'orders', (select json_object_agg(status, c) from (select status, count(*) c from orders group by 1) s), 'first', (select min(number) from orders), 'lines', (select count(*) from order_lines),
 'by_lines', (select json_object_agg(b, c) from (select case when n <= 2 then '1-2' when n <= 6 then '3-6' when n <= 12 then '7-12' else '13+' end b, count(*) c from (select count(*) n from order_lines group by order_id) x group by 1) y),
 'sales', (select round(sum(l.qty * l.unit_price)) from order_lines l join orders o on o.id = l.order_id where o.status = 'delivered'),
 'open', (select round(sum(l.qty * l.unit_price)) from order_lines l join orders o on o.id = l.order_id where o.status = 'open'),
 'cats', (select json_agg(x) from (select p.category c, round(sum(l.qty * l.unit_price)) w, sum(l.qty) q from order_lines l join orders o on o.id = l.order_id join products p on p.id = l.product_id where o.status = 'delivered' group by 1 order by 2 desc) x),
 'top', (select json_agg(x) from (select o.customer, count(distinct o.id) n, round(sum(l.qty * l.unit_price)) w from orders o join order_lines l on l.order_id = o.id where o.status = 'delivered' group by 1 order by 3 desc limit 6) x),
 'ontime', (select round(100.0 * count(*) filter (where (closed_at at time zone 'Asia/Jerusalem')::date = promised_on) / count(*)) from orders where status = 'delivered'),
 'promised_past_open', (select count(*) from orders where status = 'open' and promised_on < date '2026-11-03' and id::text like 'de200000-%'),
 'kits', (select json_agg(x) from (select split_part(p.sku, '-', 3) || split_part(p.sku, '-', 1) part, sum(l.qty) q from order_lines l join products p on p.id = l.product_id where p.sku ~ '^DOR-70-(FR|LF|TH)' group by 1) x));
commit;
