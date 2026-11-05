"use client";

import { useEffect, useMemo } from "react";
import { useUi } from "@/components/app/ui-state";
import { useTwin } from "@/components/merhav/twin/Twin";
import { resolvePlace } from "@/lib/map3d/place";
import { useData } from "@/lib/store";

interface Target {
  ids: string[];
  at: string;
  product?: string;
  shelf: boolean;
}

/**
 * What a drawer shows, found on the model: an order lights the racks of its lines, a fault its machine or its product's
 * shelf, a movement the place it took stock from or to. The camera holds there in the window over the panel and comes
 * back when the drawer closes. A product's drawer is PanelFocus's, shared with מרחב.
 */
export function AsideFocus(): null {
  const { panel, closing } = useUi();
  const { engine, itemsOf, objects, spotOver, holdCamera } = useTwin();
  const { state, linesOf } = useData();

  const target = useMemo<Target | null>(() => {
    if (!panel || closing) return null;
    if (panel.type === "movement") {
      const m = panel.movement;
      const place = resolvePlace(m.place, objects)?.objectId ?? itemsOf(m.product_id)[0]?.objectId ?? null;
      return place ? { ids: [place], at: place, product: m.product_id, shelf: true } : null;
    }
    if (panel.type === "order") {
      const ids = [...new Set(linesOf(panel.id).flatMap((l) => itemsOf(l.product_id).map((item) => item.objectId)))];
      return ids.length > 0 ? { ids, at: ids[0], shelf: false } : null;
    }
    if (panel.type === "fault") {
      const fault = state.faults.find((f) => f.id === panel.id);
      if (!fault) return null;
      const asset = fault.asset && objects.some((o) => o.id === fault.asset) ? fault.asset : null;
      if (asset) return { ids: [asset], at: asset, shelf: false };
      const place = fault.product_id ? (itemsOf(fault.product_id)[0]?.objectId ?? null) : null;
      return place && fault.product_id ? { ids: [place], at: place, product: fault.product_id, shelf: true } : null;
    }
    return null;
  }, [panel, closing, objects, itemsOf, linesOf, state.faults]);

  // Spelled out, so a ledger that reloads under an open drawer doesn't move the camera again.
  const key = target ? `${target.at}|${target.ids.join()}|${target.product ?? ""}` : null;

  useEffect(() => {
    if (!engine || !target) return;
    holdCamera({ objectId: target.at, shelf: target.shelf });
    spotOver(target.product ? { product: target.product } : { ids: target.ids });
    return () => {
      spotOver(null);
      holdCamera(null);
    };
    // The target is read through its key, so an equal target found again holds still.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key, holdCamera, spotOver]);

  return null;
}
