import { CylinderGeometry, ExtrudeGeometry, Group, LatheGeometry, Path, Shape, Vector2, type BufferGeometry } from "three";
import type { BarSection, MapObject, StockFinish, StockSlot } from "../types";
import { Batch, type TierOf } from "./batch";
import type { Tracker } from "./dispose";
import type { Easing } from "./ease";
import type { Look } from "./looks";
import { packObject, type PackedObject, type Placed } from "./packing";
import { drumY, merge, rounded, strut } from "./shapes";
import type { SceneLooks, Stage } from "./stage";

const SLIDE_MS = 420;
/** The wall of a drawn bar against its side: thick enough to see the hollow from across the building. */
const BAR_WALL = 0.17;
/** Units leave at the same line in the aisle, however deep on the shelf they stood. */
const AISLE_REACH = 0.9;
const DROP = 0.14;
/** The last stretch of the slide, where a unit that is leaving shrinks away. */
const VANISH = 0.36;

function outline(section: BarSection, tz: number, ty: number): Shape {
  const points = (list: readonly (readonly [number, number])[]) => list.map(([z, y]) => new Vector2(z - 0.5, y));
  if (section === "channel") {
    return new Shape(points([[0, 0], [1, 0], [1, 1], [1 - tz, 1], [1 - tz, ty], [tz, ty], [tz, 1], [0, 1]]));
  }
  if (section === "angle") {
    return new Shape(points([[0, 0], [1, 0], [1, ty], [tz, ty], [tz, 1], [0, 1]]));
  }
  // Tube mills leave a soft corner, about as wide as the wall.
  const [cz, cy] = [tz * 1.2, ty * 1.2];
  const shape = new Shape(
    points([[cz, 0], [1 - cz, 0], [1, cy], [1, 1 - cy], [1 - cz, 1], [cz, 1], [0, 1 - cy], [0, cy]]),
  );
  shape.holes.push(new Path(points([[tz, ty], [tz, 1 - ty], [1 - tz, 1 - ty], [1 - tz, ty]])));
  return shape;
}

/** One metre of bar along x with a unit section: instances scale it to real length and real section. */
function barGeometry(section: BarSection, tz: number, ty: number): BufferGeometry {
  return new ExtrudeGeometry(outline(section, tz, ty), { depth: 1, bevelEnabled: false, curveSegments: 1 }).rotateY(-Math.PI / 2).translate(0.5, 0, 0);
}

/** A coil standing on edge, its axis along z: soft shoulders, a clean bore. */
function rollGeometry(): BufferGeometry {
  const [outer, bore, half, soft] = [0.5, 0.16, 0.5, 0.08];
  const points = [
    new Vector2(bore, -half),
    new Vector2(outer - soft, -half),
    new Vector2(outer - soft * 0.3, -half + soft * 0.3),
    new Vector2(outer, -half + soft),
    new Vector2(outer, half - soft),
    new Vector2(outer - soft * 0.3, half - soft * 0.3),
    new Vector2(outer - soft, half),
    new Vector2(bore, half),
  ];
  return new LatheGeometry(points, 40).rotateX(Math.PI / 2).translate(0, 0.5, 0);
}

function coreGeometry(): BufferGeometry {
  return new CylinderGeometry(0.16, 0.16, 1.02, 24, 1, true).rotateX(Math.PI / 2).translate(0, 0.5, 0);
}

const CANISTER = { w: 0.19, h: 0.27, d: 0.125 };

function canisterBody(): BufferGeometry {
  const { w, h, d } = CANISTER;
  const body = merge([
    rounded(w, h * 0.84, d, 0.02),
    rounded(w * 0.96, h * 0.14, d * 0.92, 0.02, 0, h * 0.8),
    rounded(w * 0.5, 0.012, d * 0.24, 0.005, w * 0.2, h * 1.02),
    strut([w * 0.03, h * 0.93, 0], [w * 0.03, h * 1.03, 0], 0.016),
    strut([w * 0.37, h * 0.93, 0], [w * 0.37, h * 1.03, 0], 0.016),
    drumY(0.019, h * 0.1, -w * 0.26, h * 0.93, 0, 12),
  ]);
  return body.scale(1 / w, 1 / h, 1 / d);
}

