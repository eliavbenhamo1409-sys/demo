/**
 * What a row on the door points at on the model. The rail's rows are the shared ones and carry no data, so a row is read
 * from what it shows, or from its place in a list this page holds too. A row that can't be read just points at nothing.
 */

import { fmtName } from "@/lib/format";
import { DISPATCH_ZONE, RECEIVING_ZONE, shelfAnchor } from "@/lib/map3d/layout";
import { blockAt, shelfLines, type MapItem, type MapModel, type ShelfBlock } from "@/lib/map3d/model";
import { blockSpot, type Spot } from "@/lib/map3d/piles";
import { resolvePlace } from "@/lib/map3d/place";
import { routeBetween } from "@/lib/map3d/route";
import type { MapObject, MapRoute, PickHit } from "@/lib/map3d/types";
import type { Movement, Order, OrderLine, Product } from "@/lib/store";

export const ROW = ".m3d-line, .m3d-shelf, .m3d-row";

export interface Aim {
  /** The places that stay lit. */
  ids: readonly string[];
  /** Where the line goes and what the rule marks. Null: several places, so no one line. */
  hit: PickHit | null;
  /** The pile it means, because a shelf can hold several. */
  block?: ShelfBlock;
  /** The way a movement really took across the floor. */
  route?: MapRoute;
}

export interface LensData {
  objects: readonly MapObject[];
  model: MapModel;
  /** The object the rail is turned to. */
  open: MapObject | null;
  products: readonly Product[];
  moves: readonly Movement[];
  orders: readonly Order[];
  linesOf: (orderId: string) => readonly OrderLine[];
  placeOf: (productId: string) => string | null;
  itemsOf: (productId: string) => readonly MapItem[];
}

const textOf = (row: Element, selector: string) => row.querySelector(selector)?.textContent ?? null;

const indexIn = (row: Element, rows: Iterable<Element>) => [...rows].indexOf(row);

export function objectAim(objectId: string): Aim {
  return { ids: [objectId], hit: { objectId, level: null } };
}

const blockHit = (block: ShelfBlock): PickHit => ({ objectId: block.objectId, level: block.level, side: block.side, through: block.through ?? undefined });

export function productAim(productId: string, itemsOf: LensData["itemsOf"], model: MapModel): Aim | null {
  const items = itemsOf(productId);
  const first = items[0];
  if (!first) return null;
  const ids = [...new Set(items.map((item) => item.objectId))];
  const block = model.byObject.get(first.objectId)?.blocks.find((candidate) => candidate.items.includes(first));
  return { ids, hit: block ? blockHit(block) : { objectId: first.objectId, level: first.level, side: first.side }, block };
}

/** The rows of a rack's ledger, in the order the card draws them. */
function shelfAims(object: MapObject, model: MapModel): Aim[] {
  const blocks = model.byObject.get(object.id)?.blocks ?? [];
  const lines = object.kind === "rack" ? shelfLines(object, blocks) : [];
  const ofBlock = (block: ShelfBlock): Aim => ({ ids: [object.id], hit: blockHit(block), block });
  return [
    ...lines.flatMap((line) => (line.blocks.length === 0 ? [{ ids: [object.id], hit: { objectId: object.id, level: line.level, side: line.side } }] : line.blocks.map(ofBlock))),
    ...blocks.filter((block) => block.level === null).map(ofBlock),
  ];
}

/** Does a row of the rack's ledger cover the shelf the pointer is on? */
function covers(row: PickHit, shelf: PickHit): boolean {
  if (row.level === null || shelf.level === null) return false;
  const inside = shelf.level >= row.level && shelf.level <= (row.through ?? row.level);
  return inside && (!row.side || !shelf.side || row.side === shelf.side);
}

