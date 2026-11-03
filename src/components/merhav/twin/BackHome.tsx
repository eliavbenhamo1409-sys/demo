"use client";

import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useUi } from "@/components/app/ui-state";
import { useTwin } from "./Twin";

/** Whoever turned the model by hand gets one button back to the view of the whole floor, and only they do. */
export function BackHome(): ReactElement | null {
  const { engine, world, home, itemsOf } = useTwin();
  const { panel } = useUi();
  const [turned, setTurned] = useState(false);

  // A drawer takes the camera to its shelf and brings it home, so nothing is left to come back from.
  if (turned && panel?.type === "product" && itemsOf(panel.id).length > 0) setTurned(false);

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
    // A new size fits the model to the stage again, so there is nothing left to come back from.
    const refit = () => setTurned(false);
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    canvas.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("resize", refit);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", refit);
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
