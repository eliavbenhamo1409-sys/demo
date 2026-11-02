/**
 * Products on the floor, from state.products alone. One product takes one branch of one loop, so
 * placed + tray = total holds by construction, and a row that can't be read goes to the tray.
 */

import { available, stockState, type Product } from "@/lib/store";
import { formOf } from "./forms";
import { valueOf } from "./metrics";
import { resolvePlace } from "./place";
import type { MapObject, StockSlot, StockState } from "./types";

export interface MapItem {
  product: Product;
  objectId: string;
  /** Zero based. */
  level: number | null;
  state: StockState;
  /** qty × price, null without a price. */
  value: number | null;
}

export interface ObjectStock {
  object: MapObject;
  /** Oldest product first, the order stock fills a rack. */
  items: MapItem[];
  /** Sum of known values. */
  value: number;
  /** Items with no price. */
  unpriced: number;
  worst: StockState;
}

export interface MapModel {
  slots: StockSlot[];
  byObject: Map<string, ObjectStock>;
  tray: Product[];
  placed: number;
  total: number;
}

const SEVERITY: Record<StockState, number> = { ok: 0, low: 1, out: 2, short: 3 };

/** A place reads full at twice the minimum, so half a rack is the minimum and anything under it looks low. */
const FULL_AT = 2;
const NO_MINIMUM_FILL = 0.5;
const SMALLEST_FILL = 0.12;

function fillOf({ qty, min_qty }: Product): number {
  if (qty <= 0) return 0;
  if (min_qty <= 0) return NO_MINIMUM_FILL;
  return Math.min(Math.max(qty / (FULL_AT * min_qty), SMALLEST_FILL), 1);
}

/**
 * Oldest first and by plain code order: the store's array changes order between a reload and a live
 * update, and a new product must not shift what already stands on a rack.
 */
function byAge(a: Product, b: Product): number {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function placeProduct(product: Product, objects: readonly MapObject[]): { item: MapItem; slot: StockSlot } | null {
  try {
    const place = resolvePlace(product.location, objects);
    if (!place || !Number.isFinite(available(product))) return null;
    const { objectId, level } = place;
    const { form, finish } = formOf(product);
    return {
      item: { product, objectId, level, state: stockState(product), value: valueOf(product) },
      slot: { key: product.id, objectId, level, form, finish, fill: fillOf(product) },
    };
  } catch {
    return null;
  }
}

export function buildMapModel(products: readonly Product[], objects: readonly MapObject[]): MapModel {
  const byObject = new Map<string, ObjectStock>();
  for (const object of objects) byObject.set(object.id, { object, items: [], value: 0, unpriced: 0, worst: "ok" });

  const slots: StockSlot[] = [];
  const tray: Product[] = [];
  for (const product of [...products].sort(byAge)) {
    const found = placeProduct(product, objects);
    const stock = found && byObject.get(found.item.objectId);
    if (!stock) {
      tray.push(product);
      continue;
    }
    const { item, slot } = found;
    slots.push(slot);
    stock.items.push(item);
    if (item.value === null) stock.unpriced += 1;
    else stock.value += item.value;
    if (SEVERITY[item.state] > SEVERITY[stock.worst]) stock.worst = item.state;
  }
  return { slots, byObject, tray, placed: slots.length, total: products.length };
}
