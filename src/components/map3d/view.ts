import type { MovementHistory } from "./use-history";
import type { MapModel } from "@/lib/map3d/model";
import type { Trail } from "@/lib/map3d/trail";
import type { MapObject, PickHit } from "@/lib/map3d/types";
import type { Movement } from "@/lib/store";

/** What every part of the rail reads about the map. */
export interface MapView {
  objects: readonly MapObject[];
  model: MapModel;
  trail: Trail | null;
  /** Epoch ms, moves with the page's clock. */
  now: number;
  /** The trail's window, newest first. */
  recent: readonly Movement[];
  /** All movements ever, loaded when something needs them. */
  ledger: MovementHistory;
  /** The object a product stands on; null when it waits in the tray. */
  placeOf: (productId: string) => string | null;
  select: (objectId: string, shelf?: PickHit) => void;
  /** Goes to the shelf that holds most of a product. */
  selectProduct: (productId: string) => void;
}
