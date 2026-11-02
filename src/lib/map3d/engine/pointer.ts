import { Vector3 } from "three";
import type { MapEngineEvents, MapObject, PickHit } from "../types";
import type { Tracker } from "./dispose";
import type { Picker } from "./pick";
import type { Rig } from "./rig";

/** A press that travels further than this is a drag, not a click. */
const CLICK_TRAVEL = 5;
const SNAP = 0.5;

const snap = (value: number) => Math.round(value / SNAP) * SNAP;

const floorHit = new Vector3();

interface Press {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  travelled: boolean;
}

interface Drag {
  id: string;
  /** From the pointer on the floor to the object's centre, so it does not jump to the cursor. */
  dx: number;
  dz: number;
  x: number;
  z: number;
}

/** Turns pointer events into picks, hovers, looks and object drags. */
export class PointerInput {
  private press: Press | null = null;
  private drag: Drag | null = null;
  private hovered: PickHit | null = null;
  private objects: readonly MapObject[] = [];
  editing = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    tracker: Tracker,
    private readonly rig: Rig,
    private readonly picker: Picker,
    private readonly events: MapEngineEvents,
  ) {
    // Capture: an object drag must take the press before the orbit controls see it.
    tracker.listen(canvas, "pointerdown", (event: PointerEvent) => this.down(event), { capture: true });
    tracker.listen(canvas, "pointermove", (event: PointerEvent) => this.move(event));
    tracker.listen(canvas, "pointerup", (event: PointerEvent) => this.up(event));
    tracker.listen(canvas, "pointercancel", () => this.cancel());
    tracker.listen(canvas, "pointerleave", () => this.setHover(null));
  }

  setObjects(objects: readonly MapObject[]): void {
    this.objects = objects;
  }

  private ndc(event: PointerEvent): readonly [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2];
  }

  private down(event: PointerEvent): void {
    this.press = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, travelled: false };
    // Nothing else holds the pointer in walk view, and a release over a label would leave the look running.
    if (this.rig.walking) this.canvas.setPointerCapture(event.pointerId);
    if (this.editing && event.button === 0) this.startDrag(event);
  }

  private startDrag(event: PointerEvent): void {
    const [x, y] = this.ndc(event);
    const id = this.picker.pickObject(x, y, this.rig.camera);
    const object = this.objects.find((candidate) => candidate.id === id);
    if (!object || !this.rig.floorPoint(x, y, floorHit)) return;
    this.drag = { id: object.id, dx: object.x - floorHit.x, dz: object.z - floorHit.z, x: object.x, z: object.z };
    this.rig.holdInput(true);
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.style.cursor = "grabbing";
  }

  private move(event: PointerEvent): void {
    const { press, drag } = this;
    if (press) {
      if (Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) > CLICK_TRAVEL) press.travelled = true;
      if (this.rig.walking) this.rig.look(event.clientX - press.lastX, event.clientY - press.lastY);
      press.lastX = event.clientX;
      press.lastY = event.clientY;
      if (drag) this.moveDrag(event, drag);
      return;
    }
    if (event.pointerType !== "mouse") return;
    const [x, y] = this.ndc(event);
    this.setHover(this.picker.pick(x, y, this.rig.camera));
  }

  private moveDrag(event: PointerEvent, drag: Drag): void {
    const [x, y] = this.ndc(event);
    if (!this.rig.floorPoint(x, y, floorHit)) return;
    const snappedX = snap(floorHit.x + drag.dx);
    const snappedZ = snap(floorHit.z + drag.dz);
    if (snappedX === drag.x && snappedZ === drag.z) return;
    drag.x = snappedX;
    drag.z = snappedZ;
    this.events.onDragObject?.(drag.id, snappedX, snappedZ, false);
  }

  private up(event: PointerEvent): void {
    const { press, drag } = this;
    this.press = null;
    this.drag = null;
    if (drag) {
      this.rig.holdInput(false);
      this.canvas.style.cursor = "";
      if (press?.travelled) this.events.onDragObject?.(drag.id, drag.x, drag.z, true);
      else this.events.onPick({ objectId: drag.id, level: null });
      return;
    }
    if (!press || press.travelled || event.button !== 0) return;
    const [x, y] = this.ndc(event);
    this.events.onPick(this.picker.pick(x, y, this.rig.camera));
  }

  private cancel(): void {
    if (this.drag) this.rig.holdInput(false);
    this.press = null;
    this.drag = null;
  }

  private setHover(hit: PickHit | null): void {
    const { hovered } = this;
    if (hit?.objectId === hovered?.objectId && hit?.level === hovered?.level && hit?.side === hovered?.side) return;
    this.hovered = hit;
    this.canvas.style.cursor = hit ? "pointer" : "";
    this.events.onHover(hit);
  }
}
