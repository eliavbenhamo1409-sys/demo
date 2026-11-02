/**
 * Figures per product, one product at a time, so units never mix. A number shows only when the
 * ledger can carry it: one 400 unit out in two days must not read as two days left.
 */

import { stockState, type Movement, type Product } from "@/lib/store";
import { ledgerOf, TRAIL_WINDOW, type Trail, type TrailStep } from "./trail";
import type { StockState } from "./types";

const DAY = 86_400_000;
const MIN_IN_STOCK_DAYS = 7;
const MIN_OUT_DAYS = 2;
/** Past this many spans of known history a number would claim more than the ledger saw. */
const MAX_SPANS = 3;

export type Cover = { kind: "days"; days: number } | { kind: "over"; days: number } | { kind: "state"; state: StockState } | { kind: "thin" };

export interface CountInfo {
  /** When the shelf was last counted, ISO. */
  lastCount: string | null;
  /** qty minus what the ledger explains. Positive: stock with no movement behind it. */
  unexplained: number;
  /** Reported as faulty since the last count. A fault leaves qty alone, so this is still in it. */
  faultQty: number;
  /** The last count against what the ledger expected. Null until a second count: the first is an opening. */
  difference: number | null;
}

/** Time with something on the shelf between start and end: an empty shelf can't sell. */
function inStockMs(steps: readonly TrailStep[], start: number, end: number): number {
  let ms = 0;
  steps.forEach((step, i) => {
    if (step.qty === null || step.qty <= 0) return;
    ms += Math.max(Math.min(steps[i + 1]?.at ?? end, end) - Math.max(step.at, start), 0);
  });
  return ms;
}

function localDay(at: number): number {
  const date = new Date(at);
  return date.getFullYear() * 10000 + date.getMonth() * 100 + date.getDate();
}

/** Days of stock left at the rate of the last window. */
export function coverOf(product: Product, trail: Trail, now: number): Cover {
  const state = stockState(product);
  if (state === "out" || state === "short") return { kind: "state", state };

  const line = trail.products.get(product.id);
  const knownFrom = line?.steps.find((step) => step.qty !== null)?.at;
  if (!line || knownFrom === undefined) return { kind: "thin" };
  const start = Math.max(knownFrom, trail.from, now - TRAIL_WINDOW);

  let out = 0;
  const outDays = new Set<number>();
  for (const { movement, at, qty } of line.rows) {
    // An out at the very start has no in-stock time behind it.
    if (movement.type !== "out" || qty === 0 || at <= start || at > now) continue;
    out += qty;
    outDays.add(localDay(at));
  }
  const inStockDays = inStockMs(line.steps, start, now) / DAY;
  if (inStockDays < MIN_IN_STOCK_DAYS || outDays.size < MIN_OUT_DAYS) return { kind: "thin" };

  const days = Math.floor((Math.max(product.qty - product.reserved, 0) * 1000 * inStockDays) / out);
  const limit = (MAX_SPANS * (now - start)) / DAY;
  return days > limit ? { kind: "over", days: Math.floor(limit) } : { kind: "days", days };
}

/** How well the ledger explains the shelf. No clamp in this replay, so an out larger than the shelf shows up too. */
export function countOf(product: Product, movements: readonly Movement[]): CountInfo {
  let lastCount: string | null = null;
  let replay = 0;
  let faults = 0;
  let difference: number | null = null;
  for (const { movement, qty } of ledgerOf(movements).get(product.id) ?? []) {
    if (movement.type === "adjust") {
      difference = lastCount === null ? null : qty - replay;
      lastCount = movement.created_at;
      replay = qty;
      faults = 0;
    } else if (movement.type === "in") replay += qty;
    else if (movement.type === "out") replay -= qty;
    else faults += qty;
  }
  return {
    lastCount,
    unexplained: (Math.round(product.qty * 1000) - replay) / 1000,
    faultQty: faults / 1000,
    difference: difference === null ? null : difference / 1000,
  };
}

export function lastOutOf(productId: string, movements: readonly Movement[]): Movement | null {
  const rows = ledgerOf(movements).get(productId) ?? [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].movement.type === "out") return rows[i].movement;
  }
  return null;
}

/** qty × price, a sale price, so its label says במחירון. Null with no price: leave it out of a sum and say so. */
export function valueOf(product: Pick<Product, "qty" | "price">): number | null {
  return product.price === null ? null : product.qty * product.price;
}
