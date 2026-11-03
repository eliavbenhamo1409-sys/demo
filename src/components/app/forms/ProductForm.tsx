"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Button, Input, Modal, Notice, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { fmtQty } from "@/lib/format";
import { productPhotoUrl, removeProductPhoto, uploadProductPhoto } from "@/lib/product-photos";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { MoreFields } from "./MoreFields";
import { UNIT_OPTIONS, supplierOptions } from "./options";
import { PhotoField } from "./PhotoField";
import { REQUIRED, friendlyDeleteError, parseNum, submitOnEnter, useForm } from "./useForm";

type Field = "name" | "sku" | "barcode" | "minQty" | "qty" | "price";

/** Up to ten digits and two decimals, like the column. A plain parse would read a thousands comma as a decimal. */
const PRICE_RE = /^\d{1,10}([.,]\d{1,2})?$/;

/** The house series for a product saved with no code: P- and four digits, one past the highest in use. */
const AUTO_SKU_RE = /^P-(\d{4})$/i;
function nextSku(products: readonly { sku: string }[]): string {
  let top = 0;
  for (const p of products) {
    const m = AUTO_SKU_RE.exec(p.sku);
    if (m) top = Math.max(top, Number(m[1]));
  }
  return `P-${String(top + 1).padStart(4, "0")}`;
}

/** The file is only a leftover by now, so it never fails what already landed. */
const discardPhoto = (path: string) => void removeProductPhoto(path).catch(() => undefined);

