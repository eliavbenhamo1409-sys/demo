/**
 * Where each drawn pile stands, read from the same packing the engine draws, so a tag can stand on the stock itself
 * and not on the front of its shelf. Three-free: packing.ts is pure geometry.
 */

import { packObject } from "./engine/packing";
import type { MapModel, ShelfBlock } from "./model";
import type { MapObject, SceneFace, ScenePoint } from "./types";

/** The box a pile fills, in metres. */
export interface PileBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  /** Drawn units in it. */
  pieces: number;
}

type Box = Omit<PileBox, "pieces">;

/** Where a tag stands on a block's stock: the middle of its front face, or of whichever free face the camera comes to look at. */
export interface Spot extends ScenePoint {
  faces?: readonly SceneFace[];
}

/** Two piles closer than this stand against each other, so the faces between them are hidden: the gap between halves is 0.16. */
const AGAINST = 0.35;

const boxes = new WeakMap<MapModel, WeakMap<MapObject, Map<string, PileBox>>>();

function union(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1) };
}

/** The boxes of one object's piles by slot key, packed once per model. */
function pilesOf(model: MapModel, object: MapObject): Map<string, PileBox> {
  let perObject = boxes.get(model);
  if (!perObject) boxes.set(model, (perObject = new WeakMap()));
  const known = perObject.get(object);
  if (known) return known;
  const packed = packObject(object, model.slots.filter((slot) => slot.objectId === object.id));
  const piles = new Map<string, PileBox>();
  for (const [key, units] of packed.units) {
    let box: Box | null = null;
    for (const unit of units) {
      for (const { x, y, z, sx, sy, sz } of unit) {
        const piece = { x0: x - sx / 2, x1: x + sx / 2, y0: y, y1: y + sy, z0: z - sz / 2, z1: z + sz / 2 };
        box = box ? union(box, piece) : piece;
      }
    }
    if (box) piles.set(key, { ...box, pieces: units.length });
  }
  perObject.set(object, piles);
  return piles;
}

/** The piles of one block, one per shelf it spans: a product has one pile per level of a rack. */
function pilesOfBlock(model: MapModel, object: MapObject, block: ShelfBlock): { mine: PileBox[]; others: PileBox[] } {
  const piles = pilesOf(model, object);
  const prefix = `${block.product.id}@`;
  const keys = new Set<string>();
  for (const slot of model.slots) {
    if (slot.objectId !== object.id || slot.level === null || block.level === null || !slot.key.startsWith(prefix)) continue;
    if (slot.level >= block.level && slot.level <= (block.through ?? block.level)) keys.add(slot.key);
  }
  const mine: PileBox[] = [];
  const others: PileBox[] = [];
  for (const [key, box] of piles) (keys.has(key) ? mine : others).push(box);
  return { mine, others };
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/** Does another pile stand against this face, within reach of its whole extent? */
function covered(box: PileBox, other: PileBox, dx: number, dz: number): boolean {
  if (!overlaps(box.y0, box.y1, other.y0, other.y1)) return false;
  if (dx !== 0) {
    const edge = dx > 0 ? box.x1 : box.x0;
    const near = dx > 0 ? other.x0 : other.x1;
    return Math.abs(near - edge) < AGAINST && (dx > 0 ? other.x1 > edge : other.x0 < edge) && overlaps(box.z0, box.z1, other.z0, other.z1);
  }
  const edge = dz > 0 ? box.z1 : box.z0;
  const near = dz > 0 ? other.z0 : other.z1;
  return Math.abs(near - edge) < AGAINST && (dz > 0 ? other.z1 > edge : other.z0 < edge) && overlaps(box.x0, box.x1, other.x0, other.x1);
}

/**
 * The middle of each face of a pile that no other pile stands against, the front first: the stock of a lane shows its
 * long side only at the front or the back of the shelf, and a half shows one end.
 */
function freeFaces(box: PileBox, others: readonly PileBox[]): SceneFace[] {
  const y = (box.y0 + box.y1) / 2;
  const xm = (box.x0 + box.x1) / 2;
  const zm = (box.z0 + box.z1) / 2;
  const faces: SceneFace[] = [
    { x: xm, y, z: box.z1, nx: 0, ny: 0, nz: 1 },
    { x: box.x1, y, z: zm, nx: 1, ny: 0, nz: 0 },
    { x: box.x0, y, z: zm, nx: -1, ny: 0, nz: 0 },
    { x: xm, y, z: box.z0, nx: 0, ny: 0, nz: -1 },
  ];
  const free = faces.filter((face) => !others.some((other) => covered(box, other, face.nx, face.nz)));
  return free.length > 0 ? free : faces.slice(1, 3);
}

/** Where a block's tag stands: on its stock, at the middle of the free face the camera comes to face. Null when nothing of it is drawn. */
export function blockSpot(model: MapModel, object: MapObject, block: ShelfBlock): Spot | null {
  const { mine, others } = pilesOfBlock(model, object, block);
  if (mine.length === 0) return null;
  // A block on several shelves is tagged on its fullest pile, and on the lower of two alike, not on the deck between them.
  const box = mine.reduce((best, pile) => (pile.pieces > best.pieces || (pile.pieces === best.pieces && pile.y0 < best.y0) ? pile : best));
  const faces = freeFaces(box, [...others, ...mine.filter((pile) => pile !== box)]);
  const { x, y, z } = faces[0];
  return faces.length > 1 ? { x, y, z, faces } : { x, y, z };
}
