"use client";

import { fmtName, fmtPrice, fmtQty } from "@/lib/format";
import type { ObjectStock } from "@/lib/map3d/model";
import type { MapView } from "./view";
import type { Worth } from "./worth";

const shareText = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${fmtQty(Math.round(share * 100))}%`);

function contents(stock: ObjectStock | undefined): string {
  const items = stock?.items ?? [];
  return items.length === 1 ? fmtName(items[0].product.name) : `${fmtQty(items.length)} מוצרים`;
}

/** Where the money stands, at list prices: per location, largest first. */
export function ValueRail({ map, worth }: { map: MapView; worth: Worth }) {
  const share = (value: number) => (worth.total > 0 ? value / worth.total : 0);

  if (worth.places.length === 0 && worth.tray === 0) return <p className="m3d-empty">אין מוצרים עם מחיר</p>;

  return (
    <div className="m3d-ledger is-value" role="table" aria-label="שווי לפי מיקום">
      <div className="m3d-ledger-head" role="row">
        <span role="columnheader">מיקום</span>
        <span role="columnheader">מה יש שם</span>
        <span role="columnheader" className="m3d-num">שווי</span>
        <span role="columnheader" className="m3d-num">מהמלאי</span>
      </div>
      {worth.places.map(({ object, value }) => (
        <button key={object.id} type="button" role="row" className="m3d-line" onClick={() => map.select(object.id)}>
          <span className="m3d-line-place" role="cell"><span className="ltr">{object.id}</span></span>
          <span className="m3d-line-name" role="cell">{contents(map.model.byObject.get(object.id))}</span>
          <span className="m3d-num m3d-line-qty" role="cell">{fmtPrice(value)}</span>
          <span className="m3d-num m3d-line-percent" role="cell">{shareText(share(value))}</span>
        </button>
      ))}
      {worth.tray > 0 ? (
        <div className="m3d-line" role="row">
          <span className="m3d-line-place is-none" role="cell">—</span>
          <span className="m3d-line-name" role="cell">ללא מיקום במפה</span>
          <span className="m3d-num m3d-line-qty" role="cell">{fmtPrice(worth.tray)}</span>
          <span className="m3d-num m3d-line-percent" role="cell">{shareText(share(worth.tray))}</span>
        </div>
      ) : null}
      {worth.unpriced > 0 ? (
        <p className="sa-hint m3d-note">
          <span className="sa-num">{fmtQty(worth.unpriced)}</span> {worth.unpriced === 1 ? "מוצר ללא מחיר לא נכלל" : "מוצרים ללא מחיר לא נכללו"}
        </p>
      ) : null}
    </div>
  );
}
