"use client";

import { useMemo, useState } from "react";
import { cx, Select, type SelectOption } from "@/components/ui";
import { useFloorObjects } from "@/components/map3d/use-floor-objects";
import { buildMapModel } from "@/lib/map3d/model";
import { placeWords, resolvePlace } from "@/lib/map3d/place";
import { useShelves } from "@/lib/map3d/shelves";
import { suggestPlaces, WHY_WORD } from "@/lib/map3d/suggest";
import { useData, type Product } from "@/lib/store";
import { ShelfGrid } from "../ShelfGrid";

interface PlaceFieldProps {
  label?: string;
  optional?: boolean;
  product: Product;
  value: string;
  onChange: (place: string) => void;
  error?: string;
}

/** Where stock goes: the usual place in one click, or any place from the rack as it stands. */
export function PlaceField({ label = "מיקום", optional, product, value, onChange, error }: PlaceFieldProps) {
  const { state } = useData();
  const { rows, usual } = useShelves();
  const objects = useFloorObjects();
  const [rackId, setRackId] = useState(() => resolvePlace(value, objects)?.objectId ?? "");

  const model = useMemo(() => buildMapModel(state.products, objects, rows), [state.products, objects, rows]);
  const quick = useMemo(() => suggestPlaces(product, rows ?? [], usual, objects), [product, rows, usual, objects]);
  const options = useMemo<SelectOption[]>(
    () => objects.filter((o) => o.kind === "rack" || o.kind === "floor").map((o) => ({ value: o.id, label: `${o.id} · ${o.name}` })),
    [objects],
  );
  const rack = objects.find((o) => o.id === rackId);

  const openRack = (id: string) => {
    setRackId(id);
    const object = objects.find((o) => o.id === id);
    if (object?.kind === "floor") onChange(id);
  };

  return (
    <div className="sa-field sa-placefield">
      <span className="sa-label">
        {label}
        {optional ? <span className="sa-optional"> לא חובה</span> : null}
      </span>
      {quick.length > 0 ? (
        <div className="sa-quickplaces">
          {quick.map(({ place, why, rackOnly }) => (
            <button
              key={place}
              type="button"
              className={cx("sa-quickplace", value === place && "is-selected")}
              aria-pressed={value === place}
              onClick={() => (rackOnly ? setRackId(resolvePlace(place, objects)?.objectId ?? "") : (setRackId(""), onChange(place)))}
            >
              <span>{placeWords(place, objects)}</span>
              <span className="sa-quickplace-why">{WHY_WORD[why]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <Select options={options} value={rackId} onChange={openRack} placeholder={quick.length > 0 ? "מקום אחר" : "בחירת מתקן"} searchPlaceholder="חיפוש מתקן" block />
      {rack?.kind === "rack" ? <ShelfGrid key={rack.id} object={rack} product={product} stock={model.byObject.get(rack.id)} value={value} onPick={onChange} /> : null}
      {error ? <span className="sa-error" role="alert">{error}</span> : null}
    </div>
  );
}
