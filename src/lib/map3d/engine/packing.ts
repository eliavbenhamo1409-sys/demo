import { levelY, RACK_LEVELS } from "../layout";
import type { MapObject, ShelfSide, StockFinish, StockForm, StockSlot } from "../types";

/**
 * How stock stands in its place. Every piece is drawn, so a shelf can be counted against the ledger. Pieces are neat
 * and large so a shelf reads from across the building; a place that can't hold its count at that size draws all it
 * holds smaller. A unit's place depends only on its index, so what stays has not moved when the rest leaves.
 */

/** One instance. `part` names its geometry and look; x and z are the centre, y the base. */
export interface Placed {
  part: string;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

/** One drawn unit: usually one instance, two for a roll and its core or a canister and its cap. */
export type Unit = readonly Placed[];

export interface PackedObject {
  /** By slot key, in fill order, so the last in the list is the first to leave. */
  units: Map<string, Unit[]>;
  /** What the stock rests on. */
  fittings: Placed[];
}

interface Bay {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  clear: number;
}

/** The places one product has in one bay, by index. */
interface Pile {
  capacity: number;
  unit: (index: number) => Unit;
}

/** What one bay holds of one product. */
interface Take {
  key: string;
  bay: Bay;
  pile: Pile;
  count: number;
}

/** What a bay keeps free of its rack: the posts at the sides, the lip at the front, air under the next shelf. */
const SIDE_CLEARANCE = 0.3;
const DEPTH_CLEARANCE = 0.2;
const HALF_GAP = 0.16;
/** A lane is at least this share of an even split, so the smaller product keeps a place to stand. */
const LEAST_LANE = 3;
const SHELF_HEIGHT = 0.11;
const HEADROOM = 0.1;

const SKID_HEIGHT = 0.07;
const SKID_WIDTH = 0.16;
const SKID_SPREAD = 0.32;

const BAR_SIDE = 0.2;
const BAR_GAP_Z = 0.05;
const BAR_GAP_Y = 0.03;
const MAX_ASPECT = 1.5;

const SHEET_THICKNESS = 0.03;
const SHEET_PITCH = 0.045;

const ROLL_OD = 0.56;
const ROLL_WIDTH = 0.3;
const ROLL_GAP = 0.06;
const ROLL_LINE_GAP = 0.1;

const CANISTER = { w: 0.42, h: 0.58, d: 0.3, gap: 0.06 };
const CARTON = { w: 0.62, h: 0.36, d: 0.46, gap: 0.03 };

/** Steps down from the full size, so one piece more or less doesn't resize a whole rack. The last is about real size. */
const SCALE_STEP = 0.9;
const SMALLEST_SCALE = 0.15;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Indices of `count` places from the middle outward, so a part-filled row stands centred. */
function fromMiddle(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(a - (count - 1) / 2) - Math.abs(b - (count - 1) / 2) || b - a);
}

function bearers(bay: Bay, fittings: Placed[]): void {
  for (const side of [-1, 1]) {
    fittings.push({ part: "skid", x: bay.x + side * bay.w * SKID_SPREAD, y: bay.y, z: bay.z, sx: SKID_WIDTH, sy: SKID_HEIGHT, sz: bay.d });
  }
}

function barPile(form: Extract<StockForm, { form: "bar" }>, finish: StockFinish, bay: Bay, scale: number): Pile {
  const part = `bar:${form.section}:${finish}`;
  const sz = scale * BAR_SIDE * clamp(form.a / form.b, 1, MAX_ASPECT);
  const sy = scale * BAR_SIDE * clamp(form.b / form.a, 1, MAX_ASPECT);
  const [gapZ, gapY] = [scale * BAR_GAP_Z, scale * BAR_GAP_Y];
  const cols = Math.max(1, Math.floor((bay.d + gapZ) / (sz + gapZ)));
  const rows = Math.max(1, Math.floor((bay.clear - SKID_HEIGHT) / (sy + gapY)));
  const places = fromMiddle(cols);
  return {
    capacity: cols * rows,
    unit: (index) => {
      const z = bay.z + (places[index % cols] - (cols - 1) / 2) * (sz + gapZ);
      return [{ part, x: bay.x, y: bay.y + SKID_HEIGHT + Math.floor(index / cols) * (sy + gapY), z, sx: bay.w, sy, sz }];
    },
  };
}

