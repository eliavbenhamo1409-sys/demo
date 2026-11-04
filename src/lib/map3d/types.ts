/**
 * The contract of the 3D page. Three-free, so it can be imported anywhere.
 *
 * One rule runs through it: products.qty is the only total, and shelf_stock only says where it stands. Layout holds
 * geometry, the engine holds pieces to draw, and every number a person reads comes from the store through the DOM.
 * All lengths are metres. x and z are floor coordinates, y is height, z grows toward the viewer.
 */

/* ───────── layout ───────── */

export type MapObjectKind = "rack" | "floor" | "machine" | "zone";

/** Which silhouette a machine is built with. Trade neutral: "generic" is a plain enclosure. */
export type MachineModel = "saw" | "cnc" | "press" | "generic";

export interface MapObject {
  /** The code on the floor (A-1, F-02, M-03, Z-01), which is also what products.location points at. */
  id: string;
  kind: MapObjectKind;
  name: string;
  /** Centre on the floor. */
  x: number;
  z: number;
  /** Size along x, along z, and height. */
  w: number;
  d: number;
  h: number;
  /** Rack only. Defaults to RACK_LEVELS. */
  levels?: number;
  /** Machine only. */
  model?: MachineModel;
  note?: string;
}

/* ───────── stock as the engine sees it ───────── */

export type BarSection = "tube" | "channel" | "angle";

/** The real shape of one unit. a and b are the outer section, wall the thickness. */
export type StockForm =
  | { form: "bar"; section: BarSection; a: number; b: number; wall: number; length: number }
  | { form: "sheet"; width: number; length: number; thickness: number }
  | { form: "roll"; od: number; id: number; height: number; length: number }
  | { form: "canister"; width: number; depth: number; height: number; litres: number }
  | { form: "carton"; width: number; depth: number; height: number };

export type StockFinish = "natural" | "black" | "white" | "bronze";

/** A half of a shelf, as seen from the aisle: right is +x. */
export type ShelfSide = "right" | "left";

/** One product in one place. Every piece is drawn, so the shelf can be counted against the ledger. */
export interface StockSlot {
  /** The product and its place. Stable, so what changes can slide on or off the shelf. */
  key: string;
  objectId: string;
  /** Zero based, 0 is the bottom level. Null: unknown, the stock fills from the bottom up. */
  level: number | null;
  /** Null: the whole shelf. */
  side: ShelfSide | null;
  form: StockForm;
  finish: StockFinish;
  /** Whole pieces in this place: its share of products.qty, as bars where it is sold by the metre. */
  count: number;
}

/* ───────── what the rail shows ───────── */

/** The same words the store's attention list uses. See stockState in store.tsx. */
export type StockState = "ok" | "low" | "out" | "short";

/* ───────── theme ───────── */

/** Read from CSS by readPalette(). Soft albedos under one shared rig; only these change per theme. */
export interface ScenePalette {
  /** The stage behind the model. */
  canvas: string;
  slab: string;
  grid: string;
  wall: string;
  wallTop: string;
  column: string;
  door: string;
  upright: string;
  shelf: string;
  shelfEdge: string;
  machine: string;
  machineDetail: string;
  lane: string;
  laneMark: string;
  zone: string;
  zoneLine: string;
  ink: string;
  focus: string;
  /** The weekly chart's green, for footprints. */
  chart: string;
  in: string;
  out: string;
  warn: string;
  /** Opacity of the shadow the building throws on the stage. */
  groundShadow: number;
  /** Strength of the sky and of the sun. */
  sky: number;
  sun: number;
  /** The sun's colour and what the floor bounces up. Empty: the engine's own. */
  sunColor: string;
  bounce: string;
  /** Strength of the soft boxes the metal reflects. Zero: none. */
  studio: number;
  /** How much of the racks, the machines and the bars is metal. */
  metal: number;
  /** Opacity of the soft pool under what stands on the floor. */
  contact: number;
  /** Stock and forklift colours for a theme that sets its own. Empty: the engine's. */
  forklift: string;
  stock: Readonly<Record<StockFinish | "roll" | "canister" | "carton", string>>;
}

