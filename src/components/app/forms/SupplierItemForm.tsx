"use client";

import { useId, useMemo, useState } from "react";
import { Input, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { productOptions, supplierOptions } from "./options";
import { REQUIRED, useForm } from "./useForm";

type Field = "supplier" | "name";

export function SupplierItemForm({ ctx }: { ctx: ActionContext }) {
  const { state, supplier, createSupplierItem, resolveSupplierName } = useData();
  const { close, notify } = useUi();
  const form = useForm<Field>();
  const approvedId = `sa-approved-${useId()}`;

  const [supplierId, setSupplierId] = useState(ctx.supplierId ?? "");
  const [externalName, setExternalName] = useState("");
  const [externalSku, setExternalSku] = useState("");
  const [productId, setProductId] = useState(ctx.productId ?? "");
  const [approved, setApproved] = useState(false);

  const supOpts = useMemo(() => supplierOptions(state.suppliers), [state.suppliers]);
  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);

  const submit = () => {
    const trimmed = externalName.trim();
    const errors: Partial<Record<Field, string>> = {};
    if (!supplierId) errors.supplier = REQUIRED;
    if (!trimmed) errors.name = REQUIRED;
    else if (supplierId && resolveSupplierName(supplierId, trimmed).status !== "unknown") {
      errors.name = "השם כבר קיים אצל הספק הזה";
    }
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const s = supplier(supplierId);
    void form.run(async () => {
      await createSupplierItem({
        supplier_id: supplierId,
        external_name: trimmed,
        external_sku: externalSku.trim() || null,
        product_id: productId || null,
        status: approved && productId ? "approved" : "pending",
      });
      notify({ tone: "success", title: s ? `${trimmed} נוסף למילון של ${s.name}` : `${trimmed} נוסף למילון` });
      close();
    });
  };

  return (
    <FormPanel
      title="שם חיצוני חדש"
      onClose={close}
      onSubmit={submit}
      submitLabel="שמור"
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      <div className="sa-field">
        <Select label="ספק" options={supOpts} value={supplierId} onChange={(v) => { setSupplierId(v); form.clearField("supplier"); }} placeholder="בחר ספק" block />
        {form.errors.supplier ? <span className="sa-error" role="alert">{form.errors.supplier}</span> : null}
      </div>
      <Input
        label="שם אצל הספק"
        required
        value={externalName}
        onChange={(e) => { setExternalName(e.target.value); form.clearField("name"); }}
        error={form.errors.name}
        hint="המערכת תזהה את השם הזה אוטומטית בקליטות הבאות"
        autoComplete="off"
      />
      <Input label={'מק"ט חיצוני'} optional mono value={externalSku} onChange={(e) => setExternalSku(e.target.value)} autoComplete="off" spellCheck={false} />
      <Select label="מוצר במפעל" options={prodOpts} value={productId} onChange={setProductId} allLabel="ללא התאמה" block />
      <label htmlFor={approvedId} className="flex items-center gap-[var(--space-2)] text-[13px] leading-5 cursor-pointer select-none">
        <input
          id={approvedId}
          type="checkbox"
          checked={approved}
          disabled={!productId}
          onChange={(e) => setApproved(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: "var(--text-primary)" }}
        />
        <span>מאושר</span>
        <span className="sa-faint">{productId ? (approved ? "ההתאמה תירשם כמאושרת" : "יישמר כלא מאושר") : "אפשר לאשר רק עם מוצר במפעל"}</span>
      </label>
    </FormPanel>
  );
}
