"use client";

import { useMemo } from "react";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, cx, EmptyState, Icon } from "@/components/ui";
import { fmtName, fmtQty, fmtRelative, fmtUnit } from "@/lib/format";
import { available, useData } from "@/lib/store";
import { RailRow } from "./parts";
import type { MapView } from "./view";

interface OrdersRailProps {
  map: MapView;
  orderId: string | null;
  onOrder: (id: string | null) => void;
}

/** Open orders, the oldest first. Opening one lays its picks on the floor, from each source to dispatch. */
export function OrdersRail({ map, orderId, onOrder }: OrdersRailProps) {
  const { state, linesOf, product } = useData();
  const { openOrder } = useUi();

  const orders = useMemo(
    () => state.orders.filter((o) => o.status === "open" && linesOf(o.id).length > 0).reverse(),
    [state.orders, linesOf],
  );

  if (orders.length === 0) return <EmptyState title="אין הזמנות פתוחות" hint="הזמנה של סוכן תופיע כאן" />;

  return (
    <ul className="m3d-list">
      {orders.map((o) => {
        const open = o.id === orderId;
        const lines = linesOf(o.id);
        return (
          <li key={o.id} className={cx("m3d-order", open && "is-open")}>
            <div className="sa-order-line m3d-row">
              <button type="button" className="sa-attention-open m3d-row-main" aria-expanded={open} onClick={() => onOrder(open ? null : o.id)}>
                <span className="m3d-line-name"><bdi>{o.customer}</bdi></span>
                <span className="sa-cell-sub">
                  הזמנה <span className="sa-mono ltr">{o.number}</span> · <span className="ltr">{fmtQty(lines.length)}</span> {lines.length === 1 ? "שורה" : "שורות"} · {fmtRelative(o.created_at)}
                </span>
              </button>
              <span className="sa-attention-chev"><Icon name={open ? "chevron-up" : "chevron-down"} size={16} /></span>
            </div>
            {open ? (
              <>
                <ul className="m3d-list">
                  {lines.map((l) => {
                    const p = product(l.product_id);
                    const place = map.placeOf(l.product_id);
                    return (
                      <RailRow
                        key={l.id}
                        lead={<ProductThumb product={p} small />}
                        onOpen={place ? () => map.select(place) : undefined}
                        end={<><span className="sa-num">{fmtQty(l.qty)}</span> {fmtUnit(l.qty, p?.unit)}</>}
                      >
                        <span className="m3d-line-name">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
                        <span className="sa-cell-sub">
                          {place ? <span className="sa-mono ltr">{place}</span> : "ללא מיקום במפה"}
                          {p && available(p) < 0 ? <> · <span className="font-semibold text-short">חסר</span></> : null}
                        </span>
                      </RailRow>
                    );
                  })}
                </ul>
                <Button variant="secondary" size="sm" onClick={() => openOrder(o.id)}>פתיחת ההזמנה</Button>
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
