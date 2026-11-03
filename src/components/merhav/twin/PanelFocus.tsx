"use client";

import { useEffect } from "react";
import { useUi } from "@/components/app/ui-state";
import { useTwin } from "./Twin";

/** A product opened where the model is in view: the camera goes to the shelf it stands on, and comes back when it closes. */
export function PanelFocus(): null {
  const { panel, closing } = useUi();
  const { engine, itemsOf, spotOver, holdCamera } = useTwin();
  const productId = panel?.type === "product" && !closing ? panel.id : null;
  const first = productId ? itemsOf(productId)[0] : undefined;
  const place = first?.objectId ?? null;
  // Which shelf, spelled out: a ledger that reloads hands over new objects for the same place.
  const shelf = first ? `${first.level}/${first.side}` : null;

  useEffect(() => {
    if (!engine || !productId || !place) return;
    holdCamera({ objectId: place, shelf: true });
    spotOver({ product: productId });
    return () => {
      spotOver(null);
      holdCamera(null);
    };
  }, [engine, productId, place, shelf, spotOver, holdCamera]);

  return null;
}
