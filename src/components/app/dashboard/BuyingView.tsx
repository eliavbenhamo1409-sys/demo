"use client";

/** The fourth view: what came in, from whom, and what to order next. */
import { useCallback, useMemo, type ReactElement } from "react";
import { dayKey, useData, type Movement } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { EmptyState, Table, type TableColumn } from "@/components/ui";
import { fmtDayWord, fmtName, fmtPrice, fmtQty, fmtUnit } from "@/lib/format";
import { change, movedShares, rolling, topAndRest, worthOf } from "@/lib/control-room";
import { runway, type Runway } from "@/lib/snapshot";
import { ChartCard, Columns, hue, Ring, type ColumnSeries, type Slice } from "./Charts";
import { toSlices } from "./ManagerView";
import { Money, Tile } from "./Tile";
import type { Room } from "./useControlRoom";
import "./buying.css";

/** The share of the goods no supplier is known for. */
const NONE = "__none";

const NO_SUPPLIER = "ללא ספק";

const LIST_ROWS = 8;

const money = (n: number) => fmtPrice(Math.round(n));

const movedAt = (m: Movement) => Date.parse(m.created_at);

const percent = (n: number) => <span className="ltr">{n}%</span>;

/** Each window's part of its whole; a window with no whole reads 0. */
const shareOf = (part: number[], whole: number[]) => part.map((v, i) => (whole[i] > 0 ? Math.round((v / whole[i]) * 100) : 0));

type Delivery = { id: string; supplierId: string | null; at: string; lines: number; worth: number };

/** The goods in as the documents they came on, newest first as the rows are. A delivery with no document is told apart by its day. */
function deliveriesIn(rows: Movement[], worth: (m: Movement) => number): Delivery[] {
  const found = new Map<string, Delivery>();
  for (const m of rows) {
    if (m.type !== "in") continue;
    const id = `${m.supplier_id}|${m.document_id ?? m.reference ?? dayKey(m.created_at)}`;
    const seen = found.get(id);
    if (seen) {
      seen.lines += 1;
      seen.worth += worth(m);
    } else {
      found.set(id, { id, supplierId: m.supplier_id, at: m.created_at, lines: 1, worth: worth(m) });
    }
  }
  return [...found.values()];
}

type DeliveryRow = { id: string; supplier: string; day: string; lines: string; worth: string };

const DELIVERY_COLUMNS: TableColumn<DeliveryRow>[] = [
  { key: "supplier", title: "ספק", render: (r) => <span className="sa-cell-primary">{r.supplier}</span> },
  { key: "day", title: "תאריך" },
  { key: "lines", title: "שורות", align: "num" },
  { key: "worth", title: "שווי", align: "num" },
];

