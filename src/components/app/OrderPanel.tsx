"use client";

/**
 * One order in a SidePanel: who it is for, its lines, its history, and the two ways it closes.
 * Opened via useUi().openOrder(id); reads ui.panel of type "order".
 */
import { useState } from "react";
import { deliverOrderWithoutReceipt } from "@/lib/exit-pass";
import { available, orderTotal, useData, type Order } from "@/lib/store";
import { changeWords, keptChanges } from "@/lib/worker/order-check";
import { useUi } from "./ui-state";
import { CodeDialog } from "./forms/CodeDialog";
import { ReceiptField, useExitProof } from "./forms/ReceiptField";
import { errorMessage } from "./forms/useForm";
import { ExitNotice, History, ReceiptPhoto, useMovementsById } from "./MovementPanel";
import { Figure } from "./ProductPanel";
import { ProductThumb } from "./Viz";
import { Button, Dot, Fields, Modal, Notice, SidePanel, type TimelineItem, type Tone } from "@/components/ui";
import { daysUntil, fmtFull, fmtName, fmtPrice, fmtPromised, fmtQty, fmtRelative, fmtUnit, fmtWeekday, ORDER_STATUS_LABEL } from "@/lib/format";

/** The closing the manager is being asked to confirm. */
type Closing = "deliver" | "cancel";

const STATUS_DOT: Record<Order["status"], Tone | undefined> = { open: undefined, delivered: "success", cancelled: "neutral" };

export function OrderPanel() {
  const { panel } = useUi();
  if (panel?.type !== "order") return null;
  return <OrderPanelInner key={panel.id} id={panel.id} />;
}

