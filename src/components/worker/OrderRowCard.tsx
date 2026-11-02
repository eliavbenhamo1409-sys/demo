"use client";

import type { ReactElement } from "react";
import { ProductThumb } from "@/components/app/Viz";
import { Badge } from "@/components/ui/Badge";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { fmtName, fmtQty } from "@/lib/format";
import type { Product } from "@/lib/store";
import type { OrderRow, RowState } from "@/lib/worker/order-check";
import { Row } from "@/components/worker";

const HEADS: Record<RowState, string> = { qty: "כמות שונה", missing: "לא בקבלה", same: "שינוי בשורה", waiting: "" };

/** One line of the order against its receipt. Once answered the stepper takes over, so any figure can still be set. */
export function OrderRowCard({ row, product, wasRead, onAnswer }: { row: OrderRow; product?: Product; wasRead: boolean; onAnswer: (left: number) => void }): ReactElement {
  const { read, ordered, left } = row;
  const unit = product?.unit ?? "";
  const words = (n: number) => `${fmtQty(n)} ${unit}`;
  return (
    <article id={`line-${row.id}`} className="wk-line">
      <div className="wk-line-head">
        <span className="wk-line-n">{HEADS[row.state]}</span>
        <span className="wk-line-state">{left === undefined ? <Badge tone="warning">צריך תשובה</Badge> : <Badge tone="success">מוכן</Badge>}</span>
      </div>
      <div className="wk-status">
        <ProductThumb product={product} small />
        <span>{product ? fmtName(product.name) : "מוצר שנמחק"}</span>
      </div>
      <dl className="wk-compare">
        <div>
          <dt>בהזמנה</dt>
          <dd><span className="sa-num">{fmtQty(ordered)}</span> {unit}</dd>
        </div>
        {wasRead ? (
          <div>
            <dt>בקבלה</dt>
            <dd>{read === null ? "אין" : <><span className="sa-num">{fmtQty(read)}</span> {unit}</>}</dd>
          </div>
        ) : null}
      </dl>
      {left === undefined ? (
        <div className="wk-choices">
          <p className="wk-ask">{read === null ? "יצא ללקוח?" : "כמה יצא?"}</p>
          <div className="wk-group">
            {read === null ? (
              <>
                <Row title="לא יצא" onClick={() => onAnswer(0)} />
                <Row title={words(ordered)} sub="כמו בהזמנה" onClick={() => onAnswer(ordered)} />
              </>
            ) : (
              <>
                <Row title={words(read)} sub="כמו בקבלה" onClick={() => onAnswer(read)} />
                <Row title={words(ordered)} sub="כמו בהזמנה" onClick={() => onAnswer(ordered)} />
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="wk-qty-row">
          <span className="wk-qty-label">יצא בפועל{unit ? ` (${unit})` : ""}</span>
          <QuantityStepper value={left} min={0} onChange={onAnswer} />
        </div>
      )}
    </article>
  );
}
