"use client";

import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import { readPalette } from "@/lib/map3d/palette";
import type { MapEngine, MapEngineEvents } from "@/lib/map3d/types";
import { COARSE_POINTER, REDUCED_MOTION } from "./use-device";

/** The page's stylesheet can land after the engine does. */
const PALETTE_RETRY_MS = 100;

/** three is reached only from here, in an effect, so no other page's bundle ever carries it. */
export function useMapEngine(host: RefObject<HTMLDivElement | null>, events: Required<MapEngineEvents>) {
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
            { reducedMotion: window.matchMedia(REDUCED_MOTION).matches, coarse: window.matchMedia(COARSE_POINTER).matches },
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
  }, [host]);

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
    const observer = new MutationObserver(paint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.clearTimeout(retry);
      observer.disconnect();
    };
  }, [engine]);

  return { engine, failed };
}
