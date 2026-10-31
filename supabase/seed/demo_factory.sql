-- Demo dataset: a small carpentry workshop, one week of activity.
-- Applied 2026-11-01 via MCP execute_sql (the two trial products from 2026-10-31 were removed separately).
-- Additive: keeps existing workers/suppliers and adds the missing ones by name. Supplier 'מקור' (contact דני) is the existing one.
do $$
declare
  w_itzik uuid; w_moran uuid; w_yossi uuid;
  s_dani uuid; s_galil uuid; s_parzul uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid;
  d0 timestamptz := date_trunc('day', now());
begin
  -- workers
  select id into w_itzik from workers where name = 'איציק' limit 1;
  if w_itzik is null then insert into workers(name, role) values ('איציק','מחסנאי') returning id into w_itzik; end if;
  insert into workers(name, role) select 'מורן לוי','עובד' where not exists (select 1 from workers where name='מורן לוי');
  insert into workers(name, role) select 'יוסי כהן','מנהל' where not exists (select 1 from workers where name='יוסי כהן');
  select id into w_moran from workers where name='מורן לוי'; select id into w_yossi from workers where name='יוסי כהן';

  -- suppliers
  select id into s_dani from suppliers where name='מקור' limit 1;
  if s_dani is null then insert into suppliers(name, contact) values ('מקור','דני') returning id into s_dani; end if;
  update suppliers set notes = coalesce(notes,'עצים ולוחות · אספקה בימי ב׳ וה׳') where id = s_dani;
  insert into suppliers(name, contact, phone, email, notes) values ('עצים הגליל בע״מ','רונית','04-6900411','orders@galil-wood.co.il','לוחות סנדוויץ׳, קנטים · מינימום הזמנה 10 לוחות')
    on conflict (name) do nothing;
  insert into suppliers(name, contact, phone, email, notes) values ('פרזול הצפון','אבי','04-8231177','avi@parzul-north.co.il','ברגים, דבקים, אביזרי פרזול')
    on conflict (name) do nothing;
  select id into s_galil from suppliers where name='עצים הגליל בע״מ'; select id into s_parzul from suppliers where name='פרזול הצפון';

  -- products (qty starts at 0; the opening count below sets it)
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id,notes) values
    ('PLY-18','לוח סנדוויץ׳ 18 מ״מ 122×244','לוחות','יח׳',20,'A-1',s_galil,'ליבנה, איכות B/BB') returning id into p1;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id) values
    ('MDF-16','לוח MDF 16 מ״מ 122×244','לוחות','יח׳',25,'A-2',s_dani) returning id into p2;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id,notes) values
    ('OAK-27','קרש אלון 27 מ״מ','עץ מלא','מטר',60,'B-1',s_dani,'אלון אירופאי, מיובש בתנור') returning id into p3;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id) values
    ('SCR-4X40','ברגי עץ 4×40 (קופסה 500)','פרזול','אריזה',10,'C-3',s_parzul) returning id into p4;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id) values
    ('GLU-PVA','דבק עץ PVA 5 ק״ג','חומרים מתכלים','יח׳',4,'C-1',s_parzul) returning id into p5;
  insert into products(sku,name,category,unit,min_qty,location,primary_supplier_id) values
    ('EDG-OAK','קנט אלון 22 מ״מ (גליל 50 מ׳)','קנטים','יח׳',5,'C-2',s_galil) returning id into p6;

  -- supplier dictionary: how each supplier names our products on delivery notes
  insert into supplier_items(supplier_id,external_name,external_sku,product_id,status,approved_at,times_seen,last_seen_at) values
    (s_galil,'סנדוויץ ליבנה 18 מ"מ 122/244','SW18-BB',p1,'approved',d0 - interval '20 days',3,d0 - interval '12 days'),
    (s_galil,'קנט אלון 22 גליל 50',null,p6,'approved',d0 - interval '20 days',2,d0 - interval '12 days'),
    (s_dani,'MDF 16 גולמי',null,p2,'approved',d0 - interval '30 days',4,d0 - interval '9 days'),
    (s_dani,'קרש אלון 27 מ''''א','OK-27',p3,'approved',d0 - interval '30 days',5,d0 - interval '10 days'),
    (s_parzul,'בורג עץ 4*40 ק/500','WS-440',p4,'approved',d0 - interval '45 days',6,d0 - interval '14 days'),
    (s_parzul,'דבק PVA D3 5 ק"ג','PVA-5',p5,'approved',d0 - interval '45 days',3,d0 - interval '14 days'),
    -- waiting for a manager decision (came in on recent delivery notes)
    (s_dani,'אלון 27 ממ ממוין',null,p3,'pending',null,1,d0 - interval '3 days' + interval '9 hours'),
    (s_galil,'קנט PVC לבן 22',null,null,'pending',null,1,d0 - interval '5 days' + interval '8 hours');

  -- opening count, 8 days ago
  insert into movements(type,product_id,qty,worker_id,note,created_at) values
    ('adjust',p1,30,w_yossi,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p2,28,w_yossi,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p3,120,w_yossi,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p4,6,w_yossi,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p5,7,w_yossi,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours'),
    ('adjust',p6,12,w_yossi,'ספירת פתיחה',d0 - interval '8 days' + interval '7 hours');

  -- the week: receipts (with the supplier's own wording) and issues to jobs
  insert into movements(type,product_id,qty,worker_id,supplier_id,reference,external_name,note,created_at) values
    ('in', p1,24,w_itzik,s_galil,'תעודה 48213','סנדוויץ ליבנה 18 מ"מ 122/244',null,d0 - interval '5 days' + interval '8 hours 20 minutes'),
    ('in', p6, 5,w_itzik,s_galil,'תעודה 48213','קנט אלון 22 גליל 50',null,d0 - interval '5 days' + interval '8 hours 21 minutes'),
    ('out',p2, 8,w_moran,null,'הזמנה 2041',null,'ארונות מטבח · משפחת ברק',d0 - interval '6 days' + interval '9 hours'),
    ('out',p1, 6,w_moran,null,'הזמנה 2041',null,'ארונות מטבח · משפחת ברק',d0 - interval '6 days' + interval '9 hours 5 minutes'),
    ('out',p4, 4,w_moran,null,'הזמנה 2041',null,null,d0 - interval '6 days' + interval '9 hours 10 minutes'),
    ('out',p3,20,w_itzik,null,'הזמנה 2043',null,'שולחן אוכל אלון',d0 - interval '5 days' + interval '13 hours'),
    ('out',p5, 2,w_itzik,null,'הזמנה 2043',null,null,d0 - interval '5 days' + interval '13 hours 2 minutes'),
    ('out',p2, 5,w_moran,null,'הזמנה 2045',null,'מדפים לחנות',d0 - interval '4 days' + interval '10 hours 30 minutes'),
    ('out',p6, 2,w_moran,null,'הזמנה 2045',null,null,d0 - interval '4 days' + interval '10 hours 32 minutes'),
    ('in', p3,90,w_itzik,s_dani,'תעודה 1187','קרש אלון 27 מ''''א',null,d0 - interval '3 days' + interval '9 hours'),
    ('out',p3,10,w_itzik,null,'הזמנה 2043',null,'השלמה',d0 - interval '3 days' + interval '14 hours'),
    ('out',p1, 4,w_moran,null,'הזמנה 2046',null,'ארון אמבטיה',d0 - interval '2 days' + interval '11 hours'),
    ('out',p4, 2,w_moran,null,'הזמנה 2046',null,null,d0 - interval '2 days' + interval '11 hours 3 minutes'),
    ('in', p5, 4,w_itzik,s_parzul,'תעודה 7731','דבק PVA D3 5 ק"ג',null,d0 - interval '1 day' + interval '8 hours 45 minutes'),
    ('out',p2, 3,w_moran,null,'הזמנה 2047',null,'דלתות פנים',d0 - interval '1 day' + interval '12 hours'),
    ('out',p1, 2,w_itzik,null,'הזמנה 2047',null,null,d0 + interval '8 hours 10 minutes');

  -- faults: one handled last week, one open from this morning
  insert into faults(product_id,description,reported_by,status,created_at,resolved_at) values
    (p4,'קופסה הגיעה פתוחה, חסרים כ־100 ברגים',w_itzik,'resolved',d0 - interval '4 days' + interval '9 hours',d0 - interval '3 days' + interval '10 hours');
  insert into movements(type,product_id,qty,worker_id,note,created_at) values
    ('fault',p2,1,w_moran,'פינה שבורה, הופרד בצד',d0 + interval '7 hours 40 minutes');
  insert into faults(product_id,movement_id,description,reported_by,status,created_at)
    select p2, id, 'לוח MDF הגיע עם פינה שבורה, הופרד בצד', w_moran, 'open', created_at from movements where type='fault' and product_id=p2;
end $$;
