"use client";

/**
 * "שם של ספק": records how one supplier calls one of the factory's products.
 * Product first, then supplier, then the supplier's own name for it. Saving
 * always stores an approved alias, so the next delivery note is recognised.
 */
import { useMemo, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { productOptions, supplierOptions } from "./options";
import { REQUIRED, useForm } from "./useForm";

type Field = "product" | "supplier" | "name";

export function SupplierItemForm({ ctx }: { ctx: ActionContext }) {
  const { state, supplier, product, createSupplierItem, resolveSupplierName } = useData();
  const { close, notify, openAction } = useUi();
  const form = useForm<Field>();

  const noProducts = state.products.length === 0;
  const noSuppliers = state.suppliers.length === 0;
  const blocked = noProducts || noSuppliers;

  const [productId, setProductId] = useState(ctx.productId ?? "");
  const [supplierId, setSupplierId] = useState(ctx.supplierId ?? "");
  const [externalName, setExternalName] = useState("");
  const [externalSku, setExternalSku] = useState("");

  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);
  const supOpts = useMemo(() => supplierOptions(state.suppliers), [state.suppliers]);

  const submit = () => {
    if (blocked) return;
    const trimmed = externalName.trim();
    const errors: Partial<Record<Field, string>> = {};
    if (!productId) errors.product = REQUIRED;
    if (!supplierId) errors.supplier = REQUIRED;
    if (!trimmed) errors.name = REQUIRED;
    else if (supplierId) {
      const existing = resolveSupplierName(supplierId, trimmed);
      if (existing.status !== "unknown") {
        errors.name = productId && existing.item.product_id === productId ? "השם הזה כבר רשום למוצר" : "השם כבר קיים אצל הספק הזה";
      }
    }
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const s = supplier(supplierId);
    const p = product(productId);
    void form.run(async () => {
      await createSupplierItem({
        supplier_id: supplierId,
        external_name: trimmed,
        external_sku: externalSku.trim() || null,
        product_id: productId,
        status: "approved",
      });
      notify({ tone: "success", title: `"${trimmed}" של ${s?.name ?? "הספק"} נרשם למוצר ${p?.name ?? ""}`.trim() });
      close();
    });
  };

  return (
    <FormPanel
      title="שם של ספק"
      subtitle="השם של המוצר אצל הספק"
      onClose={close}
      onSubmit={submit}
      submitLabel="שמירה"
      busy={form.busy}
      submitDisabled={blocked}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      {noProducts ? (
        <div className="sa-field">
          <span className="sa-label">מוצר במחסן</span>
          <span className="sa-dict-form-missing">
            <span>אין מוצרים במחסן</span>
            <Button variant="link" data-autofocus onClick={() => openAction("new-product")}>מוצר חדש</Button>
          </span>
        </div>
      ) : (
        <div className="sa-field">
          <Select
            label="מוצר במחסן"
            options={prodOpts}
            value={productId}
            onChange={(v) => { setProductId(v); form.clearField("product"); form.clearField("name"); }}
            placeholder="בחירת מוצר"
            searchPlaceholder='חיפוש לפי שם או מק"ט'
            block
          />
          {form.errors.product ? <span className="sa-error" role="alert">{form.errors.product}</span> : null}
        </div>
      )}
      {noSuppliers ? (
        <div className="sa-field">
          <span className="sa-label">ספק</span>
          <span className="sa-dict-form-missing">
            <span>אין ספקים</span>
            <Button variant="link" data-autofocus={!noProducts || undefined} onClick={() => openAction("new-supplier")}>ספק חדש</Button>
          </span>
        </div>
      ) : (
        <div className="sa-field">
          <Select
            label="ספק"
            options={supOpts}
            value={supplierId}
            onChange={(v) => { setSupplierId(v); form.clearField("supplier"); form.clearField("name"); }}
            placeholder="בחירת ספק"
            searchPlaceholder="חיפוש לפי שם ספק"
            block
          />
          {form.errors.supplier ? <span className="sa-error" role="alert">{form.errors.supplier}</span> : null}
        </div>
      )}
      <hr className="sa-form-break" />
      <Input
        label="שם אצל הספק"
        required
        value={externalName}
        onChange={(e) => { setExternalName(e.target.value); form.clearField("name"); }}
        error={form.errors.name}
        hint="יזוהה אוטומטית בקליטות הבאות"
        autoComplete="off"
        disabled={blocked}
      />
      <Input label={'מק"ט חיצוני'} optional mono value={externalSku} onChange={(e) => setExternalSku(e.target.value)} autoComplete="off" spellCheck={false} disabled={blocked} />
    </FormPanel>
  );
}
