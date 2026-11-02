import { Box3, Raycaster, Vector2, Vector3, type PerspectiveCamera } from "three";
import { levelY, RACK_LEVELS } from "../layout";
import type { MapObject, PickHit } from "../types";

interface Target {
  box: Box3;
  objectId: string;
  level: number | null;
}

const ZONE_HEIGHT = 0.05;

const pointer = new Vector2();
const forward = new Vector3();
const hit = new Vector3();

/** One box per rack level and per object. No readback, no scene raycast: a click costs a short loop. */
export class Picker {
  /** In a rack's close view nothing else stands on the floor to be clicked. */
  only: string | null = null;
  private targets: Target[] = [];
  private readonly raycaster = new Raycaster();

  setObjects(objects: readonly MapObject[]): void {
    this.targets = objects.flatMap((object) => (object.kind === "rack" ? this.rackBoxes(object) : [this.objectBox(object)]));
  }

  /** The near and far planes cut the model in shelf view, and what they cut away cannot be clicked. */
  pick(ndcX: number, ndcY: number, camera: PerspectiveCamera): PickHit | null {
    this.raycaster.setFromCamera(pointer.set(ndcX, ndcY), camera);
    const { ray } = this.raycaster;
    camera.getWorldDirection(forward);
    const axial = ray.direction.dot(forward);
    ray.origin.addScaledVector(ray.direction, camera.near / axial);
    const reach = (camera.far - camera.near) / axial;

    let nearest: Target | null = null;
    let best = reach;
    for (const target of this.targets) {
      if (this.only !== null && target.objectId !== this.only) continue;
      if (!ray.intersectBox(target.box, hit)) continue;
      const distance = hit.distanceTo(ray.origin);
      if (distance < best) {
        best = distance;
        nearest = target;
      }
    }
    return nearest ? { objectId: nearest.objectId, level: nearest.level } : null;
  }

  /** Whatever stands under the pointer, ignoring the level: what a drag in edit mode takes hold of. */
  pickObject(ndcX: number, ndcY: number, camera: PerspectiveCamera): string | null {
    return this.pick(ndcX, ndcY, camera)?.objectId ?? null;
  }

  private rackBoxes(o: MapObject): Target[] {
    const levels = o.levels ?? RACK_LEVELS;
    return Array.from({ length: levels }, (_, level) => {
      const bottom = level === 0 ? 0 : levelY(o, level);
      const top = level + 1 < levels ? levelY(o, level + 1) : o.h;
      return { box: this.boxOf(o, bottom, top), objectId: o.id, level };
    });
  }

  private objectBox(o: MapObject): Target {
    return { box: this.boxOf(o, 0, o.kind === "zone" ? ZONE_HEIGHT : o.h), objectId: o.id, level: null };
  }

  private boxOf(o: MapObject, bottom: number, top: number): Box3 {
    return new Box3(new Vector3(o.x - o.w / 2, bottom, o.z - o.d / 2), new Vector3(o.x + o.w / 2, top, o.z + o.d / 2));
  }
}
