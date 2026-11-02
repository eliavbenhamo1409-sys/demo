import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from "three";
import { FOOTPRINT } from "../layout";
import type { MapObject, MapPoint, ScenePalette } from "../types";
import type { Tracker } from "./dispose";
import type { Easing } from "./ease";
import { box, merge } from "./shapes";
import type { Stage } from "./stage";

const CUT_HEIGHT = 2;
const TALL_HEIGHT = 7.2;
const WALL_THICKNESS = 0.24;
const SLAB_DEPTH = 0.25;
const CAP_DEPTH = 0.03;
const COLUMN_SIZE = 0.34;
const COLUMN_PITCH = 10;
const COLUMN_INSET = 0.26;
const ARM_LENGTH = 8;
const ARM_WIDTH = 0.16;
const ARM_DEPTH = 0.2;
const GRID_PITCH = 5;
const GRID_Y = 0.012;
const GRID_OPACITY = 0.6;
const PAINT_DEPTH = 0.016;
const ZONE_Y = 0.016;
const ZONE_LINE = 0.1;
/** The forklift lane through the middle of the building. */
const LANE = { x: 60, z: 30.5, w: 5, d: 55 };
const DASH = { width: 0.12, length: 0.9, pitch: 2 };
const ARROW_PITCH = 7;
/** Metres past a wall's plane before it answers, so a camera near the plane does not toggle it. */
const HYSTERESIS = 1.5;
const WALL_MS = 420;

export type WallMode = "auto" | "up" | "down";

interface Edge {
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Outward. */
  nx: number;
  nz: number;
  /** Carries columns behind the model. The rest are always cut, so nothing hides a machine. */
  rear: boolean;
  /** A whole wall to the top, as against a low wall with columns rising from it. */
  solid: boolean;
  height: number;
  from: number;
  to: number;
  start: number;
}

function signedArea(points: readonly MapPoint[]): number {
  return points.reduce((sum, [x, z], i) => {
    const [nx, nz] = points[(i + 1) % points.length];
    return sum + x * nz - nx * z;
  }, 0);
}

function outwardNormals(points: readonly MapPoint[]): MapPoint[] {
  const sign = signedArea(points) > 0 ? 1 : -1;
  return points.map(([x, z], i) => {
    const [nx, nz] = points[(i + 1) % points.length];
    const length = Math.hypot(nx - x, nz - z);
    return [(sign * (nz - z)) / length, (sign * (x - nx)) / length];
  });
}

/** The slab's outline runs on the outer face of the walls. Square corners only, as the footprint has. */
function grown(points: readonly MapPoint[], normals: readonly MapPoint[], by: number): MapPoint[] {
  return points.map(([x, z], i) => {
    const [ax, az] = normals[(i + normals.length - 1) % normals.length];
    const [bx, bz] = normals[i];
    return [x + (ax + bx) * by, z + (az + bz) * by];
  });
}

