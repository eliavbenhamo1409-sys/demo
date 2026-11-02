"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { available, ShortageError, useCatalog, type DraftLine, type Product } from "@/lib/catalog";
import { fmtName, fmtPrice, fmtQty } from "@/lib/catalog/format";
import { CloseIcon } from "./Icons";
import { ProductImage } from "./ProductCard";
import { useDrawer } from "./Shell";
import { Stepper } from "./Stepper";

function Line({ line, product }: { line: DraftLine; product: Product | undefined }) {
  const { setDraftQty, removeFromDraft } = useCatalog();

  if (!product) {
    return (
      <li className="cg-line">
        <span />
        <div className="cg-line__body">
          <span className="cg-line__short">המוצר כבר לא בקטלוג</span>
          <div><button type="button" className="cg-link" onClick={() => removeFromDraft(line.productId)}>הסרה</button></div>
        </div>
      </li>
    );
  }

  const free = available(product);
  const over = line.qty > free;
  return (
    <li className="cg-line">
      <ProductImage product={product} />
      <div className="cg-line__body">
        <div className="cg-line__top">
          <span className="cg-line__name">{fmtName(product.name)}</span>
          {product.price !== null ? <span className="cg-line__sum cg-num">{fmtPrice(product.price * line.qty)}</span> : null}
        </div>
        <div className="cg-line__row">
          <Stepper small label={`כמות של ${product.name}`} value={line.qty} max={Math.max(free, line.qty)} onChange={(n) => setDraftQty(product.id, n)} />
          <button type="button" className="cg-link" onClick={() => removeFromDraft(product.id)}>הסרה</button>
        </div>
        {over ? (
          <div className="cg-line__row">
            <span className="cg-line__short">{free > 0 ? `זמין ${fmtQty(free)} ${product.unit}` : "לא זמין"}</span>
            {free >= 1 ? <button type="button" className="cg-link" onClick={() => setDraftQty(product.id, Math.floor(free))}>עדכון הכמות</button> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function OrderDrawer() {
  const { lines, product, orders, landed, placeOrder, clearDraft } = useCatalog();
  const { open, hide } = useDrawer();
  const router = useRouter();
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [customerError, setCustomerError] = useState(false);
  const [failure, setFailure] = useState<{ text: string; lines: DraftLine[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const filledPhone = useRef("");

  const number = placed ?? landed?.number ?? null;
  // A message about these lines, gone once they change.
  const error = failure?.lines === lines ? failure.text : null;

  const close = () => {
    hide();
    setPlaced(null);
    setFailure(null);
    if (landed) clearDraft();
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // Behind an open panel the page must stay put, and Escape closes it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open]);

  const customers = useMemo(() => [...new Set(orders.map((o) => o.customer))], [orders]);

  const known = lines.map((l) => ({ line: l, product: product(l.productId) }));
  const blocked = known.some(({ line, product: p }) => !p || line.qty > available(p));
  const priced = known.every(({ product: p }) => p && p.price !== null);
  const total = known.reduce((sum, { line, product: p }) => sum + (p?.price ?? 0) * line.qty, 0);

  const pickCustomer = (name: string) => {
    setCustomer(name);
    setCustomerError(false);
    // A phone filled from an earlier order follows the name; one the agent typed stays.
    if (phone && phone !== filledPhone.current) return;
    const earlier = orders.find((o) => o.customer === name)?.customer_phone ?? "";
    filledPhone.current = earlier;
    setPhone(earlier);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || blocked) return;
    if (!customer.trim()) {
      setCustomerError(true);
      customerRef.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const order = await placeOrder({ customer, phone, note });
      setPlaced(order.number);
      clearDraft();
      setCustomer("");
      setPhone("");
      setNote("");
      filledPhone.current = "";
    } catch (refused) {
      const text = refused instanceof ShortageError ? "המלאי השתנה. צריך לעדכן את הכמויות" : refused instanceof Error ? refused.message : "השליחה נכשלה";
      setFailure({ text, lines });
    } finally {
      setBusy(false);
    }
  };

  const toOrders = () => {
    close();
    router.push("/catalog/orders");
  };

  return (
    <div className={`cg-drawer${open ? " is-open" : ""}`} aria-hidden={!open}>
      <button type="button" className="cg-drawer__scrim" aria-label="סגירה" tabIndex={-1} onClick={close} />
      <div ref={panelRef} className="cg-drawer__panel" role="dialog" aria-modal="true" aria-label="הזמנה חדשה" tabIndex={-1}>
        <div className="cg-drawer__head">
          <h2 className="cg-drawer__title">{number === null ? "הזמנה חדשה" : "ההזמנה נשלחה"}</h2>
          <button type="button" className="cg-close" aria-label="סגירה" onClick={close}><CloseIcon /></button>
        </div>

        {number !== null ? (
          <div className="cg-placed">
            <span className="cg-placed__number cg-num">{number}</span>
            <p className="cg-placed__title">המלאי שוריין</p>
            <p className="cg-placed__sub">המחסן רואה את ההזמנה</p>
            <div className="cg-placed__actions">
              <button type="button" className="cg-btn" onClick={close}>המשך בקטלוג</button>
              <button type="button" className="cg-btn cg-btn--ghost" onClick={toOrders}>כל ההזמנות</button>
            </div>
          </div>
        ) : lines.length === 0 ? (
          <div className="cg-placed">
            <p className="cg-placed__title">אין מוצרים בהזמנה</p>
            <div className="cg-placed__actions">
              <button type="button" className="cg-btn cg-btn--ghost" onClick={close}>חזרה לקטלוג</button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} noValidate style={{ display: "contents" }}>
            <div className="cg-drawer__body">
              {/* While the order is on its way the lines hold still: what was sent is what stays. */}
              <fieldset className="cg-fieldset" disabled={busy}>
                <ul className="cg-lines">
                  {known.map(({ line, product: p }) => <Line key={line.productId} line={line} product={p} />)}
                </ul>
                <div className="cg-form">
                  <label className={`cg-field${customerError ? " has-error" : ""}`}>
                    שם הלקוח
                    <input
                      ref={customerRef}
                      list="cg-customers"
                      value={customer}
                      autoComplete="off"
                      aria-required
                      aria-invalid={customerError}
                      onChange={(e) => pickCustomer(e.target.value)}
                    />
                    {customerError ? <span className="cg-error" role="alert">חסר שם לקוח</span> : null}
                  </label>
                  <datalist id="cg-customers">
                    {customers.map((c) => <option key={c} value={c} />)}
                  </datalist>
                  <label className="cg-field">
                    טלפון
                    <input type="tel" dir="ltr" style={{ textAlign: "right" }} value={phone} autoComplete="off" onChange={(e) => setPhone(e.target.value)} />
                  </label>
                  <label className="cg-field">
                    הערה
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                </div>
              </fieldset>
            </div>
            <div className="cg-drawer__foot">
              {error ? <p className="cg-error" role="alert">{error}</p> : null}
              {priced ? (
                <p className="cg-total">סה״כ <b className="cg-num">{fmtPrice(total)}</b></p>
              ) : null}
              <button type="submit" className="cg-btn" disabled={busy || blocked}>{busy ? "שליחה" : "שליחת הזמנה"}</button>
              <p className="cg-drawer__hint">המלאי ישוריין מיד</p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
