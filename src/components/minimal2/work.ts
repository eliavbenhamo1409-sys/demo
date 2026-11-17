/**
 * What waits on the manager, worked out once for every page of מינימל 2, so a count reads the same wherever it stands:
 * the rail, the overview and the page that owns it all take it from here. Nothing is estimated: a date the data
 * doesn't hold stays null and the screen says לא נקבע.
 */
import { daysUntil, isToday } from "@/lib/format";
import { available, orderTotal, type Fault, type ItemRequest, type Order, type OrderLine, type Product, type SupplierItem } from "@/lib/store";

/* ───────── stock ───────── */

/** One reading per product, in the order of need. Orders past the shelf come first, an empty shelf nobody waits for second. */
export type StockLevel = "short" | "out" | "low" | "ok";

export function levelOf(p: Pick<Product, "qty" | "reserved" | "min_qty">): StockLevel {
  const free = available(p);
  if (free < 0) return "short";
  if (p.qty <= 0) return "out";
  if (p.min_qty > 0 && free < p.min_qty) return "low";
  return "ok";
}

export const LEVEL_WORD: Record<StockLevel, string> = { short: "חסר להזמנות", out: "אזל", low: "מתחת למינימום", ok: "תקין" };

export type Shortage = {
  /** The product's id, so a table can key its rows. */
  id: string;
  product: Product;
  level: Exclude<StockLevel, "ok">;
  /** What can still be promised; below zero when orders hold more than the shelf has. */
  free: number;
  /** The units missing: to the orders when short, to the minimum otherwise. */
  gap: number;
  /** The open orders holding this product, the nearest delivery first. */
  orders: Order[];
  /** The nearest delivery promised among them; null when none of them has a date. */
  nearest: string | null;
};

const byPromiseThenAge = (a: Order, b: Order) => (a.promised_on ?? "9").localeCompare(b.promised_on ?? "9") || a.created_at.localeCompare(b.created_at);

/** Open orders by the product they hold. */
export function holdsByProduct(orders: Order[], linesOf: (id: string) => OrderLine[]): Map<string, Order[]> {
  const map = new Map<string, Order[]>();
  for (const o of orders) {
    if (o.status !== "open") continue;
    for (const l of linesOf(o.id)) {
      const list = map.get(l.product_id);
      if (list) list.push(o);
      else map.set(l.product_id, [o]);
    }
  }
  for (const list of map.values()) list.sort(byPromiseThenAge);
  return map;
}

const LEVEL_RANK: Record<StockLevel, number> = { short: 0, out: 1, low: 2, ok: 3 };

/** Every product that is missing something, what hurts an order first and inside that the nearest delivery first. */
export function shortagesOf(products: Product[], orders: Order[], linesOf: (id: string) => OrderLine[]): Shortage[] {
  const holds = holdsByProduct(orders, linesOf);
  const list: Shortage[] = [];
  for (const product of products) {
    const level = levelOf(product);
    if (level === "ok") continue;
    const free = available(product);
    const held = level === "short" ? holds.get(product.id) ?? [] : [];
    list.push({
      id: product.id,
      product,
      level,
      free,
      gap: level === "short" ? -free : Math.max(0, product.min_qty - free),
      orders: held,
      nearest: held.find((o) => o.promised_on)?.promised_on ?? null,
    });
  }
  const cover = (s: Shortage) => (s.product.min_qty > 0 ? s.free / s.product.min_qty : 0);
  return list.sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      (a.nearest ?? "9").localeCompare(b.nearest ?? "9") ||
      cover(a) - cover(b) ||
      a.product.name.localeCompare(b.product.name, "he"),
  );
}

/* ───────── orders ───────── */

export const isLate = (o: Order): boolean => o.status === "open" && o.promised_on !== null && daysUntil(o.promised_on) < 0;

/** An open order is short while any of its products is held past the shelf, as every other page reads it. */
export function isUncovered(o: Order, linesOf: (id: string) => OrderLine[], product: (id: string) => Product | undefined): boolean {
  return linesOf(o.id).some((l) => {
    const p = product(l.product_id);
    return p !== undefined && available(p) < 0;
  });
}

export type OrderFacts = { open: number; late: number; ready: number; waiting: number; lateWaiting: number; worth: number; unpriced: number };

export function orderFacts(orders: Order[], linesOf: (id: string) => OrderLine[], product: (id: string) => Product | undefined): OrderFacts {
  const facts: OrderFacts = { open: 0, late: 0, ready: 0, waiting: 0, lateWaiting: 0, worth: 0, unpriced: 0 };
  for (const o of orders) {
    if (o.status !== "open") continue;
    facts.open += 1;
    const short = isUncovered(o, linesOf, product);
    const late = isLate(o);
    if (late) facts.late += 1;
    if (short) facts.waiting += 1;
    else facts.ready += 1;
    if (late && short) facts.lateWaiting += 1;
    const total = orderTotal(linesOf(o.id));
    if (total === null) facts.unpriced += 1;
    else facts.worth += total;
  }
  return facts;
}

/* ───────── what waits for a decision ───────── */

export const openFaults = (faults: Fault[]): Fault[] => faults.filter((f) => f.status === "open");

/** Open faults nobody holds yet: these wait on the manager. The rest wait on a worker. */
export const unassigned = (faults: Fault[]): Fault[] => faults.filter((f) => f.status === "open" && !f.assigned_to);

export const pendingRequests = (requests: ItemRequest[]): ItemRequest[] => requests.filter((r) => r.status === "pending");

/** A supplier's name that still needs a decision: not approved yet, or its product is gone. */
export function pendingNames(items: SupplierItem[], product: (id: string | null) => Product | undefined): SupplierItem[] {
  return items.filter((i) => i.status === "pending" || !i.product_id || !product(i.product_id));
}

/** `hurting` is how many of the shortages hold back an order already promised: the part of the count that is red. */
export type Waiting = { faults: number; approvals: number; shortages: number; hurting: number; total: number };

/* ───────── what was handled today ───────── */

export type Handled = { faults: number; approvals: number; total: number };

const today = (iso: string | null | undefined): boolean => !!iso && isToday(iso);

/** Decisions made today, counted from the rows themselves: faults closed, worker lines decided, supplier names approved. */
export function handledToday(faults: Fault[], requests: ItemRequest[], names: SupplierItem[]): Handled {
  const closed = faults.filter((f) => f.status === "resolved" && today(f.resolved_at)).length;
  const lines = requests.filter((r) => r.status !== "pending" && today(r.resolved_at)).length;
  // A name typed in already approved never waited, so it is not a decision: only one approved some time after it arrived counts.
  const approved = names.filter((i) => i.status === "approved" && today(i.approved_at) && Date.parse(i.approved_at ?? "") - Date.parse(i.created_at) > 60_000).length;
  return { faults: closed, approvals: lines + approved, total: closed + lines + approved };
}

/** The moment this many days ago. */
export const daysBack = (days: number, now: number = Date.now()): number => now - days * 86_400_000;

/** Whole days something has waited. */
export const ageDays = (iso: string, now: number = Date.now()): number => Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));

/** Hebrew count: "תקלה אחת" / "3 תקלות". */
export const many = (n: number, one: string, more: string): string => (n === 1 ? one : `${n} ${more}`);

/** "א", "א ו-ב", "א, ב ו-ג": a sentence's list, with the joining vav before a digit written as it is said. */
export function listWords(parts: string[]): string {
  const and = (word: string) => (/^\d/.test(word) ? `ו-${word}` : `ו${word}`);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${and(parts[parts.length - 1])}`;
}
