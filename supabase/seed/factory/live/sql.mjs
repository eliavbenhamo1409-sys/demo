// The same transaction as sql.mjs, written compactly: products by SKU, people by index, times in seconds,
// ids rebuilt in SQL from small numbers, and goods out expanded from each order's own lines.
import fs from 'node:fs';
const plan = JSON.parse(fs.readFileSync('plan.json', 'utf8'));
const S = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const P = new Map(S.products.map((p) => [p.id, p]));
if (new Set(S.products.map((p) => p.sku)).size !== S.products.length) throw new Error('sku not unique');
const sku = (id) => P.get(id).sku;
const W = S.workers.map((w) => w.id), SUPS = S.suppliers.map((s) => s.id), AG = S.agents.map((a) => a.id);
const wi = (id) => (id == null ? null : (() => { const i = W.indexOf(id); if (i < 0) throw new Error('worker ' + id); return i; })());
const BASE = Date.parse('2026-11-03T00:00:00+02:00');
const sec = (iso) => Math.round((Date.parse(iso) - BASE) / 1000);
const nOf = (uuid) => parseInt(uuid.slice(-12), 16);
const tail = (path) => path.replace(/^(in|out)\//, '').replace(/\.jpg$/, '');
const dayOff = (d) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse('2026-11-03T12:00:00Z')) / 86400000);
const J = (x) => `$J$${JSON.stringify(x)}$J$::jsonb`;

const OR = plan.orders.map((o) => [nOf(o.id), o.number, o.customer, AG.indexOf(o.agent_id), sec(o.created_at), dayOff(o.promised_on), o.customer_phone, o.note]);
const LN = plan.orders.flatMap((o) => o.lines.map((l) => [nOf(o.id), nOf(l.id), sku(l.product_id), l.qty]));
// Deliveries: the order (n for this batch's, the full id for older ones), when, who, and its paper.
const DV = plan.deliveries.map((d) => [d.order_id.includes('-1116-') ? nOf(d.order_id) : d.order_id, sec(d.at), wi(d.worker), nOf(d.doc.id), sec(d.doc.created_at), tail(d.doc.path)]);
for (const d of plan.deliveries) { // each delivery ships its order's lines whole
  const o = [...S.orders, ...plan.orders].find((x) => x.id === d.order_id);
  const lines = o.lines ?? S.order_lines.filter((l) => l.order_id === o.id);
  if (lines.length !== d.lines.length || d.lines.some((l) => Number(lines.find((x) => x.product_id === l.product_id)?.qty) !== l.qty)) throw new Error('partial delivery ' + d.number);
}
const TR = plan.trucks.map((t) => [nOf(t.doc.id), SUPS.indexOf(t.supplier_id), Number(t.ref.replace(/\D/g, '')), wi(t.worker), sec(t.doc.created_at), tail(t.doc.path)]);
// Movements other than goods out: [n, sec, type, sku, qty, worker, truck index, place, supplier's name for it].
const MV = [
  ...plan.trucks.flatMap((t, k) => t.lines.map((l) => [nOf(l.mid), sec(l.at), 'in', sku(l.product_id), l.qty, wi(l.worker), k, l.place, l.ext])),
  ...plan.counts.map((c) => [nOf(c.mid), sec(c.at), 'adjust', sku(c.product_id), c.qty, wi(c.worker), null, null, null]),
  ...plan.faults.filter((f) => f.movement).map((f) => [nOf(f.movement.mid), sec(f.at), 'fault', sku(f.product_id), f.movement.qty, wi(f.reporter), null, null, f.description]),
];
const FA = plan.faults.map((f) => [nOf(f.id), f.product_id ? sku(f.product_id) : null, f.asset, f.description, wi(f.reporter), sec(f.at), f.movement ? nOf(f.movement.mid) : null, f.resolved ? sec(f.resolved.at) : null, f.resolved?.resolution ?? null, f.resolved?.by ?? null]);
const CL = plan.closeOld.map((f) => [f.id, sec(f.resolvedAt), f.resolution, f.by]);
const CA = plan.cancels.map((c) => [nOf(c.id), sec(c.at)]);
const ST = Object.entries(plan.start).map(([id, s]) => [sku(id), s.qty, s.reserved]);

