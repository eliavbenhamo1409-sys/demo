import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type WebGLRenderTarget,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { FOOTPRINT } from "../layout";
import type { ScenePalette, StockFinish } from "../types";
import type { Tracker } from "./dispose";
import { Looks, type Look } from "./looks";

/**
 * A high soft sun over the left of the first view: shadows stay short and fall toward the reader, where they stand a
 * rack on the floor instead of hiding behind it, and the top, left and right of a box each read as their own plane.
 */
const SUN_OFFSET = new Vector3(-16, 60, 4);
const SUN_COLOR = 0xfff5df;
const SKY_COLOR = 0xffffff;
const SKY_GROUND = 0x8d9988;
const EXPOSURE = 1.35;
/** How far past the walls the shadow map reaches, for the shadow the building throws on the stage. */
const SHADOW_MARGIN = 9;
const BUILDING_HEIGHT = 7.6;

/** Stock keeps its colours in every theme: it is the one thing the eye should find first. */
const FINISH: Record<StockFinish, string> = { natural: "#b8c5cb", black: "#4b555c", white: "#e0e6e4", bronze: "#9e8d75" };

export interface SceneLooks {
  slab: Look;
  lane: Look;
  laneMark: Look;
  zone: Look;
  zoneLine: Look;
  wall: Look;
  wallTop: Look;
  column: Look;
  door: Look;
  upright: Look;
  shelf: Look;
  shelfEdge: Look;
  machine: Look;
  machineDetail: Look;
  forkliftBody: Look;
  forkliftDark: Look;
  bar: Record<StockFinish, Look>;
  sheet: Record<StockFinish, Look>;
  skid: Look;
  roll: Look;
  core: Look;
  canister: Look;
  canisterCap: Look;
  carton: Look;
}

function createLooks(looks: Looks): SceneLooks {
  const finishes = (roughness: number): Record<StockFinish, Look> => ({
    natural: looks.add({ color: FINISH.natural, roughness }),
    black: looks.add({ color: FINISH.black, roughness }),
    white: looks.add({ color: FINISH.white, roughness }),
    bronze: looks.add({ color: FINISH.bronze, roughness }),
  });
  const themed = (roughness: number, recede: "tier" | "whole" | "fixed" = "tier") => looks.add({ color: "#888888", roughness, recede });
  return {
    slab: themed(0.85, "fixed"),
    lane: themed(0.85, "fixed"),
    laneMark: themed(0.8, "fixed"),
    zone: themed(0.85, "fixed"),
    zoneLine: themed(0.8, "fixed"),
    wall: themed(0.9, "whole"),
    wallTop: themed(0.9, "whole"),
    column: themed(0.8, "whole"),
    door: themed(0.7, "whole"),
    upright: themed(0.6),
    shelf: themed(0.7),
    shelfEdge: themed(0.7),
    machine: themed(0.6),
    machineDetail: themed(0.6),
    forkliftBody: looks.add({ color: "#62656d", roughness: 0.55, recede: "whole" }),
    forkliftDark: looks.add({ color: "#33353a", roughness: 0.7, recede: "whole" }),
    bar: finishes(0.5),
    sheet: finishes(0.55),
    skid: looks.add({ color: "#8d958e", roughness: 0.75 }),
    roll: looks.add({ color: "#465057", roughness: 0.7 }),
    core: looks.add({ color: "#d9dcd5", roughness: 0.8 }),
    canister: looks.add({ color: "#8fb3b5", roughness: 0.5 }),
    canisterCap: looks.add({ color: "#394a43", roughness: 0.6 }),
    carton: looks.add({ color: "#c9b99f", roughness: 0.85 }),
  };
}

