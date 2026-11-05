"use client";

import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import { readPalette } from "@/lib/map3d/palette";
import type { MapEngine, MapEngineEvents } from "@/lib/map3d/types";
import { COARSE_POINTER, REDUCED_MOTION } from "./use-device";

/** The page's stylesheet can land after the engine does. */
const PALETTE_RETRY_MS = 100;

/** three is reached only from here, in an effect, so no other page's bundle ever carries it. */
export function useMapEngine(host: RefObject<HTMLDivElement | null>, events: Required<MapEngineEvents>, maxDistance?: number) {
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [failed, setFailed] = useState(false);

  const onPick = useEffectEvent(events.onPick);
  const onHover = useEffectEvent(events.onHover);
  const onDragObject = useEffectEvent(events.onDragObject);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let cancelled = false;
    let created: MapEngine | null = null;

    import("@/lib/map3d/engine").then(
      ({ createMapEngine }) => {
        if (cancelled) return;
        try {
          created = createMapEngine(
            container,
            {
              onPick: (hit) => onPick(hit),
              onHover: (hit) => onHover(hit),
              onDragObject: (id, x, z, done) => onDragObject(id, x, z, done),
            },
            { reducedMotion: window.matchMedia(REDUCED_MOTION).matches, coarse: window.matchMedia(COARSE_POINTER).matches, maxDistance },
          );
          const palette = readPalette();
          if (palette) created.setPalette(palette);
          setEngine(created);
        } catch {
          setFailed(true);
        }
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );

    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [host, maxDistance]);

  useEffect(() => {
    if (!engine) return;
    let retry = 0;
    const paint = () => {
      window.clearTimeout(retry);
      const palette = readPalette();
      if (palette) engine.setPalette(palette);
      else retry = window.setTimeout(paint, PALETTE_RETRY_MS);
    };
    paint();
    // The style's id, or a variant's mark beside it: מרחב 5 changes the scene's tokens while data-theme stays מרחב's.
    const observer = new MutationObserver((changes) => {
      if (changes.some((c) => c.attributeName?.startsWith("data-"))) paint();
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => {
      window.clearTimeout(retry);
      observer.disconnect();
    };
  }, [engine]);

  return { engine, failed };
}
