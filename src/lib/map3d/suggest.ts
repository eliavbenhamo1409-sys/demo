/**
 * Where a receipt probably goes, so the usual place is one tap. Worked out from what the warehouse already did, and
 * always the worker's choice: nothing here lands in the data until they press it.
 */

import type { Product } from "@/lib/store";
import { resolvePlace } from "./place";
import type { ShelfRow, UsualPlace } from "./shelves";
import type { MapObject } from "./types";

export type PlaceWhy = "always" | "last" | "here" | "home";

export interface PlaceSuggestion {
  place: string;
  why: PlaceWhy;
  /** A rack with no shelf named: it opens that rack rather than filling the answer. */
  rackOnly: boolean;
}

export const WHY_WORD: Record<PlaceWhy, string> = {
  always: "תמיד כאן",
  last: "בקליטה הקודמת",
  here: "נמצא כאן עכשיו",
  home: "המיקום הקבוע",
};

/** Two receipts make a habit, and four of five still count as always. */
const HABIT_TIMES = 2;
const HABIT_SHARE = 0.8;
const MOST = 3;

export function suggestPlaces(product: Pick<Product, "id" | "location">, rows: readonly ShelfRow[], usual: readonly UsualPlace[], objects: readonly MapObject[]): PlaceSuggestion[] {
  const found: PlaceSuggestion[] = [];
  const add = (place: string | null, why: PlaceWhy) => {
    const resolved = resolvePlace(place, objects);
    if (!place || !resolved || found.some((known) => known.place === place)) return;
    const object = objects.find((o) => o.id === resolved.objectId);
    found.push({ place, why, rackOnly: object?.kind === "rack" && resolved.level === null });
  };

  const receipts = usual.filter((row) => row.product_id === product.id);
  const total = receipts.reduce((sum, row) => sum + row.times, 0);
  const byHabit = [...receipts].sort((a, b) => b.times - a.times || Date.parse(b.last_at) - Date.parse(a.last_at));
  for (const row of byHabit) add(row.place, row.times >= HABIT_TIMES && row.times / total >= HABIT_SHARE ? "always" : "last");

  const standing = rows.filter((row) => row.product_id === product.id).sort((a, b) => b.qty - a.qty);
  for (const row of standing) add(row.place, "here");

  add(product.location, "home");

  // A habit is the answer, not one of a list. A rack with no shelf adds nothing beside a shelf on that rack.
  if (found[0]?.why === "always") return found.slice(0, 1);
  const named = found.filter((suggestion) => !suggestion.rackOnly);
  const known = new Set(named.map((suggestion) => resolvePlace(suggestion.place, objects)?.objectId));
  return found.filter((suggestion) => !suggestion.rackOnly || !known.has(resolvePlace(suggestion.place, objects)?.objectId)).slice(0, MOST);
}
