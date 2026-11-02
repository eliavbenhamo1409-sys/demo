"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtSigned } from "@/lib/format";
import { DISPATCH_ZONE, RECEIVING_ZONE } from "@/lib/map3d/layout";
import { routeBetween } from "@/lib/map3d/route";
import type { MapEngine, MapObject, MapRoute, StockSlot } from "@/lib/map3d/types";
import { isTempId, useData, type Movement } from "@/lib/store";
import type { LabelFlash } from "./Labels";

const FLASH_MS = 1200;
/** A movement and the product row it changes arrive one after the other, in either order. */
const MOTION_WINDOW_MS = 2000;
const SETTLE_MS = 250;
/** A reconnect can bring a long list at once; the floor shows the latest few. */
const MOTION_LIMIT = 8;

const NO_FLASHES: ReadonlyMap<string, LabelFlash> = new Map();

function flashOf(m: Movement): LabelFlash | null {
  if (m.type === "fault") return null;
  return { text: fmtSigned(m.qty, m.type), className: `sa-signed is-${m.type}` };
}

function traceOf(m: Movement, place: string, objects: readonly MapObject[]): MapRoute | null {
  if (m.type === "in") return { points: routeBetween(objects, RECEIVING_ZONE, place), tone: "in" };
  if (m.type === "out") return { points: routeBetween(objects, place, DISPATCH_ZONE), tone: "out" };
  return null;
}

interface LiveOptions {
  engine: MapEngine | null;
  /** What the shelves hold now. */
  slots: readonly StockSlot[];
  /** What they held at the date on screen, which wins over `slots`. */
  pastSlots: readonly StockSlot[] | null;
  objects: readonly MapObject[];
  placeOf: (productId: string) => string | null;
}

/**
 * Keeps the drawn stock on the ledger. The one thing that moves it is a movement id this page has not seen:
 * the store's reload replaces every array each minute, so a change of products alone proves nothing.
 */
export function useLiveStock({ engine, slots, pastSlots, objects, placeOf }: LiveOptions): ReadonlyMap<string, LabelFlash> {
  const { state } = useData();
  const [flashes, setFlashes] = useState(NO_FLASHES);
  const seen = useRef<Set<string> | null>(null);
  const motionUntil = useRef(0);
  const drawn = useRef(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = useCallback((ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  }, []);

  const dated = pastSlots !== null;
  // An optimistic row has no id yet; its quantity waits here for the real one to say it moved.
  const held = state.movements.some((m) => isTempId(m.id));

  useEffect(() => {
    if (state.status !== "ready") return;
    if (seen.current === null) {
      seen.current = new Set(state.movements.map((m) => m.id));
      return;
    }
    const known = seen.current;
    const fresh = state.movements.filter((m) => !isTempId(m.id) && !known.has(m.id));
    if (fresh.length === 0) return;
    for (const m of fresh) known.add(m.id);
    if (dated || !engine) return;

    motionUntil.current = performance.now() + MOTION_WINDOW_MS;
    const shown = fresh.slice(0, MOTION_LIMIT);
    const flashed = new Map<string, LabelFlash>();
    for (const m of [...shown].reverse()) {
      const place = placeOf(m.product_id);
      const flash = flashOf(m);
      if (!place) continue;
      const route = traceOf(m, place, objects);
      if (route && route.points.length > 1) engine.trace(route);
      if (flash) flashed.set(place, flash);
    }
    if (flashed.size === 0) return;

    // The figure turns up with the units it speaks of, which wait the same time below.
    later(SETTLE_MS, () => {
      setFlashes((current) => new Map([...current, ...flashed]));
      later(FLASH_MS, () => {
        setFlashes((current) => {
          const next = new Map(current);
          for (const [place, flash] of flashed) if (next.get(place) === flash) next.delete(place);
          return next;
        });
      });
    });
  }, [state.movements, state.status, dated, engine, objects, placeOf, later]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!engine) return;
    if (pastSlots) {
      drawn.current = false;
      engine.setStock(pastSlots);
      return;
    }
    if (held) return;
    if (!drawn.current) {
      drawn.current = true;
      engine.setStock(slots);
      return;
    }
    const timer = setTimeout(() => engine.setStock(slots, { animate: performance.now() < motionUntil.current }), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [engine, slots, pastSlots, held]);

  return flashes;
}
