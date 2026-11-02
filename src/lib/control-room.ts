/**
 * What the control room shows, worked out from the store's rows: months of goods out and in, who bought and who sold,
 * what the shelf was worth, and how the floor worked. Pure sums, so every view reads the same figures.
 * Goods are worth their sale price, as on the overview (snapshot.ts), so the screens say במחירון.
 * A figure from an order comes from its own lines. Quantities never add up across products; only their worth does.
 */
import { orderTotal, type Fault, type Movement, type Order, type OrderLine, type Product } from "@/lib/store";

const DAY = 86_400_000;

const MONTH_LABELS = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

/** A KPI compares this many days with the ones before, so it reads the same on the 2nd of a month and on the 28th. */
export const WINDOW_DAYS = 30;

/** The small line in a KPI tile. */
const SPARK_WINDOWS = 12;

export type Month = { key: string; label: string; from: number; to: number; partial: boolean };

/** The last `count` calendar months, this one included, oldest first. */
export function lastMonths(count: number, now: number = Date.now()): Month[] {
  const today = new Date(now);
  return Array.from({ length: count }, (_, i) => {
    const first = new Date(today.getFullYear(), today.getMonth() - (count - 1 - i), 1);
    const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    return { key: `${first.getFullYear()}-${first.getMonth()}`, label: MONTH_LABELS[first.getMonth()], from: first.getTime(), to: next.getTime(), partial: next.getTime() > now };
  });
}

/** What the month a chart point stands for reads in full in a tooltip. */
export function fullMonth(month: Month): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(new Date(month.from));
}

const at = (iso: string) => Date.parse(iso);

const inMonth = (months: Month[], t: number) => months.findIndex((m) => t >= m.from && t < m.to);

type ProductOf = (id: string) => Product | undefined;

/** What one line of movement was worth at the list price. */
export const worthOf = (m: Movement, product: ProductOf) => m.qty * (product(m.product_id)?.price ?? 0);

export type MonthFigures = { month: Month; out: number; in: number; moves: number; faults: number };

export function monthFigures(rows: Movement[], months: Month[], product: ProductOf): MonthFigures[] {
  const list = months.map<MonthFigures>((month) => ({ month, out: 0, in: 0, moves: 0, faults: 0 }));
  for (const m of rows) {
    const i = inMonth(months, at(m.created_at));
    if (i < 0) continue;
    list[i].moves += 1;
    if (m.type === "out") list[i].out += worthOf(m, product);
    else if (m.type === "in") list[i].in += worthOf(m, product);
    else if (m.type === "fault") list[i].faults += 1;
  }
  return list;
}

/** Sums over back-to-back windows of days ending now, oldest first: the last one is the figure, the one before it what it is measured against. */
export function rolling<T>(rows: T[], when: (row: T) => number, value: (row: T) => number, now: number, windows = SPARK_WINDOWS, days = WINDOW_DAYS): number[] {
  const sums = new Array<number>(windows).fill(0);
  const span = days * DAY;
  for (const row of rows) {
    const back = Math.floor((now - when(row)) / span);
    if (back >= 0 && back < windows) sums[windows - 1 - back] += value(row);
  }
  return sums;
}

