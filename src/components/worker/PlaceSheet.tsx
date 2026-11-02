"use client";

import { useMemo, useState, type ReactElement } from "react";
import { ShelfGrid } from "@/components/app/ShelfGrid";
import { Icon } from "@/components/ui/Icon";
import { fmtName, fmtQty } from "@/lib/format";
import { shelfLines, type MapModel } from "@/lib/map3d/model";
import type { MapObject } from "@/lib/map3d/types";
import type { Product } from "@/lib/store";
import { Row, StepHead, useBackToClose } from ".";

function freeWords(object: MapObject, model: MapModel): string {
  const blocks = model.byObject.get(object.id)?.blocks ?? [];
  if (object.kind !== "rack") return blocks.length > 0 ? "יש כאן מוצרים" : "פנוי";
  const free = new Set(shelfLines(object, blocks).filter((line) => line.blocks.length === 0).map((line) => line.level)).size;
  return free === 0 ? "אין מדף פנוי" : free === 1 ? "מדף אחד פנוי" : `${fmtQty(free)} מדפים פנויים`;
}

/** Every place in the warehouse: the rack first, then its shelves as they stand. */
export function PlaceSheet({ product, objects, model, value, rack: firstRack, onPick, onClose }: {
  product: Product;
  objects: readonly MapObject[];
  model: MapModel;
  value: string;
  /** Opens on this rack, when the system knows the rack and not the shelf. */
  rack?: string;
  onPick: (place: string) => void;
  onClose: () => void;
}): ReactElement {
  const [rackId, setRackId] = useState(firstRack ?? "");
  useBackToClose(onClose);
  const places = useMemo(() => objects.filter((o) => o.kind === "rack" || o.kind === "floor"), [objects]);
  const rack = places.find((o) => o.id === rackId);

  return (
    <div className="wk-sheet" role="dialog" aria-modal="true" aria-label="איפה שמת?">
      <div className="wk-sheet-inner">
        <StepHead title={rack ? rack.id : "איפה שמת?"} onBack={rack ? () => setRackId("") : onClose} />
        <p className="wk-pick-context">{fmtName(product.name)}</p>
        <div className="wk-sheet-list">
          {rack ? (
            <ShelfGrid object={rack} product={product} stock={model.byObject.get(rack.id)} value={value} onPick={onPick} />
          ) : (
            <div className="wk-group">
              {places.map((o) => (
                <Row key={o.id} title={o.id} sub={freeWords(o, model)} end={<Icon name="chevron-left" size={20} />} onClick={() => (o.kind === "rack" ? setRackId(o.id) : onPick(o.id))} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
