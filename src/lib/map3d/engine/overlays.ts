import { BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial, type Object3D } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { levelY, RACK_LEVELS } from "../layout";
import type { MapObject, MapPoint, MapRoute, PickHit, ScenePalette, ShelfSide } from "../types";
import type { Tracker } from "./dispose";
import type { Easing } from "./ease";

const RULE_WIDTH = 2;
const RULE_Y = 0.03;
const RULE_MARGIN = 0.3;
const RULE_FADE_MS = 180;
const FILL_Y = 0.04;
/** A fill stands wider than its rack, or the shelves above would hide it from most of the view. */
const FILL_MARGIN = 0.9;
/** The weakest fill still reads as a place with value. */
const FILL_FLOOR = 0.22;
const ROUTE_Y = 0.04;
const TRACE_DRAW_MS = 640;
const TRACE_HOLD_MS = 240;
const TRACE_FADE_MS = 480;
const TRACE_STEP = 0.5;
const BEAM_MIDDLE = 0.065;

type Tone = MapRoute["tone"];

const TONES: readonly Tone[] = ["ink", "focus", "in", "out", "warn"];

interface Trace {
  line: LineSegments2;
  segments: number;
  start: number;
}

function ruleMaterial(): LineMaterial {
  return new LineMaterial({ linewidth: RULE_WIDTH, transparent: true, toneMapped: false, depthWrite: false });
}

function floorSegments(points: readonly MapPoint[], y: number): number[] {
  const flat: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) flat.push(points[i][0], y, points[i][1], points[i + 1][0], y, points[i + 1][1]);
  return flat;
}

/** Cuts a route into even steps, so drawing it is only a matter of how many to show. */
function evenSteps(points: readonly MapPoint[]): MapPoint[] {
  const even: MapPoint[] = [points[0]];
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / TRACE_STEP));
    for (let s = 1; s <= steps; s++) even.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
  }
  return even;
}

/** What is drawn on the floor over the model: the selection rule, footprints, routes and the trace of a movement. */
export class Overlays {
  private objects: readonly MapObject[] = [];
  private selection: PickHit | null = null;
  private readonly rule: LineSegments2;
  private readonly ruleMaterial: LineMaterial;
  private ruleShown = false;
  private ruleFade = { from: 0, to: 0, start: 0 };

  private readonly fills: Mesh<BufferGeometry, MeshBasicMaterial>;
  private footprints: readonly { objectId: string; strength: number }[] | null = null;

  private readonly toneColors = new Map<Tone, Color>(TONES.map((tone) => [tone, new Color("#171717")]));
  private readonly routeMaterials = new Map<Tone, LineMaterial>();
  private routeLines: LineSegments2[] = [];
  private traces: Trace[] = [];