function footprintBox(): Box3 {
  const box = new Box3();
  for (const [x, z] of FOOTPRINT) box.expandByPoint(new Vector3(x, 0, z));
  return box;
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly looks: Looks;
  readonly set: SceneLooks;
  readonly floor: Box3;
  private readonly background = new Color("#eef0ec");
  private readonly ground: Mesh<PlaneGeometry, ShadowMaterial>;
  private readonly sky = new HemisphereLight(SKY_COLOR, SKY_GROUND, 2.2);
  private readonly sun = new DirectionalLight(SUN_COLOR, 3);
  private studio: WebGLRenderTarget | null = null;

  constructor(container: HTMLElement, private readonly tracker: Tracker, coarse: boolean) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    this.looks = new Looks(tracker);
    this.set = createLooks(this.looks);
    this.scene.background = this.background;
    this.scene.add(this.sky);

    this.floor = footprintBox();
    this.addSun(coarse);

    const groundGeometry = tracker.add(new PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2));
    const groundMaterial = tracker.add(new ShadowMaterial({ opacity: 0.16 }));
    this.ground = new Mesh(groundGeometry, groundMaterial);
    this.ground.position.y = -0.26;
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    this.scene.add(this.ground);
  }

  add(object: Object3D): void {
    this.scene.add(object);
  }

  setPalette(palette: ScenePalette): void {
    const { set, looks } = this;
    this.background.set(palette.canvas);
    this.ground.material.opacity = palette.groundShadow;
    this.sky.intensity = palette.sky;
    this.sun.intensity = palette.sun;
    this.sun.color.set(palette.sunColor || SUN_COLOR);
    this.sky.groundColor.set(palette.bounce || SKY_GROUND);
    this.scene.environmentIntensity = palette.studio;
    if (palette.studio > 0 && !this.studio) this.buildStudio();
    for (const look of [set.upright, set.shelf, set.shelfEdge, set.machine, set.column, set.door, ...Object.values(set.bar), ...Object.values(set.sheet)]) {
      look.setMetal(palette.metal);
    }
    set.slab.setColor(palette.slab);
    set.lane.setColor(palette.lane);
    set.laneMark.setColor(palette.laneMark);
    set.zone.setColor(palette.zone);
    set.zoneLine.setColor(palette.zoneLine);
    set.wall.setColor(palette.wall);
    set.wallTop.setColor(palette.wallTop);
    set.column.setColor(palette.column);
    set.door.setColor(palette.door);
    set.upright.setColor(palette.upright);
    set.shelf.setColor(palette.shelf);
    set.shelfEdge.setColor(palette.shelfEdge);
    set.machine.setColor(palette.machine);
    set.machineDetail.setColor(palette.machineDetail);
    looks.setCanvas(palette.canvas);
    looks.write();
  }

  invalidateShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** A render target goes with a lost context, and metal with nothing to reflect draws black. */
  restoreStudio(): void {
    if (this.studio) this.buildStudio();
  }

  /** Soft boxes for the metal to catch. One render, once. */
  private buildStudio(): void {
    const generator = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const studio = this.tracker.add(generator.fromScene(room, 0.04));
    if (this.studio) this.tracker.free(this.studio);
    this.studio = studio;
    this.scene.environment = studio.texture;
    room.dispose();
    generator.dispose();
  }

  private addSun(coarse: boolean): void {
    const center = this.floor.getCenter(new Vector3());
    const { sun } = this;
    sun.target.position.set(center.x, 0, center.z);
    sun.position.copy(sun.target.position).add(SUN_OFFSET);
    sun.castShadow = true;
    const size = coarse ? 2048 : 4096;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.03;
    sun.shadow.intensity = 0.6;

    const camera = sun.shadow.camera;
    camera.position.copy(sun.position);
    camera.lookAt(sun.target.position);
    camera.updateMatrixWorld();
    const reach = this.floor.clone().expandByVector(new Vector3(SHADOW_MARGIN, 0, SHADOW_MARGIN));
    reach.min.y = -0.3;
    reach.max.y = BUILDING_HEIGHT;
    const seen = new Box3();
    const corner = new Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? reach.max.x : reach.min.x, i & 2 ? reach.max.y : reach.min.y, i & 4 ? reach.max.z : reach.min.z);
      seen.expandByPoint(corner.applyMatrix4(camera.matrixWorldInverse));
    }
    camera.left = seen.min.x;
    camera.right = seen.max.x;
    camera.bottom = seen.min.y;
    camera.top = seen.max.y;
    camera.near = -seen.max.z - 1;
    camera.far = -seen.min.z + 1;
    camera.updateProjectionMatrix();

    this.scene.add(sun, sun.target);
  }
}