function canisterCap(): BufferGeometry {
  const { w, h, d } = CANISTER;
  return drumY(0.024, 0.03, -w * 0.26, h * 1.0, 0, 16).scale(1 / w, 1 / h, 1 / d);
}

interface Motion {
  kind: "leave" | "arrive" | "glide";
  /** Where a survivor stood before. */
  from?: Placed;
  /** Metres along +z to the line in the aisle. */
  travel: number;
}

interface Running {
  batch: Batch;
  index: number;
  placed: Placed;
  motion: Motion;
}

interface Owned {
  owner: string;
  placed: Placed;
}

function signature(slot: StockSlot): string {
  return `${slot.key}/${slot.level}/${slot.finish}/${slot.fill}/${JSON.stringify(slot.form)}`;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** All the stock, in as few batches as there are shapes and finishes. */
export class Stock {
  private readonly group = new Group();
  private readonly batches = new Map<string, Batch>();
  private readonly geometries = new Map<string, BufferGeometry>();
  private objects: readonly MapObject[] = [];
  private slots: readonly StockSlot[] = [];
  private readonly signatures = new Map<string, string>();
  private readonly packed = new Map<string, PackedObject>();
  private readonly motions = new Map<Placed, Motion>();
  private readonly leaving: Owned[] = [];
  private readonly outgoing: Owned[] = [];
  private running: Running[] = [];
  private startedAt = 0;
  private readonly looks: SceneLooks;

  constructor(
    stage: Stage,
    private readonly tracker: Tracker,
    private readonly ease: Easing,
    private readonly reducedMotion: boolean,
    private readonly tierOf: TierOf,
    private readonly unitBox: BufferGeometry,
  ) {
    this.looks = stage.set;
    stage.add(this.group);
  }

  /** Stock stands where the layout says, so a moved rack carries its pieces with no animation. */
  setObjects(objects: readonly MapObject[]): void {
    this.objects = objects;
    this.signatures.clear();
    this.setSlots(this.slots, false, 0);
  }

  /** Returns whether anything changed. Only racks whose signature differs are packed again. */
  setSlots(slots: readonly StockSlot[], animate: boolean, now: number): boolean {
    this.slots = slots;
    const byObject = new Map<string, StockSlot[]>();
    for (const slot of slots) {
      const list = byObject.get(slot.objectId);
      if (list) list.push(slot);
      else byObject.set(slot.objectId, [slot]);
    }

    const changed: MapObject[] = [];
    for (const object of this.objects) {
      const mark = (byObject.get(object.id) ?? []).map(signature).join("|");
      if (mark !== this.signatures.get(object.id)) changed.push(object);
      this.signatures.set(object.id, mark);
    }
    const gone = [...this.packed.keys()].filter((id) => !this.objects.some((object) => object.id === id));
    if (changed.length === 0 && gone.length === 0) return false;

    this.settle();
    for (const id of gone) this.packed.delete(id);
    const moving = animate && !this.reducedMotion;
    for (const object of changed) {
      const before = this.packed.get(object.id);
      const after = packObject(object, byObject.get(object.id) ?? []);
      if (moving && before) this.compare(object, before, after);
      this.packed.set(object.id, after);
    }
    this.startedAt = now;
    this.rebuild();
    this.flush();
    return true;
  }

  flush(): void {
    for (const batch of this.batches.values()) batch.flush(this.tierOf);
  }

  /** True while units are sliding, and on the frame they land: the shadow map follows. */
  step(now: number): boolean {
    if (this.running.length === 0) return false;
    const t = Math.min((now - this.startedAt) / SLIDE_MS, 1);
    if (t >= 1) {
      this.settle();
      return true;
    }
    const eased = this.ease(t);
    const touched = new Set<Batch>();
    for (const { batch, index, placed, motion } of this.running) {
      touched.add(batch);
      const { x, y, z, sx, sy, sz } = placed;
      if (motion.kind === "glide" && motion.from) {
        const { from } = motion;
        batch.place(index, from.x + (x - from.x) * eased, from.y + (y - from.y) * eased, from.z + (z - from.z) * eased, sx, sy, sz);
        continue;
      }
      const away = motion.kind === "leave" ? eased : 1 - eased;
      const seen = motion.kind === "leave" ? 1 - smooth(Math.max(t - (1 - VANISH), 0) / VANISH) : smooth(Math.min(t / VANISH, 1));
      batch.place(index, x, y - DROP * away * away, z + motion.travel * away, sx * seen, sy * seen, sz * seen);
    }
    for (const batch of touched) batch.flush(this.tierOf);
    return true;
  }

  private compare(object: MapObject, before: PackedObject, after: PackedObject): void {
    const aisle = object.z + object.d / 2 + AISLE_REACH;
    const travel = (placed: Placed) => aisle - placed.z + placed.sz / 2;
    for (const key of new Set([...before.units.keys(), ...after.units.keys()])) {
      const old = before.units.get(key) ?? [];
      const next = after.units.get(key) ?? [];
      for (let i = 0; i < Math.max(old.length, next.length); i++) {
        const was = old[i];
        const now = next[i];
        if (was && now) {
          now.forEach((placed, part) => {
            const from = was[part];
            if (from.x !== placed.x || from.y !== placed.y || from.z !== placed.z) this.motions.set(placed, { kind: "glide", from, travel: 0 });
          });
        } else if (now) {
          for (const placed of now) this.motions.set(placed, { kind: "arrive", travel: travel(placed) });
        } else {
          for (const placed of was) {
            this.motions.set(placed, { kind: "leave", travel: travel(placed) });
            this.leaving.push({ owner: object.id, placed });
          }
        }
      }
    }
    // Skids and straps stay until the slide is over, or units would leave a stack that has already lost its pallet.
    for (const placed of before.fittings) this.outgoing.push({ owner: object.id, placed });
  }

  private settle(): void {
    if (this.motions.size === 0) return;
    this.motions.clear();
    this.leaving.length = 0;
    this.outgoing.length = 0;
    this.rebuild();
    this.flush();
  }

  private rebuild(): void {
    for (const batch of this.batches.values()) batch.clear();
    this.running = [];
    for (const [owner, packed] of this.packed) {
      for (const units of packed.units.values()) for (const unit of units) for (const placed of unit) this.add(owner, placed);
      for (const placed of packed.fittings) this.add(owner, placed);
    }
    for (const { owner, placed } of this.leaving) this.add(owner, placed);
    for (const { owner, placed } of this.outgoing) this.add(owner, placed);
  }

  private add(owner: string, placed: Placed): void {
    const batch = this.batchOf(placed.part);
    const index = batch.add(owner, placed.x, placed.y, placed.z, placed.sx, placed.sy, placed.sz);
    const motion = this.motions.get(placed);
    if (motion) this.running.push({ batch, index, placed, motion });
  }

  private batchOf(part: string): Batch {
    const existing = this.batches.get(part);
    if (existing) return existing;
    const { geometry, look } = this.partOf(part);
    const batch = new Batch(this.group, geometry, look, this.tracker);
    this.batches.set(part, batch);
    return batch;
  }

  private shared(key: string, make: () => BufferGeometry): BufferGeometry {
    const known = this.geometries.get(key);
    if (known) return known;
    const geometry = this.tracker.add(make());
    this.geometries.set(key, geometry);
    return geometry;
  }

  private partOf(part: string): { geometry: BufferGeometry; look: Look } {
    const { looks } = this;
    const [kind, first, second] = part.split(":");
    switch (kind) {
      case "bar":
        return {
          geometry: this.shared(`${kind}:${first}`, () => barGeometry(first as BarSection, BAR_WALL, BAR_WALL)),
          look: looks.bar[second as StockFinish],
        };
      case "sheet":
        return { geometry: this.unitBox, look: looks.sheet[first as StockFinish] };
      case "roll":
        return { geometry: this.shared(kind, rollGeometry), look: looks.roll };
      case "core":
        return { geometry: this.shared(kind, coreGeometry), look: looks.core };
      case "canister":
        return { geometry: this.shared(kind, canisterBody), look: looks.canister };
      case "canister-cap":
        return { geometry: this.shared(kind, canisterCap), look: looks.canisterCap };
      case "carton":
        return { geometry: this.unitBox, look: looks.carton };
      default:
        return { geometry: this.unitBox, look: looks.skid };
    }
  }
}
