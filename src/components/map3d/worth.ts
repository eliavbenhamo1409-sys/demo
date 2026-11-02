import { valueOf } from "@/lib/map3d/metrics";
import type { MapModel } from "@/lib/map3d/model";
import type { MapObject } from "@/lib/map3d/types";

/** Stock at list prices: never cost, and a product with no price is counted, not guessed. */
export interface Worth {
  total: number;
  unpriced: number;
  /** Value of what has no place on the map. */
  tray: number;
  /** Largest first. */
  places: { object: MapObject; value: number }[];
}

export function worthOf(model: MapModel): Worth {
  const places: Worth["places"] = [];
  let unpriced = 0;
  for (const stock of model.byObject.values()) {
    unpriced += stock.unpriced;
    if (stock.value > 0) places.push({ object: stock.object, value: stock.value });
  }
  places.sort((a, b) => b.value - a.value);

  let tray = 0;
  for (const p of model.tray) {
    const value = valueOf(p);
    if (value === null) unpriced += 1;
    else tray += value;
  }
  return { total: places.reduce((sum, place) => sum + place.value, tray), unpriced, tray, places };
}
