/**
 * Products on the floor, from state.products and what stands on each shelf. products.qty stays the only total: a place
 * shows its row capped by what the total leaves, and what no place covers goes to the tray. So placed + tray = total
 * holds by construction, and a row that can't be read goes to the tray.
 */

import { fmtName } from "@/lib/format";
import { available, stockState, type Product } from "@/lib/store";
import { formOf } from "./forms";
import { valueOf } from "./metrics";
import { formatPlace, levelsOf, resolvePlace, type Place } from "./place";
import type { ShelfRow } from "./shelves";
import type { MapObject, PickHit, ShelfSide, StockSlot, StockState } from "./types";

/** One product in one place. */
export interface MapItem {
  product: Product;
  objectId: string;
  /** Zero based. */
  level: number | null;
  side: ShelfSide | null;
  /** The place as text, as shelf_stock holds it. */
  place: string;
  /** How much of product.qty stands here. */
  qty: number;
  state: StockState;
  /** qty × price, null without a price. */
  value: number | null;
}

/** Neighbouring places of one product on one rack, which read and draw as one: two halves of a shelf, or shelves one above the other. */
export interface ShelfBlock {
  key: string;
  product: Product;
  objectId: string;
  /** The bottom level, or null on a floor area or where no shelf is known. */
  level: number | null;
  /** The top level. */
  through: number | null;
  side: ShelfSide | null;
  qty: number;
  state: StockState;
  items: MapItem[];
}

export interface ObjectStock {
  object: MapObject;
  /** Oldest product first, the order stock fills a rack. */
  items: MapItem[];
  blocks: ShelfBlock[];
  /** How many products stand here. */
  products: number;
  /** Sum of known values. */
  value: number;
  /** Items with no price. */
  unpriced: number;
  worst: StockState;
}

/** What has no place on the map: the whole product, or the part of it no shelf holds. */
export interface TrayItem {
  product: Product;
  qty: number;
}

export interface MapModel {
  slots: StockSlot[];
  byObject: Map<string, ObjectStock>;
  tray: TrayItem[];
  placed: number;
  total: number;
}

const SEVERITY: Record<StockState, number> = { ok: 0, low: 1, out: 2, short: 3 };

/** Each piece is drawn, and past this nobody counts them by eye: a million loose screws must not stop the page. Per product, however many shelves it takes. */
const MOST_PIECES = 2000;

/** Whole pieces, so the shelf can be counted against the ledger. A part piece still stands there. */
function piecesOf(qty: number, perPiece: number): number {
  return qty <= 0 ? 0 : Math.max(Math.ceil(qty / perPiece - 1e-6), 1);
}

/** Shares the limit out over a product's piles, so each still shows. */
function limited(slots: readonly StockSlot[]): StockSlot[] {
  const drawn = slots.reduce((sum, slot) => sum + slot.count, 0);
  if (drawn <= MOST_PIECES) return [...slots];
  return slots.map((slot) => ({ ...slot, count: Math.max(Math.floor((slot.count * MOST_PIECES) / drawn), 1) }));
}

/**
 * Oldest first and by plain code order: the store's array changes order between a reload and a live
 * update, and a new product must not shift what already stands on a rack.
 */
