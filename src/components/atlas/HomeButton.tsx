"use client";

import { useEffect, useState, type ReactElement } from "react";

/**
 * Whoever turned the model by hand gets one button back to the fitted view, and only they do. It stands on the page's
 * frame, where it can be seen: the world's own corner lies under the side column here.
 */
export function HomeButton({ world, onHome }: { world: HTMLElement | null; onHome: () => void }): ReactElement | null {
  const [turned, setTurned] = useState(false);

  useEffect(() => {
    const canvas = world?.querySelector("canvas");
    if (!canvas) return;
    let from: { x: number; y: number } | null = null;
    let size = [window.innerWidth, window.innerHeight];
    const down = (e: PointerEvent) => {
      from = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 5) setTurned(true);
      from = null;
    };
    const wheel = () => setTurned(true);
    // A new window size fits the model to the frame again, so there is nothing left to come back from. A frame that only
    // moved sends the same event, and the view stays turned.
    const refit = () => {
      if (window.innerWidth === size[0] && window.innerHeight === size[1]) return;
      size = [window.innerWidth, window.innerHeight];
      setTurned(false);
    };
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
  }, [world]);

  if (!turned) return null;
  return (
    <button
      type="button"
      className="at-home"
      onClick={() => {
        onHome();
        setTurned(false);
      }}
    >
      מבט כללי
    </button>
  );
}
