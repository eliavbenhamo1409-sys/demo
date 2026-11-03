"use client";

/** The third view: what the shelf holds, what it is worth, and what is stuck or about to run out. */
import { useMemo, type ReactElement } from "react";
import { dayKey, stockState, useData, type Movement, type Order, type OrderLine, type Product } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { EmptyState } from "@/components/ui";
import { fmtAge, fmtDate, fmtName, fmtPrice, fmtQty, fmtUnit } from "@/lib/format";
import { change, movedShares, topAndRest, WINDOW_DAYS } from "@/lib/control-room";
import { movedWorth, runway, shelfWorth, type Runway } from "@/lib/snapshot";
import { Area, Bars, ChartCard, Ring, type Hue, type Slice } from "./Charts";
import { Money, Tile } from "./Tile";
import type { Room } from "./useControlRoom";

type ProductOf = (id: string) => Product | undefined;
type LinesOf = (orderId: string) => OrderLine[];

const SLOTS: Hue[] = [1, 2, 3, 4, 5];

const DAY = 86_400_000;

const YEAR_DAYS = 365;

/** With nothing out of it for this long, stock counts as standing still. */
const STILL_DAYS = 60;

/** As many rows of each list as keep the three cards of a row the same height. */
const SOONEST_ROWS = 6;
const STILL_ROWS = 5;
const COUNT_ROWS = 6;

const money = (n: number) => fmtPrice(Math.round(n));

const worthOrDash = (n: number) => (n > 0 ? money(n) : "—");

const signedMoney = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;

const productWord = (n: number) => (n === 1 ? "מוצר" : "מוצרים");

const categoryOf = (p: Product) => p.category || "ללא קטגוריה";

/** One movement on the running quantities, the way the shelf took it: a count sets the quantity and a fault leaves it. */
function step(qty: Map<string, number>, m: Movement) {
  const had = qty.get(m.product_id) ?? 0;
  if (m.type === "in") qty.set(m.product_id, had + m.qty);
  else if (m.type === "out") qty.set(m.product_id, Math.max(had - m.qty, 0));
  else if (m.type === "adjust") qty.set(m.product_id, m.qty);
}

/** What the orders open at a moment held of each product: an order holds from the day it is placed until it closes. */
function holdsAt(orders: Order[], linesOf: LinesOf, t: number): Map<string, number> {
  const holds = new Map<string, number>();
  for (const o of orders) {
    if (Date.parse(o.created_at) > t || (o.closed_at && Date.parse(o.closed_at) <= t)) continue;
    for (const line of linesOf(o.id)) holds.set(line.product_id, (holds.get(line.product_id) ?? 0) + line.qty);
  }
  return holds;
}

/** The shelf as it stood at each moment in `marks` (ascending). A product with no movement yet has no known quantity, so it stays out of that moment. */
function shelvesAt(products: Product[], orders: Order[], linesOf: LinesOf, rows: Movement[], marks: number[]): Product[][] {
  const qty = new Map<string, number>();
  const found: Product[][] = [];
  const take = () => {
    const holds = holdsAt(orders, linesOf, marks[found.length]);
    found.push(
      products.flatMap((p) => {
        const on = qty.get(p.id);
        return on === undefined ? [] : [{ ...p, qty: on, reserved: holds.get(p.id) ?? 0 }];
      }),
    );
  };
  // Newest first from the store, so the walk starts at the far end.
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = Date.parse(rows[i].created_at);
    while (found.length < marks.length && marks[found.length] < t) take();
    step(qty, rows[i]);
  }
  while (found.length < marks.length) take();
  return found;
}

/** The store's stats.low and stats.out, for one product. */
const needsFilling = (p: Product) => p.qty <= 0 || stockState(p) === "low";

/**
 * The sales view's colours and order, so a category is the same slice on both: it is ranked by all it ever sold.
 * A category with no sales yet takes a free colour by its worth on the shelf, or a new warehouse would be one grey ring.
 */
