import type { BufferGeometry, Object3D } from "three";
import { levelY, RACK_LEVELS } from "../layout";
import type { MapObject } from "../types";
import { Batch, type TierOf } from "./batch";
import type { Tracker } from "./dispose";
import type { SceneLooks } from "./stage";

const POST = 0.1;
const SHELF = 0.07;
const LIP_HEIGHT = 0.12;
const LIP_DEPTH = 0.06;

/** Four posts and a solid shelf per level: simple forms read cleanly from across the building. */
export class Racks {
  private readonly posts: Batch;
  private readonly shelves: Batch;
  private readonly lips: Batch;

  constructor(parent: Object3D, looks: SceneLooks, tracker: Tracker, unitBox: BufferGeometry) {
    this.posts = new Batch(parent, unitBox, looks.upright, tracker);
    this.shelves = new Batch(parent, unitBox, looks.shelf, tracker);
    this.lips = new Batch(parent, unitBox, looks.shelfEdge, tracker);
  }

  setObjects(objects: readonly MapObject[]): void {
    this.posts.clear();
    this.shelves.clear();
    this.lips.clear();
    for (const object of objects) if (object.kind === "rack") this.addRack(object);
  }

  flush(tierOf: TierOf): void {
    this.posts.flush(tierOf);
    this.shelves.flush(tierOf);
    this.lips.flush(tierOf);
  }

  private addRack(o: MapObject): void {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) this.posts.add(o.id, o.x + (sx * o.w) / 2, 0, o.z + (sz * o.d) / 2, POST, o.h, POST);
    }
    const levels = o.levels ?? RACK_LEVELS;
    for (let level = 0; level < levels; level++) {
      const deck = levelY(o, level);
      this.shelves.add(o.id, o.x, deck - SHELF, o.z, o.w, SHELF, o.d);
      this.lips.add(o.id, o.x, deck - SHELF - 0.02, o.z + o.d / 2, o.w, LIP_HEIGHT, LIP_DEPTH);
    }
  }
}
