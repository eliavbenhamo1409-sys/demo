"use client";

/**
 * הזמנה חדשה: the owner places an order from the admin, the way an agent does from the catalogue.
 * It goes through the same database function, which holds the stock, refuses what can no longer be promised
 * and keeps a resend after a lost answer from placing it twice. With no agent chosen it is a direct order.
 */
import { useId, useMemo, useRef, useState } from "react";
import { Button, Input, QuantityStepper, Select, type SelectOption } from "@/components/ui";
import { available, OrderShortageError, useData, type Product } from "@/lib/store";
import { daysUntil, DIRECT_ORDER, fmtName, fmtPrice, fmtQty, fmtUnit } from "@/lib/format";
import { DayField } from "../WhenFilters";
import { useUi, type ActionContext } from "../ui-state";
import { ProductThumb } from "../Viz";
import { FormPanel } from "./FormPanel";
import { MoreFields } from "./MoreFields";
import { REQUIRED, submitOnEnter, useForm } from "./useForm";

type Field = "customer" | "promised" | "lines";
type Line = { productId: string; qty: number };

function newRequest(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Any page not served over https.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Why a line can't go as it is, in words; null when it fits what can still be promised. */
function overWords(p: Product, qty: number): string | null {
  const free = available(p);
  if (qty <= free) return null;
  if (free <= 0) return p.qty <= 0 ? "אזל מהמלאי" : "כל המלאי משוריין להזמנות";
  return `אפשר להבטיח עד ${fmtQty(free)} ${fmtUnit(free, p.unit)}`;
}

export function OrderForm({ ctx }: { ctx: ActionContext }) {
  const { state, product, createOrder } = useData();
  const { close, notify, openOrder } = useUi();
  const form = useForm<Field>();
  const listId = useId();
  const linesTitle = useId();
  const linesRef = useRef<HTMLElement>(null);

  // The order's own id, kept across resends: when an answer is lost, sending again returns the order that landed.
  const [request, setRequest] = useState(newRequest);
  const [customer, setCustomer] = useState("");
  const [promised, setPromised] = useState("");
  const [lines, setLines] = useState<Line[]>(() => {
    const p = product(ctx.productId);
    return p && p.in_catalog && available(p) > 0 ? [{ productId: p.id, qty: 1 }] : [];
  });
  const [phone, setPhone] = useState("");
  const [phoneTyped, setPhoneTyped] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [note, setNote] = useState("");
  // What the database refused, by product, until the line changes.
  const [refused, setRefused] = useState<Record<string, string>>({});

  // Customers who ordered before, the latest first, each with the last phone they gave.
  const known = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of state.orders) if (!map.has(o.customer) || (!map.get(o.customer) && o.customer_phone)) map.set(o.customer, o.customer_phone ?? "");
    return map;
  }, [state.orders]);

  // Only what the catalogue sells can be ordered, as for an agent; a product with nothing to promise says so.
  const addOptions = useMemo<SelectOption[]>(() => {
    const taken = new Set(lines.map((l) => l.productId));
    return state.products
      .filter((p) => p.in_catalog && !taken.has(p.id))
      .map((p) => ({ value: p.id, label: `${fmtName(p.name)} · ${p.sku}${available(p) > 0 ? "" : " · אין זמין"}` }));
  }, [state.products, lines]);

  const agentOptions = useMemo<SelectOption[]>(
    () => state.agents.filter((a) => a.active).map((a) => ({ value: a.id, label: a.name })),
    [state.agents],
  );

  const rows = lines.flatMap((l) => {
    const p = product(l.productId);
    return p ? [{ line: l, p, problem: refused[p.id] ?? overWords(p, l.qty) }] : [];
  });
  const total = rows.reduce<number | null>((sum, r) => (sum === null || r.p.price === null ? null : sum + r.line.qty * r.p.price), 0);

  /** −, + and a removed line fire no input event, so a real change announces itself to the drawer's guard. */
  const touched = () => linesRef.current?.dispatchEvent(new Event("input", { bubbles: true }));

  const forget = (productId: string) =>
    setRefused((r) => {
      if (!(productId in r)) return r;
      const next = { ...r };
      delete next[productId];
      return next;
    });

  const onCustomer = (v: string) => {
    setCustomer(v);
    form.clearField("customer");
    // A customer who ordered before brings their phone, unless one was typed.
    if (!phoneTyped) setPhone(known.get(v.trim()) ?? "");
  };

  const onAdd = (id: string) => {
    const p = product(id);
    if (!p) return;
    const why = overWords(p, 1);
    if (why) {
      form.setErrors((e) => ({ ...e, lines: `${fmtName(p.name)}: ${why}` }));
      return;
    }
    form.clearField("lines");
    setLines((ls) => [...ls, { productId: id, qty: 1 }]);
  };

  const setQty = (productId: string, qty: number) => {
    touched();
    forget(productId);
    form.clearField("lines");
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, qty } : l)));
  };

  const remove = (productId: string) => {
    touched();
    forget(productId);
    form.clearField("lines");
    setLines((ls) => ls.filter((l) => l.productId !== productId));
  };

  const submit = () => {
    const errors: Partial<Record<Field, string>> = {};
    if (!customer.trim()) errors.customer = REQUIRED;
    if (!promised) errors.promised = REQUIRED;
    else if (daysUntil(promised) < 0) errors.promised = "היום הזה כבר עבר";
    if (rows.length === 0) errors.lines = "צריך לפחות מוצר אחד";
    else if (rows.some((r) => r.problem || !Number.isFinite(r.line.qty) || r.line.qty <= 0)) errors.lines = "יש שורה שמבקשת יותר ממה שזמין";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;

    void form.run(async () => {
      try {
        const placed = await createOrder({
          request,
          agentId: agentId || null,
          customer: customer.trim(),
          phone: phone.trim(),
          note: note.trim(),
          promised,
          lines: rows.map((r) => r.line),
        });
        if (placed.status === "cancelled") {
          // A resend found its earlier order, cancelled since: a new id sends this one as a new order.
          setRequest(newRequest());
          throw new Error("ההזמנה הקודמת בוטלה בינתיים. אפשר לשלוח שוב, והיא תיפתח כהזמנה חדשה");
        }
        notify({ tone: "success", title: `הזמנה ${placed.number} נפתחה`, text: placed.customer });
        openOrder(placed.id);
      } catch (e) {
        if (e instanceof OrderShortageError) {
          setRefused(Object.fromEntries(e.lines.flatMap((s) => {
            if (!s.product_id) return [];
            const p = product(s.product_id);
            const word = s.wanted <= s.available ? "כבר לא בקטלוג" : s.available > 0 ? `אפשר להבטיח עד ${fmtQty(s.available)} ${fmtUnit(s.available, p?.unit)}` : "כבר אין זמין";
            return [[s.product_id, word]];
          })));
          throw new Error("בינתיים הוזמן מהמלאי, והשורות המסומנות כבר לא זמינות כך. אפשר לתקן ולשלוח שוב");
        }
        throw e;
      }
    });
  };

  return (
    <FormPanel
      title="הזמנה חדשה"
      onClose={close}
      onSubmit={submit}
      submitLabel="פתיחת הזמנה"
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      <Input
        label="לקוח"
        required
        value={customer}
        onChange={(e) => onCustomer(e.target.value)}
        error={form.errors.customer}
        hint={phone && !phoneTyped ? `טלפון ${phone}` : undefined}
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {[...known.keys()].map((name) => <option key={name} value={name} />)}
      </datalist>
      <DayField label="מסירה ללקוח" value={promised} onChange={(day) => { setPromised(day); form.clearField("promised"); }} error={form.errors.promised} />

      <hr className="sa-form-break" />
      {/* The chosen lines read like the order's own drawer; the picker under them stays a plain field. */}
      {rows.length > 0 ? (
        <section ref={linesRef} className="sa-group sa-draft flex flex-col gap-[var(--space-2)]" aria-labelledby={linesTitle}>
          <h3 id={linesTitle} className="sa-section-title">
            מוצרים
            <span className="sa-mono sa-faint ms-[var(--space-2)] font-normal">{fmtQty(rows.length)}</span>
          </h3>
          <ul className="sa-rows flex list-none flex-col divide-y divide-line-subtle">
            {rows.map(({ line, p, problem }) => {
              const free = available(p);
              return (
                <li key={p.id} className="sa-order-line sa-draft-line relative flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                  <ProductThumb product={p} />
                  <span className="min-w-0 flex-1">
                    <span className="sa-truncate block">{fmtName(p.name)}</span>
                    {problem ? (
                      <span className="sa-error block">{problem}</span>
                    ) : (
                      <span className="sa-cell-sub">
                        זמין <span className="sa-mono ltr">{fmtQty(free)}</span> {fmtUnit(free, p.unit)}
                        {p.price !== null ? <> · {fmtPrice(line.qty * p.price)}</> : null}
                      </span>
                    )}
                  </span>
                  <QuantityStepper size="sm" label={`כמות של ${p.name}`} value={line.qty} min={1} onChange={(n) => setQty(p.id, n)} />
                  <Button variant="ghost" size="sm" iconOnly icon="x" title="הסרת השורה" onClick={() => remove(p.id)} />
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
        </section>
      ) : null}
      <div className="sa-field">
        <Select
          label={rows.length > 0 ? undefined : "מוצרים"}
          options={addOptions}
          value=""
          onChange={onAdd}
          placeholder={rows.length > 0 ? "הוספת מוצר נוסף" : "הוספת מוצר"}
          searchPlaceholder={'חיפוש לפי שם או מק"ט'}
          emptyLabel="אין מוצר כזה בקטלוג"
          block
        />
        {form.errors.lines ? <span className="sa-error" role="alert">{form.errors.lines}</span> : null}
      </div>

      <MoreFields>
        <Input
          label="טלפון"
          optional
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setPhoneTyped(true); }}
          inputMode="tel"
          autoComplete="off"
        />
        <Select label="סוכן" options={agentOptions} value={agentId} onChange={setAgentId} allLabel={DIRECT_ORDER} placeholder={DIRECT_ORDER} block />
        <Input label="הערה" optional multiline value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={submitOnEnter} />
      </MoreFields>
    </FormPanel>
  );
}
