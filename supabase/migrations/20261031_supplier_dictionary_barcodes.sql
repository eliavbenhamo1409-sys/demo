-- Applied 2026-10-31 via MCP execute_sql.
alter table products add column if not exists barcode text;
create unique index if not exists products_barcode_key on products(barcode) where barcode is not null;
create sequence if not exists product_barcode_seq start 1000;
create or replace function ean13_check(digits12 text) returns text language sql immutable set search_path = public as $$
  select digits12 || ((10 - ((substr(digits12,1,1)::int + substr(digits12,3,1)::int + substr(digits12,5,1)::int + substr(digits12,7,1)::int + substr(digits12,9,1)::int + substr(digits12,11,1)::int)
    + 3 * (substr(digits12,2,1)::int + substr(digits12,4,1)::int + substr(digits12,6,1)::int + substr(digits12,8,1)::int + substr(digits12,10,1)::int + substr(digits12,12,1)::int)) % 10) % 10)::text; $$;
create or replace function products_default_barcode() returns trigger language plpgsql set search_path = public as $$
begin
  if new.barcode is null or btrim(new.barcode) = '' then new.barcode := ean13_check('729' || lpad(nextval('product_barcode_seq')::text, 9, '0'));
  else new.barcode := btrim(new.barcode); end if;
  return new;
end $$;
create trigger products_default_barcode before insert or update of barcode on products for each row execute function products_default_barcode();
create or replace function normalize_name(t text) returns text language sql immutable set search_path = public as $$ select regexp_replace(lower(btrim(coalesce(t,''))), '\s+', ' ', 'g'); $$;
alter table supplier_items add column if not exists normalized_name text generated always as (normalize_name(external_name)) stored;
alter table supplier_items add column if not exists times_seen integer not null default 0;
alter table supplier_items add column if not exists last_seen_at timestamptz;
alter table supplier_items add column if not exists approved_at timestamptz;
alter table supplier_items drop constraint if exists supplier_items_supplier_id_external_name_external_sku_key;
create unique index if not exists supplier_items_supplier_norm_key on supplier_items(supplier_id, normalized_name);
alter table movements add column if not exists external_name text;
create or replace function learn_supplier_name() returns trigger language plpgsql set search_path = public as $$
begin
  if new.type = 'in' and new.supplier_id is not null and new.external_name is not null then
    update supplier_items set times_seen = times_seen + 1, last_seen_at = now()
     where supplier_id = new.supplier_id and normalized_name = normalize_name(new.external_name);
  end if;
  return new;
end $$;
create trigger movements_learn after insert on movements for each row execute function learn_supplier_name();
revoke execute on function public.products_default_barcode() from public, anon, authenticated;
revoke execute on function public.learn_supplier_name() from public, anon, authenticated;
update products set barcode = '' where barcode is null;
