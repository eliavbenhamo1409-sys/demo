/**
 * Reads products.location against the codes of the layout on screen, so any warehouse's codes work.
 * The text counts levels from 1 and the map from 0; resolvePlace and formatPlace are the only converters.
 */

import type { MapObject } from "./types";

/** Levels of a rack that doesn't say how many. */
export const RACK_LEVELS = 4;

export interface Place {
  objectId: string;
  /** Zero based. Null: the text names no level, or one the rack doesn't have. */
  level: number | null;
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

function levelsOf(object: MapObject): number {
  return object.kind === "rack" ? (object.levels ?? RACK_LEVELS) : 0;
}

/** Null sends the product to the tray: empty text, a list of places, a machine, or a code the layout doesn't have. */
export function resolvePlace(location: string | null | undefined, objects: readonly MapObject[]): Place | null {
  if (typeof location !== "string") return null;
  const match = /^(.+?)(?:\/(\d+))?$/.exec(placeKey(location));
  if (!match) return null;
  const places = stockPlaces(objects);
  const object = places.get(match[1]) ?? places.get(swapped(match[1]));
  if (!object) return null;
  const wanted = match[2] === undefined ? 0 : Number(match[2]);
  return { objectId: object.id, level: wanted >= 1 && wanted <= levelsOf(object) ? wanted - 1 : null };
}

/** The text form of a place, as products.location holds it. */
export function formatPlace(objectId: string, level: number | null): string {
  return level === null ? objectId : `${objectId}/${level + 1}`;
}
