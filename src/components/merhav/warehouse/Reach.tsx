"use client";

import { useEffect, useRef, type ReactElement, type RefObject } from "react";

const BEND = 28;
/** The air the line leaves between its end and the edge of a card. */
const AIR = 3;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const inside = (x: number, y: number, box: Box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/** Where the segment from a to b first enters the box, or a itself when it starts inside. */
function entry(ax: number, ay: number, bx: number, by: number, box: Box): [number, number] {
  const [dx, dy] = [bx - ax, by - ay];
  let first = Number.POSITIVE_INFINITY;
  const cross = (t: number, x: number, y: number) => {
    if (t >= 0 && t <= 1 && t < first && inside(x, y, box)) first = t;
  };
  if (dx !== 0) {
    for (const edge of [box.left, box.right]) {
      const t = (edge - ax) / dx;
      cross(t, edge, ay + t * dy);
    }
  }
  if (dy !== 0) {
    for (const edge of [box.top, box.bottom]) {
      const t = (edge - ay) / dy;
      cross(t, ax + t * dx, edge);
    }
  }
  return Number.isFinite(first) ? [ax + first * dx, ay + first * dy] : [ax, ay];
}

interface ReachProps {
  world: HTMLElement;
  /** The list the line comes out of; its edge is the door's. */
  rail: RefObject<HTMLElement | null>;
  /** The row it leaves from, found at each draw: rows scroll, and a row that scrolls away takes the line with it. */
  row: () => Element | null;
  /** The node the engine keeps on the point; its transform is the one signal that the picture moved. */
  anchor: HTMLElement;
  /** The tag that stands on the point, when one does: the line stops at its edge instead of running under it. */
  card?: () => Element | null;
}

/**
 * The line from a row to any point on the model, drawn the way the rest of the admin draws it (Leader.tsx), which knows
 * only a product's largest pile. Here a row can mean one shelf, one rack or where a movement went.
 */
export function Reach({ world, rail, row, anchor, card }: ReachProps): ReactElement {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const list = rail.current;
    const draw = () => {
      const line = path.current;
      const ring = dot.current;
      if (!line || !ring || !list) return;
      const stage = world.getBoundingClientRect();
      const plate = list.getBoundingClientRect();
      const end = anchor.getBoundingClientRect();
      const from = row()?.getBoundingClientRect();
      const x = end.left - stage.left;
      const y = end.top - stage.top;
      const startX = plate.left - stage.left;
      const startY = from ? from.top + from.height / 2 - stage.top : -1;
      const off = x < -100 || y < -100 || startY < plate.top - stage.top || startY > plate.bottom - stage.top;
      line.style.opacity = off ? "0" : "";
      if (off) {
        ring.style.opacity = "0";
        return;
      }
      // Straight out from the plate, then one clean diagonal to the shelf.
      const bend = Math.min(Math.max(startX - BEND, x + Math.abs(y - startY)), startX);
      // A card standing on the point takes the line at its edge, and needs no dot under it.
      const face = card?.()?.getBoundingClientRect();
      const box: Box | null = face && face.width > 0 ? { left: face.left - stage.left - AIR, right: face.right - stage.left + AIR, top: face.top - stage.top - AIR, bottom: face.bottom - stage.top + AIR } : null;
      const onCard = box !== null && inside(x, y, box);
      const [endX, endY] = onCard && box ? entry(bend, startY, x, y, box) : [x, y];
      line.setAttribute("d", `M${startX} ${startY} L${bend} ${startY} L${endX} ${endY}`);
      ring.style.opacity = onCard ? "0" : "";
      ring.setAttribute("cx", String(x));
      ring.setAttribute("cy", String(y));
    };
    draw();
    const watcher = new MutationObserver(draw);
    watcher.observe(anchor, { attributes: true, attributeFilter: ["style"] });
    list?.addEventListener("scroll", draw, { passive: true });
    return () => {
      watcher.disconnect();
      list?.removeEventListener("scroll", draw);
    };
  }, [world, rail, row, anchor, card]);

  return (
    <svg className="mh-leader" aria-hidden="true">
      <path ref={path} pathLength={1} />
      <circle ref={dot} r={4} />
    </svg>
  );
}
