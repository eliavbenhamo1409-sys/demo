/**
 * What the shelf held at a past moment, read from the ledger. Feeds the dated past view only: the
 * live view reads products.qty and nothing here. All sums run on integer thousandths, because a
 * float that drifts would fail the reconcile check on honest data.
 */

import type { Movement, Product } from "@/lib/store";

const DAY = 86_400_000;

/** How far back the past view and the run-out numbers read: fetchMovements(now - TRAIL_WINDOW, null). */
export const TRAIL_WINDOW = 30 * DAY;

export type PastQty = { kind: "known"; qty: number } | { kind: "unknown" } | { kind: "absent" };

export interface TrailTick {
  at: number;
  id: string;
  type: Movement["type"];
  productId: string;
  qty: number;
}

export interface LedgerRow {
  movement: Movement;
  at: number;
  /** Thousandths. */
  qty: number;
}

/** From `at` until the next step the shelf held `qty`, in thousandths. Null: the ledger can't say. */
export interface TrailStep {
  at: number;
  qty: number | null;
}

export interface ProductTrail {
  rows: readonly LedgerRow[];
  /** min(created_at, first movement): opening rows are backdated, so created_at alone would hide them. */
  born: number;
  /** Thousandths. */
  current: number;
  /** Oldest first. Empty when the ledger doesn't add up to products.qty, which hides the history. */
  steps: readonly TrailStep[];
}

export interface Trail {
  from: number;
  to: number;
  ticks: TrailTick[];
  /** Products whose ledger doesn't add up. Worth one fresh fetch, since a row may have landed mid-read. */
  broken: string[];
  products: ReadonlyMap<string, ProductTrail>;
}

const thousandths = (n: number) => Math.round(n * 1000);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const ledgers = new WeakMap<readonly Movement[], ReadonlyMap<string, readonly LedgerRow[]>>();

/** Each product's rows once each, oldest first: a paged read can repeat a row, and a repeated `in` would count twice. */
export function ledgerOf(movements: readonly Movement[]): ReadonlyMap<string, readonly LedgerRow[]> {
  const cached = ledgers.get(movements);
  if (cached) return cached;
  const seen = new Set<string>();
  const ledger = new Map<string, LedgerRow[]>();
  for (const movement of movements) {
    const at = Date.parse(movement.created_at);
    if (seen.has(movement.id) || !Number.isFinite(at) || !Number.isFinite(movement.qty)) continue;
    seen.add(movement.id);
    const row = { movement, at, qty: thousandths(movement.qty) };
    const rows = ledger.get(movement.product_id);
    if (rows) rows.push(row);
    else ledger.set(movement.product_id, [row]);
  }
  for (const rows of ledger.values()) rows.sort((a, b) => a.at - b.at || compare(a.movement.id, b.movement.id));
  ledgers.set(movements, ledger);
  return ledger;
}

/** Forward from the first adjust, as the database trigger applies rows: in adds, out clamps at 0, fault leaves the shelf alone. */
function forwardSteps(rows: readonly LedgerRow[], born: number): { steps: TrailStep[]; last: number } {
  const steps: TrailStep[] = [{ at: born, qty: null }];
  let qty = 0;
  for (const { movement, at, qty: amount } of rows) {
    if (movement.type === "fault") continue;
    if (movement.type === "adjust") qty = amount;
    else if (movement.type === "in") qty += amount;
    else qty = Math.max(qty - amount, 0);
    steps.push({ at, qty });
  }
  return { steps, last: qty };
}

/**
 * Back from today's quantity, for rows with no count behind them. An out that landed on 0 may have
 * clamped, so nothing before it is known. Null: the rows ask for less than nothing on the shelf.
 */
function backwardSteps(rows: readonly LedgerRow[], current: number, born: number): TrailStep[] | null {
  const steps: TrailStep[] = [];
  let qty: number | null = current;
  for (let i = rows.length - 1; i >= 0 && qty !== null; i--) {
    const { movement, at, qty: amount } = rows[i];
    if (movement.type === "fault") continue;
    steps.push({ at, qty });
    if (movement.type === "in") qty -= amount;
    else qty = qty === 0 ? null : qty + amount;
    if (qty !== null && qty < 0) return null;
  }
  steps.push({ at: born, qty });
  return steps.reverse();
}

function trailOf(product: Product, rows: readonly LedgerRow[]): ProductTrail {
  const current = thousandths(product.qty);
  const born = Math.min(Date.parse(product.created_at), rows[0]?.at ?? Infinity);
  const firstCount = rows.findIndex((row) => row.movement.type === "adjust");
  if (firstCount >= 0) {
    const { steps, last } = forwardSteps(rows.slice(firstCount), born);
    return { rows, born, current, steps: last === current ? steps : [] };
  }
  return { rows, born, current, steps: backwardSteps(rows, current, born) ?? [] };
}

export function buildTrail(products: readonly Product[], movements: readonly Movement[], now: number): Trail {
  const ledger = ledgerOf(movements);
  const lines = new Map<string, ProductTrail>();
  const ticks: TrailTick[] = [];
  const broken: string[] = [];
  for (const product of products) {
    const rows = ledger.get(product.id) ?? [];
    const line = trailOf(product, rows);
    lines.set(product.id, line);
    if (line.steps.length === 0) broken.push(product.id);
    for (const { movement, at } of rows) {
      ticks.push({ at, id: movement.id, type: movement.type, productId: movement.product_id, qty: movement.qty });
    }
  }
  ticks.sort((a, b) => a.at - b.at || compare(a.id, b.id));
  return { from: ticks[0]?.at ?? now, to: now, ticks, broken, products: lines };
}

/** The last step at or before a moment: a row at exactly that moment has already happened. */
function stepAt(steps: readonly TrailStep[], at: number): TrailStep | undefined {
  let low = 0;
  let high = steps.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (steps[middle].at <= at) low = middle + 1;
    else high = middle;
  }
  return steps[low - 1];
}

export function qtyAt(trail: Trail, productId: string, at: number): PastQty {
  const line = trail.products.get(productId);
  if (!line) return { kind: "unknown" };
  if (at < line.born) return { kind: "absent" };
  if (at >= trail.to) return { kind: "known", qty: line.current / 1000 };
  // Rows older than the window weren't read, so the steps can't speak for that time.
  if (at < trail.from) return { kind: "unknown" };
  const qty = stepAt(line.steps, at)?.qty ?? null;
  return qty === null ? { kind: "unknown" } : { kind: "known", qty: qty / 1000 };
}
