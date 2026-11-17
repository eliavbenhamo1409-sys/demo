"use client";

/**
 * One supplier in the same drawer every other detail opens in: who to call, what they bring, what they call it, and
 * what arrived lately. The shared shell has no drawer for a supplier, so this one stands on the same sheet classes,
 * over the same scrim, and steps aside the moment a product or a form is opened from it.
 */
import { useEffect, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Figure } from "@/components/app/ProductPanel";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, Fields, SidePanel } from "@/components/ui";
import { fmtCompact, fmtDayWord, fmtName, fmtQty, fmtUnit } from "@/lib/format";
import { available, useData, type Movement } from "@/lib/store";
import { Word, type Tone } from "./parts";
import { LEVEL_WORD, levelOf, type StockLevel } from "./work";
import "@/components/app/drawers.css";

const LEVEL_TONE: Record<StockLevel, Tone> = { short: "short", out: "bad", low: "warn", ok: "ok" };
const DELIVERIES = 8;

export function SupplierPanel({ id, month, onClose }: { id: string; /** The last 30 days of movements, newest first. */ month: Movement[]; onClose: () => void }): ReactElement | null {
  const { state, supplier, product } = useData();
  const { openAction, openProduct } = useUi();
  const s = supplier(id);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!s) return null;

  const products = state.products.filter((p) => p.primary_supplier_id === id);
  const names = state.supplierItems.filter((i) => i.supplier_id === id).sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.times_seen - a.times_seen);
  const deliveries = month.filter((m) => m.type === "in" && m.supplier_id === id);
  const worth = deliveries.reduce((sum, m) => sum + m.qty * (product(m.product_id)?.price ?? 0), 0);

  // The drawer leaves first, so the product or the form opens alone and the list behind keeps its place.
  const leaveFor = (run: () => void) => () => {
    onClose();
    run();
  };

  return createPortal(
    <>
      <div className="sa-scrim app-scrim" onClick={onClose} aria-hidden />
      <div className="app-panelHost" role="dialog" aria-modal="true">
        <SidePanel
          className="sa-sheet"
          eyebrow="ספק"
          title={s.name}
          summary={
            <dl className="sa-figures">
              <Figure label="מוצרים" value={products.length} tone={products.length === 0 ? "quiet" : undefined} />
              <Figure label="שמות אצלו" value={names.length} tone={names.length === 0 ? "quiet" : undefined} />
              <Figure label="נקלט ב-30 יום" value={deliveries.length > 0 ? fmtCompact(worth) : "לא נקלט"} tone={deliveries.length === 0 ? "quiet" : undefined} />
            </dl>
          }
          onClose={onClose}
          headActions={<Button variant="ghost" size="sm" icon="edit" onClick={leaveFor(() => openAction("edit-supplier", { supplierId: id }))}>עריכה</Button>}
          footer={
            <>
              <div>
                <Button variant="ghost" icon="plus" onClick={leaveFor(() => openAction("new-supplier-item", { supplierId: id }))}>שם חדש</Button>
              </div>
              <div>
                <Button variant="primary" icon="arrow-down-left" onClick={leaveFor(() => openAction("receive", { supplierId: id }))}>קליטת סחורה</Button>
              </div>
            </>
          }
        >
          <Fields
            items={[
              { label: "איש קשר", value: s.contact },
              { label: "טלפון", value: s.phone ? <a className="sa-btn sa-btn-link sa-mono ltr" href={`tel:${s.phone.replace(/\s/g, "")}`}>{s.phone}</a> : undefined },
              { label: "אימייל", value: s.email ? <a className="sa-btn sa-btn-link ltr" href={`mailto:${s.email}`}>{s.email}</a> : undefined },
            ]}
          />
          {s.notes ? <Fields columns={1} items={[{ label: "הערות", value: <span className="whitespace-pre-wrap">{s.notes}</span> }]} /> : null}

          <section className="sa-group flex flex-col gap-[var(--space-2)]" aria-labelledby="mn2-supplier-products">
            <h3 id="mn2-supplier-products" className="sa-section-title">
              מוצרים שהוא מספק
              {products.length > 0 ? <span className="sa-mono sa-faint ms-[var(--space-2)] font-normal">{fmtQty(products.length)}</span> : null}
            </h3>
            {products.length === 0 ? (
              <p className="sa-hint">אין מוצר שהספק הזה רשום כספק הראשי שלו</p>
            ) : (
              <ul className="sa-rows flex list-none flex-col divide-y divide-line-subtle">
                {products.map((p) => {
                  const level = levelOf(p);
                  const free = Math.max(0, available(p));
                  return (
                    <li key={p.id} className="sa-order-line relative flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                      <ProductThumb product={p} small />
                      <button type="button" className="sa-attention-open min-w-0 flex-1" onClick={leaveFor(() => openProduct(p.id))}>
                        <span className="block">{fmtName(p.name)}</span>
                        <span className="sa-cell-sub">זמין {fmtQty(free)} {fmtUnit(free, p.unit)}</span>
                      </button>
                      <span className="shrink-0"><Word tone={LEVEL_TONE[level]}>{LEVEL_WORD[level]}</Word></span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="sa-group flex flex-col gap-[var(--space-2)]" aria-labelledby="mn2-supplier-names">
            <h3 id="mn2-supplier-names" className="sa-section-title">
              איך הוא קורא למוצרים
              {names.length > 0 ? <span className="sa-mono sa-faint ms-[var(--space-2)] font-normal">{fmtQty(names.length)}</span> : null}
            </h3>
            {names.length === 0 ? (
              <p className="sa-hint">עוד לא נרשם שם מתעודת משלוח שלו</p>
            ) : (
              <ul className="sa-rows flex list-none flex-col divide-y divide-line-subtle">
                {names.map((i) => {
                  const p = product(i.product_id);
                  const waits = i.status === "pending" || !p;
                  return (
                    <li key={i.id} className="sa-order-line relative flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                      <button type="button" className="sa-attention-open min-w-0 flex-1" onClick={leaveFor(() => openAction("map-supplier-item", { supplierItemId: i.id }))}>
                        <span className="block"><bdi>{i.external_name}</bdi></span>
                        <span className="sa-cell-sub">{p ? `אצלנו: ${fmtName(p.name)}` : "עוד לא שויך למוצר"}</span>
                      </button>
                      {waits ? <span className="shrink-0"><Word tone="warn">דורש שיוך</Word></span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="sa-group flex flex-col gap-[var(--space-2)]" aria-labelledby="mn2-supplier-in">
            <h3 id="mn2-supplier-in" className="sa-section-title">
              אספקות ב-30 הימים האחרונים
              {deliveries.length > 0 ? <span className="sa-mono sa-faint ms-[var(--space-2)] font-normal">{fmtQty(deliveries.length)}</span> : null}
            </h3>
            {deliveries.length === 0 ? (
              <p className="sa-hint">לא נקלטה ממנו סחורה ב-30 הימים האחרונים</p>
            ) : (
              <>
                <ul className="sa-rows flex list-none flex-col divide-y divide-line-subtle">
                  {deliveries.slice(0, DELIVERIES).map((m) => {
                    const p = product(m.product_id);
                    return (
                      <li key={m.id} className="flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                        <span className="min-w-0 flex-1">
                          <span className="block">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
                          <span className="sa-cell-sub">{fmtDayWord(m.created_at)}</span>
                        </span>
                        <span className="shrink-0"><span className="sa-num">{fmtQty(m.qty)}</span> {fmtUnit(m.qty, p?.unit)}</span>
                      </li>
                    );
                  })}
                </ul>
                {deliveries.length > DELIVERIES ? <p className="sa-hint">מוצגות {fmtQty(DELIVERIES)} האחרונות מתוך {fmtQty(deliveries.length)}</p> : null}
              </>
            )}
          </section>
        </SidePanel>
      </div>
    </>,
    document.body,
  );
}