// Where every touched product must land, replaying the plan from its start.
const q = new Map(Object.entries(plan.start).map(([id, s]) => [id, s.qty]));
const ev = [];
for (const d of plan.deliveries) for (const l of d.lines) ev.push([d.at, 2, l.product_id, l.qty]);
for (const t of plan.trucks) for (const l of t.lines) ev.push([l.at, 1, l.product_id, l.qty]);
for (const c of plan.counts) ev.push([c.at, 0, c.product_id, c.qty]);
ev.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
for (const [, k, id, n] of ev) { if (!q.has(id)) throw new Error('missing start ' + id); q.set(id, k === 0 ? n : k === 1 ? q.get(id) + n : q.get(id) - n); if (q.get(id) < 0) throw new Error('negative ' + sku(id)); }
const EX = [...q].map(([id, n]) => [sku(id), Math.round(n * 1000) / 1000]);
const touchedOld = [...new Set(plan.deliveries.map((d) => d.order_id).filter((id) => !id.includes('-1116-')))];

const sql = `begin;
set local statement_timeout = '240s';
create function pg_temp.sid(kind text, n bigint) returns uuid language sql immutable as $f$ select (kind || '00000-1116-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $f$;
create function pg_temp.ts(s int) returns timestamptz language sql immutable as $f$ select timestamptz '2026-11-03 00:00+02' + make_interval(secs => s) $f$;
create temp table k_w on commit drop as select (ordinality - 1)::int i, value::text::uuid id from jsonb_array_elements_text(${J(W)}) with ordinality;
create temp table k_s on commit drop as select (ordinality - 1)::int i, value::text::uuid id from jsonb_array_elements_text(${J(SUPS)}) with ordinality;
create temp table k_a on commit drop as select (ordinality - 1)::int i, value::text::uuid id from jsonb_array_elements_text(${J(AG)}) with ordinality;

-- The plan started from this state; if a real worker or agent moved anything since, stop.
do $$
declare bad text;
begin
  if exists (select 1 from orders where id::text like 'de200000-1116-%') then raise exception 'this batch is already in'; end if;
  select string_agg(p.sku || ' ' || p.qty || '/' || p.reserved, ', ') into bad
    from products p join jsonb_array_elements(${J(ST)}) e on p.sku = e->>0
    where p.qty <> (e->>1)::numeric or p.reserved <> (e->>2)::numeric;
  if bad is not null then raise exception 'stock moved since the plan: %', bad; end if;
  if exists (select 1 from orders where id::text = any(array(select jsonb_array_elements_text(${J(touchedOld)}))) and status <> 'open') then raise exception 'an order the plan delivers is no longer open'; end if;
end $$;

-- New orders, as the catalogue would have written them; they all start open.
insert into orders (id, number, request_id, agent_id, customer, customer_phone, note, status, created_at, promised_on)
overriding system value
select pg_temp.sid('de2', (e->>0)::int), (e->>1)::int, md5('live-1116-' || pg_temp.sid('de2', (e->>0)::int))::uuid, a.id, e->>2, e->>6, e->>7, 'open', pg_temp.ts((e->>4)::int), date '2026-11-03' + (e->>5)::int
from jsonb_array_elements(${J(OR)}) e join k_a a on a.i = (e->>3)::int;
insert into order_lines (id, order_id, product_id, qty, unit_price)
select pg_temp.sid('de3', (e->>1)::int), pg_temp.sid('de2', (e->>0)::int), p.id, (e->>3)::numeric, p.price
from jsonb_array_elements(${J(LN)}) e join products p on p.sku = e->>2;
select setval('orders_number_seq', (select max(number) from orders));

-- Deliveries and trucks, each with the paper already photographed into delivery-notes.
create temp table k_dv on commit drop as
select (ordinality - 1)::int k, case when jsonb_typeof(e->0) = 'number' then pg_temp.sid('de2', (e->>0)::int) else (e->>0)::uuid end order_id,
  pg_temp.ts((e->>1)::int) at_, w.id worker_id, pg_temp.sid('de6', (e->>3)::int) doc_id, pg_temp.ts((e->>4)::int) doc_at, 'out/' || (e->>5) || '.jpg' path
from jsonb_array_elements(${J(DV)}) with ordinality as x(e, ordinality) left join k_w w on w.i = (e->>2)::int;
create temp table k_tr on commit drop as
select (ordinality - 1)::int k, pg_temp.sid('de6', (e->>0)::int) doc_id, s.id supplier_id, 'תעודה ' || (e->>2) ref, w.id worker_id, pg_temp.ts((e->>4)::int) doc_at, 'in/' || (e->>5) || '.jpg' path
from jsonb_array_elements(${J(TR)}) with ordinality as x(e, ordinality) join k_s s on s.i = (e->>1)::int left join k_w w on w.i = (e->>3)::int;
insert into documents (id, kind, storage_path, supplier_id, customer, reference, worker_id, created_at)
select d.doc_id, 'out'::document_kind, d.path, null::uuid, o.customer, 'הזמנה ' || o.number, d.worker_id, d.doc_at from k_dv d join orders o on o.id = d.order_id
union all
select t.doc_id, 'in'::document_kind, t.path, t.supplier_id, null::text, t.ref, t.worker_id, t.doc_at from k_tr t;

-- Every movement: goods out from each delivered order's lines, the rest as planned; then one at a time, oldest first, through the live triggers.
create temp table k_mv on commit drop as
select pg_temp.sid('de1', 100000 + d.k * 100 + row_number() over (partition by d.k order by l.id))::uuid id, 'out'::movement_type type, l.product_id, l.qty, d.worker_id, null::uuid supplier_id,
  'הזמנה ' || o.number reference, 'ללקוח: ' || o.customer || ' · סוכן: ' || a.name note, d.at_ created_at, null::text external_name, d.doc_id document_id, null::text place, l.id line_id
from k_dv d join orders o on o.id = d.order_id join agents a on a.id = o.agent_id join order_lines l on l.order_id = o.id
union all
select pg_temp.sid('de1', (e->>0)::int), (e->>2)::movement_type, p.id, (e->>4)::numeric, w.id,
  t.supplier_id, t.ref, case when e->>2 = 'adjust' then 'ספירת מחזור' when e->>2 = 'fault' then e->>8 end, pg_temp.ts((e->>1)::int),
  case when e->>2 = 'in' then e->>8 end, t.doc_id, e->>7, null
from jsonb_array_elements(${J(MV)}) e join products p on p.sku = e->>3 left join k_w w on w.i = (e->>5)::int left join k_tr t on t.k = (e->>6)::int;
do $$
declare r record;
begin
  for r in select * from k_mv order by created_at, case type when 'adjust' then 0 when 'in' then 1 when 'out' then 2 else 3 end, id loop
    insert into movements (id, type, product_id, qty, worker_id, supplier_id, reference, note, created_at, external_name, document_id, place)
    values (r.id, r.type, r.product_id, r.qty, r.worker_id, r.supplier_id, r.reference, r.note, r.created_at, r.external_name, r.document_id, r.place);
  end loop;
end $$;

-- Orders that left close at the moment their goods did; a cancelled one closes when the agent cancelled it.
update order_lines l set movement_id = m.id from k_mv m where m.line_id = l.id;
update orders o set status = 'delivered', closed_at = d.at_ from k_dv d where o.id = d.order_id and o.status = 'open';
update orders o set status = 'cancelled', closed_at = pg_temp.ts((e->>1)::int) from jsonb_array_elements(${J(CA)}) e where o.id = pg_temp.sid('de2', (e->>0)::int) and o.status = 'open';
select recount_reserved(array(select distinct product_id from order_lines l join orders o on o.id = l.order_id where o.id::text like 'de200000-1116-%' or o.id in (select order_id from k_dv)));

-- What the floor reported.
insert into faults (id, product_id, movement_id, description, reported_by, status, created_at, resolved_at, asset, resolution, resolved_by)
select pg_temp.sid('de4', (e->>0)::int), p.id, case when e->>6 is not null then pg_temp.sid('de1', (e->>6)::int) end, e->>3, w.id,
  case when e->>7 is null then 'open' else 'resolved' end::fault_status, pg_temp.ts((e->>5)::int), pg_temp.ts((e->>7)::int), e->>2, e->>8, e->>9
from jsonb_array_elements(${J(FA)}) e left join products p on p.sku = e->>1 left join k_w w on w.i = (e->>4)::int;

-- Stamps the triggers set to this minute go back to the moment each thing happened.
set local session_replication_role = replica;
update faults f set status = 'resolved', resolved_at = pg_temp.ts((e->>1)::int), resolution = e->>2, resolved_by = e->>3
from jsonb_array_elements(${J(CL)}) e where f.id = (e->>0)::uuid and f.status = 'open';
update products p set updated_at = x.at from (select product_id, max(created_at) at from movements group by 1) x
  where x.product_id = p.id and p.id in (select product_id from k_mv);
update supplier_items i set last_seen_at = x.at from (select supplier_id, external_name, max(created_at) at from k_mv where type = 'in' group by 1, 2) x
  where x.supplier_id = i.supplier_id and x.external_name = i.external_name;
update shelf_stock s set placed_at = x.at, updated_at = x.at from (select product_id, place, min(created_at) at from k_mv where type = 'in' group by 1, 2) x
  where s.product_id = x.product_id and s.place = x.place and s.placed_at = now();
set local session_replication_role = origin;

-- The books must still close.
do $$
declare bad text;
begin
  select string_agg(p.sku || ' ' || p.qty || '≠' || (e->>1), ', ') into bad from products p join jsonb_array_elements(${J(EX)}) e on p.sku = e->>0 where p.qty <> (e->>1)::numeric;
  if bad is not null then raise exception 'stock is not where the plan put it: %', bad; end if;
  select string_agg(p.sku || ' ' || p.reserved || '≠' || coalesce(h.q, 0), ', ') into bad from products p
    left join (select l.product_id, sum(l.qty) q from order_lines l join orders o on o.id = l.order_id where o.status = 'open' group by 1) h on h.product_id = p.id
    where p.reserved <> coalesce(h.q, 0);
  if bad is not null then raise exception 'reserved drifted: %', bad; end if;
  select string_agg(p.sku, ', ') into bad from products p join (select product_id, sum(qty) q from shelf_stock group by 1) s on s.product_id = p.id where s.q > p.qty + 0.0001;
  if bad is not null then raise exception 'shelves over the total: %', bad; end if;
  if (select count(*) from movements where id::text like 'de100000-1116-%') <> ${plan.deliveries.reduce((s, d) => s + d.lines.length, 0) + MV.length} then raise exception 'movement count off'; end if;
  if exists (select 1 from movements where id::text like 'de100000-1116-%' and created_at > now()) then raise exception 'a movement in the future'; end if;
end $$;
commit;
`;
fs.writeFileSync('apply.sql', sql);
console.log({ bytes: Buffer.byteLength(sql), chars: sql.length, explicitMoves: MV.length, outLines: plan.deliveries.reduce((s, d) => s + d.lines.length, 0), deliveries: DV.length, trucks: TR.length, orders: OR.length });
