/**
 * The floor and what stands on it. Geometry only: no stock, no status, nothing a ledger would own.
 * All lengths are metres, as in types.ts.
 */

import { placeKey, RACK_LEVELS } from "./place";
import type { MachineModel, MapObject, MapObjectKind, MapPoint, ShelfSide } from "./types";

export { RACK_LEVELS };

/** The line of the walls: an L of about 4,800 m². */
export const FOOTPRINT: readonly MapPoint[] = [
  [0, 0],
  [100, 0],
  [100, 26],
  [64, 26],
  [64, 60],
  [0, 60],
];

/** Where goods come in and where orders go out, as a real movement's line draws them. */
export const RECEIVING_ZONE = "Z-01";
export const DISPATCH_ZONE = "Z-02";

/** Every object stays this far from a wall. */
const WALL_GAP = 0.5;
const TOUCH = 1e-6;
/** Height of the bottom deck, and what the top of a rack keeps above the decks. */
const BOTTOM_DECK = 0.2;
const RACK_HEAD = 0.6;

const RACK_SIZE = { w: 6.4, d: 3.4, h: 5.4 };

/** Six aisles of five racks. F belongs to the floor areas, so the aisles skip it. */
const AISLES = ["A", "B", "C", "D", "E", "G"];
const RACK_ROWS = [10, 23, 33, 43, 53];

export const DEFAULT_OBJECTS: readonly MapObject[] = [
  ...AISLES.flatMap((aisle, i) =>
    RACK_ROWS.map((z, j): MapObject => {
      const id = `${aisle}-${j + 1}`;
      return { id, kind: "rack", name: `מתקן ${id}`, x: 8 + i * 9, z, ...RACK_SIZE, levels: RACK_LEVELS };
    }),
  ),
  { id: "M-01", kind: "machine", model: "saw", name: "מסור דו־ראשי לפרופילים", note: "חיתוך פרופילים לפי מידה", x: 72, z: 7, w: 6, d: 4, h: 2.3 },
  { id: "M-02", kind: "machine", model: "cnc", name: "מרכז עיבוד CNC", note: "קידוח וכרסום פרופילים ולוחות", x: 83, z: 7, w: 6, d: 4, h: 2.6 },
  { id: "M-03", kind: "machine", model: "press", name: "מכבש כיפוף לוחות", note: "כיפוף לוחות", x: 93, z: 7, w: 5, d: 2, h: 2.4 },
  { id: "M-04", kind: "machine", model: "saw", name: "מסור חיתוך ללוחות", note: "חיתוך לוחות ופלטות לפי מידה", x: 72, z: 19, w: 6, d: 4, h: 2.3 },
  { id: "M-05", kind: "machine", model: "cnc", name: "לייזר סיבים 6 קילוואט", note: "חיתוך לוחות עד 20 מ״מ", x: 83, z: 19, w: 6, d: 4, h: 2.6 },
  { id: "M-06", kind: "machine", model: "press", name: "גיליוטינה 3 מטר", note: "גזירת לוחות עד 6 מ״מ", x: 93, z: 19, w: 5, d: 2, h: 2.4 },
  { id: "F-01", kind: "floor", name: "אחסון רצפה F-01", x: 8, z: 16.5, w: 6, d: 3, h: 1.1 },
  { id: "F-02", kind: "floor", name: "אחסון רצפה F-02", x: 21, z: 16.5, w: 7, d: 2.7, h: 1.1 },
  { id: "F-03", kind: "floor", name: "אחסון רצפה F-03", x: 51, z: 3, w: 7, d: 2.6, h: 0.9 },
  { id: "F-04", kind: "floor", name: "גלילי אלומיניום F-04", x: 35, z: 16.5, w: 8, d: 3.4, h: 1.4 },
  { id: "F-05", kind: "floor", name: "גלילים צבועים F-05", x: 48, z: 16.5, w: 6, d: 3.4, h: 1.4 },
  { id: RECEIVING_ZONE, kind: "zone", name: "קליטת סחורה", x: 8, z: 3, w: 11, d: 4, h: 0.2 },
  { id: DISPATCH_ZONE, kind: "zone", name: "הזמנות פתוחות", x: 23, z: 3, w: 11, d: 4, h: 0.2 },
  { id: "Z-03", kind: "zone", name: "אריזה ומשלוח", x: 38, z: 3, w: 11, d: 4, h: 0.2 },
];

