import { Box3, MOUSE, MathUtils, PerspectiveCamera, Plane, Raycaster, Spherical, TOUCH, Vector2, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { insideFootprint } from "../layout";
import type { Insets, MapObject, ViewMode } from "../types";
import type { Tracker } from "./dispose";
import type { Easing } from "./ease";

const ORBIT_FOV = 24;
const TOP_FOV = 12;
const SHELF_FOV = 18;
const WALK_FOV = 52;
const NEAR = 2;
const FAR = 700;
const WALK_NEAR = 0.1;
const WALK_FAR = 220;
/** From a high three-quarter corner: the panel's measured camera, kept as a direction so the distance can fit the stage. */
const HOME_DIRECTION = new Vector3(62, 88, 96).normalize();
const BUILDING_TOP = 7.2;
const FIT_PADDING = 1.04;
const TOP_PHI = 0.001;
const FLIGHT_MS = 700;
const INSET_MS = 280;
/** Room around a rack in shelf view, and what the clip planes keep clear of it. */
const SHELF_MARGIN = 0.5;
const SLICE_MARGIN = 0.6;
const OBJECT_MARGIN = 5;
const EYE = 1.72;
const WALK_SPEED = 5;
const TURN_SPEED = 1.5;
const LOOK_SPEED = 0.004;
const PITCH_LIMIT = 0.6;
const BODY_RADIUS = 0.4;
const WALK_LOOK_AHEAD = 6;
const MAX_STEP = 0.05;

const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const TEXT_FIELDS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

interface Pose {
  target: Vector3;
  radius: number;
  theta: number;
  phi: number;
  fov: number;
}

interface Flight {
  from: Pose;
  to: Pose;
  start: number;
  landing: () => void;
}

interface Tween {
  from: number;
  to: number;
  start: number;
  length: number;
}

export interface Obstacle {
  x: number;
  z: number;
  w: number;
  d: number;
}

const spherical = new Spherical();
const offset = new Vector3();
const forward = new Vector3();
const right = new Vector3();
const upward = new Vector3();
const corner = new Vector3();
const lookAt = new Vector3();
const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const pointer = new Vector2();

function typing(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  return TEXT_FIELDS.has(active.tagName) || (active instanceof HTMLElement && active.isContentEditable);
}

const dialogOpen = () => document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]') !== null;

/** The one camera: free orbit, plan and walk, joined by eased flights. Nothing here depends on a frame's length. */
export class Rig {
  readonly camera = new PerspectiveCamera(ORBIT_FOV, 1, NEAR, FAR);
  private readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private view: ViewMode = "orbit";
  /** What input does now: flying to an object leaves plan view, though plan stays what home means. */
  private input: ViewMode = "orbit";
  private flight: Flight | null = null;
  private width = 0;
  private height = 0;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private shift = { x: 0, y: 0 };
  private shiftTween: { x: Tween; y: Tween } | null = null;
  /** Until someone moves the camera, a resize keeps the model fitted. */
  private resting = true;

  /** A rack in shelf view is a slice of the model: near and far hug it, so what stands in front does not hide it. */
  private sliced: MapObject | null = null;
  private slice = 0;
  private sliceTween: Tween | null = null;