/** What falls short first, who to ask and how much: enough to stand at twice the minimum. */
function ToOrder({ list, rows }: { list: Runway[]; rows: Movement[] }): ReactElement {
  const { supplier } = useData();
  const { openProduct } = useUi();

  // A product with no supplier of its own goes to whoever delivered it last; the rows are newest first.
  const lastFrom = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of rows) if (m.type === "in" && m.supplier_id && !seen.has(m.product_id)) seen.set(m.product_id, m.supplier_id);
    return seen;
  }, [rows]);

  const shown = list.length > LIST_ROWS ? `${LIST_ROWS} הדחופים מתוך ${fmtQty(list.length)}` : "הדחוף קודם";

  return (
    <ChartCard title="מה צריך להזמין" subtitle={`${shown} · כמות מוצעת`} flush>
      {list.length === 0 ? (
        <EmptyState title="אין מה להזמין" hint="אין מוצרים מתחת למינימום" />
      ) : (
        <ul className="dash-task-list">
          {list.slice(0, LIST_ROWS).map(({ product: p, free }) => (
            <li key={p.id}>
              <button type="button" className="dash-task" onClick={() => openProduct(p.id)}>
                <ProductThumb product={p} small />
                <span className="dash-task-text">
                  <span className="dash-task-title">{fmtName(p.name)}</span>
                  <span className="dash-task-meta">{supplier(p.primary_supplier_id ?? lastFrom.get(p.id))?.name ?? NO_SUPPLIER}</span>
                </span>
                <span className="dash-buying-qty">{fmtQty(Math.ceil(2 * p.min_qty - free))} {fmtUnit(Math.ceil(2 * p.min_qty - free), p.unit)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function BuyingView({ room }: { room: Room }): ReactElement {
  const { state, stats, product, supplier } = useData();
  const worth = useCallback((m: Movement) => worthOf(m, product), [product]);

  const { shares, hues } = useMemo(() => {
    const sender = (m: Movement) => {
      const from = supplier(m.supplier_id);
      return from ? { key: from.id, label: from.name } : { key: NONE, label: NO_SUPPLIER };
    };
    const ever = movedShares(room.rows, "in", 0, room.to, product, sender).filter((s) => s.key !== NONE);
    return {
      shares: movedShares(room.rows, "in", room.from, room.to, product, sender),
      // Colours are set by every delivery there is, not the period on screen, so a supplier keeps its own in all of them.
      hues: new Map(toSlices(ever).map((s) => [s.key, s.hue])),
    };
  }, [room.rows, room.from, room.to, product, supplier]);

  const slices = useMemo(() => topAndRest(shares, 5).map<Slice>((s) => ({ key: s.key, label: s.label, value: s.value, hue: hues.get(s.key) ?? "other" })), [shares, hues]);

  const series = useMemo<ColumnSeries[]>(() => {
    const slot = new Map(slices.map((s, i) => [s.key, i]));
    const values = slices.map(() => room.months.map(() => 0));
    for (const m of room.rows) {
      if (m.type !== "in") continue;
      const t = movedAt(m);
      const month = room.months.findIndex((x) => t >= x.from && t < x.to);
      const at = slot.get(supplier(m.supplier_id)?.id ?? NONE) ?? slot.get("__rest");
      if (month >= 0 && at !== undefined) values[at][month] += worth(m);
    }
    return slices.map((s, i) => ({ key: s.key, label: s.label, hue: s.hue, values: values[i] }));
  }, [slices, room.rows, room.months, supplier, worth]);

  const { received, lead, leadWindows } = useMemo(() => {
    const total = shares.reduce((sum, s) => sum + s.value, 0);
    const first = total > 0 ? shares.find((s) => s.key !== NONE) : undefined;
    const own = room.rows.filter((m) => m.type === "in" && m.supplier_id === first?.key);
    return { received: total, lead: first, leadWindows: first ? shareOf(rolling(own, movedAt, worth, room.now), room.receipts) : undefined };
  }, [shares, room.rows, room.receipts, room.now, worth]);

  const deliveries = useMemo(() => deliveriesIn(room.rows, worth), [room.rows, worth]);
  const deliveryWindows = useMemo(() => rolling(deliveries, (d) => Date.parse(d.at), () => 1, room.now), [deliveries, room.now]);
  const ratioWindows = useMemo(() => shareOf(room.receipts, room.sales), [room.receipts, room.sales]);
  const toOrder = useMemo(() => runway(state.products, room.rows, room.now).filter((r) => r.free < r.product.min_qty), [state.products, room.rows, room.now]);

  const lastDeliveries = deliveries.slice(0, LIST_ROWS).map<DeliveryRow>((d) => ({
    id: d.id,
    supplier: supplier(d.supplierId)?.name ?? NO_SUPPLIER,
    day: fmtDayWord(d.at, room.now),
    lines: fmtQty(d.lines),
    worth: money(d.worth),
  }));

  return (
    <>
      <div className="dash-kpis">
        <Tile label="קליטות" icon="truck" hue={2} value={<Money value={room.receipts[11]} />} delta={change(room.receipts)} note="30 יום · במחירון" spark={room.receipts} href="/movements?period=month" />
        <Tile label="תעודות" icon="file-text" hue={5} value={fmtQty(deliveryWindows[11])} delta={change(deliveryWindows)} note="30 יום" spark={deliveryWindows} href="/movements?period=month" />
        <Tile
          label="ספק מוביל"
          icon="users"
          hue={(lead && hues.get(lead.key)) ?? "other"}
          value={lead ? percent(Math.round((lead.value / received) * 100)) : "—"}
          note={lead?.label ?? "אין קליטות"}
          spark={leadWindows}
        />
        <Tile label="קליטות מול מכירות" icon="activity" hue={4} value={room.sales[11] > 0 ? percent(ratioWindows[11]) : "—"} note="30 יום · במחירון" spark={ratioWindows} href="/movements?period=month" />
        <Tile label="להזמין" icon="package" hue={3} value={fmtQty(toOrder.length)} note="מתחת למינימום" href="/inventory?filter=low" />
        <Tile label="שמות ממתינים" icon="book-open" hue={5} value={fmtQty(stats.pendingMappings)} note="להתאמה לקטלוג" href="/suppliers" />
      </div>

      <div className="dash-grid">
        <ChartCard
          title="קליטות לפי חודש"
          subtitle="לפי ספק · במחירון"
          className="is-wide"
          table={received > 0 ? { head: ["חודש", ...series.map((s) => s.label)], rows: room.labels.map((label, i) => [label, ...series.map((s) => money(s.values[i]))]) } : undefined}
        >
          {received > 0 ? (
            <>
              <ul className="dash-keys dash-buying-keys">
                {series.map((s) => <li key={s.key}><i style={{ background: hue(s.hue) }} />{s.label}</li>)}
              </ul>
              <Columns labels={room.labels} titles={room.titles} partial={room.partial} series={series} stacked label="קליטות לפי ספק וחודש" height={272} />
            </>
          ) : (
            <EmptyState title="אין קליטות" />
          )}
        </ChartCard>

        <ChartCard title="חלק כל ספק" subtitle="שווי הקליטות · במחירון" className="dash-buying-ring" table={received > 0 ? { head: ["ספק", "שווי"], rows: slices.map((s) => [s.label, money(s.value)]) } : undefined}>
          {received > 0 ? <Ring slices={slices} center={<Money value={received} />} centerLabel="סה״כ" label="חלק כל ספק בקליטות" /> : <EmptyState title="אין קליטות" />}
        </ChartCard>

        <ToOrder list={toOrder} rows={room.rows} />

        <ChartCard title="קליטות אחרונות" subtitle="לפי תעודה · במחירון" flush className="is-wide">
          {deliveries.length === 0 ? <EmptyState title="אין קליטות" /> : <Table columns={DELIVERY_COLUMNS} data={lastDeliveries} className="dash-table dash-buying-table" />}
        </ChartCard>
      </div>
    </>
  );
}
