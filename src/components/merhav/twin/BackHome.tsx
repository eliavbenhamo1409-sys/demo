"use client";

import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useTwin } from "./Twin";

/** Whoever turned the model by hand gets one button back to the view of the whole floor, and only they do. */
export function BackHome(): ReactElement | null {
  const { engine, world, home } = useTwin();
  const [turned, setTurned] = useState(false);

  useEffect(() => {
    const canvas = world?.querySelector("canvas");
    if (!canvas) return;
    let from: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      from = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 5) setTurned(true);
      from = null;
    };
    const wheel = () => setTurned(true);
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    canvas.addEventListener("wheel", wheel, { passive: true });
    return () => {
      canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [world, engine]);

  if (!world || !turned) return null;
  return createPortal(
    <button
      type="button"
      className="mh-back"
      onClick={() => {
        home();
        setTurned(false);
      }}
    >
      מבט כללי
    </button>,
    world,
  );
}
