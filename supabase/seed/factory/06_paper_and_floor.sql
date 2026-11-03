begin;
set local statement_timeout = '200s';
set local session_replication_role = replica;
create function pg_temp.sid(kind text, n bigint) returns uuid language sql immutable as
$f$ select (kind || '00000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $f$;
create function pg_temp.at_il(d date, minutes int) returns timestamptz language sql as
$f$ select (d + make_interval(mins => minutes, secs => floor(random() * 60)::int)) at time zone 'Asia/Jerusalem' $f$;
create function pg_temp.shut() returns date[] language sql immutable as
$f$ select array['2026-03-03','2026-04-01','2026-04-02','2026-04-03','2026-04-05','2026-04-06','2026-04-07','2026-04-08','2026-04-21','2026-04-22','2026-05-21','2026-05-22','2026-09-11','2026-09-13','2026-09-20','2026-09-21','2026-09-25','2026-10-02']::date[] $f$;
-- The same moment if the floor is working then, otherwise the next working morning.
create function pg_temp.working(t timestamptz) returns timestamptz language plpgsql as $f$
declare l timestamp := t at time zone 'Asia/Jerusalem'; d date := l::date; h numeric := extract(hour from l);
begin
  if extract(dow from d) not in (5, 6) and d <> all (pg_temp.shut()) and h between 7 and 16 then return t; end if;
  if h >= 7 then d := d + 1; end if;
  while extract(dow from d) in (5, 6) or d = any(pg_temp.shut()) loop d := d + 1; end loop;
  return pg_temp.at_il(d, 450 + floor(random() * 300)::int);
end $f$;

-- Metres cut to length can leave a shelf a few metres over its rounded bars.
update shelf_stock s set qty = s.qty - x.gap from (
  select distinct on (p.id) p.id, sh.place, t.gap from products p join shelf_stock sh on sh.product_id = p.id
  join (select product_id, sum(qty) - (select qty from products q where q.id = product_id) gap from shelf_stock group by 1) t on t.product_id = p.id
  where t.gap > 0 order by p.id, sh.qty desc) x where x.id = s.product_id and x.place = s.place;

create temp table h_pass on commit drop as
select o.id as order_id, o.number, o.customer, o.closed_at, row_number() over (order by o.closed_at) as n
from orders o where o.id::text like 'de200000-%' and o.status = 'delivered' and o.number % 131 = 19;
insert into exit_passes (id, session_id, user_id, phone, reason, tx, created_at)
select pg_temp.sid('de8', p.n), md5('pass-v3-' || p.n)::uuid, '5e76868a-a5a5-4584-8eee-4b9ff92a6ac7', '972538206810',
  (array['איסוף דחוף, התעודה תיחתם מחר','נהג הלקוח יצא בלי תעודה, אישור טלפוני','החלפת סחורה פגומה באתר','הספק של הלקוח אסף, תעודה תגיע במייל','לקוח קבוע, חתימה ביום ראשון','סחורה לתערוכה, תוחזר','השלמה דחופה לאתר בבנייה'])[1 + (p.n - 1) % 7], 0, p.closed_at
from h_pass p;
update movements m set exit_pass = pg_temp.sid('de8', p.n), note = m.note || ' · בלי קבלה: ' || e.reason
from h_pass p join order_lines l on l.order_id = p.order_id join exit_passes e on e.id = pg_temp.sid('de8', p.n)
where l.movement_id = m.id;

insert into documents (id, kind, storage_path, customer, reference, worker_id, created_at)
select pg_temp.sid('de6', row_number() over (order by o.closed_at)), 'out',
  'out/' || floor(extract(epoch from o.closed_at - interval '41 seconds') * 1000)::bigint || '-' || substr(md5('v3' || o.id::text), 1, 6) || '.jpg',
  o.customer, 'הזמנה ' || o.number,
  (select m.worker_id from order_lines l join movements m on m.id = l.movement_id where l.order_id = o.id and m.worker_id is not null limit 1),
  o.closed_at - make_interval(secs => 20 + abs(hashtext(o.id::text)) % 70)
from orders o where o.status = 'delivered' and not exists (select 1 from h_pass p where p.order_id = o.id) and exists (select 1 from order_lines l where l.order_id = o.id and l.movement_id is not null);
update movements m set document_id = d.id
from order_lines l join orders o on o.id = l.order_id join documents d on d.reference = 'הזמנה ' || o.number and d.kind = 'out' and d.id::text like 'de600000-%'
where l.movement_id = m.id and m.exit_pass is null;

insert into documents (id, kind, storage_path, supplier_id, reference, worker_id, created_at)
select pg_temp.sid('de6', 100000 + row_number() over (order by x.at)), 'in',
  'in/' || floor(extract(epoch from x.at - interval '55 seconds') * 1000)::bigint || '-' || substr(md5('v3' || x.supplier_id::text || x.reference), 1, 6) || '.jpg',
  x.supplier_id, x.reference, x.w, x.at - make_interval(secs => 30 + abs(hashtext(x.reference)) % 90)
from (select supplier_id, reference, min(created_at) as at, (array_agg(worker_id order by created_at))[1] as w from movements where type = 'in' and id::text like 'de100000-%' and reference is not null group by 1, 2) x;
update movements m set document_id = d.id from documents d where d.kind = 'in' and d.id::text like 'de600000-%' and d.supplier_id = m.supplier_id and d.reference = m.reference and m.type = 'in';

create temp table h_si on commit drop as
select p.id as product_id, p.primary_supplier_id as supplier_id, s.name as sname,
  btrim(regexp_replace(replace(replace(replace(replace(p.name, 'אלומיניום', 'אלומ'), 'מ״מ', 'ממ'), ' (מוט 6 מ׳)', ' 6 מטר'), ' (מוט 3 מ׳)', ' 3 מטר'), '\(אריזה (\d+)\)', 'ק/\1'), ' ') as base
from products p join suppliers s on s.id = p.primary_supplier_id;
insert into supplier_items (supplier_id, external_name, external_sku, product_id, status, approved_at, times_seen, created_at, updated_at)
select h.supplier_id,
  case when h.sname in ('שיחולי הערבה בע״מ','גזית מחברים בע״מ') then replace(h.base, '×', '*') when h.sname in ('נמל מתכות יבוא ושיווק','קומפוזיט פאנל יבוא','הצפון אביזרים') then replace(h.base, '×', 'X') else replace(h.base, '×', '/') end,
  case when abs(hashtext(p.sku)) % 5 < 2 then upper(substr(md5(p.sku), 1, 2)) || '-' || (1000 + abs(hashtext(p.sku)) % 9000) end,
  h.product_id, 'approved', timestamptz '2025-11-02 09:00+02', 0, timestamptz '2025-11-02 09:00+02', now()
from h_si h join products p on p.id = h.product_id
where not exists (select 1 from supplier_items i where i.product_id = h.product_id and i.supplier_id = h.supplier_id and i.status = 'approved')
on conflict do nothing;
update movements m set external_name = x.external_name from (select distinct on (supplier_id, product_id) supplier_id, product_id, external_name from supplier_items where status = 'approved' order by supplier_id, product_id, created_at) x
where m.type = 'in' and m.supplier_id = x.supplier_id and m.product_id = x.product_id and m.id::text like 'de100000-%';
update supplier_items i set times_seen = 0, last_seen_at = null where status = 'approved';
update supplier_items i set times_seen = x.n, last_seen_at = x.at from (select supplier_id, external_name, count(*) n, max(created_at) at from movements where type = 'in' and external_name is not null group by 1, 2) x where x.supplier_id = i.supplier_id and x.external_name = i.external_name;

do $$
declare
  machine constant text[][] := array[['M-01','להב המסור רועד בחיתוך'],['M-01','חיישן המגן לא מגיב'],['M-01','הזנה נתקעת בחיתוך 45 מעלות'],['M-02','שגיאת ציר Z בהפעלה'],['M-02','ואקום שולחן יורד באמצע עבודה'],['M-03','נזילת שמן הידראולי'],['M-03','כיול זווית לא מדויק'],['M-04','להב שחוק, חיתוך לא ישר'],['M-04','מנוע הזנה מתחמם'],['M-05','עדשה מלוכלכת, חיתוך לא נקי'],['M-05','לחץ חנקן נמוך'],['M-05','שגיאת מערכת קירור'],['M-06','סכין קהה, גזירה עם זיז'],['M-06','רגל מכנית לא חוזרת'],['C-2','פין בטיחות חסר בעמוד'],['G-3','קורה כפופה אחרי פגיעת מלגזה']];
  who uuid[]; d date; dow int; pr record; descr text; rep uuid; opened timestamptz; fn int := 0; mid uuid; q int;
begin
  perform setseed(0.2291);
  select array_agg(id) into who from workers where name in ('ליאל סויסה','ניב לוצקי','שחר אלמקאייס','יהלי קרסנטי','מתן רוזנבלט','דביר חיימוב');
  for d in select generate_series(date '2025-11-05', date '2026-10-27', interval '1 day')::date loop
    dow := extract(dow from d);
    continue when dow in (5, 6) or d = any(pg_temp.shut());
    rep := who[1 + floor(random() * 6)::int];
    opened := pg_temp.at_il(d, 450 + floor(random() * 480)::int);
    if random() < .26 then
      select id, category, sku into pr from products where category <> 'חומרים מתכלים' order by random() * case category when 'פרופילים' then 1 when 'מערכות חלונות' then .8 when 'לוחות' then .8 when 'פאנלים מרוכבים' then 1.1 else 2.6 end limit 1;
      descr := case pr.category
        when 'לוחות' then (array['פינה מקופלת בהובלה','שריטות על פני הלוח','כתמי חמצון בין הלוחות','עובי לא תואם לתעודה','ניילון המגן נקרע בפריקה'])[1 + floor(random() * 5)::int]
        when 'פרופילים' then (array['מוט כפוף בקצה','שריטות לאורך המוט','אורך קצר מהמוזמן','סימני לחץ על המוט','צרור הגיע פתוח'])[1 + floor(random() * 5)::int]
        when 'מערכות חלונות' then (array['שריטות בצבע','גוון שונה מהאצווה הקודמת','פרופיל מעוך בפריקה','צבע מתקלף בקצה המוט'])[1 + floor(random() * 4)::int]
        when 'פרגולות ומעקות' then (array['שריטות בצבע','מכה בדופן הקורה','גוון שונה מהאצווה הקודמת'])[1 + floor(random() * 3)::int]
        when 'פאנלים מרוכבים' then (array['שריטה בציפוי','פינה מעוכה','ניילון המגן נקרע בפריקה'])[1 + floor(random() * 3)::int]
        when 'גלילים' then (array['קצה הגליל מעוך','אריזה נקרעה בהובלה'])[1 + floor(random() * 2)::int]
        when 'אביזרים' then (array['אריזה הגיעה פתוחה','חסרות יחידות באריזה','הברגה פגומה'])[1 + floor(random() * 3)::int]
        else (array['גליל מעוך','גומי סדוק'])[1 + floor(random() * 2)::int] end;
      fn := fn + 1; mid := null;
      if random() < .75 then
        q := 1 + floor(random() * random() * 5)::int;
        mid := pg_temp.sid('de1', 100000 + fn);
        insert into movements (id, type, product_id, qty, worker_id, note, created_at) values (mid, 'fault', pr.id, q, rep, descr, opened);
      end if;
      insert into faults (id, product_id, movement_id, description, reported_by, status, created_at, resolved_at)
      values (pg_temp.sid('de4', fn), pr.id, mid, descr, rep, 'resolved', opened, pg_temp.working(opened + make_interval(hours => 3 + floor(random() * random() * 170)::int, mins => floor(random() * 60)::int)));
    elsif random() < .1 then
      fn := fn + 1;
      q := 1 + floor(random() * 16)::int;
      insert into faults (id, asset, description, reported_by, status, created_at, resolved_at)
      values (pg_temp.sid('de4', fn), machine[q][1], machine[q][2], rep, 'resolved', opened, pg_temp.working(opened + make_interval(hours => 2 + floor(random() * random() * 90)::int, mins => floor(random() * 60)::int)));
    end if;
  end loop;
  insert into faults (id, product_id, description, reported_by, status, created_at)
  select pg_temp.sid('de4', 9001), id, 'גוון שונה מהאצווה הקודמת', who[1], 'open', pg_temp.at_il(date '2026-10-29', 640) from products where sku = 'WIN-60-SA-G';
  insert into faults (id, product_id, description, reported_by, status, created_at)
  select pg_temp.sid('de4', 9002), id, 'אריזה הגיעה פתוחה', who[4], 'open', pg_temp.at_il(date '2026-11-02', 505) from products where sku = 'ACC-HNG-60';
  insert into faults (id, asset, description, reported_by, status, created_at) values (pg_temp.sid('de4', 9003), 'M-02', 'נזילת נוזל קירור מהציר', who[3], 'open', pg_temp.at_il(date '2026-11-01', 800));
  insert into faults (id, asset, description, reported_by, status, created_at) values (pg_temp.sid('de4', 9004), 'E-3', 'קורה כפופה אחרי פגיעת מלגזה', who[6], 'open', pg_temp.at_il(date '2026-10-30', 590));

  -- A worker met a line he couldn't match; the manager tied it to the product it really was.
  insert into item_requests (id, kind, status, external_name, qty, customer, reference, note, worker_id, product_id, movement_id, created_at, resolved_at, document_id)
  select pg_temp.sid('de7', x.n), 'unknown', 'approved',
    replace(replace(regexp_replace(x.name, '\s*\(.*\)\s*$', ''), '×', ' על '), ' מ״מ', ''), x.qty, x.customer, x.reference, x.note, x.worker_id, x.product_id, x.mid,
    greatest(x.created_at - make_interval(mins => 15 + abs(hashtext(x.mid::text)) % 190), ((x.created_at at time zone 'Asia/Jerusalem')::date + time '07:12') at time zone 'Asia/Jerusalem'), x.created_at, x.document_id
  from (select row_number() over (order by m.created_at) n, m.qty, split_part(split_part(m.note, 'ללקוח: ', 2), ' · ', 1) customer, m.reference, m.note, m.worker_id, m.product_id, m.id mid, m.created_at, m.document_id, p.name
        from movements m join products p on p.id = m.product_id where m.type = 'out' and m.id::text like 'de100000-%' and abs(hashtext(m.id::text)) % 300 = 7 and m.worker_id is not null limit 20) x;
  insert into item_requests (id, kind, status, external_name, proposed_name, qty, customer, note, worker_id, created_at, resolved_at) values
    (pg_temp.sid('de7', 901), 'new_product', 'rejected', 'פרופיל L 25 על 25', 'זווית 25×25×2 (מוט 6 מ׳)', 12, 'מסגריית המושבה', 'לא בקטלוג, הוחלף בזווית 30', who[2], timestamptz '2026-08-11 10:30+03', timestamptz '2026-08-11 13:05+03'),
    (pg_temp.sid('de7', 902), 'unknown', 'rejected', 'לוח דקורטיבי זהב', null, 4, 'סטודיו ויטרינה', 'לא מוצר שלנו', who[3], timestamptz '2026-06-24 09:40+03', timestamptz '2026-06-24 11:15+03');
  insert into item_requests (id, kind, status, external_name, proposed_name, qty, customer, note, worker_id, created_at) values
    (pg_temp.sid('de7', 903), 'new_product', 'pending', 'פרופיל סיום לחיפוי ACP', 'פרופיל סיום לחיפוי 4 מ״מ (מוט 3 מ׳)', 30, 'חזיתות המרכז בע״מ', 'מופיע בתעודת הלקוח, אין בקטלוג', who[5], timestamptz '2026-11-02 11:20+02'),
    (pg_temp.sid('de7', 904), 'unknown', 'pending', 'זווית 120/60', null, 16, 'קונסטרוקציות עכו', 'צריך להתאים למוצר', who[1], timestamptz '2026-11-02 14:05+02');
end $$;

update orders set promised_on = date '2026-11-02' where number = (select max(number) from orders where status = 'open' and id::text like 'de200000-%' and created_at < '2026-10-25');
update orders set promised_on = date '2026-11-01' where number = (select min(number) from orders where status = 'open' and id::text like 'de200000-%');

select json_build_object('documents', (select json_object_agg(kind, c) from (select kind, count(*) c from documents group by 1) d),
 'out_no_doc', (select count(*) from movements where type = 'out' and document_id is null), 'in_no_doc', (select count(*) from movements where type = 'in' and document_id is null),
 'passes', (select count(*) from exit_passes), 'names', (select json_object_agg(status, c) from (select status, count(*) c from supplier_items group by 1) s),
 'faults', (select json_object_agg(status, c) from (select status, count(*) c from faults group by 1) s), 'requests', (select json_object_agg(status, c) from (select status, count(*) c from item_requests group by 1) s),
 'over', (select count(*) from (select s.product_id, sum(s.qty) q, p.qty t from shelf_stock s join products p on p.id = s.product_id group by 1, 3) x where q > t), 'open_lines', (select count(*) from orders where status = 'open'));
commit;
