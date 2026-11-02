import { levelY, RACK_LEVELS } from "../layout";
import type { MapObject, StockFinish, StockForm, StockSlot } from "../types";

/**
 * How stock stands in its place. Drawn for the eye, not counted: neat, large forms, as many as the fill asks for, so a
 * shelf reads from across the building. A unit's place depends only on its index, so what stays has not moved when
 * the rest leaves.
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

interface Sink {
  units: Unit[];
  fittings: Placed[];
}

/** What a bay keeps free of its rack: the posts at the sides, the lip at the front, air under the next shelf. */
const SIDE_CLEARANCE = 0.3;
const DEPTH_CLEARANCE = 0.2;
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
const MAX_LINES = 3;

/** The least of a level a product takes, so what is nearly gone still shows. */
const SMALLEST_SHARE = 0.2;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** How many of `capacity` a bay shows for its share. At least one, or a product in stock would look gone. */
const inBay = (capacity: number, share: number) => clamp(Math.round(capacity * share), 1, capacity);

/** Indices of `count` places from the middle outward, so a part-filled row stands centred. */
function fromMiddle(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(a - (count - 1) / 2) - Math.abs(b - (count - 1) / 2) || b - a);
}

function bearers(bay: Bay, sink: Sink): void {
  for (const side of [-1, 1]) {
    sink.fittings.push({ part: "skid", x: bay.x + side * bay.w * SKID_SPREAD, y: bay.y, z: bay.z, sx: SKID_WIDTH, sy: SKID_HEIGHT, sz: bay.d });
  }
}

function fillBars(form: Extract<StockForm, { form: "bar" }>, finish: StockFinish, bay: Bay, share: number, sink: Sink): void {
  const part = `bar:${form.section}:${finish}`;
  const sz = BAR_SIDE * clamp(form.a / form.b, 1, MAX_ASPECT);
  const sy = BAR_SIDE * clamp(form.b / form.a, 1, MAX_ASPECT);
  const cols = Math.max(1, Math.floor((bay.d + BAR_GAP_Z) / (sz + BAR_GAP_Z)));
  const rows = Math.max(1, Math.floor((bay.clear - SKID_HEIGHT) / (sy + BAR_GAP_Y)));
  const places = fromMiddle(cols);
  const count = inBay(cols * rows, share);
  bearers(bay, sink);
  for (let i = 0; i < count; i++) {
    const col = places[i % cols];
    const z = bay.z + (col - (cols - 1) / 2) * (sz + BAR_GAP_Z);
    sink.units.push([{ part, x: bay.x, y: bay.y + SKID_HEIGHT + Math.floor(i / cols) * (sy + BAR_GAP_Y), z, sx: bay.w, sy, sz }]);
  }
}

function fillSheets(finish: StockFinish, bay: Bay, share: number, sink: Sink): void {
  const part = `sheet:${finish}`;
  const capacity = Math.max(2, Math.floor((bay.clear - SKID_HEIGHT) / SHEET_PITCH));
  const count = inBay(capacity, share);
  bearers(bay, sink);
  for (let i = 0; i < count; i++) {
    sink.units.push([{ part, x: bay.x, y: bay.y + SKID_HEIGHT + i * SHEET_PITCH, z: bay.z, sx: bay.w, sy: SHEET_THICKNESS, sz: bay.d - 0.1 }]);
  }
}

/** Rolls stand on edge in lines, so their round faces look out of the rack and never read as tyres. */
function fillRolls(bay: Bay, share: number, sink: Sink): void {
  const od = Math.min(ROLL_OD, bay.clear - SKID_HEIGHT);
  const across = Math.max(1, Math.floor((bay.w + ROLL_GAP) / (od + ROLL_GAP)));
  const lines = clamp(Math.floor((bay.d + ROLL_LINE_GAP) / (ROLL_WIDTH + ROLL_LINE_GAP)), 1, MAX_LINES);
  const places = fromMiddle(across);
  const count = inBay(across * lines, share);
  bearers(bay, sink);
  for (let i = 0; i < count; i++) {
    const x = bay.x + (places[i % across] - (across - 1) / 2) * (od + ROLL_GAP);
    const z = bay.z + ((lines - 1) / 2 - Math.floor(i / across)) * (ROLL_WIDTH + ROLL_LINE_GAP);
    const size = { x, y: bay.y + SKID_HEIGHT, z, sx: od, sy: od, sz: ROLL_WIDTH };
    sink.units.push([{ part: "roll", ...size }, { part: "core", ...size }]);
  }
}

interface Grid {
  w: number;
  h: number;
  d: number;
  gap: number;
}

