"use client";

import { useEffect, useRef, type ReactElement, type RefObject } from "react";

const BEND = 28;

interface ReachProps {
  world: HTMLElement;
  /** The list the line comes out of; its edge is the door's. */
  rail: RefObject<HTMLElement | null>;
  /** The row it leaves from, found at each draw: rows scroll, and a row that scrolls away takes the line with it. */
  row: () => Element | null;
  /** The node the engine keeps on the point; its transform is the one signal that the picture moved. */
  anchor: HTMLElement;
}

/**
 * The line from a row to any point on the model, drawn the way the rest of the admin draws it (Leader.tsx), which knows
 * only a product's largest pile. Here a row can mean one shelf, one rack or where a movement went.
 */
export function Reach({ world, rail, row, anchor }: ReachProps): ReactElement {
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
      ring.style.opacity = off ? "0" : "";
      if (off) return;
      // Straight out from the plate, then one clean diagonal to the shelf.
      const bend = Math.max(startX - BEND, x + Math.abs(y - startY));
      line.setAttribute("d", `M${startX} ${startY} L${Math.min(bend, startX)} ${startY} L${x} ${y}`);
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
  }, [world, rail, row, anchor]);

  return (
    <svg className="mh-leader" aria-hidden="true">
      <path ref={path} pathLength={1} />
      <circle ref={dot} r={4} />
    </svg>
  );
}
