/**
 * Reads a place against the codes of the layout on screen, so any warehouse's codes work.
 * A place is text: A-1 a rack, A-1/2 its second shelf, A-1/2R and A-1/2L that shelf's halves as seen from the aisle.
 * The text counts levels from 1 and the map from 0; resolvePlace and formatPlace are the only converters.
 */

import type { MapObject, ShelfSide } from "./types";

/** Levels of a rack that doesn't say how many. */
export const RACK_LEVELS = 4;

export interface Place {
  objectId: string;
  /** Zero based. Null: the text names no level, or one the rack doesn't have. */
  level: number | null;
  /** Null: the whole shelf. */
  side: ShelfSide | null;
}

/** Spaces, hyphens of any kind (maqaf included), underscores, dots, and bidi and other invisible marks. */
const NOISE = /[\s\p{Pd}\p{Cf}\u2212_.]/gu;

/** The form two spellings of one code have in common. */
export function placeKey(text: string): string {
  return text.normalize("NFKC").toUpperCase().replace(NOISE, "");
}

const indexes = new WeakMap<readonly MapObject[], Map<string, MapObject>>();

/** Racks and floor areas by key. Machines and zones hold no stock, so nothing resolves to them. */
function stockPlaces(objects: readonly MapObject[]): Map<string, MapObject> {
  const cached = indexes.get(objects);
  if (cached) return cached;
  const index = new Map<string, MapObject>();
  for (const object of objects) {
    if (object.kind !== "rack" && object.kind !== "floor") continue;
    const key = placeKey(object.id);
    if (!index.has(key)) index.set(key, object);
  }
  indexes.set(objects, index);
  return index;
}

/** A code typed the other way round: 2B for B2. */
function swapped(key: string): string {
  const parts = /^(\d+)(\p{L}+)$|^(\p{L}+)(\d+)$/u.exec(key);
  if (!parts) return key;
  return parts[1] ? parts[2] + parts[1] : parts[4] + parts[3];
}

export function levelsOf(object: MapObject): number {
  return object.kind === "rack" ? (object.levels ?? RACK_LEVELS) : 0;
}

/** Null: empty text, a list of places, a machine, or a code the layout doesn't have. */
export function resolvePlace(location: string | null | undefined, objects: readonly MapObject[]): Place | null {
  if (typeof location !== "string") return null;
  const match = /^(.+?)(?:\/(\d+)([RL])?)?$/.exec(placeKey(location));
  if (!match) return null;
  const places = stockPlaces(objects);
  const object = places.get(match[1]) ?? places.get(swapped(match[1]));
  if (!object) return null;
  const wanted = match[2] === undefined ? 0 : Number(match[2]);
  const level = wanted >= 1 && wanted <= levelsOf(object) ? wanted - 1 : null;
  const side = level === null || match[3] === undefined ? null : match[3] === "R" ? "right" : "left";
  return { objectId: object.id, level, side };
}

/** The text form of a place, as shelf_stock, movements.place and products.location hold it. */
export function formatPlace(objectId: string, level: number | null, side: ShelfSide | null = null): string {
  if (level === null) return objectId;
  return `${objectId}/${level + 1}${side === "right" ? "R" : side === "left" ? "L" : ""}`;
}

export const SIDE_WORD: Record<ShelfSide, string> = { right: "ימין", left: "שמאל" };

/** A place as a person reads it: מדף 2 ימין. Null for a rack with no shelf named and for a floor area. */
export function shelfWords(level: number | null, side: ShelfSide | null, through = level): string | null {
  if (level === null) return null;
  const shelf = through !== null && through !== level ? `מדפים ${level + 1}–${through + 1}` : `מדף ${level + 1}`;
  return side ? `${shelf} ${SIDE_WORD[side]}` : shelf;
}

/** The place with its code, as a line of text: A-1 · מדף 2 ימין. An unknown code reads as it was written. */
export function placeWords(location: string, objects: readonly MapObject[]): string {
  const place = resolvePlace(location, objects);
  if (!place) return location;
  const shelf = shelfWords(place.level, place.side);
  return shelf ? `${place.objectId} · ${shelf}` : place.objectId;
}