/** Height of a rack's deck. Level is zero based, 0 is the bottom. */
export function levelY(object: MapObject, level: number): number {
  const levels = object.levels ?? RACK_LEVELS;
  return BOTTOM_DECK + (level * (object.h - BOTTOM_DECK - RACK_HEAD)) / levels;
}

/** Centre of a half of a rack along x. Right is +x, the viewer's right from the aisle. */
export function sideX(object: MapObject, side: ShelfSide | null): number {
  return side === null ? object.x : object.x + ((side === "right" ? 1 : -1) * object.w) / 4;
}

/** The point on the front of a shelf where its figure stands. `through`: the top level of a block of shelves. */
export function shelfAnchor(object: MapObject, level: number, side: ShelfSide | null, through = level): { x: number; y: number; z: number } {
  const levels = object.levels ?? RACK_LEVELS;
  const top = through + 1 < levels ? levelY(object, through + 1) : object.h - RACK_HEAD;
  return { x: sideX(object, side), y: (levelY(object, level) + top) / 2, z: object.z + object.d / 2 };
}

function pointInside(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = FOOTPRINT.length - 1; i < FOOTPRINT.length; j = i++) {
    const [xi, zi] = FOOTPRINT[i];
    const [xj, zj] = FOOTPRINT[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Is a point on the floor, or with a size, a whole rectangle centred on it. A rectangle may touch a wall. */
export function insideFootprint(x: number, z: number, w = 0, d = 0): boolean {
  const left = x - w / 2 + TOUCH;
  const right = x + w / 2 - TOUCH;
  const near = z - d / 2 + TOUCH;
  const far = z + d / 2 - TOUCH;
  const corners: readonly MapPoint[] = [
    [left, near],
    [right, near],
    [right, far],
    [left, far],
  ];
  if (!corners.every(([cx, cz]) => pointInside(cx, cz))) return false;
  return !FOOTPRINT.some(([cx, cz]) => cx > left && cx < right && cz > near && cz < far);
}

const KINDS: readonly MapObjectKind[] = ["rack", "floor", "machine", "zone"];
const MODELS: readonly MachineModel[] = ["saw", "cnc", "press", "generic"];
const MIN_SIDE = 1;
const MIN_HEIGHT = 0.2;
const MAX_HEIGHT = 7;
const MIN_RACK_HEIGHT = 3;
const MAX_LEVELS = 8;

function oneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.includes(value as T);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLength(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLevelCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_LEVELS;
}

/** A clean copy of one object, or null. A `/` in a code would read as a level, so it's refused. */
function parseObject(raw: unknown): MapObject | null {
  if (!isRecord(raw)) return null;
  const { id, kind, name, x, z, w, d, h, levels, model, note } = raw;
  if (!text(id, 16) || id.includes("/") || !placeKey(id) || !text(name, 100) || !oneOf(KINDS, kind)) return null;
  if (!isLength(x) || !isLength(z) || !isLength(w) || !isLength(d) || !isLength(h)) return null;
  if (w < MIN_SIDE || d < MIN_SIDE || h < MIN_HEIGHT || h > MAX_HEIGHT) return null;
  if (!insideFootprint(x, z, w + 2 * WALL_GAP, d + 2 * WALL_GAP)) return null;

  const object: MapObject = { id, kind, name, x, z, w, d, h };
  if (note !== undefined) {
    if (!text(note, 200)) return null;
    object.note = note;
  }
  if (kind === "rack") {
    if (h < MIN_RACK_HEIGHT) return null;
    if (levels !== undefined) {
      if (!isLevelCount(levels)) return null;
      object.levels = levels;
    }
  }
  if (kind === "machine" && model !== undefined) {
    if (!oneOf(MODELS, model)) return null;
    object.model = model;
  }
  return object;
}

/** A clean list, or null when anything is off: a list with one bad object is a bad list, never a partial floor. */
export function validateObjects(raw: unknown): MapObject[] | null {
  if (!Array.isArray(raw)) return null;
  const objects: MapObject[] = [];
  const keys = new Set<string>();
  for (const item of raw) {
    const object = parseObject(item);
    if (!object) return null;
    const key = placeKey(object.id);
    if (keys.has(key)) return null;
    keys.add(key);
    objects.push(object);
  }
  return objects;
}
