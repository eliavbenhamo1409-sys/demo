"use client";

/** The second view: who buys, what sells and how fast it goes out. */
import { useMemo, type ReactElement } from "react";
import { orderTotal, useData, type Movement, type Order, type Product } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { EmptyState } from "@/components/ui";
import { fmtName, fmtPrice, fmtQty } from "@/lib/format";
import { agentShares, change, customerShares, leadDays, movedShares, rolling, topAndRest, WINDOW_DAYS, type Share } from "@/lib/control-room";
import { Bars, ChartCard, Columns, Ring, type BarRow, type Hue, type Slice } from "./Charts";
import { Money, Tile } from "./Tile";
import type { Room } from "./useControlRoom";

type ProductOf = (id: string) => Product | undefined;

const SLOTS: Hue[] = [1, 2, 3, 4, 5];

const TOP = 8;

const SPAN = WINDOW_DAYS * 86_400_000;

const money = (n: number) => fmtPrice(Math.round(n));

const closedAt = (o: Order) => Date.parse(o.closed_at as string);

/** The twelve windows rolling() sums, oldest first, for the figures that are not sums. */
const lastWindows = (now: number) => Array.from({ length: 12 }, (_, i) => ({ from: now - (12 - i) * SPAN, to: now - (11 - i) * SPAN }));

const toBars = (shares: Share[]): BarRow[] => shares.map((s) => ({ key: s.key, label: s.label, value: s.value, sub: s.count === 1 ? "הזמנה אחת" : `${fmtQty(s.count)} הזמנות` }));

const toCells = (shares: Share[]) => shares.map((s) => [s.label, fmtQty(s.count), money(s.value)]);

/** Colours and order are set by every movement there is, not the period on screen, so a category is the same slice in all of them. */
function categorySlices(rows: Movement[], from: number, to: number, product: ProductOf): Slice[] {
  const sold = (since: number, until: number) =>
    movedShares(rows, "out", since, until, product, (m) => {
      const found = product(m.product_id);
      if (!found) return null;
      const label = found.category || "ללא קטגוריה";
      return { key: label, label };
    });
  const ranked = sold(0, Infinity).slice(0, SLOTS.length).map((s) => s.key);
  const shares = sold(from, to).filter((s) => s.value > 0);
  const coloured = ranked.flatMap((key) => shares.filter((s) => s.key === key));
  const rest = shares.filter((s) => !ranked.includes(s.key));
  return topAndRest([...coloured, ...rest], coloured.length).map((s) => ({ key: s.key, label: s.label, value: s.value, hue: SLOTS[ranked.indexOf(s.key)] ?? "other" }));
}

/** The best sellers by worth, each with how much of it left. A quantity stays on its own row: only worth adds up. */
function topProducts(rows: Movement[], from: number, to: number, product: ProductOf) {
  const out = rows.filter((m) => m.type === "out" && Date.parse(m.created_at) >= from && Date.parse(m.created_at) < to);
  const top = movedShares(out, "out", from, to, product, (m) => {
    const found = product(m.product_id);
    return found ? { key: found.id, label: fmtName(found.name) } : null;
  }).slice(0, TOP);
  return top.map((s) => ({ ...s, amount: `${fmtQty(out.reduce((sum, m) => (m.product_id === s.key ? sum + m.qty : sum), 0))} ${product(s.key)?.unit ?? ""}` }));
}