function categorySlices(products: Product[], rows: Movement[], product: ProductOf): Slice[] {
  const sums = new Map<string, number>();
  for (const p of products) {
    const worth = p.qty * (p.price ?? 0);
    if (worth > 0) sums.set(categoryOf(p), (sums.get(categoryOf(p)) ?? 0) + worth);
  }
  const shares = [...sums].map(([key, value]) => ({ key, label: key, value })).sort((a, b) => b.value - a.value);
  const sold = movedShares(rows, "out", 0, Infinity, product, (m) => {
    const found = product(m.product_id);
    if (!found) return null;
    const label = categoryOf(found);
    return { key: label, label };
  }).map((s) => s.key);
  const ranked = [...sold, ...shares.map((s) => s.key).filter((key) => !sold.includes(key))].slice(0, SLOTS.length);
  const coloured = ranked.flatMap((key) => shares.filter((s) => s.key === key));
  const rest = shares.filter((s) => !ranked.includes(s.key));
  return topAndRest([...coloured, ...rest], coloured.length).map((s) => ({ key: s.key, label: s.label, value: s.value, hue: SLOTS[ranked.indexOf(s.key)] ?? "other" }));
}

const fmtDaysLeft = (n: number) => (n >= 90 ? "מעל 3 חודשים" : n === 1 ? "עוד יום" : n === 2 ? "עוד יומיים" : `עוד ${fmtQty(n)} ימים`);

/** The same words as the overview: first what is already wrong, then the days it has left. */
function runwayFigure(r: Runway): { text: string; loud?: boolean } {
  if (r.state === "short") return { text: `חסר ${fmtQty(-r.free)}`, loud: true };
  if (r.state === "out") return { text: "אזל", loud: true };
  if (r.free <= 0) return { text: "הכל משוריין" };
  if (r.days === null) return { text: "מתחת למינימום" };
  return { text: fmtDaysLeft(r.days) };
}

function runwayMeta({ product: p, free }: Runway): string {
  const min = p.min_qty > 0 ? `מינימום ${fmtQty(p.min_qty)}` : "";
  const stock = p.qty <= 0 ? "" : free <= 0 ? `על המדף ${fmtQty(p.qty)} ${fmtUnit(p.qty, p.unit)}` : `זמין ${fmtQty(free)} ${fmtUnit(free, p.unit)}`;
  return [stock, min].filter(Boolean).join(" · ") || p.sku;
}