function sheetPile(finish: StockFinish, bay: Bay, scale: number): Pile {
  const part = `sheet:${finish}`;
  const pitch = scale * SHEET_PITCH;
  return {
    capacity: Math.max(2, Math.floor((bay.clear - SKID_HEIGHT) / pitch)),
    unit: (index) => [{ part, x: bay.x, y: bay.y + SKID_HEIGHT + index * pitch, z: bay.z, sx: bay.w, sy: scale * SHEET_THICKNESS, sz: bay.d - 0.1 }],
  };
}

interface Grid {
  w: number;
  h: number;
  d: number;
  gap: number;
  /** Between one line and the next, into the depth. */
  lineGap: number;
}

/** Rows on the shelf, then a layer on top where the height allows, in fill order from the front middle. */
function gridPile(grid: Grid, bay: Bay, unit: (x: number, y: number, z: number) => Unit): Pile {
  const across = Math.max(1, Math.floor((bay.w + grid.gap) / (grid.w + grid.gap)));
  const lines = Math.max(1, Math.floor((bay.d + grid.lineGap) / (grid.d + grid.lineGap)));
  const high = Math.max(1, Math.floor((bay.clear - SKID_HEIGHT) / grid.h));
  const places = fromMiddle(across);
  const perLayer = across * lines;
  return {
    capacity: perLayer * high,
    unit: (index) => {
      const cell = index % perLayer;
      const x = bay.x + (places[cell % across] - (across - 1) / 2) * (grid.w + grid.gap);
      const z = bay.z + ((lines - 1) / 2 - Math.floor(cell / across)) * (grid.d + grid.lineGap);
      return unit(x, bay.y + SKID_HEIGHT + Math.floor(index / perLayer) * grid.h, z);
    },
  };
}

/** Rolls stand on edge in lines, so their round faces look out of the rack and never read as tyres. */
function rollPile(bay: Bay, scale: number): Pile {
  const od = Math.min(scale * ROLL_OD, bay.clear - SKID_HEIGHT);
  const sz = scale * ROLL_WIDTH;
  return gridPile({ w: od, h: od, d: sz, gap: scale * ROLL_GAP, lineGap: scale * ROLL_LINE_GAP }, bay, (x, y, z) => {
    const size = { x, y, z, sx: od, sy: od, sz };
    return [{ part: "roll", ...size }, { part: "core", ...size }];
  });
}

function canisterPile(bay: Bay, scale: number): Pile {
  const [w, h, d, gap] = [CANISTER.w, CANISTER.h, CANISTER.d, CANISTER.gap].map((size) => size * scale);
  return gridPile({ w, h, d, gap, lineGap: gap }, bay, (x, y, z) => {
    const size = { x, y, z, sx: w, sy: h, sz: d };
    return [{ part: "canister", ...size }, { part: "canister-cap", ...size }];
  });
}

function cartonPile(bay: Bay, scale: number): Pile {
  const [w, h, d, gap] = [CARTON.w, CARTON.h, CARTON.d, CARTON.gap].map((size) => size * scale);
  return gridPile({ w, h, d, gap, lineGap: gap }, bay, (x, y, z) => [{ part: "carton", x, y, z, sx: w, sy: h - scale * 0.02, sz: d }]);
}

function pileOf({ form, finish }: StockSlot, bay: Bay, scale: number): Pile {
  if (form.form === "bar") return barPile(form, finish, bay, scale);
  if (form.form === "sheet") return sheetPile(finish, bay, scale);
  if (form.form === "roll") return rollPile(bay, scale);
  return form.form === "canister" ? canisterPile(bay, scale) : cartonPile(bay, scale);
}

/** A shelf whole, or the deck of a floor area. */
function shelfBay(object: MapObject, level: number): Bay {
  const base = { x: object.x, z: object.z, w: object.w - SIDE_CLEARANCE, d: object.d - DEPTH_CLEARANCE };
  if (object.kind !== "rack") return { ...base, y: 0, clear: object.h };
  const levels = object.levels ?? RACK_LEVELS;
  const y = levelY(object, level);
  const top = level + 1 < levels ? levelY(object, level + 1) - SHELF_HEIGHT : object.h;
  return { ...base, y, clear: top - y - HEADROOM };
}

/** One half of a shelf. The gap keeps two products from reading as one pile. */
function halfBay(bay: Bay, side: ShelfSide): Bay {
  const w = (bay.w - HALF_GAP) / 2;
  return { ...bay, x: bay.x + ((side === "right" ? 1 : -1) * (w + HALF_GAP)) / 2, w };
}