/* ───────── engine ───────── */

export type ViewMode = "orbit" | "top" | "walk";

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PickHit {
  objectId: string;
  /** The level clicked, when the object is a rack. */
  level: number | null;
  /** The half clicked. Without it a rule on the map covers the whole shelf. */
  side?: ShelfSide | null;
  /** The top level of a block of shelves, which the rule follows. */
  through?: number;
}

/** A point in the scene, in metres. */
export interface ScenePoint {
  x: number;
  y: number;
  z: number;
}

/** The middle of a face, with the face's outward normal. */
export interface SceneFace extends ScenePoint {
  nx: number;
  ny: number;
  nz: number;
}

/** A DOM node the engine keeps glued to a point in the scene. React owns the content, the engine only writes style.transform. */
export interface LabelAnchor extends ScenePoint {
  el: HTMLElement;
  /** The faces of a pile it may stand on instead of the point: each frame it takes the one that looks most at the eye. */
  faces?: readonly SceneFace[];
}

export type MapPoint = readonly [x: number, z: number];

export interface MapRoute {
  points: readonly MapPoint[];
  /** Ink for a route that stays, in or out for the trace of a real movement, warn or out for what needs a hand. */
  tone: "ink" | "focus" | "in" | "out" | "warn";
}

export interface MapEngineEvents {
  /** A click that was not a drag. Null: empty floor. */
  onPick: (hit: PickHit | null) => void;
  onHover: (hit: PickHit | null) => void;
  /** Edit mode: an object is being dragged, snapped to 0.5 m. `done` on release. */
  onDragObject?: (id: string, x: number, z: number, done: boolean) => void;
}

export interface MapEngineOptions {
  reducedMotion: boolean;
  /** A touch device: smaller shadow map, one finger scrolls the page. */
  coarse: boolean;
  /** How far the camera may stand back, for a model fitted into a narrow part of the stage. Stay under the far plane. */
  maxDistance?: number;
}

export interface MapEngine {
  setPalette(palette: ScenePalette): void;
  setLayout(objects: readonly MapObject[]): void;
  /** No-ops on identical input. `animate`: what changed slides on or off the shelf, only for a real new movement. */
  setStock(slots: readonly StockSlot[], options?: { animate?: boolean }): void;
  setView(view: ViewMode): void;
  /** Flies to an object, to the front of its shelf, or home with null. */
  flyTo(target: { objectId: string; shelf?: boolean } | null): void;
  /** One thin rule in the focus colour around the object, or along the front beam of a level. */
  setSelection(selection: PickHit | null): void;
  /** Everything but these ids recedes toward the canvas. Null: nothing recedes. */
  setEmphasis(ids: ReadonlySet<string> | null): void;
  /** Flat fills on the floor under objects, strength 0 to 1 in the chart colour. Null: none. */
  setFootprints(items: readonly { objectId: string; strength: number }[] | null): void;
  /** Lines that stay on the floor until replaced, such as an order's picks. */
  setRoutes(routes: readonly MapRoute[]): void;
  /** A line drawn once along the floor and faded, for one real movement. */
  trace(route: MapRoute): void;
  /** Stands the forklift at this object, forks to it. Null: its own spot. `animate`: it drives there along the aisles. */
  setForklift(objectId: string | null, options?: { animate?: boolean }): void;
  /** CSS pixels of the stage covered by UI, so the model centres in what is left. */
  setInsets(insets: Insets): void;
  setLabels(labels: readonly LabelAnchor[]): void;
  /** Plan view with objects draggable. */
  setEditing(on: boolean): void;
  /** Draws one frame now. Needed by a hidden page, where requestAnimationFrame never fires. */
  renderNow(): void;
  stats(): { calls: number; triangles: number; geometries: number; textures: number; frames: number };
  dispose(): void;
}

export type CreateMapEngine = (container: HTMLElement, events: MapEngineEvents, options: MapEngineOptions) => MapEngine;