function RunningOut({ room }: { room: Room }): ReactElement {
  const { state } = useData();
  const { openProduct } = useUi();
  // A healthy product that nothing has left lately has no end to predict.
  const soonest = useMemo(
    () => runway(state.products, room.rows, room.now).filter((r) => r.days !== null || r.state !== "ok").slice(0, SOONEST_ROWS),
    [state.products, room.rows, room.now],
  );

  return (
    <ChartCard title="מה ייגמר ראשון" subtitle="לפי קצב ההוצאה בחודש האחרון" flush>
      {soonest.length === 0 ? (
        <EmptyState title="אין מוצרים להשלמה" />
      ) : (
        <ul className="dash-task-list">
          {soonest.map((r) => {
            const { text, loud } = runwayFigure(r);
            return (
              <li key={r.product.id}>
                <button type="button" className="dash-task" onClick={() => openProduct(r.product.id)}>
                  <ProductThumb product={r.product} small />
                  <span className="dash-task-text">
                    <span className="dash-task-title">{fmtName(r.product.name)}</span>
                    <span className="dash-task-meta">{runwayMeta(r)}</span>
                  </span>
                  <span className={loud ? "dash-task-when is-loud" : "dash-task-when"}>{text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

type Still = { product: Product; worth: number; lastOut?: string };

/** Products on the shelf with nothing out of them for STILL_DAYS, the most money first. */
function standingStill(products: Product[], rows: Movement[], now: number): Still[] {
  const lastOut = new Map<string, string>();
  // Newest first from the store, so the first one seen is the last one out.
  for (const m of rows) if (m.type === "out" && !lastOut.has(m.product_id)) lastOut.set(m.product_id, m.created_at);
  const since = now - STILL_DAYS * DAY;
  const list: Still[] = [];
  for (const p of products) {
    const last = lastOut.get(p.id);
    if (p.qty > 0 && (!last || Date.parse(last) < since)) list.push({ product: p, worth: p.qty * (p.price ?? 0), lastOut: last });
  }
  return list.sort((a, b) => b.worth - a.worth);
}

function StandingStill({ room }: { room: Room }): ReactElement {
  const { state } = useData();
  const { openProduct } = useUi();
  const still = useMemo(() => standingStill(state.products, room.rows, room.now), [state.products, room.rows, room.now]);
  const stuck = still.reduce((sum, s) => sum + s.worth, 0);
  const top = still.slice(0, STILL_ROWS);

  return (
    <ChartCard
      title="מלאי שלא זז"
      subtitle={`${STILL_DAYS} יום בלי הוצאה · ${money(stuck)} במחירון`}
      table={{ head: ["מוצר", "על המדף", "שווי"], rows: top.map((s) => [fmtName(s.product.name), `${fmtQty(s.product.qty)} ${fmtUnit(s.product.qty, s.product.unit)}`, worthOrDash(s.worth)]) }}
    >
      {top.length === 0 ? (
        <EmptyState title="אין מלאי שלא זז" />
      ) : (
        <Bars
          label="מלאי שלא זז לפי שווי"
          hue={3}
          format={worthOrDash}
          rows={top.map((s) => ({
            key: s.product.id,
            label: fmtName(s.product.name),
            value: s.worth,
            sub: `${fmtQty(s.product.qty)} ${fmtUnit(s.product.qty, s.product.unit)} · ${s.lastOut ? `הוצאה אחרונה ${fmtAge(s.lastOut, room.now)}` : "ללא הוצאות"}`,
            lead: <ProductThumb product={s.product} small />,
            onOpen: () => openProduct(s.product.id),
          }))}
        />
      )}
    </ChartCard>
  );
}

type ShelfCount = { key: string; at: string; counted: Set<string>; off: Set<string>; gap: number };

/** Every day the shelf was counted, the latest first, and how far the count stood from the quantity on record. */
function shelfCounts(rows: Movement[], product: ProductOf): ShelfCount[] {
  const qty = new Map<string, number>();
  const days = new Map<string, ShelfCount>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i];
    if (m.type === "adjust") {
      const key = dayKey(m.created_at);
      const day = days.get(key) ?? { key, at: m.created_at, counted: new Set<string>(), off: new Set<string>(), gap: 0 };
      // A product's first count has nothing on record to differ from.
      const gap = m.qty - (qty.get(m.product_id) ?? m.qty);
      day.counted.add(m.product_id);
      if (gap !== 0) day.off.add(m.product_id);
      day.gap += gap * (product(m.product_id)?.price ?? 0);
      days.set(key, day);
    }
    step(qty, m);
  }
  return [...days.values()].reverse();
}

function RecentCounts({ room }: { room: Room }): ReactElement {
  const { product } = useData();
  const counts = useMemo(() => shelfCounts(room.rows, product).slice(0, COUNT_ROWS), [room.rows, product]);

  return (
    <ChartCard title="ספירות אחרונות" subtitle="הפרש מול הרישום · במחירון">
      {counts.length === 0 ? (
        <EmptyState title="אין ספירות" />
      ) : (
        <ul className="dash-bars">
          {counts.map((c) => (
            <li key={c.key}>
              <div className="dash-bar">
                <span className="dash-bar-text">
                  <span className="dash-bar-top">
                    <span className="dash-bar-name">{fmtAge(c.at, room.now)}</span>
                    {c.off.size > 0 ? <b className="dash-bar-n ltr">{signedMoney(c.gap)}</b> : null}
                  </span>
                  <span className="dash-bar-sub">
                    {fmtDate(c.at)} · {fmtQty(c.counted.size)} {productWord(c.counted.size)} · {c.off.size > 0 ? `${fmtQty(c.off.size)} עם הפרש` : "ללא הפרש"}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function StockView({ room }: { room: Room }): ReactElement {
  const { state, stats, product, linesOf } = useData();
  const toFill = stats.low + stats.out;

  // The stock keeps no past, so these lines are rebuilt; like the shelf's own, each ends at the live figure.
  const lines = useMemo(() => {
    const last = room.shelfWindows.length - 1;
    const marks = room.shelfWindows.map((_, i) => room.now - (last - i) * WINDOW_DAYS * DAY);
    const shelves = shelvesAt(state.products, state.orders, linesOf, room.rows, marks);
    const worths = shelves.map((shelf) => shelfWorth(shelf));
    const endAt = (series: number[], figure: number) => series.map((v, i) => (i === last ? figure : v));
    return {
      free: endAt(worths.map((w) => w.free), room.shelf.free),
      held: endAt(worths.map((w) => w.held), room.shelf.held),
      toFill: endAt(shelves.map((shelf) => shelf.filter(needsFilling).length), toFill),
      // A window with no sales has no pace, so it draws as nothing rather than as forever.
      cover: room.shelfWindows.map((worth, i) => (room.sales[i] > 0 ? Math.round((worth / room.sales[i]) * WINDOW_DAYS) : 0)),
      turns: room.shelfWindows.map((worth, i) => (worth > 0 ? (room.sales[i] / worth) * (YEAR_DAYS / WINDOW_DAYS) : 0)),
    };
  }, [state.products, state.orders, linesOf, room.now, room.rows, room.sales, room.shelf, room.shelfWindows, toFill]);

  const turnover = useMemo(() => {
    const average = room.shelfWindows.reduce((sum, v) => sum + v, 0) / room.shelfWindows.length;
    return average > 0 ? movedWorth(room.rows, "out", room.now - YEAR_DAYS * DAY, room.now, product) / average : null;
  }, [room.rows, room.now, room.shelfWindows, product]);

  const categories = useMemo(() => categorySlices(state.products, room.rows, product), [state.products, room.rows, product]);

  const selling = room.sales[11] > 0;
  const share = (part: number) => (room.shelf.total > 0 ? Math.round((part / room.shelf.total) * 100) : 0);

  return (
    <>
      <div className="dash-kpis">
        <Tile
          label="שווי מלאי"
          icon="package"
          hue={3}
          value={<Money value={room.shelf.total} />}
          delta={change(room.shelfWindows)}
          note={room.shelf.unpriced > 0 ? `במחירון · ${fmtQty(room.shelf.unpriced)} ללא מחיר` : "במחירון"}
          spark={room.shelfWindows}
          href="/inventory"
        />
        <Tile label="זמין" icon="check-circle" hue={2} value={<Money value={room.shelf.free} />} note={`${share(room.shelf.free)}% מהשווי · במחירון`} spark={lines.free} href="/inventory" />
        <Tile label="משוריין" icon="clipboard-check" hue={5} value={<Money value={room.shelf.held} />} note={`${share(room.shelf.held)}% מהשווי · במחירון`} spark={lines.held} href="/inventory?filter=reserved" />
        <Tile label="ימי מלאי" icon="clock" hue={1} value={selling ? fmtQty(lines.cover[11]) : "—"} unit={selling ? "ימים" : undefined} delta={selling ? change(lines.cover) : null} note="לפי מכירות 30 יום" spark={lines.cover} />
        <Tile label="מחזור מלאי" icon="refresh" hue={1} value={turnover === null ? "—" : turnover.toFixed(1)} unit={turnover === null ? undefined : "בשנה"} note="מכירות מול שווי ממוצע" spark={lines.turns} />
        <Tile
          label="להשלמה"
          icon="truck"
          hue={4}
          value={fmtQty(toFill)}
          unit={productWord(toFill)}
          note={`${fmtQty(stats.low)} מתחת למינימום · ${fmtQty(stats.out)} ${stats.out === 1 ? "אזל" : "אזלו"}`}
          spark={lines.toFill}
          href={stats.low > 0 || stats.out === 0 ? "/inventory?filter=low" : "/inventory?filter=out"}
        />
      </div>

      <div className="dash-grid">
        <ChartCard title="שווי מלאי לאורך זמן" subtitle="בסוף כל חודש · במחירון" className="is-wide" table={{ head: ["חודש", "שווי"], rows: room.labels.map((label, i) => [label, money(room.shelfMonths[i])]) }}>
          {room.shelfMonths.some((v) => v > 0) ? (
            <Area labels={room.labels} titles={room.titles} values={room.shelfMonths} name="שווי מלאי" hue={3} label="שווי המלאי בסוף כל חודש" height={232} />
          ) : (
            <EmptyState title="אין תנועות מלאי" />
          )}
        </ChartCard>

        <ChartCard title="שווי לפי קטגוריה" subtitle="היום · במחירון" table={{ head: ["קטגוריה", "שווי"], rows: categories.map((c) => [c.label, money(c.value)]) }}>
          {categories.length === 0 ? (
            <EmptyState title="אין מלאי" />
          ) : (
            <Ring slices={categories} center={<Money value={room.shelf.total} />} centerLabel="סה״כ" label="חלק כל קטגוריה בשווי המלאי" />
          )}
        </ChartCard>

        <RunningOut room={room} />
        <StandingStill room={room} />
        <RecentCounts room={room} />
      </div>
    </>
  );
}