/** Rows on the shelf, then a layer on top where the height allows, in fill order from the front middle. */
function fillGrid(grid: Grid, bay: Bay, share: number, sink: Sink, unit: (x: number, y: number, z: number) => Unit): void {
  const across = Math.max(1, Math.floor((bay.w + grid.gap) / (grid.w + grid.gap)));
  const lines = clamp(Math.floor((bay.d + grid.gap) / (grid.d + grid.gap)), 1, MAX_LINES);
  const high = Math.max(1, Math.floor((bay.clear - SKID_HEIGHT) / grid.h));
  const places = fromMiddle(across);
  const perLayer = across * lines;
  const count = inBay(perLayer * high, share);
  bearers(bay, sink);
  for (let i = 0; i < count; i++) {
    const cell = i % perLayer;
    const x = bay.x + (places[cell % across] - (across - 1) / 2) * (grid.w + grid.gap);
    const z = bay.z + ((lines - 1) / 2 - Math.floor(cell / across)) * (grid.d + grid.gap);
    sink.units.push(unit(x, bay.y + SKID_HEIGHT + Math.floor(i / perLayer) * grid.h, z));
  }
}

function fillBay(slot: StockSlot, bay: Bay, share: number, sink: Sink): void {
  const { form, finish } = slot;
  if (form.form === "bar") fillBars(form, finish, bay, share, sink);
  else if (form.form === "sheet") fillSheets(finish, bay, share, sink);
  else if (form.form === "roll") fillRolls(bay, share, sink);
  else if (form.form === "canister") {
    const size = { sx: CANISTER.w, sy: CANISTER.h, sz: CANISTER.d };
    fillGrid(CANISTER, bay, share, sink, (x, y, z) => [{ part: "canister", x, y, z, ...size }, { part: "canister-cap", x, y, z, ...size }]);
  } else {
    fillGrid(CARTON, bay, share, sink, (x, y, z) => [{ part: "carton", x, y, z, sx: CARTON.w, sy: CARTON.h - 0.02, sz: CARTON.d }]);
  }
}

function baysOf(object: MapObject, lanes: number): Bay[][] {
  const w = object.w - SIDE_CLEARANCE;
  const d = object.d - DEPTH_CLEARANCE;
  const lane = (y: number, clear: number) =>
    Array.from({ length: lanes }, (_, i): Bay => ({ x: object.x, y, z: object.z + d / 2 - ((i + 0.5) * d) / lanes, w, d: d / lanes, clear }));
  if (object.kind !== "rack") return [lane(0, object.h)];
  const levels = object.levels ?? RACK_LEVELS;
  return Array.from({ length: levels }, (_, level) => {
    const y = levelY(object, level);
    const top = level + 1 < levels ? levelY(object, level + 1) - SHELF_HEIGHT : object.h;
    return lane(y, top - y - HEADROOM);
  });
}

/** How many levels each product takes: what it asks for, cut back from the greediest until they all fit. */
function spans(wants: readonly number[], free: number): number[] {
  const counts = wants.map((want) => Math.max(1, Math.ceil(want - 1e-6)));
  const total = () => counts.reduce((sum, n) => sum + n, 0);
  while (total() > free) {
    const largest = counts.indexOf(Math.max(...counts));
    if (counts[largest] === 1) break;
    counts[largest]--;
  }
  return counts;
}

/** Each product starts on the next free level, a pinned one on its own. More products than levels share lanes across the depth. */
export function packObject(object: MapObject, slots: readonly StockSlot[]): PackedObject {
  const packed: PackedObject = { units: new Map(), fittings: [] };
  const active = slots.filter((slot) => slot.fill > 0);
  const levels = object.kind === "rack" ? (object.levels ?? RACK_LEVELS) : 1;
  const pinnedLevel = (slot: StockSlot) => clamp(slot.level ?? 0, 0, levels - 1);
  const pinned = active.filter((slot) => slot.level !== null);
  const loose = active.filter((slot) => slot.level === null);

  const pinnedOn = new Array<number>(levels).fill(0);
  for (const slot of pinned) pinnedOn[pinnedLevel(slot)]++;
  const bays = baysOf(object, Math.max(1, Math.ceil(active.length / levels), ...pinnedOn));
  const free = bays.flat();

  const fill = (slot: StockSlot, list: readonly { bay: Bay; share: number }[]) => {
    const units: Unit[] = [];
    for (const { bay, share } of list) fillBay(slot, bay, share, { units, fittings: packed.fittings });
    packed.units.set(slot.key, units);
  };

  for (const slot of pinned) {
    const level = bays[pinnedLevel(slot)];
    const lane = level.find((bay) => free.includes(bay)) ?? level[0];
    if (free.includes(lane)) free.splice(free.indexOf(lane), 1);
    fill(slot, [{ bay: lane, share: Math.max(slot.fill, SMALLEST_SHARE) }]);
  }

  const room = free.length;
  const wants = loose.map((slot) => slot.fill * room);
  const counts = spans(wants, room);
  loose.forEach((slot, i) => {
    const taken = free.splice(0, counts[i]);
    if (taken.length === 0) taken.push(bays[0][0]);
    const last = clamp(wants[i] - (taken.length - 1), SMALLEST_SHARE, 1);
    fill(slot, taken.map((bay, n) => ({ bay, share: n === taken.length - 1 ? last : 1 })));
  });
  return packed;
}