  constructor(
    private readonly parent: Object3D,
    private readonly tracker: Tracker,
    private readonly ease: Easing,
    private readonly reducedMotion: boolean,
  ) {
    this.ruleMaterial = tracker.add(ruleMaterial());
    this.ruleMaterial.opacity = 0;
    this.rule = new LineSegments2(tracker.add(new LineSegmentsGeometry()), this.ruleMaterial);
    this.rule.frustumCulled = false;
    this.rule.visible = false;
    parent.add(this.rule);

    const fillMaterial = tracker.add(new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
    this.fills = new Mesh(tracker.add(new BufferGeometry()), fillMaterial);
    this.fills.frustumCulled = false;
    this.fills.visible = false;
    parent.add(this.fills);

    for (const tone of TONES) this.routeMaterials.set(tone, tracker.add(ruleMaterial()));
  }

  setPalette(palette: ScenePalette): void {
    this.toneColors.get("ink")?.set(palette.ink);
    this.toneColors.get("focus")?.set(palette.focus);
    this.toneColors.get("in")?.set(palette.in);
    this.toneColors.get("out")?.set(palette.out);
    this.toneColors.get("warn")?.set(palette.warn);
    this.ruleMaterial.color.set(palette.focus);
    this.fills.material.color.set(palette.chart);
    for (const [tone, material] of this.routeMaterials) {
      const color = this.toneColors.get(tone);
      if (color) material.color.copy(color);
    }
  }

  setObjects(objects: readonly MapObject[]): void {
    this.objects = objects;
    this.writeRule();
    this.writeFills();
  }

  setSelection(selection: PickHit | null, now: number): void {
    const mark = (hit: PickHit | null) => (hit ? `${hit.objectId}/${hit.level}/${hit.side ?? ""}/${hit.through ?? ""}` : "");
    const same = mark(selection) === mark(this.selection);
    this.selection = selection;
    if (same) return;
    this.writeRule();
    const shown = this.ruleShown;
    this.ruleShown = selection !== null && this.rule.visible;
    if (shown === this.ruleShown && !this.ruleShown) return;
    this.ruleFade = { from: this.ruleShown && !shown ? 0 : this.ruleMaterial.opacity, to: this.ruleShown ? 1 : 0, start: now };
  }

  setFootprints(items: readonly { objectId: string; strength: number }[] | null): void {
    this.footprints = items;
    this.writeFills();
  }

  setRoutes(routes: readonly MapRoute[]): void {
    for (const line of this.routeLines) {
      line.removeFromParent();
      this.tracker.free(line.geometry);
    }
    this.routeLines = [];
    for (const [tone, material] of this.routeMaterials) {
      const flat = routes.filter((route) => route.tone === tone).flatMap((route) => floorSegments(route.points, ROUTE_Y));
      if (flat.length === 0) continue;
      const line = this.line(flat, material);
      this.routeLines.push(line);
    }
  }

  trace(route: MapRoute, now: number): void {
    if (route.points.length < 2) return;
    const material = this.tracker.add(ruleMaterial());
    material.color.copy(this.toneColors.get(route.tone) ?? material.color);
    const flat = floorSegments(evenSteps(route.points), ROUTE_Y);
    const line = this.line(flat, material);
    const segments = flat.length / 6;
    line.geometry.instanceCount = this.reducedMotion ? segments : 0;
    this.traces.push({ line, segments, start: now });
  }

  /** True while the rule fades or a trace is on the floor. */
  step(now: number): boolean {
    let busy = this.stepRule(now);
    this.traces = this.traces.filter((trace) => {
      const age = now - trace.start;
      if (age >= TRACE_DRAW_MS + TRACE_HOLD_MS + TRACE_FADE_MS) {
        trace.line.removeFromParent();
        this.tracker.free(trace.line.geometry);
        this.tracker.free(trace.line.material);
        return false;
      }
      if (!this.reducedMotion) trace.line.geometry.instanceCount = Math.round(this.ease(Math.min(age / TRACE_DRAW_MS, 1)) * trace.segments);
      trace.line.material.opacity = 1 - Math.max(age - TRACE_DRAW_MS - TRACE_HOLD_MS, 0) / TRACE_FADE_MS;
      return true;
    });
    busy = busy || this.traces.length > 0;
    return busy;
  }

  private stepRule(now: number): boolean {
    const { from, to, start } = this.ruleFade;
    if (this.ruleMaterial.opacity === to) {
      this.rule.visible = to > 0;
      return false;
    }
    const t = this.reducedMotion ? 1 : Math.min((now - start) / RULE_FADE_MS, 1);
    this.ruleMaterial.opacity = from + (to - from) * t;
    this.rule.visible = true;
    return t < 1;
  }

  private line(flat: number[], material: LineMaterial): LineSegments2 {
    const geometry = this.tracker.add(new LineSegmentsGeometry());
    geometry.setPositions(flat);
    const line = new LineSegments2(geometry, material);
    line.frustumCulled = false;
    this.parent.add(line);
    return line;
  }

  private writeRule(): void {
    const { selection } = this;
    const object = selection ? this.objects.find((candidate) => candidate.id === selection.objectId) : undefined;
    if (!object) {
      this.rule.visible = false;
      return;
    }
    const flat =
      selection?.level !== null && selection?.level !== undefined && object.kind === "rack"
        ? this.shelfFront(object, selection.level, selection.through ?? selection.level, selection.side ?? null)
        : this.around(object);
    this.tracker.free(this.rule.geometry);
    const geometry = this.tracker.add(new LineSegmentsGeometry());
    geometry.setPositions(flat);
    this.rule.geometry = geometry;
    this.rule.visible = true;
  }

  private around(o: MapObject): number[] {
    const [left, right] = [o.x - o.w / 2 - RULE_MARGIN, o.x + o.w / 2 + RULE_MARGIN];
    const [near, far] = [o.z - o.d / 2 - RULE_MARGIN, o.z + o.d / 2 + RULE_MARGIN];
    const corners: MapPoint[] = [
      [left, near],
      [right, near],
      [right, far],
      [left, far],
      [left, near],
    ];
    return floorSegments(corners, RULE_Y);
  }

  /** A frame on the front of a shelf, a half or a block of shelves: it stands off the stock, so the eye finds what it marks. */
  private shelfFront(o: MapObject, level: number, through: number, side: ShelfSide | null): number[] {
    const levels = o.levels ?? RACK_LEVELS;
    const bottom = levelY(o, level) - BEAM_MIDDLE;
    const top = through + 1 < levels ? levelY(o, through + 1) - BEAM_MIDDLE : o.h;
    const z = o.z + o.d / 2 + 0.03;
    const [left, right] = side === null ? [o.x - o.w / 2, o.x + o.w / 2] : side === "right" ? [o.x, o.x + o.w / 2] : [o.x - o.w / 2, o.x];
    return [left, bottom, z, right, bottom, z, right, bottom, z, right, top, z, right, top, z, left, top, z, left, top, z, left, bottom, z];
  }

  /** Strength is alpha on the chart colour, so the floor keeps its shadows under a fill and a theme is one colour write. */
  private writeFills(): void {
    const { footprints } = this;
    const placed = (footprints ?? []).flatMap(({ objectId, strength }) => {
      const object = this.objects.find((candidate) => candidate.id === objectId);
      return object ? [{ object, strength: Math.min(Math.max(strength, 0), 1) }] : [];
    });
    this.fills.visible = placed.length > 0;
    this.tracker.free(this.fills.geometry);
    const geometry = this.tracker.add(new BufferGeometry());
    const positions = new Float32Array(placed.length * 12);
    const colors = new Float32Array(placed.length * 16);
    const index: number[] = [];
    placed.forEach(({ object: o, strength }, i) => {
      const [left, right] = [o.x - o.w / 2 - FILL_MARGIN, o.x + o.w / 2 + FILL_MARGIN];
      const [near, far] = [o.z - o.d / 2 - FILL_MARGIN, o.z + o.d / 2 + FILL_MARGIN];
      positions.set([left, FILL_Y, near, right, FILL_Y, near, right, FILL_Y, far, left, FILL_Y, far], i * 12);
      for (let v = 0; v < 4; v++) colors.set([1, 1, 1, FILL_FLOOR + (1 - FILL_FLOOR) * strength * 0.8], (i * 4 + v) * 4);
      const a = i * 4;
      index.push(a, a + 3, a + 2, a, a + 2, a + 1);
    });
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 4));
    geometry.setIndex(index);
    this.fills.geometry = geometry;
  }
}