function byAge(a: Product, b: Product): number {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const round = (qty: number) => Math.round(qty * 1000) / 1000;

interface Standing {
  place: Place;
  qty: number;
}

export interface ModelOptions {
  /** A date on screen: the shelves of today, shared out over that day's total. */
  dated?: boolean;
}

/** Where a product's quantity stands. The rows are capped by the total, and with no rows products.location speaks for all of it. */
function standingOf(product: Product, rows: readonly ShelfRow[] | undefined, objects: readonly MapObject[], dated: boolean): Standing[] {
  const listed = (rows ?? []).flatMap(({ place, qty }) => {
    const resolved = resolvePlace(place, objects);
    return resolved ? [{ place: resolved, qty }] : [];
  });
  if (listed.length === 0) {
    const home = resolvePlace(product.location, objects);
    return home ? [{ place: home, qty: Math.max(product.qty, 0) }] : [];
  }
  const sum = listed.reduce((total, row) => total + row.qty, 0);
  const share = dated && sum > 0 ? product.qty / sum : 1;
  // The newest first, so a total ahead of the rows cuts the oldest shelf, as the database is about to.
  let left = Math.max(product.qty, 0);
  return [...listed].reverse().flatMap(({ place, qty }) => {
    const here = round(Math.min(qty * share, left));
    left -= here;
    return here > 0 ? [{ place, qty: here }] : [];
  }).reverse();
}

/** Two places that touch: side by side on a shelf. */
const halves = (a: MapItem, b: MapItem) => a.level === b.level && a.side !== null && b.side !== null && a.side !== b.side;

/** Merges a product's places on one object: the halves of a shelf first, then the same span on neighbouring shelves. */
function blocksOf(items: readonly MapItem[]): ShelfBlock[] {
  const rows: MapItem[][] = [];
  for (const item of items) {
    const row = rows.find((list) => list.length === 1 && item.level !== null && halves(list[0], item));
    if (row) row.push(item);
    else rows.push([item]);
  }
  const spanOf = (row: readonly MapItem[]) => (row.length === 2 ? null : row[0].side);
  rows.sort((a, b) => (a[0].level ?? -1) - (b[0].level ?? -1));

  const blocks: ShelfBlock[] = [];
  for (const row of rows) {
    const [first] = row;
    const side = spanOf(row);
    const qty = round(row.reduce((sum, item) => sum + item.qty, 0));
    const above = blocks.find((b) => first.level !== null && b.product.id === first.product.id && b.through === first.level - 1 && b.side === side);
    if (above) {
      above.through = first.level;
      above.qty = round(above.qty + qty);
      above.items.push(...row);
      continue;
    }
    blocks.push({ key: `${first.product.id}@${first.place}`, product: first.product, objectId: first.objectId, level: first.level, through: first.level, side, qty, state: first.state, items: [...row] });
  }
  return blocks;
}

/** One slot per drawn pile: two halves of one product stand as one pile across the shelf, with no gap between them. */
function slotsOf(block: ShelfBlock): StockSlot[] {
  const { form, finish, perPiece } = formOf(block.product);
  const byLevel = new Map<number | null, MapItem[]>();
  for (const item of block.items) byLevel.set(item.level, [...(byLevel.get(item.level) ?? []), item]);
  return [...byLevel.values()].map((items) => {
    const [first] = items;
    const qty = items.reduce((sum, item) => sum + item.qty, 0);
    const side = items.length === 2 ? null : first.side;
    return { key: `${first.product.id}@${formatPlace(first.objectId, first.level, side)}`, objectId: first.objectId, level: first.level, side, form, finish, count: piecesOf(qty, perPiece) };
  });
}

function readable(product: Product): boolean {
  try {
    return Number.isFinite(available(product)) && Boolean(formOf(product));
  } catch {
    return false;
  }
}

/** `rows` come from useShelves: null until they are read, and then products.location decides, as it did before shelves had stock. */
export function buildMapModel(products: readonly Product[], objects: readonly MapObject[], rows: readonly ShelfRow[] | null = null, options: ModelOptions = {}): MapModel {
  const byObject = new Map<string, ObjectStock>();
  for (const object of objects) byObject.set(object.id, { object, items: [], blocks: [], products: 0, value: 0, unpriced: 0, worst: "ok" });

  const rowsOf = new Map<string, ShelfRow[]>();
  for (const row of rows ?? []) rowsOf.set(row.product_id, [...(rowsOf.get(row.product_id) ?? []), row]);

  const slots: StockSlot[] = [];
  const tray: TrayItem[] = [];
  for (const product of [...products].sort(byAge)) {
    const fine = readable(product);
    const standing = fine ? standingOf(product, rowsOf.get(product.id), objects, options.dated === true) : [];
    const state = fine ? stockState(product) : "ok";

    const here = new Map<string, MapItem[]>();
    const piles: StockSlot[] = [];
    let placed = 0;
    for (const { place, qty } of standing) {
      if (!byObject.has(place.objectId)) continue;
      placed += qty;
      const item: MapItem = { product, ...place, place: formatPlace(place.objectId, place.level, place.side), qty, state, value: valueOf({ qty, price: product.price }) };
      here.set(place.objectId, [...(here.get(place.objectId) ?? []), item]);
    }

    for (const [objectId, items] of here) {
      const stock = byObject.get(objectId);
      if (!stock) continue;
      const blocks = blocksOf(items);
      stock.items.push(...items);
      stock.blocks.push(...blocks);
      stock.products += 1;
      piles.push(...blocks.flatMap(slotsOf));
      const value = valueOf({ qty: items.reduce((sum, item) => sum + item.qty, 0), price: product.price });
      if (value === null) stock.unpriced += 1;
      else stock.value += value;
      if (SEVERITY[state] > SEVERITY[stock.worst]) stock.worst = state;
    }

    slots.push(...limited(piles));

    const waiting = round(Math.max(product.qty, 0) - placed);
    if (waiting > 0 || here.size === 0) tray.push({ product, qty: Math.max(waiting, 0) });
  }
  return { slots, byObject, tray, placed: products.length - tray.filter((item) => item.qty === item.product.qty).length, total: products.length };
}

/** The block a click or a link landed on. */
export function blockAt(model: MapModel, hit: PickHit): ShelfBlock | null {
  const blocks = model.byObject.get(hit.objectId)?.blocks ?? [];
  const level = hit.level;
  if (level === null) return null;
  return (
    blocks.find((block) => {
      if (block.level === null || level < block.level || level > (block.through ?? block.level)) return false;
      return block.side === null || !hit.side || block.side === hit.side;
    }) ?? null
  );
}

/** An empty shelf reads whole until one of its halves is taken: a click on it marks the line the ledger shows. */
export function emptySpot(hit: PickHit, object: MapObject, model: MapModel): PickHit {
  if (hit.level === null) return hit;
  const lines = shelfLines(object, model.byObject.get(object.id)?.blocks ?? []).filter((line) => line.level === hit.level && line.blocks.length === 0);
  return lines.some((line) => line.side === hit.side) ? hit : { ...hit, side: lines[0]?.side ?? null };
}

/** A name without its bracket, which says what the shelf already shows. */
export function shortName(name: string): string {
  return fmtName(name.replace(/\s*\(.*?\)\s*/g, " ").trim());
}

/** A rack's shelves from the top down, with what stands on each half: the ledger of one rack and the worker's picker read the same. */
export interface ShelfLine {
  level: number;
  side: ShelfSide | null;
  blocks: ShelfBlock[];
}

/** Does a piece of this shape fit on half a shelf of this rack? A 6 m bar doesn't, so it is only offered the whole shelf. */
export function fitsHalf(product: Pick<Product, "name" | "category" | "unit">, object: MapObject): boolean {
  const { form } = formOf(product);
  const half = object.w / 2;
  if (form.form === "bar") return form.length <= half;
  if (form.form === "sheet") return Math.min(form.width, form.length) <= half && Math.max(form.width, form.length) <= object.d + half;
  return true;
}

/** Top shelf first, as the rack stands. A half with nothing on it gets its own empty line, so it can be picked. */
export function shelfLines(object: MapObject, blocks: readonly ShelfBlock[]): ShelfLine[] {
  const lines: ShelfLine[] = [];
  const covers = (block: ShelfBlock, level: number, side: ShelfSide | null) =>
    block.level !== null && level >= block.level && level <= (block.through ?? block.level) && (block.side === null || side === null || block.side === side);

  for (let level = levelsOf(object) - 1; level >= 0; level--) {
    const on = blocks.filter((block) => covers(block, level, null));
    const shown = on.filter((block) => block.through === level);
    const halved = on.some((block) => block.side !== null);
    if (!halved) {
      if (on.length === 0) lines.push({ level, side: null, blocks: [] });
      else if (shown.length > 0) lines.push({ level, side: null, blocks: shown });
      continue;
    }
    for (const side of ["right", "left"] as const) {
      const at = on.filter((block) => covers(block, level, side));
      const top = at.filter((block) => block.through === level);
      if (at.length === 0) lines.push({ level, side, blocks: [] });
      else if (top.length > 0) lines.push({ level, side, blocks: top });
    }
  }
  return lines;
}
