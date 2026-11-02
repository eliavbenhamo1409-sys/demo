"use client";

/**
 * One order in a SidePanel: who it is for, its lines, and the two ways it closes.
 * Opened via useUi().openOrder(id); reads ui.panel of type "order".
 */
import { useState } from "react";
import { orderTotal, useData, type Order } from "@/lib/store";
import { useUi } from "./ui-state";
import { errorMessage } from "./forms/useForm";
import { ProductThumb } from "./Viz";
import { Button, Dot, Fields, Modal, Notice, SidePanel, type Tone } from "@/components/ui";
import { fmtFull, fmtName, fmtPrice, fmtQty, fmtRelative, ORDER_STATUS_LABEL } from "@/lib/format";

/** The closing the manager is being asked to confirm. */
type Closing = "deliver" | "cancel";

const STATUS_DOT: Record<Order["status"], Tone | undefined> = { open: undefined, delivered: "success", cancelled: "neutral" };

export function OrderPanel() {
  const { panel } = useUi();
  if (panel?.type !== "order") return null;
  return <OrderPanelInner key={panel.id} id={panel.id} />;
}

function OrderPanelInner({ id }: { id: string }) {
  const { order, agent, product, linesOf, deliverOrder, cancelOrder } = useData();
  const { close, notify, openProduct } = useUi();
  const [asking, setAsking] = useState<Closing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const o = order(id);
  if (!o) return null;

  const lines = linesOf(id);
  const total = orderTotal(lines);
  const agentName = agent(o.agent_id)?.name;
  const dot = STATUS_DOT[o.status];
  const isOpen = o.status === "open";

  // A line the shelf can't cover: delivering it zeroes the stock, the same as a manual issue.
  const shortages = isOpen
    ? lines.flatMap((l) => {
        const p = product(l.product_id);
        return p && p.qty < l.qty ? [`חסרים ${fmtQty(l.qty - p.qty)} ${p.unit} של ${fmtName(p.name)}`] : [];
      })
    : [];

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      if (asking === "deliver") await deliverOrder(id);
      else await cancelOrder(id);
      notify({ tone: "success", title: asking === "deliver" ? `הזמנה ${o.number} נמסרה` : `הזמנה ${o.number} בוטלה` });
      setAsking(null);
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SidePanel
        className="sa-sheet"
        eyebrow={`הזמנה ${o.number}`}
        title={o.customer}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-[var(--space-3)]">
            <span className={`sa-order-status is-${o.status} inline-flex items-center gap-[var(--space-2)]`}>
              {dot ? <Dot tone={dot} /> : null}
              {ORDER_STATUS_LABEL[o.status]}
            </span>
            <span>{[agentName, fmtRelative(o.created_at)].filter(Boolean).join(" · ")}</span>
          </span>
        }
        onClose={close}
        footer={
          isOpen ? (
            <>
              <div>
                <Button variant="ghost" className="sa-order-cancel" disabled={busy} onClick={() => setAsking("cancel")}>ביטול הזמנה</Button>
              </div>
              <div>
                <Button variant="primary" disabled={busy} onClick={() => setAsking("deliver")}>סימון כנמסרה</Button>
              </div>
            </>
          ) : undefined
        }
      >
        {shortages.length > 0 ? (
          <Notice tone="warning" title="חסר במלאי">{shortages.join(" · ")}. המסירה תאפס את המלאי.</Notice>
        ) : null}

        <section className="sa-group flex flex-col gap-[var(--space-2)]" aria-labelledby="order-lines-title">
          <h3 id="order-lines-title" className="sa-section-title">
            שורות
            {lines.length > 0 ? <span className="sa-mono sa-faint ms-[var(--space-2)] font-normal">{fmtQty(lines.length)}</span> : null}
          </h3>
          {lines.length === 0 ? (
            <p className="sa-hint">אין שורות</p>
          ) : (
            <ul className="sa-rows flex list-none flex-col divide-y divide-line-subtle">
              {lines.map((l) => {
                const p = product(l.product_id);
                return (
                  <li key={l.id} className="sa-order-line relative flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                    <ProductThumb product={p} />
                    {p ? (
                      <button type="button" className="sa-attention-open min-w-0 flex-1" onClick={() => openProduct(p.id)}>
                        <span className="sa-truncate block">{fmtName(p.name)}</span>
                        <span className="sa-cell-sub"><span className="sa-mono ltr">{p.sku}</span></span>
                      </button>
                    ) : (
                      <span className="min-w-0 flex-1 text-ink-3">מוצר שנמחק</span>
                    )}
                    <span className="shrink-0 text-end">
                      <span className="block"><span className="sa-num">{fmtQty(l.qty)}</span> {p?.unit}</span>
                      {l.unit_price !== null ? <span className="sa-cell-sub">{fmtPrice(l.qty * l.unit_price)}</span> : null}
                    </span>
                  </li>
                );
              })}
              {total !== null ? (
                <li className="sa-order-total flex items-center justify-between gap-[var(--space-3)] py-[var(--space-2)] font-medium">
                  <span>סה&quot;כ</span>
                  <span>{fmtPrice(total)}</span>
                </li>
              ) : null}
            </ul>
          )}
        </section>

        <Fields
          items={[
            { label: "סוכן", value: agentName },
            {
              label: "טלפון",
              value: o.customer_phone ? <a className="sa-btn sa-btn-link sa-mono ltr" href={`tel:${o.customer_phone.replace(/\s/g, "")}`}>{o.customer_phone}</a> : undefined,
            },
            { label: "נוצרה", value: fmtFull(o.created_at), num: true },
            { label: "נסגרה", value: o.closed_at ? fmtFull(o.closed_at) : undefined, num: true },
          ]}
        />
        {o.note ? (
          <Fields columns={1} items={[{ label: "הערה", value: <span className="whitespace-pre-wrap">{o.note}</span> }]} />
        ) : null}
      </SidePanel>

      {/* Closed from elsewhere while asking, the question no longer stands; this panel's own closing and a refusal stay on screen. */}
      {asking && (isOpen || busy || error) ? (
        <Modal
          title={asking === "deliver" ? `לסמן את הזמנה ${o.number} כנמסרה?` : `לבטל את הזמנה ${o.number}?`}
          tone={asking === "cancel" ? "danger" : undefined}
          confirmLabel={asking === "deliver" ? "סימון כנמסרה" : "ביטול הזמנה"}
          cancelLabel="חזרה"
          busy={busy}
          onConfirm={() => void onConfirm()}
          onClose={() => { setAsking(null); setError(null); }}
        >
          <div className="flex flex-col gap-[var(--space-3)]">
            <p className="m-0">{asking === "deliver" ? "המלאי יירד לפי השורות" : "המלאי המשוריין ישוחרר"}</p>
            {error ? <Notice tone="danger">{error}</Notice> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