export function SalesView({ room }: { room: Room }): ReactElement {
  const { state, product, agent, linesOf } = useData();
  const { openProduct } = useUi();

  const figures = useMemo(() => {
    const delivered = state.orders.filter((o) => o.status === "delivered" && o.closed_at !== null);
    const total = (o: Order) => orderTotal(linesOf(o.id));
    // A line with no price leaves its order with no total, so the average skips the order rather than count it as nothing.
    const priced = delivered.filter((o) => total(o) !== null);
    const worth = rolling(priced, closedAt, (o) => total(o) ?? 0, room.now);
    const count = rolling(priced, closedAt, () => 1, room.now);
    const windows = lastWindows(room.now);
    return {
      average: worth.map((w, i) => (count[i] > 0 ? w / count[i] : 0)),
      delivered: rolling(delivered, closedAt, () => 1, room.now),
      customers: windows.map(({ from, to }) => customerShares(delivered, { linesOf }, from, to).length),
      lead: windows.map(({ from, to }) => leadDays(delivered, from, to) ?? 0),
    };
  }, [state.orders, linesOf, room.now]);

  const closed = useMemo(() => {
    const inPeriod = state.orders.filter((o) => o.status !== "open" && o.closed_at !== null && closedAt(o) >= room.from && closedAt(o) < room.to);
    return { all: inPeriod.length, cancelled: inPeriod.filter((o) => o.status === "cancelled").length };
  }, [state.orders, room.from, room.to]);

  const categories = useMemo(() => categorySlices(room.rows, room.from, room.to, product), [room.rows, room.from, room.to, product]);
  const agents = useMemo(() => agentShares(state.orders, { linesOf }, (id) => agent(id)?.name ?? "סוכן", room.from, room.to), [state.orders, linesOf, agent, room.from, room.to]);
  const customers = useMemo(() => customerShares(state.orders, { linesOf }, room.from, room.to).slice(0, TOP), [state.orders, linesOf, room.from, room.to]);
  const products = useMemo(() => topProducts(room.rows, room.from, room.to, product), [room.rows, room.from, room.to, product]);

  const average = figures.average[11];
  const lead = figures.lead[11];
  const period = `${room.months.length} חודשים`;

  return (
    <>
      <div className="dash-kpis">
        <Tile label="מכירות" icon="arrow-up-right" hue={1} value={<Money value={room.sales[11]} />} delta={change(room.sales)} upIsGood note="30 יום · במחירון" spark={room.sales} href="/movements?period=month" />
        <Tile label="הזמנה ממוצעת" icon="tag" hue={2} value={average > 0 ? <Money value={average} /> : "—"} delta={average > 0 ? change(figures.average) : null} note="30 יום · במחירון" spark={figures.average} href="/orders?status=delivered" />
        <Tile label="הזמנות שנמסרו" icon="check-circle" hue={3} value={fmtQty(figures.delivered[11])} delta={change(figures.delivered)} note="30 יום" spark={figures.delivered} href="/orders?status=delivered" />
        <Tile label="לקוחות פעילים" icon="users" hue={4} value={fmtQty(figures.customers[11])} delta={change(figures.customers)} note="30 יום" spark={figures.customers} href="/orders?status=delivered" />
        <Tile label="זמן אספקה" icon="clock" hue={5} value={lead > 0 ? lead.toFixed(1) : "—"} unit={lead > 0 ? "ימים" : undefined} delta={lead > 0 ? change(figures.lead) : null} upIsGood={false} note="30 יום" spark={figures.lead} href="/orders?status=delivered" />
        <Tile
          label="ביטולים"
          icon="x"
          hue="other"
          value={closed.all > 0 ? <span className="ltr">{Math.round((closed.cancelled / closed.all) * 100)}%</span> : "—"}
          note={closed.all > 0 ? `${fmtQty(closed.cancelled)} מתוך ${fmtQty(closed.all)} · ${period}` : period}
          href="/orders?status=cancelled"
        />
      </div>

      <div className="dash-grid">
        <ChartCard title="מכירות לפי חודש" subtitle="סחורה שיצאה · במחירון" className="is-wide" table={{ head: ["חודש", "מכירות"], rows: room.monthly.map((m) => [m.month.label, money(m.out)]) }}>
          {room.monthly.some((m) => m.out > 0) ? (
            <Columns
              labels={room.labels}
              titles={room.titles}
              partial={room.partial}
              label="מכירות לפי חודש"
              height={272}
              series={[{ key: "out", label: "מכירות", hue: 1, values: room.monthly.map((m) => m.out) }]}
            />
          ) : (
            <EmptyState title="אין מכירות" />
          )}
        </ChartCard>

        <ChartCard title="מכירות לפי קטגוריה" subtitle="סחורה שיצאה · במחירון" table={{ head: ["קטגוריה", "מכירות"], rows: categories.map((c) => [c.label, money(c.value)]) }}>
          {categories.length === 0 ? (
            <EmptyState title="אין מכירות" />
          ) : (
            <Ring slices={categories} center={<Money value={categories.reduce((sum, c) => sum + c.value, 0)} />} centerLabel="סה״כ" label="חלק כל קטגוריה במכירות" />
          )}
        </ChartCard>

        <ChartCard title="סוכנים" subtitle="לפי הזמנות שנמסרו · במחירון" table={{ head: ["סוכן", "הזמנות", "מכירות"], rows: toCells(agents) }}>
          {agents.length === 0 ? <EmptyState title="אין הזמנות שנמסרו" /> : <Bars rows={toBars(agents)} label="סוכנים לפי מכירות" />}
        </ChartCard>

        <ChartCard title="לקוחות מובילים" subtitle="לפי הזמנות שנמסרו · במחירון" table={{ head: ["לקוח", "הזמנות", "מכירות"], rows: toCells(customers) }}>
          {customers.length === 0 ? <EmptyState title="אין הזמנות שנמסרו" /> : <Bars rows={toBars(customers)} label="לקוחות מובילים לפי מכירות" />}
        </ChartCard>

        <ChartCard title="מוצרים מובילים" subtitle="לפי שווי · במחירון" table={{ head: ["מוצר", "כמות", "מכירות"], rows: products.map((p) => [p.label, p.amount, money(p.value)]) }}>
          {products.length === 0 ? (
            <EmptyState title="אין מכירות" />
          ) : (
            <Bars
              label="מוצרים מובילים לפי שווי"
              rows={products.map((p) => ({ key: p.key, label: p.label, value: p.value, sub: p.amount, lead: <ProductThumb product={product(p.key)} small />, onOpen: () => openProduct(p.key) }))}
            />
          )}
        </ChartCard>
      </div>
    </>
  );
}
