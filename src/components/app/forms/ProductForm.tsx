"use client";

import { useId, useMemo, useState } from "react";
import { Button, Input, Modal, Notice, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { UNIT_OPTIONS, supplierOptions } from "./options";
import { REQUIRED, friendlyDeleteError, parseNum, submitOnEnter, useForm } from "./useForm";

type Field = "name" | "sku" | "minQty" | "qty";

export function ProductForm({ ctx, mode }: { ctx: ActionContext; mode: "new" | "edit" }) {
  const { state, product, createProduct, updateProduct, deleteProduct } = useData();
  const { close, notify } = useUi();
  const form = useForm<Field>();
  const listId = `sa-cats-${useId()}`;

  const editing = mode === "edit" ? product(ctx.productId) : undefined;
  const [name, setName] = useState(editing?.name ?? "");
  const [sku, setSku] = useState(editing?.sku ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? UNIT_OPTIONS[0]);
  const [minQty, setMinQty] = useState(editing ? String(editing.min_qty) : "0");
  const [qty, setQty] = useState("0");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [supplierId, setSupplierId] = useState(editing?.primary_supplier_id ?? ctx.supplierId ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of state.products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [state.products]);
  const unitOptions = useMemo(() => (unit && !UNIT_OPTIONS.includes(unit) ? [...UNIT_OPTIONS, unit] : UNIT_OPTIONS), [unit]);
  const supOpts = useMemo(() => supplierOptions(state.suppliers), [state.suppliers]);

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedSku = sku.trim().toUpperCase();
    const min = parseNum(minQty);
    const initial = parseNum(qty);
    const errors: Partial<Record<Field, string>> = {};
    if (!trimmedName) errors.name = REQUIRED;
    if (!trimmedSku) errors.sku = REQUIRED;
    else if (state.products.some((p) => p.sku.toUpperCase() === trimmedSku && p.id !== editing?.id)) errors.sku = "מק\"ט קיים";
    if (minQty.trim() !== "" && (!Number.isFinite(min) || min < 0)) errors.minQty = "הזן מספר 0 ומעלה";
    if (!editing && (!Number.isFinite(initial) || initial < 0)) errors.qty = "הזן מספר 0 ומעלה";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const patch = {
      name: trimmedName,
      sku: trimmedSku,
      category: category.trim() || null,
      unit: unit || UNIT_OPTIONS[0],
      min_qty: Number.isFinite(min) ? min : 0,
      location: location.trim() || null,
      primary_supplier_id: supplierId || null,
      notes: notes.trim() || null,
    };
    void form.run(async () => {
      if (editing) {
        await updateProduct(editing.id, patch);
        notify({ tone: "success", title: `המוצר ${trimmedName} עודכן` });
      } else {
        await createProduct({ ...patch, qty: initial });
        notify({ tone: "success", title: `המוצר ${trimmedName} נוסף` });
      }
      close();
    });
  };

  const onDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProduct(editing.id);
      notify({ tone: "success", title: `המוצר ${editing.name} נמחק` });
      close();
    } catch (e) {
      setDeleteError(friendlyDeleteError(e, "לא ניתן למחוק מוצר עם תנועות"));
      setDeleting(false);
    }
  };

  const missing = mode === "edit" && !editing;

  return (
    <>
      <FormPanel
        title={mode === "edit" ? "עריכת מוצר" : "מוצר חדש"}
        subtitle={editing ? <span className="sa-mono" dir="ltr">{editing.sku}</span> : undefined}
        onClose={close}
        onSubmit={submit}
        submitLabel="שמור"
        submitDisabled={missing}
        busy={form.busy}
        error={form.error}
        onDismissError={() => form.setError(null)}
        footerStart={
          editing ? (
            <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)} disabled={form.busy}>
              מחק מוצר
            </Button>
          ) : null
        }
      >
        {missing ? (
          <Notice tone="warning" title="המוצר לא נמצא">ייתכן שנמחק ממכשיר אחר.</Notice>
        ) : (
          <>
            <Input
              label="שם"
              required
              value={name}
              onChange={(e) => { setName(e.target.value); form.clearField("name"); }}
              error={form.errors.name}
              autoComplete="off"
            />
            <Input
              label={'מק"ט'}
              required
              mono
              value={sku}
              onChange={(e) => { setSku(e.target.value.toUpperCase()); form.clearField("sku"); }}
              error={form.errors.sku}
              autoComplete="off"
              spellCheck={false}
              style={{ textTransform: "uppercase" }}
            />
            <Input label="קטגוריה" optional list={listId} value={category} onChange={(e) => setCategory(e.target.value)} autoComplete="off" />
            <datalist id={listId}>
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
            <div className="grid grid-cols-2 gap-[var(--space-4)]">
              <Select label="יחידה" options={unitOptions} value={unit} onChange={setUnit} searchable={false} block />
              <Input
                label="מינימום"
                mono
                inputMode="decimal"
                value={minQty}
                onChange={(e) => { setMinQty(e.target.value); form.clearField("minQty"); }}
                error={form.errors.minQty}
                hint={form.errors.minQty ? undefined : "0 = בלי התראה"}
              />
            </div>
            {!editing ? (
              <Input
                label="כמות התחלתית"
                mono
                inputMode="decimal"
                value={qty}
                onChange={(e) => { setQty(e.target.value); form.clearField("qty"); }}
                error={form.errors.qty}
                end={unit ? <span className="sa-faint" style={{ fontSize: 12 }}>{unit}</span> : undefined}
              />
            ) : null}
            <Input label="מיקום" optional placeholder="מדף / אזור" value={location} onChange={(e) => setLocation(e.target.value)} />
            <Select label="ספק ראשי" options={supOpts} value={supplierId} onChange={setSupplierId} allLabel="ללא ספק" block />
            <Input label="הערות" optional multiline value={notes} onChange={(e) => setNotes(e.target.value)} onKeyDown={submitOnEnter} />
          </>
        )}
      </FormPanel>

      {confirmDelete && editing ? (
        <Modal
          title={`למחוק את המוצר ${editing.name}?`}
          tone="danger"
          confirmLabel="מחק מוצר"
          busy={deleting}
          onConfirm={() => void onDelete()}
          onClose={() => { if (!deleting) { setConfirmDelete(false); setDeleteError(null); } }}
        >
          <div className="flex flex-col gap-[var(--space-3)]">
            <p className="m-0">
              {'הפעולה אינה הפיכה. מק"ט '}<span className="sa-num">{editing.sku}</span> יוסר מהמלאי. מוצר עם תנועות אינו ניתן למחיקה.
            </p>
            {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
