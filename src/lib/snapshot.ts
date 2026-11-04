/**
 * What the overview tells the owner, worked out from the store's rows: what the shelf is worth,
 * what moved, and how long each product will hold. Every ₪ here is a sale price, so the screen
 * says במחירון. Quantities never add up across products; only their worth does.
 */
import { available, orderTotal, stockState, type Movement, type Order, type OrderLine, type Product, type Supplier } from "@/lib/store";
import type { StockState } from "@/lib/map3d/types";

const DAY = 86_400_000;

/** The pace of goods out comes from this many days at most. */
export const PACE_DAYS = 30;

/** And from no fewer than these, so one busy day never sets it. */
const PACE_FLOOR_DAYS = 7;

export type ShelfWorth = {
  total: number;
  /** Can still be sold. */
  free: number;
  /** Open orders hold it. */
  held: number;
  /** Products on the shelf that have no price, so the total leaves them out. */
  unpriced: number;
};

export function shelfWorth(products: Product[]): ShelfWorth {
  const worth: ShelfWorth = { total: 0, free: 0, held: 0, unpriced: 0 };
  for (const p of products) {
    if (p.price === null) {
      if (p.qty > 0) worth.unpriced += 1;
      continue;
    }
    const held = Math.min(p.qty, p.reserved);
    worth.total += p.qty * p.price;
    worth.held += held * p.price;
    worth.free += (p.qty - held) * p.price;
  }
  return worth;
}

/** What one kind of movement was worth between two moments. */
export function movedWorth(rows: Movement[], type: "in" | "out", from: number, to: number, product: (id: string) => Product | undefined): number {
  let worth = 0;
  for (const m of rows) {
    if (m.type !== type) continue;
    const t = Date.parse(m.created_at);
    if (t >= from && t < to) worth += m.qty * (product(m.product_id)?.price ?? 0);
  }
  return worth;
}

/** This week against the one before, as a whole percent; null with nothing to measure against. */
export function pctChange(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/** One part of a whole: who or what, and its ₪. */
export type Share = { key: string; label: string; value: number };

/** The key of the line that folds everything after the biggest few into one. */
export const REST = "__rest";

/** The biggest few of a whole, largest first, and the rest in one line, so a ring stays readable. */
export function topShares(rows: Share[], keep = 5): Share[] {
  const sorted = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= keep) return sorted;
  const rest = sorted.slice(keep).reduce((sum, r) => sum + r.value, 0);
  return [...sorted.slice(0, keep), { key: REST, label: "אחרים", value: rest }];
}

export const sumShares = (rows: Share[]): number => rows.reduce((sum, r) => sum + r.value, 0);

const NO_CATEGORY = "ללא קטגוריה";

/** What stands on the shelf in each category, במחירון. */
export function worthByCategory(products: Product[]): Share[] {
  const by = new Map<string, number>();
  for (const p of products) {
    if (p.price === null || p.qty <= 0) continue;
    const label = p.category?.trim() || NO_CATEGORY;
    by.set(label, (by.get(label) ?? 0) + p.qty * p.price);
  }
  return [...by].map(([label, value]) => ({ key: label, label, value }));
}

/** What each customer took, from the orders delivered since `from`, at the prices they were sold at. */
export function salesByCustomer(orders: Order[], linesOf: (id: string) => OrderLine[], from: number): Share[] {
  const by = new Map<string, number>();
  for (const o of orders) {
    if (o.status !== "delivered" || !o.closed_at || Date.parse(o.closed_at) < from) continue;
    const total = orderTotal(linesOf(o.id));
    if (total === null) continue;
    const label = o.customer.trim();
    by.set(label, (by.get(label) ?? 0) + total);
  }
  return [...by].map(([label, value]) => ({ key: label, label, value }));
}

/** What came in from each supplier since `from`, במחירון like every ₪ here. */
export function inBySupplier(rows: Movement[], from: number, product: (id: string) => Product | undefined, supplier: (id: string | null) => Supplier | undefined): Share[] {
  const by = new Map<string, Share>();
  for (const m of rows) {
    if (m.type !== "in" || Date.parse(m.created_at) < from) continue;
    const key = m.supplier_id ?? "";
    const share = by.get(key) ?? { key, label: supplier(m.supplier_id)?.name ?? "ללא ספק", value: 0 };
    share.value += m.qty * (product(m.product_id)?.price ?? 0);
    by.set(key, share);
  }
  return [...by.values()];
}

export type Runway = {
  product: Product;
  state: StockState;
  free: number;
  /** Days until nothing is left to promise; null with no goods out to judge by. */
  days: number | null;
};

/**
 * Every product by how soon it runs out, at the pace of the last weeks. A warehouse younger
 * than the window is judged by the days it has, or a new system would promise three times too long.
 */
export function runway(products: Product[], rows: Movement[], now: number = Date.now()): Runway[] {
  const since = now - PACE_DAYS * DAY;
  const out = new Map<string, number>();
  let first = now;
  for (const m of rows) {
    const t = Date.parse(m.created_at);
    if (t < since) continue;
    if (t < first) first = t;
    if (m.type === "out") out.set(m.product_id, (out.get(m.product_id) ?? 0) + m.qty);
  }
  const span = Math.max(PACE_FLOOR_DAYS, (now - first) / DAY);

  const list = products.map<Runway>((product) => {
    const free = available(product);
    const pace = (out.get(product.id) ?? 0) / span;
    const days = free <= 0 ? 0 : pace > 0 ? Math.ceil(free / pace) : null;
    return { product, state: stockState(product), free, days };
  });

  // With no pace to go by, a product under its minimum still comes before a healthy one.
  const soonest = (r: Runway) => r.days ?? (r.state === "ok" ? Number.POSITIVE_INFINITY : Number.MAX_VALUE);
  return list.sort((a, b) => soonest(a) - soonest(b) || a.free - b.free || a.product.qty - b.product.qty);
}
