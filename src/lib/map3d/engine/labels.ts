import { Vector3, type PerspectiveCamera } from "three";
import type { LabelAnchor } from "../types";

interface Glued {
  anchor: LabelAnchor;
  x: number;
  y: number;
}

/** Sub-pixel moves are not worth a style write: a label that drifts half a pixel only blurs. */
const MIN_MOVE = 0.5;
/** Past the edge of any stage, so a label with no place on screen is gone without a second style to manage. */
const AWAY = -9999;

const point = new Vector3();

/** Projects anchors to the stage's CSS pixels and writes only style.transform, in the tick, with no layout read. */
export class Labels {
  private glued: Glued[] = [];

  set(anchors: readonly LabelAnchor[]): void {
    this.glued = anchors.map((anchor) => ({ anchor, x: Number.NaN, y: Number.NaN }));
  }

  update(camera: PerspectiveCamera, width: number, height: number, pixelRatio: number): void {
    for (const label of this.glued) {
      const { anchor } = label;
      point.set(anchor.x, anchor.y, anchor.z).project(camera);
      const hidden = Math.abs(point.z) > 1;
      const x = hidden ? AWAY : Math.round((((point.x + 1) / 2) * width + Number.EPSILON) * pixelRatio) / pixelRatio;
      const y = hidden ? AWAY : Math.round((((1 - point.y) / 2) * height + Number.EPSILON) * pixelRatio) / pixelRatio;
      if (Math.abs(x - label.x) < MIN_MOVE && Math.abs(y - label.y) < MIN_MOVE) continue;
      label.x = x;
      label.y = y;
      anchor.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }
}
