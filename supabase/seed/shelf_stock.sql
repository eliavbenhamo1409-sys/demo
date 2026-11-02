-- The demo's shelves: no rack holds one product throughout. Sheets and small goods stand on half a shelf where they
-- fit, a product across two neighbours draws as one block, and 6 m bars take a whole shelf, sharing its depth when two do.
-- By sku, so it follows the live rows. Quantities add up to products.qty as of 2026-11-02; what doesn't simply waits for a place.
insert into shelf_stock (product_id, place, qty, placed_at)
select p.id, s.place, s.qty, p.created_at + s.turn * interval '1 minute'
from (values
  ('SHT-2-1225',  'A-1/1',  24, 1), ('SHT-2-1225',  'A-1/2',  16, 2),
  ('SHT-3-1530',  'A-2/1R', 12, 1),
  ('SHT-BK-15',   'A-2/1L', 14, 1), ('SHT-BK-15',   'A-2/2L', 16, 2),
  ('SHT-TRD-3',   'A-3/1R', 18, 1), ('SHT-TRD-3',   'A-3/1L', 16, 2),
  ('SHT-PRF-2',   'A-3/2',  26, 1),
  ('PRF-4040',    'B-1/1', 100, 1), ('PRF-4040',    'B-1/2',  68, 2),
  ('PRF-4040-BK', 'B-1/3', 120, 1),
  ('FRM-70',      'B-1/4',  48, 1),
  ('243535521',   'B-2/1', 380, 1), ('243535521',   'B-2/2', 270, 2),
  ('2A35Q4R',     'B-2/3', 293, 1),
  ('TEE-4040',    'B-2/4',  72, 1),
  ('FLT-5005',    'B-2/4', 140, 1),
  ('TUB-4040',    'B-3/1', 180, 1),
  ('TUB-6030',    'B-3/2',  96, 1),
  ('TUB-50',      'B-3/3',  64, 1),
  ('CUT-5L',      'C-1/1R',  9, 1),
  ('GSK-EPDM',    'C-2/1', 120, 1), ('GSK-EPDM',    'C-2/2',  89, 2),
  ('BRK-4040',    'C-3/1R', 50, 1), ('BRK-4040',    'C-3/1L', 35, 2),
  ('TNT-M6',      'C-3/2L', 60, 1)
) as s(sku, place, qty, turn)
join products p on p.sku = s.sku
on conflict (product_id, place) do nothing;

-- Out of stock, so no row: its home says which half stands empty.
update products set location = 'C-3/2R' where sku = 'SCR-M620';

-- Past receipts went where the stock stands, which is what the next receipt's suggestion reads.
update movements m set place = first.place
from (
  select distinct on (product_id) product_id, place from shelf_stock order by product_id, placed_at, place
) first
where m.type = 'in' and m.place is null and m.product_id = first.product_id;

-- Totals written straight into products, as a demo seed does, reach no trigger, so the rows are fitted to them here.
-- Each shelf keeps its share and the last one takes what rounding leaves. A product with a shelf for a home and no row gets one.
with shares as (
  select s.id, s.product_id, p.qty as total, round(p.qty * s.qty / sum(s.qty) over (partition by s.product_id)) as fair,
    row_number() over (partition by s.product_id order by s.placed_at, s.place) as turn,
    count(*) over (partition by s.product_id) as places
  from shelf_stock s join products p on p.id = s.product_id
), fitted as (
  select id, case when turn = places then total - coalesce(sum(fair) over (partition by product_id order by turn rows between unbounded preceding and 1 preceding), 0) else fair end as qty
  from shares
), gone as (
  delete from shelf_stock s using fitted f where f.id = s.id and f.qty <= 0
)
update shelf_stock s set qty = f.qty from fitted f where f.id = s.id and f.qty > 0;

insert into shelf_stock (product_id, place, qty)
select p.id, p.location, p.qty from products p
where p.qty > 0 and p.location ~ '/[0-9]+[RL]?$' and not exists (select 1 from shelf_stock s where s.product_id = p.id)
on conflict (product_id, place) do nothing;
