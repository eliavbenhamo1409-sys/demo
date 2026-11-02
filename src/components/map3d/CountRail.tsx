"use client";

import { useMemo } from "react";
import { useUi } from "@/components/app/ui-state";
import { cx, Notice, Spinner } from "@/components/ui";
import { fmtName, fmtQty } from "@/lib/format";
import { countOf, type CountInfo } from "@/lib/map3d/metrics";
import { useData } from "@/lib/store";
import type { MapView } from "./view";
import { countedAgo } from "./words";

/** Never counted, then a figure no movement explains, then damage since the count, then the oldest count. */
function needRank(info: CountInfo): number {
  if (info.lastCount === null) return 0;
  if (info.unexplained !== 0) return 1;
  return info.faultQty > 0 ? 2 : 3;
}

function byNeed(a: CountInfo, b: CountInfo): number {
  return (
    needRank(a) - needRank(b) ||
    Math.abs(b.unexplained) - Math.abs(a.unexplained) ||
    Date.parse(a.lastCount ?? "") - Date.parse(b.lastCount ?? "") ||
    0
  );
}

const signed = (n: number) => (n < 0 ? `−${fmtQty(-n)}` : fmtQty(n));

/** When each product was last counted and what its figure can't explain. The count itself is on the object's card. */
export function CountRail({ map }: { map: MapView }) {
  const { state } = useData();
  const { openProduct } = useUi();
  const { ledger } = map;

  const rows = useMemo(
    () =>
      ledger.ready
        ? state.products.map((p) => ({ product: p, info: countOf(p, ledger.rows) })).sort((a, b) => byNeed(a.info, b.info))
        : [],
    [state.products, ledger.ready, ledger.rows],
  );

  if (ledger.failed) return <Notice tone="danger" title="ההיסטוריה לא נטענה" action="ניסיון נוסף" onAction={ledger.retry} />;

  if (!ledger.ready) {
    return (
      <div className="flex justify-center py-[var(--space-8)] text-ink-3">
        <Spinner size="md" track label="טוען היסטוריה" />
      </div>
    );
  }

  if (rows.length === 0) return <p className="m3d-empty">אין מוצרים</p>;

  return (
    <div className="m3d-ledger is-count" role="table" aria-label="ספירות מלאי">
      <div className="m3d-ledger-head" role="row">
        <span role="columnheader">מוצר</span>
        <span role="columnheader">מיקום</span>
        <span role="columnheader" className="m3d-num">נספר</span>
        <span role="columnheader" className="m3d-num">פער</span>
      </div>
      {rows.map(({ product, info }) => {
        const place = map.placeOf(product.id);
        return (
          <button key={product.id} type="button" role="row" className="m3d-line" onClick={() => (place ? map.select(place) : openProduct(product.id))}>
            <span className="m3d-line-text" role="cell">
              <span className="m3d-line-name">{fmtName(product.name)}</span>
              {info.faultQty > 0 ? (
                <span className="m3d-line-unit"><span className="ltr">{fmtQty(info.faultQty)}</span> {product.unit} בתקלה מאז הספירה</span>
              ) : null}
            </span>
            <span className={cx("m3d-line-place", !place && "is-none")} role="cell">{place ? <span className="ltr">{place}</span> : "—"}</span>
            <span className={cx("m3d-num m3d-line-when", info.lastCount === null && "m3d-num-low")} role="cell">
              {info.lastCount ? countedAgo(info.lastCount, map.now) : "לא נספר"}
            </span>
            <span className="m3d-num" role="cell">
              {info.unexplained !== 0 ? (
                <>
                  <span className="m3d-line-qty ltr">{signed(info.unexplained)}</span>
                  <span className="m3d-line-unit">{product.unit}</span>
                </>
              ) : (
                <span className="m3d-line-unit">—</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