/** The change as a whole percent; nothing to compare with gives null. */
export function change(series: number[]): number | null {
  const now = series[series.length - 1];
  const before = series[series.length - 2];
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

export type Share = { key: string; label: string; value: number; count?: number };

const byValue = (a: Share, b: Share) => b.value - a.value;

function tally(into: Map<string, Share>, key: string, label: string, value: number) {
  const row = into.get(key);
  if (row) {
    row.value += value;
    row.count = (row.count ?? 0) + 1;
  } else {
    into.set(key, { key, label, value, count: 1 });
  }
}

/** The biggest few and the rest as one, so a ring never has more slices than it has colours. */
export function topAndRest(items: Share[], top: number, rest = "אחרים"): Share[] {
  if (items.length <= top + 1) return items;
  const tail = items.slice(top);
  return [...items.slice(0, top), { key: "__rest", label: rest, value: tail.reduce((sum, s) => sum + s.value, 0), count: tail.length }];
}

type Linked = { linesOf: (orderId: string) => OrderLine[] };

const delivered = (o: Order, from: number, to: number) => o.status === "delivered" && o.closed_at !== null && at(o.closed_at) >= from && at(o.closed_at) < to;

/** Customers by what left the warehouse for them; `count` is their orders. */
export function customerShares(orders: Order[], { linesOf }: Linked, from: number, to: number): Share[] {
  const sums = new Map<string, Share>();
  for (const o of orders) if (delivered(o, from, to)) tally(sums, o.customer, o.customer, orderTotal(linesOf(o.id)) ?? 0);
  return [...sums.values()].sort(byValue);
}

/** Agents the same way; the name comes from the caller, which holds the lookup. */
export function agentShares(orders: Order[], { linesOf }: Linked, name: (id: string) => string, from: number, to: number): Share[] {
  const sums = new Map<string, Share>();
  for (const o of orders) if (delivered(o, from, to)) tally(sums, o.agent_id, name(o.agent_id), orderTotal(linesOf(o.id)) ?? 0);
  return [...sums.values()].sort(byValue);
}

/** Goods of one type between two moments, grouped by what `group` says each movement belongs to. */
export function movedShares(rows: Movement[], type: Movement["type"], from: number, to: number, product: ProductOf, group: (m: Movement) => { key: string; label: string } | null): Share[] {
  const sums = new Map<string, Share>();
  for (const m of rows) {
    if (m.type !== type) continue;
    const t = at(m.created_at);
    if (t < from || t >= to) continue;
    const g = group(m);
    if (g) tally(sums, g.key, g.label, worthOf(m, product));
  }
  return [...sums.values()].sort(byValue);
}

export type Age = { key: string; label: string; orders: number; worth: number };

/** Open orders by how long they have waited. */
export function openAges(orders: Order[], { linesOf }: Linked, now: number): Age[] {
  const ages: Age[] = [
    { key: "3", label: "עד 3 ימים", orders: 0, worth: 0 },
    { key: "7", label: "4–7 ימים", orders: 0, worth: 0 },
    { key: "14", label: "8–14 ימים", orders: 0, worth: 0 },
    { key: "more", label: "מעל 14 ימים", orders: 0, worth: 0 },
  ];
  for (const o of orders) {
    if (o.status !== "open") continue;
    const days = (now - at(o.created_at)) / DAY;
    const age = ages[days <= 3 ? 0 : days <= 7 ? 1 : days <= 14 ? 2 : 3];
    age.orders += 1;
    age.worth += orderTotal(linesOf(o.id)) ?? 0;
  }
  return ages;
}

/** How long a delivered order took, in days, on average; null with none in the range. */
export function leadDays(orders: Order[], from: number, to: number): number | null {
  let sum = 0;
  let count = 0;
  for (const o of orders) {
    if (!delivered(o, from, to)) continue;
    sum += (at(o.closed_at as string) - at(o.created_at)) / DAY;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

/**
 * What the shelf was worth at each moment in `marks` (ascending), walking the movements forward. The stock keeps no history,
 * so this is the only way to know, and it needs every movement. A count sets the quantity, as it did on the day.
 */
export function shelfWorthAt(rows: Movement[], products: Product[], marks: number[]): number[] {
  const price = new Map(products.map((p) => [p.id, p.price ?? 0]));
  const qty = new Map<string, number>();
  let worth = 0;
  let mark = 0;
  const found: number[] = [];
  const set = (id: string, next: number) => {
    worth += (next - (qty.get(id) ?? 0)) * (price.get(id) ?? 0);
    qty.set(id, next);
  };
  // Newest first from the store, so the walk starts at the far end.
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i];
    const t = at(m.created_at);
    while (mark < marks.length && marks[mark] < t) {
      found.push(worth);
      mark += 1;
    }
    const held = qty.get(m.product_id) ?? 0;
    if (m.type === "in") set(m.product_id, held + m.qty);
    else if (m.type === "out") set(m.product_id, Math.max(held - m.qty, 0));
    else if (m.type === "adjust") set(m.product_id, m.qty);
  }
  while (mark < marks.length) {
    found.push(worth);
    mark += 1;
  }
  return found;
}

export const HEAT_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳"];

/** The working hours a heat map shows; anything outside them joins the nearest edge. */
export const HEAT_HOURS = Array.from({ length: 11 }, (_, i) => 7 + i);

/** Movements by day of the week and hour, Sunday to Friday. Saturday is shut. */
export function floorHeat(rows: Movement[], from: number, to: number): number[][] {
  const grid = HEAT_DAYS.map(() => HEAT_HOURS.map(() => 0));
  for (const m of rows) {
    const t = at(m.created_at);
    if (t < from || t >= to) continue;
    const d = new Date(t);
    const day = d.getDay();
    if (day >= grid.length) continue;
    const hour = Math.min(Math.max(d.getHours(), HEAT_HOURS[0]), HEAT_HOURS[HEAT_HOURS.length - 1]);
    grid[day][hour - HEAT_HOURS[0]] += 1;
  }
  return grid;
}

/** How long a fault stayed open, in days, on average; null with none resolved in the range. */
export function faultDays(faults: Fault[], from: number, to: number): number | null {
  let sum = 0;
  let count = 0;
  for (const f of faults) {
    if (f.status !== "resolved" || !f.resolved_at) continue;
    const t = at(f.resolved_at);
    if (t < from || t >= to) continue;
    sum += (t - at(f.created_at)) / DAY;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

/** The same shorter figure on every axis and in every tight spot: 950, 12K, 1.2M. */
export function fmtShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

/** A round top for an axis and the steps up to it. */
export function niceScale(max: number, steps = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / steps;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const top = Math.ceil(max / step);
  return Array.from({ length: top + 1 }, (_, i) => i * step);
}
