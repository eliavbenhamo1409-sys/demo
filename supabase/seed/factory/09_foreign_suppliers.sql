-- Foreign suppliers, and one name per supplier for each product (2026-11-16).
--
-- An aluminium factory in Israel buys abroad: profiles from Turkey, plates, coils and bars from Greece, composite panels
-- from China, window hardware from Italy. Four suppliers join with ids de9…, and 24 deliveries that already were in the
-- ledger move to them whole: the containers that came in container rhythm and size (קומפוזיט פאנל's biggest, נמל
-- מתכות's that had no 8 mm 1500×3000), מתכות המרכז's largest loads of plain profiles, and five of הצפון אביזרים's hardware
-- pallets. Quantities, dates, products, workers and places stay, so stock, shelves and every balance are untouched;
-- the supplier, the note number and the line's name on the paper change, and the names are counted again from the
-- ledger. The frozen days take the new supplier in their `moved` lists. The photos of these 24 papers are redrawn as
-- English packing lists by receipts-foreign.mjs, which uploads them and writes paths.json; the storage_path update from
-- that file closes the step (a new path each, since anon may add to the bucket but never replace).
--
-- The same supplier never calls one product two ways: each second name moves to a supplier that has no name for it.
-- One atomic block; it refuses to run twice (the suppliers' names are unique) and checks itself before committing.

do $$
declare
  tr constant uuid := 'de900000-0000-4000-8000-000000000001';
  gr constant uuid := 'de900000-0000-4000-8000-000000000002';
  cn constant uuid := 'de900000-0000-4000-8000-000000000003';
  it constant uuid := 'de900000-0000-4000-8000-000000000004';
  merkaz constant uuid := '5db3421a-cbfb-4fec-a709-47f454c65c88';
  namal constant uuid := '0bbf7232-8ab5-4157-85d2-a6f087c9c22d';
  acp constant uuid := '06a7d250-ce2b-4252-ab8a-83ec9ffbe3c5';
  tzafon constant uuid := '3dbaa794-9e75-4162-ae2a-44988277060e';
  galil constant uuid := 'fe8b058e-2173-4aa0-85f9-396a2e229194';
  arava constant uuid := 'a46069c7-80a7-4082-9237-0f0644688876';
  shahar constant uuid := 'f1fa6935-977d-4158-a650-51f6ce6107d3';
  n int;
begin
  insert into suppliers (id, name, contact, phone, email, notes, created_at) values
    (tr, 'Marmara Ekstrüzyon AŞ', 'Emre', '+90 224 555 0187', 'export@marmara-ekstruzyon.com.tr', 'פרופילים מבניים וצינורות 6063 מטורקיה · מכולה כל 6 עד 8 שבועות דרך נמל חיפה', '2024-05-14 09:00+03'),
    (gr, 'Axios Aluminium SA', 'Nikos', '+30 2310 555 041', 'sales@axios-aluminium.gr', 'פלטות 5754, גלילים ומוטות 6082 מיוון · מכולה כל חודש עד חודשיים דרך נמל חיפה', '2024-10-21 09:00+03'),
    (cn, 'Changzhou Tianhe Composite', 'Lily', '+86 519 8555 0168', 'export@tianhe-composite.cn', 'לוחות מרוכבים PVDF וחסיני אש מסין · מכולה 40׳ כל 5 עד 7 שבועות דרך נמל אשדוד', '2025-02-03 09:00+02'),
    (it, 'Brianza Accessori Srl', 'Giulia', '+39 039 555 0124', 'export@brianza-accessori.it', 'פרזול לחלונות ודלתות מאיטליה · משטחים במשלוח מאוחד כל חודשיים עד שלושה', '2024-07-08 09:00+03');

  create temp table fx_docs (doc uuid primary key, sup uuid not null, old uuid not null, ref text not null) on commit drop;
  insert into fx_docs (doc, sup, old, ref) values
    ('de600000-0000-4000-8000-0000000186f7', cn, acp, 'TH-PL-26004'),
    ('de600000-0000-4000-8000-00000001876a', cn, acp, 'TH-PL-26041'),
    ('de600000-0000-4000-8000-000000018786', cn, acp, 'TH-PL-26052'),
    ('de600000-0000-4000-8000-0000000187e9', cn, acp, 'TH-PL-26083'),
    ('de600000-0000-4000-8000-000000018809', cn, acp, 'TH-PL-26097'),
    ('de600000-0000-4000-8000-00000001883d', cn, acp, 'TH-PL-26118'),
    ('de600000-0000-4000-8000-00000001885f', cn, acp, 'TH-PL-26131'),
    ('de600000-0000-4000-8000-000000018715', gr, namal, 'AX-PL-2026-0112'),
    ('de600000-0000-4000-8000-00000001874d', gr, namal, 'AX-PL-2026-0198'),
    ('de600000-0000-4000-8000-0000000187b2', gr, namal, 'AX-PL-2026-0405'),
    ('de600000-0000-4000-8000-0000000187d1', gr, namal, 'AX-PL-2026-0447'),
    ('de600000-0000-4000-8000-00000001883e', gr, namal, 'AX-PL-2026-0663'),
    ('de600000-0000-4000-8000-000000018860', gr, namal, 'AX-PL-2026-0721'),
    ('de600000-0000-4000-8000-0000000186c8', tr, merkaz, 'PL 25/1386'),
    ('de600000-0000-4000-8000-000000018736', tr, merkaz, 'PL 26/0174'),
    ('de600000-0000-4000-8000-00000001877a', tr, merkaz, 'PL 26/0391'),
    ('de600000-0000-4000-8000-0000000187fb', tr, merkaz, 'PL 26/0712'),
    ('de600000-0000-4000-8000-00000001881c', tr, merkaz, 'PL 26/0790'),
    ('de600000-0000-4000-8000-000000018852', tr, merkaz, 'PL 26/0957'),
    ('de600000-0000-4000-8000-0000000186cb', it, tzafon, 'DDT 2025/4471'),
    ('de600000-0000-4000-8000-000000018729', it, tzafon, 'DDT 2026/0583'),
    ('de600000-0000-4000-8000-0000000187aa', it, tzafon, 'DDT 2026/1962'),
    ('de600000-0000-4000-8000-0000000187e2', it, tzafon, 'DDT 2026/2514'),
    ('de600000-0000-4000-8000-00000001886a', it, tzafon, 'DDT 2026/3608');
  select count(*) into n from fx_docs f join documents d on d.id = f.doc and d.supplier_id = f.old and d.kind = 'in';
  if n <> 24 then raise exception 'documents where expected: % of 24', n; end if;

  -- How each of them writes our products on its paper, with its own item code.
  create temp table fx_names (sup uuid not null, sku text not null, name text not null, code text not null, primary key (sup, sku)) on commit drop;
  insert into fx_names (sup, sku, name, code) values
    (tr, 'TUB-2525', 'SQUARE TUBE 25X25X1.5 6063-T5 MILL L6000', 'MRM-1121'),
    (tr, 'TUB-3030', 'SQUARE TUBE 30X30X2 6063-T5 MILL L6000', 'MRM-1132'),
    (tr, 'TUB-4040', 'SQUARE TUBE 40X40X2 6063-T5 MILL L6000', 'MRM-1142'),
    (tr, 'TUB-4040-3', 'SQUARE TUBE 40X40X3 6063-T5 MILL L6000', 'MRM-1143'),
    (tr, 'TUB-5050', 'SQUARE TUBE 50X50X2 6063-T5 MILL L6000', 'MRM-1152'),
    (tr, 'TUB-5050-3', 'SQUARE TUBE 50X50X3 6063-T5 MILL L6000', 'MRM-1153'),
    (tr, 'TUB-6060', 'SQUARE TUBE 60X60X3 6063-T5 MILL L6000', 'MRM-1163'),
    (tr, 'TUB-5025', 'RECT TUBE 50X25X2 6063-T5 MILL L6000', 'MRM-1252'),
    (tr, 'TUB-6030', 'RECT TUBE 60X30X2 6063-T5 MILL L6000', 'MRM-1262'),
    (tr, 'TUB-8040', 'RECT TUBE 80X40X2 6063-T5 MILL L6000', 'MRM-1282'),
    (tr, 'TUB-8040-3', 'RECT TUBE 80X40X3 6063-T5 MILL L6000', 'MRM-1283'),
    (tr, 'ANG-2020', 'EQUAL ANGLE 20X20X2 6063-T5 L6000', 'MRM-2022'),
    (tr, 'ANG-3030', 'EQUAL ANGLE 30X30X3 6063-T5 L6000', 'MRM-2033'),
    (tr, 'ANG-4040', 'EQUAL ANGLE 40X40X3 6063-T5 L6000', 'MRM-2043'),
    (tr, '2A35Q4R', 'EQUAL ANGLE 50X50X3 6063-T5 L6000', 'MRM-2053'),
    (tr, 'ANG-6060', 'EQUAL ANGLE 60X60X4 6063-T5 L6000', 'MRM-2064'),
    (tr, 'TEE-3030', 'T PROFILE 30X30X3 6063-T5 L6000', 'MRM-3033'),
    (tr, 'TEE-5050', 'T PROFILE 50X50X4 6063-T5 L6000', 'MRM-3054'),
    (tr, 'FLT-2003', 'FLAT BAR 20X3 6063-T5 L6000', 'MRM-4023'),
    (tr, 'FLT-5005', 'FLAT BAR 50X5 6063-T5 L6000', 'MRM-4055'),
    (tr, 'FLT-6006', 'FLAT BAR 60X6 6063-T5 L6000', 'MRM-4066'),
    (tr, '243535521', 'U CHANNEL 30X20X2 6063-T5 L6000', 'MRM-5032'),
    (tr, 'CHN-4020', 'U CHANNEL 40X20X2 6063-T5 L6000', 'MRM-5042'),
    (tr, 'PRF-4040', 'T-SLOT PROFILE 40X40 SLOT 10 ANOD NATURAL', 'MRM-6040'),
    (tr, 'PRF-4040-BK', 'T-SLOT PROFILE 40X40 SLOT 10 ANOD BLACK', 'MRM-6041'),
    (gr, 'SHT-6082-20', 'PLATE EN AW-6082 T651 20.0X1520X3020', 'AX-61520'),
    (gr, 'SHT-5-2040', 'PLATE EN AW-5754 H111 5.0X2000X4000', 'AX-5405'),
    (gr, 'SHT-6-1530', 'PLATE EN AW-5754 H111 6.0X1500X3000', 'AX-5306'),
    (gr, 'SHT-8-2040', 'PLATE EN AW-5754 H111 8.0X2000X4000', 'AX-5408'),
    (gr, 'SHT-10-1530', 'PLATE EN AW-5754 H111 10.0X1500X3000', 'AX-5310'),
    (gr, 'SHT-10-2040', 'PLATE EN AW-5754 H111 10.0X2000X4000', 'AX-5410'),
    (gr, 'SHT-12-1530', 'PLATE EN AW-5754 H111 12.0X1500X3000', 'AX-5312'),
    (gr, 'SHT-15-1530', 'PLATE EN AW-5754 H111 15.0X1500X3000', 'AX-5315'),
    (gr, 'SHT-20-1530', 'PLATE EN AW-5754 H111 20.0X1500X3000', 'AX-5320'),
    (gr, 'SHT-25-1530', 'PLATE EN AW-5754 H111 25.0X1500X3000', 'AX-5325'),
    (gr, 'COL-1-1250', 'COIL EN AW-1050A H14 1.00X1250', 'AX-C1012'),
    (gr, 'COL-15-1250', 'COIL EN AW-1050A H14 1.50X1250', 'AX-C1512'),
    (gr, 'COL-2-1500', 'COIL EN AW-1050A H14 2.00X1500', 'AX-C2015'),
    (gr, 'RND-12', 'ROUND BAR EN AW-6082 T6 D12 L3000', 'AX-R12'),
    (gr, 'RND-20', 'ROUND BAR EN AW-6082 T6 D20 L3000', 'AX-R20'),
    (gr, 'RND-30', 'ROUND BAR EN AW-6082 T6 D30 L3000', 'AX-R30'),
    (gr, 'RND-50', 'ROUND BAR EN AW-6082 T6 D50 L3000', 'AX-R50'),
    (gr, 'RND-80', 'ROUND BAR EN AW-6082 T6 D80 L3000', 'AX-R80'),
    (cn, 'ACP-3-WH', 'ACP PVDF 3MM 0.21 RAL9016 1250*3200', 'TH-3P-9016'),
    (cn, 'ACP-4-WH', 'ACP PVDF 4MM 0.30 RAL9016 1500*4000', 'TH-4P-9016'),
    (cn, 'ACP-4-GR', 'ACP PVDF 4MM 0.30 RAL7016 1500*4000', 'TH-4P-7016'),
    (cn, 'ACP-4-SL', 'ACP PVDF 4MM 0.30 SILVER MATT 1500*4000', 'TH-4P-9006'),
    (cn, 'ACP-4-BK', 'ACP PVDF 4MM 0.30 RAL9005 1500*4000', 'TH-4P-9005'),
    (cn, 'ACP-4-BZ', 'ACP PVDF 4MM 0.30 BRONZE 1500*4000', 'TH-4P-BZ01'),
    (cn, 'ACP-FR-GR', 'ACP FR MINERAL CORE 4MM RAL7016 1500*4000', 'TH-4F-7016'),
    (cn, 'ACP-FR-WH', 'ACP FR MINERAL CORE 4MM RAL9016 1500*4000', 'TH-4F-9016'),
    (it, 'ACC-HNG-60', 'CONCEALED HINGE S60 130KG PK10', 'BZ-3160'),
    (it, 'ACC-HNG-70', 'DOOR HINGE 3 PARTS S70 PK6', 'BZ-3370'),
    (it, 'ACC-LCK-45', 'SLIDING LOCK S45 STAINLESS PK10', 'BZ-2245'),
    (it, 'ACC-RLR-45', 'TANDEM ROLLER S45 120KG PK20', 'BZ-2045'),
    (it, 'ACC-HDL-60', 'SASH HANDLE S60 RAL9016 PK10', 'BZ-1460'),
    (it, 'ACC-CRN-60', 'CORNER CLEAT SASH S60 PK50', 'BZ-4060'),
    (it, 'ACC-CLS-70', 'OVERHEAD DOOR CLOSER 80KG PK4', 'BZ-5180'),
    (it, 'ACC-RLG-PT', 'RAILING BASE PLATE 60X60 PK10', 'BZ-7060');

  create temp table fx_moves on commit drop as
    select m.id, m.product_id, f.old, f.sup, (m.created_at at time zone 'Asia/Jerusalem')::date as dd
    from movements m join fx_docs f on f.doc = m.document_id where m.type = 'in';
  select count(*) into n from fx_moves;
  if n <> 136 then raise exception 'lines on the moved papers: % of 136', n; end if;
  select count(*) into n from fx_moves x join products p on p.id = x.product_id left join fx_names nm on nm.sup = x.sup and nm.sku = p.sku where nm.name is null;
  if n <> 0 then raise exception 'lines with no name for their new supplier: %', n; end if;

  update movements m set supplier_id = f.sup, reference = f.ref, external_name = nm.name
  from fx_docs f, products p, fx_names nm
  where m.document_id = f.doc and m.type = 'in' and p.id = m.product_id and nm.sup = f.sup and nm.sku = p.sku;
  get diagnostics n = row_count;
  if n <> 136 then raise exception 'lines moved: % of 136', n; end if;

  update documents d set supplier_id = f.sup, reference = f.ref from fx_docs f where d.id = f.doc;

  -- A name is known from its first paper and counted on every paper since.
  insert into supplier_items (supplier_id, external_name, external_sku, product_id, status, approved_at, times_seen, last_seen_at, created_at, updated_at)
  select nm.sup, nm.name, nm.code, p.id, 'approved', x.first, x.n, x.last, x.first, x.first
  from fx_names nm
  join products p on p.sku = nm.sku
  join (select supplier_id, external_name, count(*)::int as n, min(created_at) as first, max(created_at) as last from movements where type = 'in' group by 1, 2) x
    on x.supplier_id = nm.sup and x.external_name = nm.name;
  get diagnostics n = row_count;
  if n <> 59 then raise exception 'foreign names: % of 59', n; end if;

  -- One supplier, one name for a product. Each second name moves to a supplier with none for that product, in its way of writing.
  update supplier_items set supplier_id = gr, external_name = 'PLATE EN AW-5754 H111 8.0X1500X3000', external_sku = 'AX-5308'
  where id = '9614bba9-2078-4354-9bd1-26c31fe6618b' and supplier_id = namal;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'pending plate name'; end if;
  update supplier_items set supplier_id = galil, external_name = 'פרופיל 40/40 אנודייז טבעי'
  where id = 'e9f08c8e-0a02-49ee-8d4d-891cabc79464' and supplier_id = merkaz;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '40x40 anodised name'; end if;
  update supplier_items set supplier_id = arava, external_name = 'פרופיל U 30*20*2 6 מטר'
  where id = 'f44f639b-71fb-4390-84c0-8ef33a779a1e' and supplier_id = merkaz;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'U 30x20 name'; end if;
  update supplier_items set supplier_id = shahar, times_seen = 0, last_seen_at = null
  where id = '021a309d-ecf6-49b7-8137-f1eb7d6b210d' and supplier_id = merkaz;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '80x40 tube name'; end if;

  -- The suppliers who gave papers away are counted again from the ledger.
  update supplier_items i set times_seen = c.n, last_seen_at = c.last
  from (
    select i2.id, count(m.id)::int as n, max(m.created_at) as last
    from supplier_items i2
    left join movements m on m.type = 'in' and m.supplier_id = i2.supplier_id and normalize_name(m.external_name) = i2.normalized_name
    where i2.status = 'approved' and i2.supplier_id in (merkaz, namal, acp, tzafon)
    group by i2.id
  ) c
  where c.id = i.id and (i.times_seen, i.last_seen_at) is distinct from (c.n, c.last);

  -- The frozen days name who brought it.
  update day_closings c set summary = jsonb_set(c.summary, '{moved}', (
    select coalesce(jsonb_agg(case when t.e->>'type' = 'in' and fm.name is not null then jsonb_set(t.e, '{party}', to_jsonb(fm.name)) else t.e end order by t.ord), '[]'::jsonb)
    from jsonb_array_elements(c.summary->'moved') with ordinality as t(e, ord)
    left join lateral (
      select sn.name from fx_moves x join suppliers so on so.id = x.old join suppliers sn on sn.id = x.sup
      where x.dd = c.day and x.product_id::text = t.e->>'product_id' and so.name = t.e->>'party' limit 1
    ) fm on true))
  where c.day in (select dd from fx_moves) and jsonb_typeof(c.summary->'moved') = 'array';

  update day_closings c set summary = jsonb_set(c.summary, '{names}', (
    select jsonb_agg(case when t.e->>'id' = '9614bba9-2078-4354-9bd1-26c31fe6618b'
      then t.e || jsonb_build_object('name', 'PLATE EN AW-5754 H111 8.0X1500X3000', 'supplier', 'Axios Aluminium SA') else t.e end order by t.ord)
    from jsonb_array_elements(c.summary->'names') with ordinality as t(e, ord)))
  where c.summary->'names' @> '[{"id": "9614bba9-2078-4354-9bd1-26c31fe6618b"}]';

  -- Checks before anything is kept.
  select count(*) into n from (select 1 from supplier_items where product_id is not null group by product_id, supplier_id having count(*) > 1) d;
  if n <> 0 then raise exception 'a supplier still has two names for one product: %', n; end if;
  select count(*) into n from movements m where m.type = 'in' and m.external_name is not null
    and not exists (select 1 from supplier_items i where i.supplier_id = m.supplier_id and i.normalized_name = normalize_name(m.external_name));
  if n <> 0 then raise exception 'paper lines with no name of their supplier: %', n; end if;
  select count(*) into n from documents d join movements m on m.document_id = d.id and m.type = 'in' where m.supplier_id is distinct from d.supplier_id or m.reference is distinct from d.reference;
  if n <> 0 then raise exception 'lines that disagree with their paper: %', n; end if;
  select count(*) into n
  from day_closings c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.summary->'moved') = 'array' then c.summary->'moved' else '[]'::jsonb end) as e(v)
  join fx_moves x on x.dd = c.day and x.product_id::text = e.v->>'product_id'
  join suppliers so on so.id = x.old
  where e.v->>'type' = 'in' and e.v->>'party' = so.name;
  if n <> 0 then raise exception 'frozen days that still name the old supplier: %', n; end if;
end $$;
