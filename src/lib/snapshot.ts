/**
 * What the overview tells the owner, worked out from the store's rows: what the shelf is worth,
 * what moved, and how long each product will hold. Every ₪ here is a sale price, so the screen
 * says במחירון. Quantities never add up across products; only their worth does.
 */
import { available, stockState, type Movement, type Product } from "@/lib/store";
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
