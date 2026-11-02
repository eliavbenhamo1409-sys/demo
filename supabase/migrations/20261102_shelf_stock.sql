-- Where the stock stands: one row per product per place, so every shelf of a rack, or every half of one,
-- can hold its own product. products.qty stays the only total: a row says how much of it stands here,
-- what no row covers waits to be placed, and the rows never add up to more than the total.
--
-- A place is the text products.location already speaks: A-1/2 is shelf 2 of rack A-1, A-1/2R and A-1/2L
-- are its right and left halves as seen from the aisle, and F-01 is a floor area.
create table shelf_stock (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  place text not null check (place ~ '^[^/[:space:]]+(/[0-9]+[RL]?)?$'),
  qty numeric(12,3) not null check (qty > 0),
  -- The oldest stock leaves first.
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, place)
);
create index shelf_stock_place_idx on shelf_stock(place);
create trigger shelf_stock_touch before update on shelf_stock for each row execute function touch_updated_at();

-- Everyone reads. Rows change only through a movement or place_stock below, so a total can't drift by hand.
alter table shelf_stock enable row level security;
create policy "anyone reads shelves" on shelf_stock for select to anon, authenticated using (true);
alter publication supabase_realtime add table shelf_stock;

-- Where a receipt was put away. Empty on an out, a count or a receipt nobody placed.
alter table movements add column place text;

-- How often each product went to each place, for the quick suggestion at the next receipt.
create view usual_places with (security_invoker = true) as
  select product_id, place, count(*)::int as times, max(created_at) as last_at
  from movements
  where type = 'in' and place is not null
  group by product_id, place;

-- Named to run after movements_apply, so products.qty is already the new total here. Triggers fire by name.
create function shelves_after_movement() returns trigger language plpgsql security definer set search_path = public as $$
declare
  over numeric;
  shelf shelf_stock;
begin
  if new.type = 'in' and new.place is not null then
    insert into shelf_stock (product_id, place, qty) values (new.product_id, new.place, new.qty)
      on conflict (product_id, place) do update set qty = shelf_stock.qty + excluded.qty;
    update products set location = new.place where id = new.product_id and coalesce(location, '') = '';
  end if;

  -- What left stood somewhere: what waits for a place goes first, then the oldest shelf.
  select coalesce(sum(s.qty), 0) - p.qty into over
    from products p left join shelf_stock s on s.product_id = p.id
    where p.id = new.product_id
    group by p.qty;
  for shelf in select * from shelf_stock where product_id = new.product_id order by placed_at, id for update loop
    exit when over <= 0;
    if shelf.qty <= over then
      delete from shelf_stock where id = shelf.id;
    else
      update shelf_stock set qty = qty - over where id = shelf.id;
    end if;
    over := over - shelf.qty;
  end loop;
  return new;
end $$;
create trigger movements_shelves after insert on movements for each row execute function shelves_after_movement();

-- Puts stock on a shelf or moves it to another one. No source: from what waits for a place. No target: off the shelf, back to waiting.
-- The total doesn't change, so this is no movement.
create function place_stock(product uuid, target text, amount numeric, source text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  total numeric;
  here numeric;
begin
  if amount is null or amount <= 0 then raise exception 'כמות לא תקינה'; end if;
  if target is null and source is null then raise exception 'חסר מיקום'; end if;
  if target = source then return; end if;

  -- Locked, so a movement can't land between the sum and the write.
  select qty into total from products where id = product for update;
  if not found then raise exception 'המוצר לא נמצא'; end if;

  if source is null then
    select coalesce(sum(qty), 0) into here from shelf_stock where product_id = product;
    if amount > total - here then raise exception 'אין כמות כזו שממתינה לשיבוץ'; end if;
  else
    select qty into here from shelf_stock where product_id = product and place = source;
    if not found or amount > here then raise exception 'אין כמות כזו במדף הזה'; end if;
    if amount = here then
      delete from shelf_stock where product_id = product and place = source;
    else
      update shelf_stock set qty = qty - amount where product_id = product and place = source;
    end if;
  end if;

  if target is not null then
    insert into shelf_stock (product_id, place, qty) values (product, target, amount)
      on conflict (product_id, place) do update set qty = shelf_stock.qty + excluded.qty;
    update products set location = target where id = product and coalesce(location, '') = '';
  end if;
end $$;