function OrderPanelInner({ id }: { id: string }) {
  const { state, order, agent, product, worker, linesOf, deliverOrder, cancelOrder, reload } = useData();
  const { close, notify, openProduct } = useUi();
  const proof = useExitProof();
  const [asking, setAsking] = useState<Closing | null>(null);
  const [proving, setProving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = linesOf(id);
  // One movement per line that left. They share who delivered, the receipt and any approval, so the first speaks for all.
  const [delivery] = useMovementsById(lines.flatMap((l) => (l.movement_id ? [l.movement_id] : [])));

  const o = order(id);
  if (!o) return null;

  const total = orderTotal(lines);
  const agentName = agent(o.agent_id)?.name;
  const dot = STATUS_DOT[o.status];
  const isOpen = o.status === "open";
  const late = isOpen && !!o.promised_on && daysUntil(o.promised_on) < 0;
  const changes = keptChanges(o);

  // Against all open orders, as the overview counts it: a product is short once what they hold passes the shelf.
  const shortages = isOpen
    ? lines.flatMap((l) => {
        const p = product(l.product_id);
        return p && available(p) < 0 ? [`חסרים ${fmtQty(-available(p))} ${fmtUnit(-available(p), p.unit)} של ${fmtName(p.name)}`] : [];
      })
    : [];
  // A line the shelf can't cover on its own: delivering it zeroes the stock, the same as a manual issue.
  const zeroes = isOpen && lines.some((l) => {
    const p = product(l.product_id);
    return p ? p.qty < l.qty : false;
  });

  const deliveredBy = worker(delivery?.worker_id)?.name;
  const receipt = state.documents.find((d) => d.id === delivery?.document_id);
  const steps: TimelineItem[] = [
    { id: "created", title: agentName ? `נוצרה ע"י ${agentName}` : "נוצרה", when: fmtFull(o.created_at) },
    ...(isOpen
      ? []
      : [{
          id: "closed",
          title: o.status === "cancelled" ? "בוטלה" : deliveredBy ? `נמסרה ע"י ${deliveredBy}` : "נמסרה",
          when: o.closed_at ? fmtFull(o.closed_at) : undefined,
          detail: receipt ? <ReceiptPhoto path={receipt.storage_path} /> : undefined,
        }]),
  ];

  const finish = () => {
    notify({ tone: "success", title: asking === "deliver" ? `הזמנה ${o.number} נמסרה` : `הזמנה ${o.number} בוטלה` });
    setAsking(null);
    close();
  };

  const onConfirm = async () => {
    if (asking === "deliver" && !proof.check()) return;
    if (asking === "deliver" && proof.without) {
      setProving(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (asking === "deliver") await deliverOrder(id, await proof.save({ customer: o.customer, reference: `הזמנה ${o.number}` }));
      else await cancelOrder(id);
      finish();
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
          <>
            <span className={`sa-order-status is-${o.status} inline-flex items-center gap-[var(--space-2)]`}>
              {dot ? <Dot tone={dot} /> : null}
              {ORDER_STATUS_LABEL[o.status]}
            </span>
            {isOpen ? <> · <span className={`sa-state is-${shortages.length > 0 ? "short" : "ok"}`}>{shortages.length > 0 ? "חסר במלאי" : "מוכן למסירה"}</span></> : null}
            {" · "}
            {isOpen && o.promised_on ? <span className={late ? "sa-order-late" : undefined}>מסירה {fmtPromised(o.promised_on)}</span> : fmtRelative(o.closed_at ?? o.created_at)}
          </>
        }
        summary={
          total !== null ? (
            <dl className="sa-figures sa-order-sum">
              <Figure label={'סה"כ'} value={fmtPrice(total)} />
            </dl>
          ) : undefined
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
          <Notice tone="warning" title="חסר במלאי" className="sa-notice-short">
            {shortages.join(" · ")} מול כל ההזמנות הפתוחות.{zeroes ? " המסירה תאפס את המלאי." : null}
          </Notice>
        ) : null}
        {delivery?.exit_pass ? <ExitNotice movement={delivery} /> : null}

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
                    <span className="sa-order-figure shrink-0 text-end">
                      <span className="block"><span className="sa-num">{fmtQty(l.qty)}</span> <span className="sa-order-unit">{fmtUnit(l.qty, p?.unit)}</span></span>
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

        {changes.length > 0 ? (
          <section className="sa-group flex flex-col gap-[var(--space-2)]" aria-labelledby="order-changes-title">
            <h3 id="order-changes-title" className="sa-section-title">
              חריגות
              <span className="sa-mono sa-faint ms-[var(--space-2)] font-normal">{fmtQty(changes.length)}</span>
            </h3>
            <ul className="sa-rows flex list-none flex-col divide-y divide-line-subtle">
              {changes.map((c, i) => {
                const p = product(c.product_id);
                const sides = [c.ordered ? `בהזמנה ${fmtQty(c.ordered)}` : "לא בהזמנה", !o.receipt_read ? null : c.read === null ? "לא בקבלה" : `בקבלה ${fmtQty(c.read)}`];
                return (
                  <li key={i} className="sa-order-line relative flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                    <ProductThumb product={p} />
                    <span className="min-w-0 flex-1">
                      <span className="sa-truncate block">{p ? fmtName(p.name) : c.name}</span>
                      <span className="sa-cell-sub">{sides.filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0 text-end">
                      {c.manager ? "אצל המנהל" : c.delivered === 0 ? "לא יצא" : <>יצאו <span className="sa-num">{fmtQty(c.delivered)}</span> {fmtUnit(c.delivered, p?.unit)}</>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <Fields
          items={[
            {
              label: "מסירה ללקוח",
              value: o.promised_on ? fmtWeekday(o.promised_on) : undefined,
            },
            { label: "סוכן", value: agentName },
            {
              label: "טלפון",
              value: o.customer_phone ? <a className="sa-btn sa-btn-link sa-mono ltr" href={`tel:${o.customer_phone.replace(/\s/g, "")}`}>{o.customer_phone}</a> : undefined,
            },
            ...(o.receipt_read === null ? [] : [{ label: "קבלה", value: !o.receipt_read ? "לא נקראה" : changes.length ? `${changeWords(changes.length)} מול ההזמנה` : "תואמת להזמנה" }]),
          ]}
        />
        {o.note ? (
          <Fields columns={1} items={[{ label: "הערה", value: <span className="whitespace-pre-wrap">{o.note}</span> }]} />
        ) : null}

        <History items={steps} />
      </SidePanel>

      {/* Closed from elsewhere while asking, the question no longer stands; this panel's own closing and a refusal stay on screen. */}
      {asking && !proving && (isOpen || busy || error) ? (
        <Modal
          title={asking === "deliver" ? `לסמן את הזמנה ${o.number} כנמסרה?` : `לבטל את הזמנה ${o.number}?`}
          tone={asking === "cancel" ? "danger" : undefined}
          confirmLabel={asking === "cancel" ? "ביטול הזמנה" : proof.without ? "שליחת קוד" : "סימון כנמסרה"}
          cancelLabel="חזרה"
          busy={busy}
          onConfirm={() => void onConfirm()}
          onClose={() => { setAsking(null); setError(null); }}
        >
          <div className="flex flex-col gap-[var(--space-3)]">
            <p className="m-0">{asking === "deliver" ? "המלאי יירד לפי השורות" : "המלאי המשוריין ישוחרר"}</p>
            {asking === "deliver" ? <ReceiptField proof={proof} disabled={busy} /> : null}
            {error ? <Notice tone="danger">{error}</Notice> : null}
          </div>
        </Modal>
      ) : null}

      {proving && proof.phone ? (
        <CodeDialog
          phone={proof.phone}
          title={`הזמנה ${o.number} בלי קבלה`}
          action={async (client) => {
            await deliverOrderWithoutReceipt(client, id, proof.why.trim());
            await reload();
          }}
          onDone={finish}
          onClose={() => setProving(false)}
        />
      ) : null}
    </>
  );
}