export function ProductForm({ ctx, mode }: { ctx: ActionContext; mode: "new" | "edit" }) {
  const { state, product, supplier, createProduct, updateProduct, deleteProduct, mapSupplierItem, approveItemRequest } = useData();
  const { close, notify, markDirty } = useUi();
  const form = useForm<Field>();
  const listId = `sa-cats-${useId()}`;

  const editing = mode === "edit" ? product(ctx.productId) : undefined;
  // "מוצר חדש מהשם הזה": a dictionary entry seeds the new product and is mapped to it once created.
  const seedItem = useMemo(
    () => (mode === "new" && ctx.supplierItemId ? state.supplierItems.find((i) => i.id === ctx.supplierItemId) : undefined),
    [mode, ctx.supplierItemId, state.supplierItems],
  );
  const seedSupplier = supplier(seedItem?.supplier_id);
  // A worker's request from a receipt: approving it adds the product and records the delivery.
  const seedRequest = useMemo(
    () => (mode === "new" && ctx.requestId ? state.itemRequests.find((r) => r.id === ctx.requestId && r.status === "pending") : undefined),
    [mode, ctx.requestId, state.itemRequests],
  );
  const [name, setName] = useState(editing?.name ?? seedItem?.external_name ?? seedRequest?.proposed_name ?? seedRequest?.external_name ?? "");
  const [sku, setSku] = useState(editing?.sku ?? "");
  const [barcode, setBarcode] = useState(editing?.barcode ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? UNIT_OPTIONS[0]);
  const [minQty, setMinQty] = useState(editing ? String(editing.min_qty) : "0");
  const [qty, setQty] = useState("0");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [supplierId, setSupplierId] = useState(editing?.primary_supplier_id ?? seedItem?.supplier_id ?? ctx.supplierId ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [inCatalog, setInCatalog] = useState(editing?.in_catalog ?? true);
  const [price, setPrice] = useState(String(editing?.price ?? ""));
  const [description, setDescription] = useState(editing?.description ?? "");
  // undefined keeps the saved photo, null removes it, a picked file replaces it on save.
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>();
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

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
  const photoSrc = photo === undefined ? productPhotoUrl(editing?.image_path) : photo?.url ?? null;

  /** Saves the row with its photo. A failed save takes its upload back; one that landed drops the file it replaced. */
  const withPhoto = async <T,>(save: (imagePath: string | null) => Promise<T>): Promise<T> => {
    const before = editing?.image_path ?? null;
    const uploaded = photo ? await uploadProductPhoto(photo.file) : null;
    const after = photo === undefined ? before : uploaded;
    try {
      const saved = await save(after);
      if (before && before !== after) discardPhoto(before);
      return saved;
    } catch (e) {
      if (uploaded) discardPhoto(uploaded);
      throw e;
    }
  };

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedSku = sku.trim().toUpperCase() || nextSku(state.products);
    const trimmedBarcode = barcode.trim();
    const min = parseNum(minQty);
    const initial = parseNum(qty);
    const errors: Partial<Record<Field, string>> = {};
    if (!trimmedName) errors.name = REQUIRED;
    if (state.products.some((p) => p.sku.toUpperCase() === trimmedSku && p.id !== editing?.id)) errors.sku = "מק\"ט קיים";
    if (trimmedBarcode && state.products.some((p) => p.barcode === trimmedBarcode && p.id !== editing?.id)) errors.barcode = "ברקוד קיים";
    if (minQty.trim() !== "" && (!Number.isFinite(min) || min < 0)) errors.minQty = "מספר לא תקין (0 ומעלה)";
    if (!editing && (!Number.isFinite(initial) || initial < 0)) errors.qty = "כמות לא תקינה (0 ומעלה)";
    if (price.trim() !== "" && !PRICE_RE.test(price.trim())) errors.price = "מחיר לא תקין (0 ומעלה)";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const patch = {
      name: trimmedName,
      sku: trimmedSku,
      barcode: trimmedBarcode || null,
      category: category.trim() || null,
      unit: unit || UNIT_OPTIONS[0],
      min_qty: Number.isFinite(min) ? min : 0,
      location: location.trim() || null,
      primary_supplier_id: supplierId || null,
      notes: notes.trim() || null,
      in_catalog: inCatalog,
      price: price.trim() === "" ? null : parseNum(price),
      description: description.trim() || null,
    };
    void form.run(async () => {
      if (editing) {
        await withPhoto((image_path) => updateProduct(editing.id, { ...patch, image_path }));
        notify({ tone: "success", title: `המוצר ${trimmedName} עודכן` });
      } else {
        const created = await withPhoto((image_path) => createProduct({ ...patch, image_path, qty: initial }));
        if (seedItem) {
          await mapSupplierItem(seedItem.id, created.id);
          notify({ tone: "success", title: "המוצר נוצר והשם מופה", text: `${seedItem.external_name} ← ${trimmedName}` });
        } else if (seedRequest) {
          await approveItemRequest(seedRequest.id, created.id);
          notify({ tone: "success", title: "המוצר נוסף וההוצאה נרשמה", text: `${seedRequest.external_name} ← ${trimmedName}` });
        } else {
          notify({ tone: "success", title: `המוצר ${trimmedName} נוסף` });
        }
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
      if (editing.image_path) discardPhoto(editing.image_path);
      notify({ tone: "success", title: `המוצר ${editing.name} נמחק` });
      close();
    } catch (e) {
      setDeleteError(friendlyDeleteError(e, "לא ניתן למחוק מוצר עם תנועות או הזמנות"));
      setDeleting(false);
    }
  };

  const missing = mode === "edit" && !editing;
  // The fold opens on its own when a saved product has something in it, or when a barcode error would otherwise stay hidden.
  const hasMore = !!editing && (!!editing.barcode || !!editing.location || !!editing.description || !!editing.notes || !editing.in_catalog);

  return (
    <>
      <FormPanel
        title={mode === "edit" ? "עריכת מוצר" : "מוצר חדש"}
        subtitle={
          editing ? <span className="sa-mono" dir="ltr">{editing.sku}</span>
          : seedItem ? `מהשם "${seedItem.external_name}"${seedSupplier ? ` של ${seedSupplier.name}` : ""}`
          : seedRequest ? `מהקבלה: "${seedRequest.external_name}"`
          : undefined
        }
        onClose={close}
        onSubmit={submit}
        submitLabel="שמירה"
        submitDisabled={missing}
        busy={form.busy}
        error={form.error}
        onDismissError={() => form.setError(null)}
        footerStart={
          editing ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={form.busy}>
              מחיקת מוצר
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
              optional
              mono
              value={sku}
              onChange={(e) => { setSku(e.target.value.toUpperCase()); form.clearField("sku"); }}
              error={form.errors.sku}
              hint={form.errors.sku ? undefined : 'ריק = מק"ט אוטומטי'}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="sa-form-pair grid grid-cols-2 gap-[var(--space-4)]">
              {!editing ? (
                <Input
                  label="כמות התחלתית"
                  mono
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => { setQty(e.target.value); form.clearField("qty"); }}
                  error={form.errors.qty}
                  hint={form.errors.qty || !seedRequest ? undefined : `לפני ההוצאה; בשמירה ירדו ${fmtQty(seedRequest.qty)}`}
                />
              ) : null}
              <Select label="יחידה" options={unitOptions} value={unit} onChange={setUnit} searchable={false} block />
            </div>
            <Input
              label="מינימום"
              mono
              inputMode="decimal"
              value={minQty}
              onChange={(e) => { setMinQty(e.target.value); form.clearField("minQty"); }}
              error={form.errors.minQty}
              hint={form.errors.minQty ? undefined : "0 = בלי התראה"}
            />
            <Input
              label="מחיר"
              optional
              mono
              inputMode="decimal"
              value={price}
              onChange={(e) => { setPrice(e.target.value); form.clearField("price"); }}
              error={form.errors.price}
              end={<span className="sa-hint px-[var(--space-1)]">₪</span>}
            />
            <Select label="ספק ראשי" options={supOpts} value={supplierId} onChange={setSupplierId} allLabel="ללא ספק" block />
            <Input label="קטגוריה" optional list={listId} value={category} onChange={(e) => setCategory(e.target.value)} autoComplete="off" />
            <datalist id={listId}>
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
            <PhotoField
              label="תמונה"
              optional
              addLabel="הוספת תמונה"
              src={photoSrc}
              fileName={photo?.file.name}
              disabled={form.busy}
              onPick={(file) => setPhoto({ file, url: URL.createObjectURL(file) })}
              onRemove={() => { setPhoto(null); markDirty(); }}
            />
            <MoreFields defaultOpen={hasMore || !!form.errors.barcode}>
              <Input
                label="ברקוד"
                optional
                mono
                inputMode="numeric"
                value={barcode}
                onChange={(e) => { setBarcode(e.target.value); form.clearField("barcode"); }}
                error={form.errors.barcode}
                hint={form.errors.barcode || editing?.barcode ? undefined : "ריק = ברקוד אוטומטי"}
                autoComplete="off"
                spellCheck={false}
              />
              <Input label="מיקום" optional placeholder="מדף / אזור" value={location} onChange={(e) => setLocation(e.target.value)} />
              <Input
                label="תיאור"
                optional
                multiline
                hint="מוצג ללקוחות בקטלוג"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <Input label="הערות" optional multiline value={notes} onChange={(e) => setNotes(e.target.value)} onKeyDown={submitOnEnter} />
              <div className="sa-field">
                <label className="sa-switch flex cursor-pointer items-center gap-[var(--space-2)]">
                  {/* Filled like the primary button: ink in the classic style, the green in the minimal one. */}
                  <input
                    type="checkbox"
                    className="accent-inverse [[data-theme^=minimal]_&]:accent-accent"
                    checked={inCatalog}
                    onChange={(e) => setInCatalog(e.target.checked)}
                  />
                  <span>מוצג בקטלוג</span>
                </label>
              </div>
            </MoreFields>
          </>
        )}
      </FormPanel>

      {confirmDelete && editing ? (
        <Modal
          title={`למחוק את המוצר ${editing.name}?`}
          tone="danger"
          confirmLabel="מחיקת מוצר"
          busy={deleting}
          onConfirm={() => void onDelete()}
          onClose={() => { if (!deleting) { setConfirmDelete(false); setDeleteError(null); } }}
        >
          <div className="flex flex-col gap-[var(--space-3)]">
            <p className="m-0">
              הפעולה אינה הפיכה. מוצר עם תנועות או הזמנות אינו ניתן למחיקה.
            </p>
            {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
