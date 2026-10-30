"use client";

import { useMemo, useState } from "react";
import { Input, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { fmtQty } from "@/lib/format";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { QtyField } from "./QtyField";
import { NEW_OPTION, productOptions, supplierOptions, workerOptions } from "./options";
import { REQUIRED, submitOnEnter, useForm } from "./useForm";

type Field = "product" | "qty";

export function ReceiveForm({ ctx }: { ctx: ActionContext }) {
  const { state, product, receive } = useData();
  const { close, notify, openAction } = useUi();
  const form = useForm<Field>();

  const [productId, setProductId] = useState(ctx.productId ?? "");
  const [qty, setQty] = useState(1);
  const [supplierId, setSupplierId] = useState(product(ctx.productId)?.primary_supplier_id ?? "");
  const [workerId, setWorkerId] = useState(ctx.workerId ?? "");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const selected = product(productId);
  const unit = selected?.unit ?? "";
  const prodOpts = useMemo(() => productOptions(state.products, true), [state.products]);
  const supOpts = useMemo(() => supplierOptions(state.suppliers), [state.suppliers]);
  const workOpts = useMemo(() => workerOptions(state.workers, true), [state.workers]);

  const onProduct = (v: string) => {
    if (v === NEW_OPTION) { openAction("new-product"); return; }
    setProductId(v);
    form.clearField("product");
    const p = product(v);
    if (p?.primary_supplier_id) setSupplierId(p.primary_supplier_id);
  };
  const onWorker = (v: string) => {
    if (v === NEW_OPTION) { openAction("new-worker"); return; }
    setWorkerId(v);
  };

  const submit = () => {
    const errors: Partial<Record<Field, string>> = {};
    if (!productId) errors.product = REQUIRED;
    if (!Number.isFinite(qty) || qty < 1) errors.qty = "הזן כמות של 1 לפחות";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0 || !selected) return;
    void form.run(async () => {
      await receive({
        productId,
        qty,
        supplierId: supplierId || null,
        workerId: workerId || null,
        reference: reference.trim() || null,
        note: note.trim() || null,
      });
      notify({ tone: "success", title: `נקלטו ${fmtQty(qty)} ${selected.unit} של ${selected.name}` });
      close();
    });
  };

  const qtyLabel = Number.isFinite(qty) && qty > 0 ? `קלוט ${fmtQty(qty)} ${unit}`.trim() : "קלוט";

  return (
    <FormPanel
      title="קליטת סחורה"
      onClose={close}
      onSubmit={submit}
      submitLabel={qtyLabel}
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      <div className="sa-field">
        <Select label="מוצר" options={prodOpts} value={productId} onChange={onProduct} placeholder="בחר מוצר" block />
        {form.errors.product ? <span className="sa-error" role="alert">{form.errors.product}</span> : null}
      </div>
      <QtyField label="כמות" value={qty} onChange={(n) => { setQty(n); form.clearField("qty"); }} unit={unit || undefined} min={1} error={form.errors.qty} required />
      <Select label="ספק" options={supOpts} value={supplierId} onChange={setSupplierId} allLabel="ללא ספק" block />
      <Select label="עובד" options={workOpts} value={workerId} onChange={onWorker} allLabel="ללא" block />
      <Input label="אסמכתא" optional mono placeholder="תעודת משלוח / הזמנה" value={reference} onChange={(e) => setReference(e.target.value)} />
      <Input label="הערה" optional multiline value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={submitOnEnter} />
    </FormPanel>
  );
}