function slabGeometry(outline: readonly MapPoint[]): BufferGeometry {
  const shape = new Shape(outline.map(([x, z]) => new Vector2(x, -z)));
  return new ExtrudeGeometry(shape, { depth: SLAB_DEPTH, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -SLAB_DEPTH, 0);
}

/** Where a line at `at` along one axis crosses the outline, in pairs along the other. */
function crossings(at: number, across: 0 | 1): number[] {
  const along = across === 0 ? 1 : 0;
  const hits: number[] = [];
  FOOTPRINT.forEach((a, i) => {
    const b = FOOTPRINT[(i + 1) % FOOTPRINT.length];
    if (a[along] > at !== b[along] > at) hits.push(a[across]);
  });
  return hits.sort((x, y) => x - y);
}

function gridPositions(): number[] {
  const xs = FOOTPRINT.map((p) => p[0]);
  const zs = FOOTPRINT.map((p) => p[1]);
  const lines: number[] = [];
  // Half a millimetre off the line, so one that runs through a corner still crosses cleanly.
  for (let x = Math.min(...xs) + GRID_PITCH; x < Math.max(...xs); x += GRID_PITCH) {
    const hits = crossings(x + 0.0005, 1);
    for (let i = 0; i + 1 < hits.length; i += 2) lines.push(x, GRID_Y, hits[i], x, GRID_Y, hits[i + 1]);
  }
  for (let z = Math.min(...zs) + GRID_PITCH; z < Math.max(...zs); z += GRID_PITCH) {
    const hits = crossings(z + 0.0005, 0);
    for (let i = 0; i + 1 < hits.length; i += 2) lines.push(hits[i], GRID_Y, z, hits[i + 1], GRID_Y, z);
  }
  return lines;
}

/** A sectional door, parts in place at full height on the rear wall. */
function dockDoor(x: number, z: number): BufferGeometry {
  const width = 8;
  const height = 4.5;
  const panels = 9;
  const parts: BufferGeometry[] = [];
  const pitch = height / panels;
  for (let i = 0; i < panels; i++) parts.push(box(width - 0.3, pitch - 0.035, 0.05, x, i * pitch + 0.01, z + 0.03));
  for (const side of [-1, 1]) parts.push(box(0.14, height + 0.18, 0.14, x + (side * (width - 0.1)) / 2, 0, z + 0.07));
  parts.push(box(width + 0.04, 0.18, 0.14, x, height, z + 0.07));
  return merge(parts);
}

/** A flat arrow on the floor, pointing to -z. */
function arrow(x: number, z: number): BufferGeometry {
  const shape = new Shape([new Vector2(0, 0.6), new Vector2(0.4, -0.2), new Vector2(0, 0), new Vector2(-0.4, -0.2)]);
  return new ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(x, ZONE_Y + 0.03, z);
}

function lanePaint(): { strip: BufferGeometry; marks: BufferGeometry } {
  const { x, z, w, d } = LANE;
  const marks: BufferGeometry[] = [];
  const near = z - d / 2 + 0.5;
  const far = z + d / 2 - 0.5;
  for (let at = near; at < far; at += DASH.pitch) {
    for (const side of [-1, 1]) marks.push(box(DASH.width, PAINT_DEPTH, DASH.length, x + (side * w) / 2, ZONE_Y + 0.02, at));
  }
  for (let at = near + ARROW_PITCH / 2; at < far; at += ARROW_PITCH) marks.push(arrow(x, at));
  return { strip: box(w, PAINT_DEPTH, d, x, ZONE_Y, z), marks: merge(marks) };
}

export class Shell {
  private readonly group = new Group();
  private readonly edges: Edge[] = [];
  private readonly walls: InstancedMesh;
  private readonly caps: InstancedMesh;
  private readonly columns: InstancedMesh;
  private readonly arms: InstancedMesh;
  private readonly columnsOf: { edge: Edge; x: number; z: number }[] = [];
  private readonly dock: Mesh;
  private readonly dockEdge: Edge | null;
  private readonly gridMaterial: LineBasicMaterial;
  private readonly zones: Mesh;
  private readonly zoneLines: Mesh;
  private readonly matrix = new Matrix4();
  /** Drawn first, which lets the engine read how many calls the shadow pass took. */
  readonly slab: Mesh;
  private mode: WallMode = "auto";

  constructor(
    stage: Stage,
    private readonly tracker: Tracker,
    private readonly ease: Easing,
    private readonly reducedMotion: boolean,
  ) {
    const normals = outwardNormals(FOOTPRINT);
    const unit = tracker.add(box(1, 1, 1));
    const { set } = stage;

    this.slab = new Mesh(tracker.add(slabGeometry(grown(FOOTPRINT, normals, WALL_THICKNESS / 2))), set.slab.base);
    this.slab.receiveShadow = true;
    this.slab.castShadow = true;
    this.slab.renderOrder = -1;
    this.slab.frustumCulled = false;
    this.group.add(this.slab);

    FOOTPRINT.forEach(([x, z], i) => {
      const [nextX, nextZ] = FOOTPRINT[(i + 1) % FOOTPRINT.length];
      const [nx, nz] = normals[i];
      const rear = nx < 0 || nz < 0;
      this.edges.push({
        x: (x + nextX) / 2,
        z: (z + nextZ) / 2,
        width: Math.abs(nextX - x) + WALL_THICKNESS,
        depth: Math.abs(nextZ - z) + WALL_THICKNESS,
        nx,
        nz,
        rear,
        solid: nz < 0,
        height: rear ? TALL_HEIGHT : CUT_HEIGHT,
        from: 0,
        to: rear ? TALL_HEIGHT : CUT_HEIGHT,
        start: 0,
      });
    });

    this.walls = this.instanced(unit, set.wall.base, this.edges.length);
    this.walls.castShadow = true;
    this.walls.receiveShadow = true;
    this.caps = this.instanced(unit, set.wallTop.base, this.edges.length);

    for (const edge of this.edges) {
      if (!edge.rear) continue;
      const alongX = edge.width > edge.depth;
      const length = (alongX ? edge.width : edge.depth) - WALL_THICKNESS;
      for (let along = 0; along < length + 1; along += COLUMN_PITCH) {
        const offset = along - length / 2;
        this.columnsOf.push({
          edge,
          x: alongX ? edge.x + offset : edge.x - edge.nx * COLUMN_INSET,
          z: alongX ? edge.z - edge.nz * COLUMN_INSET : edge.z + offset,
        });
      }
    }
    this.columns = this.instanced(unit, set.column.base, this.columnsOf.length);
    this.columns.castShadow = true;
    this.columns.receiveShadow = true;
    this.arms = this.instanced(unit, set.column.base, this.columnsOf.filter(({ edge }) => edge.solid).length);
    this.arms.castShadow = true;

    this.dockEdge = this.edges.find((edge) => edge.solid) ?? null;
    const dockZ = (this.dockEdge?.z ?? 0) + WALL_THICKNESS / 2;
    this.dock = new Mesh(tracker.add(dockDoor(stage.floor.min.x + 8, dockZ)), set.door.base);
    this.dock.castShadow = true;
    this.dock.receiveShadow = true;
    this.dock.frustumCulled = false;
    this.group.add(this.dock);

    const grid = tracker.add(new BufferGeometry());
    grid.setAttribute("position", new Float32BufferAttribute(gridPositions(), 3));
    this.gridMaterial = tracker.add(new LineBasicMaterial({ transparent: true, opacity: GRID_OPACITY, toneMapped: false }));
    const gridLines = new LineSegments(grid, this.gridMaterial);
    gridLines.frustumCulled = false;
    this.group.add(gridLines);

    const lane = lanePaint();
    this.group.add(this.paint(tracker.add(lane.strip), set.lane.base), this.paint(tracker.add(lane.marks), set.laneMark.base));
    this.zones = this.paint(tracker.add(new BufferGeometry()), set.zone.base);
    this.zoneLines = this.paint(tracker.add(new BufferGeometry()), set.zoneLine.base);
    this.group.add(this.zones, this.zoneLines);

    stage.add(this.group);
    this.writeWalls();
  }

  setPalette(palette: ScenePalette): void {
    this.gridMaterial.color.set(palette.grid);
  }

  /** Zones are a soft fill inside a painted line; a floor area is the line alone until stock stands on it. */
  setObjects(objects: readonly MapObject[]): void {
    const fills: BufferGeometry[] = [];
    const lines: BufferGeometry[] = [];
    for (const o of objects) {
      if (o.kind !== "zone" && o.kind !== "floor") continue;
      if (o.kind === "zone") fills.push(box(o.w, PAINT_DEPTH, o.d, o.x, ZONE_Y, o.z));
      for (const side of [-1, 1]) {
        lines.push(box(o.w, PAINT_DEPTH, ZONE_LINE, o.x, ZONE_Y + 0.008, o.z + (side * o.d) / 2));
        lines.push(box(ZONE_LINE, PAINT_DEPTH, o.d, o.x + (side * o.w) / 2, ZONE_Y + 0.008, o.z));
      }
    }
    this.repaint(this.zones, fills);
    this.repaint(this.zoneLines, lines);
  }

  setMode(mode: WallMode): void {
    this.mode = mode;
  }

  /** Lowers a tall wall the camera stands behind. Returns whether anything moved, which the shadow map must follow. */
  step(now: number, camera: Vector3): boolean {
    let moved = false;
    for (const edge of this.edges) {
      const to = this.wanted(edge, camera);
      if (to !== edge.to) {
        edge.from = edge.height;
        edge.to = to;
        edge.start = now;
      }
      if (edge.height === edge.to) continue;
      const t = this.reducedMotion ? 1 : Math.min((now - edge.start) / WALL_MS, 1);
      edge.height = t >= 1 ? edge.to : edge.from + (edge.to - edge.from) * this.ease(t);
      moved = true;
    }
    if (moved) this.writeWalls();
    return moved;
  }

  private wanted(edge: Edge, camera: Vector3): number {
    if (this.mode === "up") return TALL_HEIGHT;
    if (this.mode === "down" || !edge.rear) return CUT_HEIGHT;
    const outside = (camera.x - edge.x) * edge.nx + (camera.z - edge.z) * edge.nz;
    if (outside > HYSTERESIS) return CUT_HEIGHT;
    if (outside < -HYSTERESIS) return TALL_HEIGHT;
    return edge.to;
  }

  private writeWalls(): void {
    const { matrix } = this;
    this.edges.forEach((edge, i) => {
      const height = edge.solid ? edge.height : Math.min(edge.height, CUT_HEIGHT);
      matrix.makeScale(edge.width, height, edge.depth).setPosition(edge.x, 0, edge.z);
      this.walls.setMatrixAt(i, matrix);
      matrix.makeScale(edge.width, CAP_DEPTH, edge.depth).setPosition(edge.x, height, edge.z);
      this.caps.setMatrixAt(i, matrix);
    });
    this.columnsOf.forEach(({ edge, x, z }, i) => {
      this.columns.setMatrixAt(i, matrix.makeScale(COLUMN_SIZE, edge.height, COLUMN_SIZE).setPosition(x, 0, z));
    });
    let arm = 0;
    this.columnsOf.forEach(({ edge, x, z }) => {
      if (!edge.solid) return;
      matrix.makeScale(ARM_WIDTH, ARM_DEPTH, ARM_LENGTH).setPosition(x, edge.height - ARM_DEPTH, z + ARM_LENGTH / 2);
      this.arms.setMatrixAt(arm++, matrix);
    });
    this.arms.visible = !this.dockEdge || this.dockEdge.height > TALL_HEIGHT * 0.9;
    this.walls.instanceMatrix.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
    this.columns.instanceMatrix.needsUpdate = true;
    this.arms.instanceMatrix.needsUpdate = true;
    if (this.dockEdge) this.dock.scale.y = this.dockEdge.height / TALL_HEIGHT;
  }

  private paint(geometry: BufferGeometry, material: Mesh["material"]): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private repaint(mesh: Mesh, parts: BufferGeometry[]): void {
    this.tracker.free(mesh.geometry);
    mesh.geometry = this.tracker.add(parts.length > 0 ? merge(parts) : new BufferGeometry());
  }

  private instanced(geometry: BufferGeometry, material: ConstructorParameters<typeof InstancedMesh>[1], count: number): InstancedMesh {
    const mesh = this.tracker.add(new InstancedMesh(geometry, material, count));
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }
}
