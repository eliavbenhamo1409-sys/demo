-- Demo dataset: an aluminium profiles and sheets factory, one week of activity.
-- The live rows were renamed to this set on 2026-11-02 (ids kept, so stock and links stayed as they were).
-- Additive: keeps existing workers/suppliers and adds the missing ones by name.
do $$
declare
  w_roi uuid; w_michal uuid; w_noam uuid;
  s_center uuid; s_shahar uuid; s_north uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid;
  d0 timestamptz := date_trunc('day', now());
begin
  -- workers
  select id into w_roi from workers where name = 'רועי דהן' limit 1;
  if w_roi is null then insert into workers(name, role) values ('רועי דהן','מחסנאי') returning id into w_roi; end if;
  insert into workers(name, role) select 'מיכל אברהם','עובד' where not exists (select 1 from workers where name='מיכל אברהם');
  insert into workers(name, role) select 'נועם פרץ','מנהל' where not exists (select 1 from workers where name='נועם פרץ');
  select id into w_michal from workers where name='מיכל אברהם'; select id into w_noam from workers where name='נועם פרץ';

  -- suppliers
  select id into s_center from suppliers where name='מתכות המרכז בע״מ' limit 1;
  if s_center is null then insert into suppliers(name, contact, phone) values ('מתכות המרכז בע״מ','נועה','03-5550142') returning id into s_center; end if;
  update suppliers set notes = coalesce(notes,'פרופילים ולוחות אלומיניום · אספקה בימי ב׳ וה׳') where id = s_center;
  insert into suppliers(name, contact, phone, email, notes) values ('שחר לוחות ומתכת','רונן','04-5550188','orders@shahar-metal.co.il','לוחות אלומיניום ואטמים · מינימום הזמנה 10 לוחות')
    on conflict (name) do nothing;
  insert into suppliers(name, contact, phone, email, notes) values ('הצפון אביזרים','הילה','04-5550177','hila@hatzafon-parts.co.il','ברגים, אביזרים וחומרים מתכלים')
    on conflict (name) do nothing;
  select id into s_shahar from suppliers where name='שחר לוחות ומתכת'; select id into s_north from suppliers where name='הצפון אביזרים';

  -- products (qty starts at 0; the opening count below sets it)
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id,notes) values
    ('SHT-2-1225','לוח אלומיניום 2 מ״מ 1250×2500','לוחות','יח׳',20,'A-1',s_shahar,'סגסוגת 5754') returning id into p1;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id) values
    ('SHT-3-1530','לוח אלומיניום 3 מ״מ 1500×3000','לוחות','יח׳',25,'A-2',s_center) returning id into p2;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id,notes) values
    ('PRF-4040','פרופיל אלומיניום 40×40 מ״מ','פרופילים','מטר',60,'B-1',s_center,'אנודייז טבעי') returning id into p3;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id) values
    ('SCR-M620','ברגי נירוסטה M6×20 (אריזה 100)','אביזרים','אריזה',10,'C-3',s_north) returning id into p4;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id) values
    ('CUT-5L','נוזל קירור לחיתוך 5 ליטר','חומרים מתכלים','יח׳',4,'C-1',s_north) returning id into p5;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id) values
    ('GSK-EPDM','אטם גומי EPDM (גליל 50 מ׳)','אטמים','יח׳',5,'C-2',s_shahar) returning id into p6;

  -- supplier dictionary: how each supplier names our products on delivery notes
  insert into supplier_items(supplier_id,external_name,external_sku,product_id,status,approved_at,times_seen,last_seen_at) values
    (s_shahar,'לוח אלומ 2 ממ 1250/2500','AL-2125',p1,'approved',d0 - interval '20 days',3,d0 - interval '12 days'),
    (s_shahar,'אטם EPDM גליל 50',null,p6,'approved',d0 - interval '20 days',2,d0 - interval '12 days'),
    (s_center,'לוח אלומ 3 ממ 1500/3000',null,p2,'approved',d0 - interval '30 days',4,d0 - interval '9 days'),
    (s_center,'פרופיל 40*40 מטר','PR-4040',p3,'approved',d0 - interval '30 days',5,d0 - interval '10 days'),
    (s_north,'בורג נירוסטה M6*20 ק/100','SS-620',p4,'approved',d0 - interval '45 days',6,d0 - interval '14 days'),
    (s_north,'נוזל קירור 5 ליטר','CF-5',p5,'approved',d0 - interval '45 days',3,d0 - interval '14 days'),
    -- waiting for a manager decision (came in on recent delivery notes)
    (s_center,'פרופיל 40X40 אנודייז',null,p3,'pending',null,1,d0 - interval '3 days' + interval '9 hours'),
    (s_shahar,'אטם EPDM שחור 6',null,null,'pending',null,1,d0 - interval '5 days' + interval '8 hours');

  -- A made-up history has no receipts to show, so the receipt gate steps aside for it.
  alter table movements disable trigger movements_guard;

  -- opening count, 8 days ago
  insert into movements(type,product_id,qty,worker_id,note,created_at) values
    ('adjust',p1,30,w_noam,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p2,28,w_noam,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p3,120,w_noam,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p4,6,w_noam,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p5,7,w_noam,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p6,12,w_noam,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours');

  -- the week: receipts (with the supplier's own wording) and issues to customers
  insert into movements(type,product_id,qty,worker_id,supplier_id,reference,external_name,note,created_at) values
    ('in', p1,24,w_roi,s_shahar,'תעודה 48213','לוח אלומ 2 ממ 1250/2500',null,d0 - interval '5 days' + interval '8 hours 20 minutes'),
    ('in', p6, 5,w_roi,s_shahar,'תעודה 48213','אטם EPDM גליל 50',null,d0 - interval '5 days' + interval '8 hours 21 minutes'),
    ('out',p2, 8,w_michal,null,'הזמנה 2041',null,'חלונות ודלתות · חברת ברק',d0 - interval '6 days' + interval '9 hours'),
    ('out',p1, 6,w_michal,null,'הזמנה 2041',null,'חלונות ודלתות · חברת ברק',d0 - interval '6 days' + interval '9 hours 5 minutes'),
    ('out',p4, 4,w_michal,null,'הזמנה 2041',null,null,d0 - interval '6 days' + interval '9 hours 10 minutes'),
    ('out',p3,20,w_roi,null,'הזמנה 2043',null,'מעקה מרפסת',d0 - interval '5 days' + interval '13 hours'),
    ('out',p5, 2,w_roi,null,'הזמנה 2043',null,null,d0 - interval '5 days' + interval '13 hours 2 minutes'),
    ('out',p2, 5,w_michal,null,'הזמנה 2045',null,'חיפוי חזית',d0 - interval '4 days' + interval '10 hours 30 minutes'),
    ('out',p6, 2,w_michal,null,'הזמנה 2045',null,null,d0 - interval '4 days' + interval '10 hours 32 minutes'),
    ('in', p3,90,w_roi,s_center,'תעודה 1187','פרופיל 40*40 מטר',null,d0 - interval '3 days' + interval '9 hours'),
    ('out',p3,10,w_roi,null,'הזמנה 2043',null,'השלמה',d0 - interval '3 days' + interval '14 hours'),
    ('out',p1, 4,w_michal,null,'הזמנה 2046',null,'פרגולה',d0 - interval '2 days' + interval '11 hours'),
    ('out',p4, 2,w_michal,null,'הזמנה 2046',null,null,d0 - interval '2 days' + interval '11 hours 3 minutes'),
    ('in', p5, 4,w_roi,s_north,'תעודה 7731','נוזל קירור 5 ליטר',null,d0 - interval '1 day' + interval '8 hours 45 minutes'),
    ('out',p2, 3,w_michal,null,'הזמנה 2047',null,'ויטרינה לחנות',d0 - interval '1 day' + interval '12 hours'),
    ('out',p1, 2,w_roi,null,'הזמנה 2047',null,null,d0 + interval '8 hours 10 minutes');

  -- faults: one handled last week, one open from this morning
  insert into faults(product_id,description,reported_by,status,created_at,resolved_at) values
    (p4,'קופסה הגיעה פתוחה, חסרים כ־20 ברגים',w_roi,'resolved',d0 - interval '4 days' + interval '9 hours',d0 - interval '3 days' + interval '10 hours');
  insert into movements(type,product_id,qty,worker_id,note,created_at) values
    ('fault',p2,1,w_michal,'פינה מקופלת, הופרד בצד',d0 + interval '7 hours 40 minutes');
  insert into faults(product_id,movement_id,description,reported_by,status,created_at)
    select p2, id, 'לוח הגיע עם פינה מקופלת, הופרד בצד', w_michal, 'open', created_at from movements where type='fault' and product_id=p2;

  alter table movements enable trigger movements_guard;
end $$;

-- Catalogue: the field agents, and what customers read about each product.
-- Runs on its own and runs again safely: agents are added by name, and a description, price or photo already set stays.
-- A photo path from the root is a file in public/products of the admin and agent apps. The two profile bars exist only on the live rows.
insert into agents(name, phone) select 'שירה לוי','052-3451122' where not exists (select 1 from agents where name='שירה לוי');
insert into agents(name, phone) select 'איתי מזרחי','054-7789034' where not exists (select 1 from agents where name='איתי מזרחי');
update products p set description = coalesce(p.description, v.description), price = coalesce(p.price, v.price), image_path = coalesce(p.image_path, v.image_path)
from (values
  ('SHT-2-1225','לוח אלומיניום בסגסוגת 5754, עמיד בקורוזיה ומתאים לכיפוף, לריתוך ולחיתוך.',320.00,'/products/sht-2-1225.webp'),
  ('SHT-3-1530','לוח עבה לשימושים מבניים ולחיפוי, במידה מלאה של 1.5 על 3 מטר.',690.00,'/products/sht-3-1530.webp'),
  ('PRF-4040','פרופיל מבני עם חריצי T בארבעת הצדדים, לבניית מסגרות ועמדות עבודה. גימור אנודייז טבעי.',68.00,'/products/prf-4040.webp'),
  ('243535521','פרופיל תעלה למסילות, לסיומות ולמסגרות, באורך מוט מלא של 6 מטר.',96.00,'/products/243535521.webp'),
  ('2A35Q4R','זווית שוות שוקיים לחיזוק, לחיבור פינות ולמסגור, באורך מוט מלא של 6 מטר.',118.00,'/products/2a35q4r.webp'),
  ('GSK-EPDM','אטם גמיש שעומד במזג אוויר ובקרינת UV, לאיטום פרופילים וזיגוג.',210.00,'/products/gsk-epdm.webp'),
  ('SCR-M620','ברגי נירוסטה עם ראש משושה, עמידים בחלודה, לחיבור פרופילים.',74.00,'/products/scr-m620.webp'),
  ('CUT-5L','נוזל קירור וסיכה לחיתוך ולקידוח אלומיניום, שומר על הלהב ועל גימור החיתוך.',135.00,'/products/cut-5l.webp')
) as v(sku, description, price, image_path)
where p.sku = v.sku;