/** Bays across the depth for what shares a place, each as deep as its share of the pieces, or the one with more would run out of room first. */
function lanesOf(bay: Bay, pieces: readonly number[]): Bay[] {
  const total = pieces.reduce((sum, count) => sum + count, 0);
  const least = total / (pieces.length * LEAST_LANE);
  const depths = pieces.map((count) => Math.max(count, least));
  const all = depths.reduce((sum, depth) => sum + depth, 0);
  let front = bay.z + bay.d / 2;
  return depths.map((depth) => {
    const d = (bay.d * depth) / all;
    front -= d;
    return { ...bay, z: front + d / 2, d };
  });
}

/** What stands on one shelf, each in its bay. A whole-shelf product beside a half takes the half that is left. */
function shelfPlan(bay: Bay, slots: readonly StockSlot[]): { slot: StockSlot; bay: Bay }[] {
  const right = slots.filter((slot) => slot.side === "right");
  const left = slots.filter((slot) => slot.side === "left");
  const whole = slots.filter((slot) => slot.side === null);
  const share = (list: readonly StockSlot[], place: Bay) => {
    const lanes = lanesOf(place, list.map((slot) => slot.count));
    return list.map((slot, i) => ({ slot, bay: lanes[i] }));
  };
  if (right.length === 0 && left.length === 0) return share(whole, bay);
  for (const slot of whole) (right.length <= left.length ? right : left).push(slot);
  return [...share(right, halfBay(bay, "right")), ...share(left, halfBay(bay, "left"))];
}

/** A placed product stands on its shelf. One with no shelf named starts on the next free level, and more of them than levels share lanes across the depth. */
export function packObject(object: MapObject, slots: readonly StockSlot[]): PackedObject {
  const active = slots.filter((slot) => slot.count > 0);
  const levels = object.kind === "rack" ? (object.levels ?? RACK_LEVELS) : 1;
  const pinnedLevel = (slot: StockSlot) => clamp(slot.level ?? 0, 0, levels - 1);
  const pinned = active.filter((slot) => slot.level !== null || object.kind !== "rack");
  const loose = active.filter((slot) => !pinned.includes(slot));

  const onLevel = (level: number) => pinned.filter((slot) => pinnedLevel(slot) === level);
  const all = Array.from({ length: levels }, (_, level) => level);
  const spare = all.filter((level) => onLevel(level).length === 0);
  const spareLevels = spare.length > 0 ? spare : all;
  const shelves = all.flatMap((level) => shelfPlan(shelfBay(object, level), onLevel(level)));
  const lanes = Math.max(1, Math.ceil(loose.length / spareLevels.length));
  const spareBays = spareLevels.flatMap((level) => lanesOf(shelfBay(object, level), new Array<number>(lanes).fill(1)));

  const plan = (scale: number): { takes: Take[]; fits: boolean } => {
    const free = [...spareBays];
    const takes: Take[] = [];
    let fits = true;
    const take = (slot: StockSlot, bay: Bay, wanted: number) => {
      const pile = pileOf(slot, bay, scale);
      const count = Math.min(wanted, pile.capacity);
      takes.push({ key: slot.key, bay, pile, count });
      return wanted - count;
    };

    for (const { slot, bay } of shelves) {
      if (take(slot, bay, slot.count) > 0) fits = false;
    }
    loose.forEach((slot, i) => {
      // One bay stays for each product still to come, or it would look gone.
      const room = free.length - (loose.length - 1 - i);
      let [left, used] = [slot.count, 0];
      while (left > 0 && used < room) left = take(slot, free[used++], left);
      free.splice(0, used);
      if (left > 0) fits = false;
    });
    return { takes, fits };
  };

  let scale = 1;
  let { takes, fits } = plan(scale);
  while (!fits && scale > SMALLEST_SCALE) {
    scale = Math.max(scale * SCALE_STEP, SMALLEST_SCALE);
    ({ takes, fits } = plan(scale));
  }

  const packed: PackedObject = { units: new Map(), fittings: [] };
  for (const { key, bay, pile, count } of takes) {
    const units = packed.units.get(key) ?? [];
    for (let i = 0; i < count; i++) units.push(pile.unit(i));
    packed.units.set(key, units);
    bearers(bay, packed.fittings);
  }
  return packed;
}
