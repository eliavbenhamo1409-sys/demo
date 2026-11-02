"use client";

import { useMemo, useState } from "react";
import { Input, Notice, Select } from "@/components/ui";
import { available, useData } from "@/lib/store";
import { fmtQty } from "@/lib/format";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { QtyField } from "./QtyField";
import { NEW_OPTION, productOptions, workerOptions } from "./options";
import { REQUIRED, submitOnEnter, useForm } from "./useForm";

type Field = "product" | "qty";

export function IssueForm({ ctx }: { ctx: ActionContext }) {
  const { state, product, issue } = useData();
  const { close, notify, openAction } = useUi();
  const form = useForm<Field>();

  const [productId, setProductId] = useState(ctx.productId ?? "");
  const [qty, setQty] = useState(1);
  const [workerId, setWorkerId] = useState(ctx.workerId ?? "");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const selected = product(productId);
  const unit = selected?.unit ?? "";
  const prodOpts = useMemo(() => productOptions(state.products, true), [state.products]);
  const workOpts = useMemo(() => workerOptions(state.workers, true), [state.workers]);
  const overStock = !!selected && Number.isFinite(qty) && qty > selected.qty;
  // It fits on the shelf, but only by taking what open orders hold.
  const intoHeld = !!selected && Number.isFinite(qty) && !overStock && qty > available(selected);

  const onProduct = (v: string) => {
    if (v === NEW_OPTION) { openAction("new-product"); return; }
    setProductId(v);
    form.clearField("product");
  };
  const onWorker = (v: string) => {
    if (v === NEW_OPTION) { openAction("new-worker"); return; }
    setWorkerId(v);
  };

  const submit = () => {
    const errors: Partial<Record<Field, string>> = {};
    if (!productId) errors.product = REQUIRED;
    if (!Number.isFinite(qty) || qty < 1) errors.qty = "כמות לא תקינה (1 ומעלה)";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0 || !selected) return;
    void form.run(async () => {
      await issue({
        productId,
        qty,
        workerId: workerId || null,
        reference: reference.trim() || null,
        note: note.trim() || null,
      });
      notify({ tone: "success", title: `הוצאו ${fmtQty(qty)} ${selected.unit} של ${selected.name}` });
      close();
    });
  };

  return (
    <FormPanel
      title="הוצאת סחורה"
      onClose={close}
      onSubmit={submit}
      submitLabel="הוצאה"
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      <div className="sa-field">
        <Select label="מוצר" options={prodOpts} value={productId} onChange={onProduct} placeholder="בחירת מוצר" block />
        {form.errors.product ? (
          <span className="sa-error" role="alert">{form.errors.product}</span>
        ) : selected ? (
          <span className="sa-hint">
            במלאי <span className="sa-mono ltr">{fmtQty(selected.qty)}</span> {selected.unit}
            {selected.reserved > 0 ? <> · משוריין <span className="sa-mono ltr">{fmtQty(selected.reserved)}</span></> : null}
          </span>
        ) : null}
      </div>
      <QtyField label="כמות" value={qty} onChange={(n) => { setQty(n); form.clearField("qty"); }} unit={unit || undefined} min={1} error={form.errors.qty} required />
      {overStock && selected ? (
        <Notice tone="warning" title="הכמות גדולה מהמלאי">
          במלאי <span className="sa-mono ltr">{fmtQty(selected.qty)}</span> {selected.unit} בלבד. ההוצאה תאפס את המלאי.
        </Notice>
      ) : null}
      {intoHeld && selected ? (
        <Notice tone="warning" title="חלק מהכמות משוריין">
          משוריין להזמנות פתוחות: <span className="sa-mono ltr">{fmtQty(selected.reserved)}</span> {selected.unit}
        </Notice>
      ) : null}
      <hr className="sa-form-break" />
      <Select label="עובד" options={workOpts} value={workerId} onChange={onWorker} allLabel="ללא" block />
      <Input label="מספר תעודה" optional mono placeholder="תעודת משלוח / הזמנה" value={reference} onChange={(e) => setReference(e.target.value)} />
      <Input label="הערה" optional multiline value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={submitOnEnter} />
    </FormPanel>
  );
}