/** The rows on the door that speak of what the pointer is on in the model. */
export function litRows(rail: Element, hover: PickHit, open: MapObject | null, model: MapModel): Element[] {
  if (open) {
    const aims = shelfAims(open, model);
    return [...rail.querySelectorAll(".m3d-shelf")].filter((_, i) => {
      const hit = aims[i]?.hit;
      return hit && covers(hit, hover);
    });
  }
  return [...rail.querySelectorAll(".m3d-line")].filter((row) => textOf(row, ".m3d-line-place .ltr") === hover.objectId);
}

function moveAim(m: Movement, data: LensData): Aim | null {
  const shelf = resolvePlace(m.place, data.objects);
  const place = shelf?.objectId ?? data.placeOf(m.product_id);
  if (!place) return null;
  const points = m.type === "in" ? routeBetween(data.objects, RECEIVING_ZONE, place) : m.type === "out" ? routeBetween(data.objects, place, DISPATCH_ZONE) : [];
  return { ids: [place], hit: shelf ?? { objectId: place, level: null }, route: points.length > 1 ? { points, tone: m.type === "in" ? "in" : "out" } : undefined };
}

function orderAim(order: Order, data: LensData): Aim | null {
  const ids = data.linesOf(order.id).flatMap((line) => data.itemsOf(line.product_id).map((item) => item.objectId));
  return ids.length > 0 ? { ids: [...new Set(ids), DISPATCH_ZONE], hit: null } : null;
}

/** A ledger line names its product and its place, and the two together are one product. */
function lineAim(row: Element, data: LensData): Aim | null {
  const place = textOf(row, ".m3d-line-place .ltr");
  if (!place) return null;
  if (row.closest(".is-value")) return objectAim(place);
  const name = textOf(row, ".m3d-line-name");
  const product = data.products.find((p) => fmtName(p.name) === name && data.placeOf(p.id) === place);
  return product ? productAim(product.id, data.itemsOf, data.model) : objectAim(place);
}

function listAim(row: Element, data: LensData): Aim | null {
  if (row.closest(".m3d-all")) {
    const code = textOf(row, ".sa-mono");
    return code ? objectAim(code) : null;
  }
  const order = row.closest(".m3d-order");
  if (order) {
    const entry = data.orders[indexIn(order, order.parentElement?.children ?? [])];
    if (!entry) return null;
    if (row.parentElement === order) return orderAim(entry, data);
    const line = data.linesOf(entry.id)[indexIn(row, row.parentElement?.children ?? [])];
    return line ? productAim(line.product_id, data.itemsOf, data.model) : null;
  }
  // The moves are the rail's only list that stands directly on it.
  if (!row.parentElement?.parentElement?.matches(".m3d-rail")) return null;
  const move = data.moves[indexIn(row, row.parentElement.children)];
  return move ? moveAim(move, data) : null;
}

export function aimOf(row: Element, data: LensData): Aim | null {
  if (row.matches(".m3d-shelf")) {
    const rows = row.closest(".m3d-shelves")?.querySelectorAll(".m3d-shelf") ?? [];
    return data.open ? (shelfAims(data.open, data.model)[indexIn(row, rows)] ?? null) : null;
  }
  return row.matches(".m3d-line") ? lineAim(row, data) : listAim(row, data);
}

/** The point on the model a line ends at. */
export function pointOf(hit: PickHit, objects: readonly MapObject[], model?: MapModel): Spot | null {
  const object = objects.find((o) => o.id === hit.objectId);
  if (!object) return null;
  if (hit.level !== null && object.kind === "rack") {
    // The stock itself, where its tag stands. An empty shelf is reached at its near end, where the line crosses no tag.
    const block = model ? blockAt(model, hit) : null;
    const spot = block && model ? blockSpot(model, object, block) : null;
    return spot ?? { ...shelfAnchor(object, hit.level, hit.side ?? null, hit.through ?? hit.level), x: hit.side === "left" ? object.x : object.x + object.w / 2 };
  }
  return { x: object.x, y: object.kind === "zone" ? 0 : object.h, z: object.z };
}
