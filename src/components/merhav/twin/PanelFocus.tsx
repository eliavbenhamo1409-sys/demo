"use client";

import { useEffect } from "react";
import { useUi } from "@/components/app/ui-state";
import { useTwin } from "./Twin";

/** A product opened where the model is in view: the camera goes to the shelf it stands on, and comes back when it closes. */
export function PanelFocus(): null {
  const { panel, closing } = useUi();
  const { engine, itemsOf, spotProduct } = useTwin();
  const productId = panel?.type === "product" && !closing ? panel.id : null;
  const place = productId ? (itemsOf(productId)[0]?.objectId ?? null) : null;

  useEffect(() => {
    if (!engine || !productId || !place) return;
    engine.flyTo({ objectId: place, shelf: true });
    spotProduct(productId);
    return () => {
      spotProduct(null);
      engine.flyTo(null);
    };
  }, [engine, productId, place, spotProduct]);

  return null;
}