  private obstacles: readonly Obstacle[] = [];
  private walkObjects: readonly MapObject[] = [];
  private readonly keys = new Set<string>();
  private yaw = Math.PI;
  private pitch = 0;
  private lastWalk = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly floor: Box3,
    private readonly tracker: Tracker,
    private readonly ease: Easing,
    private readonly options: { reducedMotion: boolean; coarse: boolean },
    onChange: () => void,
  ) {
    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;
    controls.minDistance = 8;
    controls.maxDistance = 420;
    controls.cursor.copy(floor.getCenter(new Vector3()));
    controls.maxTargetRadius = 46;
    if (options.coarse) {
      // One finger belongs to the page's scroll, so the model never traps it.
      controls.touches = { ONE: null, TWO: TOUCH.DOLLY_PAN };
      canvas.style.touchAction = "pan-y";
    }
    controls.addEventListener("change", onChange);
    controls.addEventListener("start", () => {
      this.flight = null;
      this.resting = false;
    });
    this.controls = controls;
    this.applyInput();

    tracker.listen(window, "keydown", (event: KeyboardEvent) => {
      if (this.view !== "walk" || !KEYS.has(event.code) || typing() || dialogOpen()) return;
      event.preventDefault();
      if (this.keys.size === 0) this.lastWalk = performance.now();
      this.keys.add(event.code);
      onChange();
    });
    tracker.listen(window, "keyup", (event: KeyboardEvent) => {
      this.keys.delete(event.code);
    });
    tracker.listen(window, "blur", () => this.keys.clear());
  }

  get walking(): boolean {
    return this.view === "walk";
  }

  get moving(): boolean {
    return this.flight !== null;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.writeOffset();
    if (this.resting && !this.flight) this.applyPose(this.poseOf(this.view));
    this.camera.updateProjectionMatrix();
  }

  setObjects(objects: readonly MapObject[], obstacles: readonly Obstacle[]): void {
    this.walkObjects = objects;
    this.obstacles = obstacles;
  }

  setView(view: ViewMode, now: number): void {
    this.view = view;
    this.input = view;
    this.keys.clear();
    this.setSlice(null, now);
    this.fly(this.poseOf(view), now);
  }

  home(now: number): void {
    this.setView(this.view, now);
  }

  flyTo(object: MapObject, shelf: boolean, now: number): void {
    if (this.view === "walk") return;
    this.input = "orbit";
    this.setSlice(shelf ? object : null, now);
    this.fly(shelf ? this.shelfPose(object) : this.objectPose(object), now);
  }

  setInsets(insets: Insets, now: number): void {
    this.insets = insets;
    const x = (insets.right - insets.left) / 2;
    const y = (insets.bottom - insets.top) / 2;
    if (this.options.reducedMotion) {
      this.shift = { x, y };
      this.writeOffset();
      return;
    }
    const tween = (from: number, to: number): Tween => ({ from, to, start: now, length: INSET_MS });
    this.shiftTween = { x: tween(this.shift.x, x), y: tween(this.shift.y, y) };
  }

  /** Stops the orbit taking a drag that belongs to an object in edit mode. */
  holdInput(held: boolean): void {
    this.controls.enabled = !held && this.input !== "walk";
  }

  /** Drag to look, for walk mode. */
  look(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_SPEED * 1.25;
    this.pitch = MathUtils.clamp(this.pitch - dy * LOOK_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
    this.writeWalk();
  }

  floorPoint(ndcX: number, ndcY: number, into: Vector3): Vector3 | null {
    this.raycaster.setFromCamera(pointer.set(ndcX, ndcY), this.camera);
    return this.raycaster.ray.intersectPlane(floorPlane, into);
  }

  /** Advances by the clock, so forced frames land a flight exactly as rAF does. Returns whether more frames are needed. */
  step(now: number): boolean {
    let busy = this.stepFlight(now);
    busy = this.stepShift(now) || busy;
    busy = this.stepSlice(now) || busy;
    if (this.flight) return busy;
    if (this.input === "walk") return this.stepWalk(now) || busy;
    this.controls.update();
    this.writeSlice();
    return busy;
  }

  dispose(): void {
    this.controls.dispose();
  }

  /* ───────── flights ───────── */

  private fly(to: Pose, now: number): void {
    const landing = () => {
      this.flight = null;
      this.applyInput();
    };
    this.resting = this.input === this.view && this.input !== "walk" && this.sliced === null;
    this.controls.enabled = this.input === "orbit";
    if (this.options.reducedMotion) {
      this.applyPose(to);
      landing();
      return;
    }
    this.flight = { from: this.currentPose(), to, start: now, landing };
  }

  private stepFlight(now: number): boolean {
    const { flight } = this;
    if (!flight) return false;
    const t = Math.min((now - flight.start) / FLIGHT_MS, 1);
    const eased = this.ease(t);
    const { from, to } = flight;
    const turn = Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
    this.applyPose({
      target: lookAt.lerpVectors(from.target, to.target, eased).clone(),
      radius: from.radius * Math.pow(to.radius / from.radius, eased),
      theta: from.theta + turn * eased,
      phi: MathUtils.lerp(from.phi, to.phi, eased),
      fov: MathUtils.lerp(from.fov, to.fov, eased),
    });
    if (t < 1) return true;
    flight.landing();
    return false;
  }

  private applyPose(pose: Pose): void {
    const { camera, controls } = this;
    camera.position.setFromSpherical(spherical.set(pose.radius, pose.phi, pose.theta)).add(pose.target);
    camera.lookAt(pose.target);
    camera.fov = pose.fov;
    controls.target.copy(pose.target);
    camera.updateMatrixWorld();
    this.writeSlice();
  }

  private currentPose(): Pose {
    const { camera, controls } = this;
    offset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(offset);
    return { target: controls.target.clone(), radius: spherical.radius, theta: spherical.theta, phi: spherical.phi, fov: camera.fov };
  }

  private applyInput(): void {
    const { controls, input } = this;
    controls.enabled = input !== "walk";
    controls.enableRotate = input === "orbit";
    controls.mouseButtons.LEFT = input === "orbit" ? MOUSE.ROTATE : MOUSE.PAN;
    controls.minPolarAngle = input === "top" ? TOP_PHI : 0;
    controls.maxPolarAngle = input === "top" ? TOP_PHI : Math.PI / 2;
  }

  /* ───────── poses ───────── */

  private poseOf(view: ViewMode): Pose {
    if (view === "top") return this.topPose();
    if (view === "walk") return this.walkPose();
    return this.homePose();
  }

  /** Half-spans of the view, in tangents, after what the UI covers. */
  private spans(fov: number): { h: number; v: number } {
    const { width, height, insets } = this;
    const tangent = Math.tan(MathUtils.degToRad(fov / 2));
    const safeHeight = Math.max(height, 1);
    return {
      h: (tangent * Math.max(width - insets.left - insets.right, 1)) / safeHeight,
      v: (tangent * Math.max(height - insets.top - insets.bottom, 1)) / safeHeight,
    };
  }

  /** How far back along `direction` a camera must stand to see the whole box. */
  private fit(box: Box3, target: Vector3, direction: Vector3, top: Vector3, fov: number): number {
    const { h, v } = this.spans(fov);
    right.crossVectors(top, direction).normalize();
    upward.crossVectors(direction, right).normalize();
    let distance = 0;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
      const depth = corner.dot(direction);
      distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / h, depth + Math.abs(corner.dot(upward)) / v);
    }
    return distance * FIT_PADDING;
  }

  private building(): Box3 {
    const box = this.floor.clone();
    box.max.y = BUILDING_TOP;
    return box;
  }

  private homePose(): Pose {
    const target = this.floor.getCenter(new Vector3()).setY(0).add(new Vector3(0, 0, 1));
    spherical.setFromVector3(HOME_DIRECTION);
    const { theta, phi } = spherical;
    return { target, radius: this.fit(this.building(), target, HOME_DIRECTION, new Vector3(0, 1, 0), ORBIT_FOV), theta, phi, fov: ORBIT_FOV };
  }

  private topPose(): Pose {
    const target = this.floor.getCenter(new Vector3()).setY(0);
    const radius = this.fit(this.floor, target, new Vector3(0, 1, 0), new Vector3(0, 0, -1), TOP_FOV);
    return { target, radius, theta: 0, phi: TOP_PHI, fov: TOP_FOV };
  }

  private shelfPose(o: MapObject): Pose {
    const { h, v } = this.spans(SHELF_FOV);
    const radius = Math.max((o.h / 2 + SHELF_MARGIN) / v, (o.w / 2 + SHELF_MARGIN) / h) + o.d / 2;
    return { target: new Vector3(o.x, o.h / 2, o.z), radius, theta: 0, phi: Math.PI / 2, fov: SHELF_FOV };
  }

  private objectPose(o: MapObject): Pose {
    const target = new Vector3(o.x, Math.min(o.h, 2) * 0.4, o.z);
    const box = new Box3(new Vector3(o.x - o.w / 2, 0, o.z - o.d / 2), new Vector3(o.x + o.w / 2, o.h, o.z + o.d / 2));
    box.expandByVector(new Vector3(OBJECT_MARGIN, 0, OBJECT_MARGIN));
    spherical.setFromVector3(HOME_DIRECTION);
    const { theta, phi } = spherical;
    return { target, radius: this.fit(box, target, HOME_DIRECTION, new Vector3(0, 1, 0), ORBIT_FOV), theta, phi, fov: ORBIT_FOV };
  }

  private walkPose(): Pose {
    const start = this.walkStart();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.camera.position.x = start.x;
    forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const target = new Vector3(start.x, EYE, start.z).addScaledVector(forward, WALK_LOOK_AHEAD);
    spherical.setFromVector3(offset.copy(forward).negate());
    return { target, radius: WALK_LOOK_AHEAD, theta: spherical.theta, phi: spherical.phi, fov: WALK_FOV };
  }

  /** The widest clear spot, searched outward from the middle of the floor. */
  private walkStart(): { x: number; z: number } {
    const center = this.floor.getCenter(new Vector3());
    for (let radius = 0; radius < 40; radius += 1) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
        const x = center.x + Math.cos(angle) * radius;
        const z = center.z + Math.sin(angle) * radius;
        if (!this.blocked(x, z)) return { x, z };
      }
    }
    return { x: center.x, z: center.z };
  }

  /* ───────── clip planes ───────── */

  private setSlice(object: MapObject | null, now: number): void {
    if (object) this.sliced = object;
    const to = object ? 1 : 0;
    if (this.options.reducedMotion) {
      this.slice = to;
      if (!object) this.sliced = null;
      return;
    }
    this.sliceTween = { from: this.slice, to, start: now, length: FLIGHT_MS };
  }

  private stepSlice(now: number): boolean {
    const tween = this.sliceTween;
    if (!tween) return false;
    const t = Math.min((now - tween.start) / tween.length, 1);
    this.slice = MathUtils.lerp(tween.from, tween.to, this.ease(t));
    if (t < 1) return true;
    this.sliceTween = null;
    if (tween.to === 0) this.sliced = null;
    return false;
  }

  /** The support of the rack's box along the view: near and far hold the rack and nothing else, from any angle. */
  private writeSlice(): void {
    const { camera, sliced } = this;
    const walking = this.input === "walk";
    let near = walking ? WALK_NEAR : NEAR;
    let far = walking ? WALK_FAR : FAR;
    if (sliced) {
      camera.getWorldDirection(forward);
      offset.set(sliced.x, sliced.h / 2, sliced.z).sub(camera.position);
      const depth = offset.dot(forward);
      const reach = (Math.abs(forward.x) * sliced.w + Math.abs(forward.y) * sliced.h + Math.abs(forward.z) * sliced.d) / 2 + SLICE_MARGIN;
      const sliceNear = Math.max(depth - reach, NEAR);
      const sliceFar = Math.max(depth + reach, sliceNear + 1);
      near = near * Math.pow(sliceNear / near, this.slice);
      far = far * Math.pow(sliceFar / far, this.slice);
    }
    if (near === camera.near && far === camera.far && camera.fov === camera.userData.fov) return;
    camera.near = near;
    camera.far = far;
    camera.userData.fov = camera.fov;
    camera.updateProjectionMatrix();
  }

  /* ───────── insets ───────── */

  private stepShift(now: number): boolean {
    const tween = this.shiftTween;
    if (!tween) return false;
    const t = Math.min((now - tween.x.start) / tween.x.length, 1);
    const eased = this.ease(t);
    this.shift = { x: MathUtils.lerp(tween.x.from, tween.x.to, eased), y: MathUtils.lerp(tween.y.from, tween.y.to, eased) };
    this.writeOffset();
    if (t < 1) return true;
    this.shiftTween = null;
    return false;
  }

  /** Shifts the picture, never the canvas: labels, picking and the rule all follow through the projection matrix. */
  private writeOffset(): void {
    const { camera, width, height, shift } = this;
    if (width === 0 || height === 0) return;
    if (shift.x === 0 && shift.y === 0) camera.clearViewOffset();
    else camera.setViewOffset(width, height, shift.x, shift.y, width, height);
  }

  /* ───────── walk ───────── */

  private stepWalk(now: number): boolean {
    const held = (code: string) => (this.keys.has(code) ? 1 : 0);
    const dt = Math.min((now - this.lastWalk) / 1000, MAX_STEP);
    this.lastWalk = now;
    if (this.keys.size === 0) return false;

    this.yaw += (held("ArrowLeft") - held("ArrowRight")) * TURN_SPEED * dt;
    const ahead = (held("KeyW") + held("ArrowUp") - held("KeyS") - held("ArrowDown")) * WALK_SPEED * dt;
    const across = (held("KeyD") - held("KeyA")) * WALK_SPEED * dt;
    const { position } = this.camera;
    const stepX = Math.sin(this.yaw) * ahead - Math.cos(this.yaw) * across;
    const stepZ = Math.cos(this.yaw) * ahead + Math.sin(this.yaw) * across;
    if (!this.blocked(position.x + stepX, position.z)) position.x += stepX;
    if (!this.blocked(position.x, position.z + stepZ)) position.z += stepZ;
    this.writeWalk();
    return true;
  }

  private writeWalk(): void {
    const { camera, yaw, pitch } = this;
    camera.position.y = EYE;
    const flat = Math.cos(pitch);
    lookAt.set(camera.position.x + Math.sin(yaw) * flat, EYE + Math.sin(pitch), camera.position.z + Math.cos(yaw) * flat);
    camera.lookAt(lookAt);
    this.controls.target.copy(lookAt);
  }

  private blocked(x: number, z: number): boolean {
    if (!insideFootprint(x, z, 2 * BODY_RADIUS, 2 * BODY_RADIUS)) return true;
    const hits = (o: Obstacle) => Math.abs(x - o.x) < o.w / 2 + BODY_RADIUS && Math.abs(z - o.z) < o.d / 2 + BODY_RADIUS;
    return this.obstacles.some(hits) || this.walkObjects.some((o) => o.kind !== "zone" && hits(o));
  }
}
