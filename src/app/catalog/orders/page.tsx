"use client";

import { useState } from "react";
import { useCatalog, type Order } from "@/lib/catalog";
import { ChevronDownIcon } from "@/components/catalog/Icons";
import { fmtDate, fmtName, fmtPrice, fmtQty, ORDER_STATUS_LABEL } from "@/lib/catalog/format";

function Row({ order }: { order: Order }) {
  const { cancelOrder } = useCatalog();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = order.status === "open";
  const priced = order.order_lines.every((l) => l.unit_price !== null);
  const total = order.order_lines.reduce((sum, l) => sum + (l.unit_price ?? 0) * l.qty, 0);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelOrder(order.id);
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הביטול נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`cg-order${isOpen ? " is-open" : ""}`}>
      <button type="button" className="cg-order__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="cg-order__number cg-num">{order.number}</span>
        <span className="cg-order__customer">{order.customer}</span>
        <span className="cg-order__date cg-num">{fmtDate(order.created_at)}</span>
        <span className="cg-order__status">{ORDER_STATUS_LABEL[order.status]}</span>
        <span className="cg-order__chev"><ChevronDownIcon /></span>
      </button>
      {open ? (
        <div className="cg-order__body">
          <ul className="cg-order__lines">
            {order.order_lines.map((l) => (
              <li key={l.id} className="cg-order__line">
                <span>{l.products ? fmtName(l.products.name) : "מוצר שנמחק"}</span>
                <span><span className="cg-num">{fmtQty(l.qty)}</span> {l.products?.unit}</span>
              </li>
            ))}
          </ul>
          {order.note ? <p className="cg-order__note">{order.note}</p> : null}
          <div className="cg-order__foot">
            {priced ? <span className="cg-order__line"><span className="cg-num">{fmtPrice(total)}</span></span> : <span />}
            {!isOpen ? null : asking ? (
              <span className="cg-order__ask">
                <span>המלאי המשוריין ישוחרר</span>
                <button type="button" className="cg-link" disabled={busy} onClick={() => setAsking(false)}>חזרה</button>
                <button type="button" className="cg-link" disabled={busy} onClick={() => void cancel()}>ביטול הזמנה</button>
              </span>
            ) : (
              <button type="button" className="cg-link" onClick={() => setAsking(true)}>ביטול הזמנה</button>
            )}
          </div>
          {error ? <p className="cg-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

export default function OrdersPage() {
  const { orders } = useCatalog();
  const open = orders.filter((o) => o.status === "open").length;
  return (
    <main className="cg-page">
      <h1 className="cg-page__title">הזמנות</h1>
      {orders.length === 0 ? (
        <p className="cg-page__sub">אין הזמנות</p>
      ) : (
        <>
          {open > 0 ? <p className="cg-page__sub">{open === 1 ? "הזמנה פתוחה אחת, המלאי שלה משוריין" : `${fmtQty(open)} הזמנות פתוחות, המלאי שלהן משוריין`}</p> : null}
          <div className="cg-orders">
            {orders.map((o) => <Row key={o.id} order={o} />)}
          </div>
        </>
      )}
    </main>
  );
}
