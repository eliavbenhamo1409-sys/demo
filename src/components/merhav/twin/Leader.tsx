"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useAimed, useTwin } from "./Twin";

const BEND = 28;

/**
 * The line from something on the plate to where it stands on the model. It is drawn in the world, under the door, so it
 * comes out from behind the door's edge, and it follows the aim point through any move of the camera: the engine writes
 * that point's transform, which is the one signal that the picture moved.
 */
export function Leader(): ReactElement | null {
  const { world, aimEl, aimFrom } = useTwin();
  const aimed = useAimed();
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (!world || !aimEl) return;
    const draw = () => {
      const line = path.current;
      const ring = dot.current;
      const from = aimFrom.current;
      if (!line || !ring || !from) return;
      const stage = world.getBoundingClientRect();
      const end = aimEl.getBoundingClientRect();
      const x = end.left - stage.left;
      const y = end.top - stage.top;
      const startX = from.x - stage.left;
      const startY = from.y - stage.top;
      const off = x < -100 || y < -100;
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
    watcher.observe(aimEl, { attributes: true, attributeFilter: ["style"] });
    return () => watcher.disconnect();
  }, [world, aimEl, aimFrom, aimed]);

  if (!world || !aimed) return null;
  return createPortal(
    <svg className="mh-leader" aria-hidden="true">
      <path ref={path} pathLength={1} />
      <circle ref={dot} r={4} />
    </svg>,
    world,
  );
}
