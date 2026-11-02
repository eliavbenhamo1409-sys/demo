"use client";

/**
 * The inline "שם של ספק" form that opens under a product row's names.
 * Enter submits, Escape cancels; focus lands on the first control on open.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, Input, Notice, Select } from "@/components/ui";
import { isTempId, useData, type Product } from "@/lib/store";
import { useUi } from "../ui-state";
import { NEW_OPTION, supplierOptions } from "../forms/options";
import { REQUIRED, useAutofocus, useForm } from "../forms/useForm";

type Field = "supplier" | "name";

export function InlineAliasForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const { state, supplier, createSupplierItem, resolveSupplierName } = useData();
  const { notify, openAction } = useUi();
  const form = useForm<Field>();
  const rootRef = useAutofocus<HTMLFormElement>();

  const [supplierId, setSupplierId] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");

  const supOpts = useMemo(() => supplierOptions(state.suppliers, true), [state.suppliers]);
  const noSuppliers = state.suppliers.length === 0;

  // Supplier ids known when "+ ספק חדש" was picked; the saved newcomer gets selected.
  const knownSuppliers = useRef<Set<string> | null>(null);

  useEffect(() => {
    const known = knownSuppliers.current;
    if (!known) return;
    const added = state.suppliers.find((s) => !known.has(s.id) && !isTempId(s.id));
    if (!added) return;
    knownSuppliers.current = null;
    setSupplierId(added.id);
    form.clearField("supplier");
  }, [state.suppliers, form]);

  const onSupplierChange = (v: string) => {
    if (v === NEW_OPTION) {
      knownSuppliers.current = new Set(state.suppliers.map((s) => s.id));
      openAction("new-supplier");
      return;
    }
    setSupplierId(v);
    form.clearField("supplier");
    form.clearField("name");
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (form.busy) return;
    const trimmed = name.trim();
    const errors: Partial<Record<Field, string>> = {};
    if (!supplierId) errors.supplier = REQUIRED;
    if (!trimmed) errors.name = REQUIRED;
    else if (supplierId) {
      const existing = resolveSupplierName(supplierId, trimmed);
      if (existing.status !== "unknown") {
        errors.name = existing.item.product_id === product.id ? "השם הזה כבר רשום למוצר" : "השם כבר קיים אצל הספק הזה";
      }
    }
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const s = supplier(supplierId);
    void form.run(async () => {
      await createSupplierItem({
        supplier_id: supplierId,
        external_name: trimmed,
        external_sku: sku.trim() || null,
        product_id: product.id,
        status: "approved",
      });
      notify({ tone: "success", title: `"${trimmed}" של ${s?.name ?? "הספק"} נרשם למוצר ${product.name}` });
      onClose();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape" && !e.isDefaultPrevented()) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <form ref={rootRef} className="sa-dict-form" noValidate onSubmit={submit} onKeyDown={onKeyDown} aria-label={`שם של ספק עבור ${product.name}`} aria-busy={form.busy || undefined}>
      {form.error ? (
        <Notice tone="danger" title="השמירה נכשלה" onDismiss={() => form.setError(null)}>
          {form.error}
        </Notice>
      ) : null}
      {noSuppliers ? (
        <span className="sa-dict-form-missing">
          <span>אין ספקים</span>
          <Button variant="link" data-autofocus onClick={() => openAction("new-supplier")}>ספק חדש</Button>
        </span>
      ) : (
        <div className="sa-field is-supplier">
          <Select
            options={supOpts}
            value={supplierId}
            onChange={onSupplierChange}
            placeholder="ספק"
            searchPlaceholder="חיפוש לפי שם ספק"
            block
          />
          {form.errors.supplier ? <span className="sa-error" role="alert">{form.errors.supplier}</span> : null}
        </div>
      )}
      <Input
        aria-label="שם אצל הספק"
        placeholder="שם אצל הספק"
        value={name}
        onChange={(e) => { setName(e.target.value); form.clearField("name"); }}
        error={form.errors.name}
        autoComplete="off"
        disabled={noSuppliers}
      />
      <Input
        className="is-sku"
        aria-label={'מק"ט חיצוני'}
        placeholder={'מק"ט חיצוני'}
        mono
        value={sku}
        onChange={(e) => setSku(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        disabled={noSuppliers}
      />
      <div className="sa-dict-form-actions">
        <Button type="submit" variant="primary" isLoading={form.busy} disabled={noSuppliers}>שמירה</Button>
        <Button variant="ghost" onClick={onClose} disabled={form.busy}>ביטול</Button>
      </div>
    </form>
  );
}
