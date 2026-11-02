"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { available, OrderRefused, ShortageError, useCatalog, type DraftLine, type Product } from "@/lib/catalog";
import { fmtName, fmtPrice, fmtPromise, fmtQty, today } from "@/lib/catalog/format";
import { CloseIcon } from "./Icons";
import { Notice, NoticeRow } from "./Notice";
import { ProductImage } from "./ProductCard";
import { useDrawer } from "./Shell";
import { Stepper } from "./Stepper";

/** A line the stock can't cover: `free` is what could go instead, zero when the product is gone. */
type ShortLine = { productId: string; name: string; unit: string; wanted: number; free: number };

/** What stands between the agent and a sent order, on screen until it is answered. */
type Stop =
  | { kind: "short"; lines: ShortLine[]; changed: boolean }
  | { kind: "refused"; title: string; text: string; retry: boolean }
  | { kind: "today" };

function dateProblem(day: string): string | null {
  if (!day) return "חסר תאריך מסירה";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "התאריך לא תקין";
  return day < today() ? "התאריך עבר. צריך לבחור מהיום והלאה" : null;
}

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
          <Stepper small label={`כמות של ${product.name}`} value={line.qty} onChange={(n) => setDraftQty(product.id, n)} />
          <button type="button" className="cg-link" onClick={() => removeFromDraft(product.id)}>הסרה</button>
        </div>
        {over ? (
          <div className="cg-line__row">
            <span className="cg-line__short">{free > 0 ? `זמין רק ${fmtQty(free)} ${product.unit}` : "לא זמין כרגע"}</span>
            {free >= 1 ? <button type="button" className="cg-link" onClick={() => setDraftQty(product.id, Math.floor(free))}>עדכון ל־{fmtQty(Math.floor(free))}</button> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function OrderDrawer() {
  const { lines, product, orders, landed, landedEarlier, settleLanded, placeOrder, clearDraft, setDraftLines } = useCatalog();
  const { open, hide } = useDrawer();
  const router = useRouter();
  const [customer, setCustomer] = useState("");
  const [promised, setPromised] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [customerError, setCustomerError] = useState(false);
  const [promisedError, setPromisedError] = useState<string | null>(null);
  const [stop, setStop] = useState<Stop | null>(null);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<{ number: number; customer: string; promised_on: string | null } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const promisedRef = useRef<HTMLLabelElement>(null);
  const filledPhone = useRef("");

  const done = placed ?? landed ?? null;
  // A send that found its order already there keeps the first send's details and lines.
  const earlier = done !== null && (landedEarlier || (customer.trim() !== "" && done.customer !== customer.trim()) || (promised !== "" && done.promised_on !== promised));

  const close = () => {
    // The answer decides what becomes of these lines, so the drawer waits for it.
    if (busy) return;
    hide();
    setStop(null);
    if (!done) return;
    if (landed) settleLanded();
    setPlaced(null);
    // The details belong to the order that was sent; the next customer starts clean.
    setCustomer("");
    setPromised("");
    setPhone("");
    setNote("");
    filledPhone.current = "";
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
      // With a message open, Escape belongs to the message.
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) closeRef.current();
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
  const short = known.flatMap<ShortLine>(({ line, product: p }) =>
    !p
      ? [{ productId: line.productId, name: "מוצר שהוסר מהקטלוג", unit: "", wanted: line.qty, free: 0 }]
      : line.qty > available(p)
        ? [{ productId: p.id, name: p.name, unit: p.unit, wanted: line.qty, free: Math.floor(available(p)) }]
        : [],
  );
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

  const send = async () => {
    setBusy(true);
    setStop(null);
    try {
      const order = await placeOrder({ customer, phone, note, promised });
      setPlaced(order);
      clearDraft();
    } catch (refused) {
      if (refused instanceof ShortageError) {
        setStop({
          kind: "short",
          changed: true,
          lines: refused.lines.map((l) => {
            const p = product(l.product_id);
            return { productId: l.product_id ?? "", name: l.name ?? "מוצר שהוסר מהקטלוג", unit: p?.unit ?? "", wanted: l.wanted, free: Math.floor(l.available) };
          }),
        });
      } else if (refused instanceof OrderRefused) {
        setStop({ kind: "refused", title: refused.title, text: refused.message, retry: refused.retry });
      } else {
        setStop({ kind: "refused", title: "ההזמנה לא נשלחה", text: "אפשר לנסות שוב, ואם זה חוזר לפנות למנהל", retry: true });
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Stock first: a shortage changes the order itself, a missing detail doesn't.
    if (short.length > 0) {
      setStop({ kind: "short", lines: short, changed: false });
      return;
    }
    if (!customer.trim()) {
      setCustomerError(true);
      customerRef.current?.focus();
      return;
    }
    const problem = dateProblem(promised);
    if (problem) {
      setPromisedError(problem);
      // Not focus: on an iPhone that opens the calendar, which fills in today and clears this very message.
      promisedRef.current?.scrollIntoView({ block: "center" });
      return;
    }
    // An iPhone's calendar also leaves today on a tap away, so a delivery today is asked about, never assumed.
    if (promised === today()) {
      setStop({ kind: "today" });
      return;
    }
    void send();
  };

  /** Shorts each line to what the stock has and drops the ones with nothing left. The agent sees the new order before sending it. */
  const fitToStock = (shortLines: ShortLine[]) => {
    const free = new Map(shortLines.map((l) => [l.productId, l.free]));
    setDraftLines(lines.flatMap((l) => {
      const fits = free.get(l.productId);
      if (fits === undefined) return [l];
      return fits >= 1 ? [{ ...l, qty: fits }] : [];
    }));
    setStop(null);
  };

  const toOrders = () => {
    if (busy) return;
    close();
    router.push("/catalog/orders");
  };

  return (
    <div className={`cg-drawer${open ? " is-open" : ""}`} aria-hidden={!open}>
      <button type="button" className="cg-drawer__scrim" aria-label="סגירה" tabIndex={-1} onClick={close} />
      <div ref={panelRef} className="cg-drawer__panel" role="dialog" aria-modal="true" aria-label="הזמנה חדשה" tabIndex={-1}>
        <div className="cg-drawer__head">
          <h2 className="cg-drawer__title">{done ? "ההזמנה נשלחה" : "הזמנה חדשה"}</h2>
          <button type="button" className="cg-close" aria-label="סגירה" onClick={close}><CloseIcon /></button>
        </div>

        {done ? (
          <div className="cg-placed">
            <span className="cg-placed__number cg-num">{done.number}</span>
            <p className="cg-placed__title">המלאי שוריין</p>
            {/* All from the database's answer: what the warehouse sees is what the agent reads. */}
            <p className="cg-placed__sub">{done.customer}</p>
            {done.promised_on ? <p className="cg-placed__sub">מסירה ללקוח: {fmtPromise(done.promised_on)}</p> : null}
            <p className="cg-placed__sub">{earlier ? "ההזמנה נקלטה בשליחה הקודמת. שינויים שנעשו אחריה לא נכנסו" : "המחסן רואה את ההזמנה"}</p>
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
          <form onSubmit={submit} noValidate style={{ display: "contents" }}>
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
                  <label ref={promisedRef} className={`cg-field${promisedError ? " has-error" : ""}`}>
                    תאריך מסירה ללקוח
                    <input
                      type="date"
                      min={today()}
                      max="9999-12-31"
                      value={promised}
                      aria-required
                      aria-invalid={promisedError !== null}
                      onClick={(e) => e.currentTarget.showPicker?.()}
                      onChange={(e) => {
                        setPromised(e.target.value);
                        setPromisedError(null);
                      }}
                    />
                    {promisedError ? (
                      <span className="cg-error" role="alert">{promisedError}</span>
                    ) : promised ? (
                      <span className="cg-field__note">{fmtPromise(promised)}</span>
                    ) : null}
                  </label>
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
              {priced ? (
                <p className="cg-total">סה״כ <b className="cg-num">{fmtPrice(total)}</b></p>
              ) : null}
              <button type="submit" className="cg-btn" disabled={busy}>{busy ? "שולח" : "שליחת הזמנה"}</button>
              <p className="cg-drawer__hint">המלאי ישוריין מיד</p>
            </div>
          </form>
        )}
      </div>

      {/* An order that did land while its answer was lost is confirmed above, so no message about it stands. */}
      {stop?.kind === "short" && !done ? (
        <Notice
          title={stop.changed ? "המלאי השתנה" : "אין מספיק במלאי"}
          primary={{ label: stop.lines.some((l) => l.free >= 1) ? "עדכון הכמויות" : "הסרה מההזמנה", onClick: () => fitToStock(stop.lines) }}
          secondary={{ label: "חזרה", onClick: () => setStop(null) }}
          onClose={() => setStop(null)}
        >
          <dl className="cg-notice__rows">
            {stop.lines.map((l) => (
              <NoticeRow key={l.productId} label={fmtName(l.name)}>
                {l.free >= 1 ? <>זמין <span className="cg-num">{fmtQty(l.free)}</span> {l.unit}</> : "לא זמין"}
              </NoticeRow>
            ))}
          </dl>
          <p className="cg-notice__text">
            {stop.changed ? "הוזמן מהמלאי לפני רגע. " : ""}
            {stop.lines.some((l) => l.free >= 1) ? "אפשר לעדכן לכמות הזמינה ולשלוח, ועל היתר לבדוק עם המחסן" : "אפשר להסיר מההזמנה ולבדוק עם המחסן מתי תגיע סחורה"}
          </p>
        </Notice>
      ) : null}

      {stop?.kind === "today" && !done ? (
        <Notice
          title="מסירה עוד היום?"
          primary={{ label: "כן, מסירה היום", onClick: () => void send() }}
          secondary={{ label: "שינוי התאריך", onClick: () => setStop(null) }}
          onClose={() => setStop(null)}
        >
          <p className="cg-notice__text">זו התחייבות ללקוח, והמחסן יכין את ההזמנה לפיה</p>
        </Notice>
      ) : null}

      {stop?.kind === "refused" && !done ? (
        <Notice
          title={stop.title}
          primary={stop.retry ? { label: "שליחה שוב", onClick: () => void send() } : { label: "הבנתי", onClick: () => setStop(null) }}
          secondary={stop.retry ? { label: "חזרה", onClick: () => setStop(null) } : undefined}
          onClose={() => setStop(null)}
        >
          <p className="cg-notice__text">{stop.text}</p>
        </Notice>
      ) : null}
    </div>
  );
}
