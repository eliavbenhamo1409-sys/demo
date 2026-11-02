"use client";

import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Dot, Input, Select } from "@/components/ui";
import { useData, type SupplierItem } from "@/lib/store";
import { fmtQty } from "@/lib/format";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { QtyField } from "./QtyField";
import { NEW_OPTION, productOptions, supplierOptions, workerOptions } from "./options";
import { REQUIRED, submitOnEnter, useForm } from "./useForm";

type Field = "product" | "qty";

/**
 * קליטת סחורה — the delivery-note flow is the primary path:
 * ספק → שם בתעודת המשלוח (translated live through the dictionary) → מוצר.
 */
export function ReceiveForm({ ctx }: { ctx: ActionContext }) {
  const { state, product, receive, resolveSupplierName, suggestSupplierNames, approveSupplierItem, mapSupplierItem } = useData();
  const { close, notify, openAction } = useUi();
  const form = useForm<Field>();
  const listId = `sa-ext-${useId()}`;

  const [productId, setProductId] = useState(ctx.productId ?? "");
  const [qty, setQty] = useState(1);
  const [supplierId, setSupplierId] = useState(product(ctx.productId)?.primary_supplier_id ?? ctx.supplierId ?? "");
  const [externalName, setExternalName] = useState("");
  const [externalSku, setExternalSku] = useState("");
  const [workerId, setWorkerId] = useState(ctx.workerId ?? "");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [approving, setApproving] = useState(false);

  const selected = product(productId);
  const unit = selected?.unit ?? "";
  const prodOpts = useMemo(() => productOptions(state.products, true), [state.products]);
  const supOpts = useMemo(() => supplierOptions(state.suppliers), [state.suppliers]);
  const workOpts = useMemo(() => workerOptions(state.workers, true), [state.workers]);

  // Live translation of the supplier's wording; the dictionary (state.supplierItems) is the real dependency.
  const resolution = useMemo(
    () => resolveSupplierName(supplierId, externalName),
    [resolveSupplierName, supplierId, externalName],
  );
  const suggestions = useMemo(
    () => (supplierId && suggestOpen ? suggestSupplierNames(supplierId, externalName, 6) : []),
    [suggestSupplierNames, supplierId, externalName, suggestOpen],
  );

  const applyResolution = (supId: string, name: string) => {
    const r = resolveSupplierName(supId, name);
    if (r.product) {
      setProductId(r.product.id);
      form.clearField("product");
    }
  };

  const onSupplier = (v: string) => {
    setSupplierId(v);
    setSuggestOpen(false);
    if (v) applyResolution(v, externalName);
  };

  const onExternalName = (v: string) => {
    setExternalName(v);
    setSuggestOpen(true);
    setActiveIdx(-1);
    applyResolution(supplierId, v);
  };

  const pickSuggestion = (item: SupplierItem) => {
    setExternalName(item.external_name);
    if (item.external_sku) setExternalSku(item.external_sku);
    setSuggestOpen(false);
    setActiveIdx(-1);
    if (item.product_id && product(item.product_id)) {
      setProductId(item.product_id);
      form.clearField("product");
    }
  };

  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { if (suggestOpen) { e.preventDefault(); e.stopPropagation(); setSuggestOpen(false); } return; }
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickSuggestion(suggestions[activeIdx >= 0 ? activeIdx : 0]);
    }
  };

  const onProduct = (v: string) => {
    if (v === NEW_OPTION) { openAction("new-product", { supplierId: supplierId || undefined }); return; }
    setProductId(v);
    form.clearField("product");
    const p = product(v);
    if (p?.primary_supplier_id && !supplierId) setSupplierId(p.primary_supplier_id);
  };
  const onWorker = (v: string) => {
    if (v === NEW_OPTION) { openAction("new-worker"); return; }
    setWorkerId(v);
  };

  const approvePending = async () => {
    if (resolution.status !== "pending" || !productId) return;
    setApproving(true);
    try {
      if (resolution.item.product_id !== productId) await mapSupplierItem(resolution.item.id, productId);
      else await approveSupplierItem(resolution.item.id);
      notify({ tone: "success", title: `${resolution.item.external_name} אושר במילון` });
    } catch (e) {
      form.setError(e instanceof Error ? e.message : "האישור נכשל");
    } finally {
      setApproving(false);
    }
  };

  const submit = () => {
    const errors: Partial<Record<Field, string>> = {};
    if (!productId) errors.product = REQUIRED;
    if (!Number.isFinite(qty) || qty < 1) errors.qty = "כמות לא תקינה (1 ומעלה)";
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
        externalName: supplierId ? externalName.trim() || null : null,
        externalSku: supplierId ? externalSku.trim() || null : null,
      });
      notify({ tone: "success", title: `נקלטו ${fmtQty(qty)} ${selected.unit} של ${selected.name}`, text: `מק"ט ${selected.sku}` });
      close();
    });
  };

  const qtyLabel = Number.isFinite(qty) && qty > 0 ? `קליטת ${fmtQty(qty)} ${unit}`.trim() : "קליטה";
  const typedName = externalName.trim().length > 0;

  let resolutionLine: ReactNode = null;
  if (supplierId && typedName) {
    if (resolution.status === "approved") {
      resolutionLine = (
        <span className="sa-hint flex items-center gap-[var(--space-2)]" role="status">
          <Dot tone="success" />
          <span>זוהה: {resolution.product.name} · <span className="sa-mono ltr">{resolution.product.sku}</span></span>
        </span>
      );
    } else if (resolution.status === "pending") {
      resolutionLine = (
        <span className="sa-hint flex items-center gap-[var(--space-2)]" role="status">
          <Dot tone="warning" />
          <span>התאמה ממתינה</span>
          <Button variant="link" size="sm" onClick={() => void approvePending()} disabled={!productId || approving || form.busy} isLoading={approving}>
            אישור
          </Button>
        </span>
      );
    } else {
      resolutionLine = (
        <span className="sa-hint flex items-center gap-[var(--space-2)]" role="status">
          <Dot />
          <span>שם חדש, יישמר במילון לבדיקה</span>
          {!productId ? (
            <Button variant="link" size="sm" onClick={() => openAction("new-product", { supplierId })}>
              מוצר חדש
            </Button>
          ) : null}
        </span>
      );
    }
  }

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
      <Select label="ספק" options={supOpts} value={supplierId} onChange={onSupplier} allLabel="ללא ספק" block />

      {supplierId ? (
        <div className="sa-field">
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-[var(--space-3)]">
            <div className="sa-field relative">
              <Input
                label="שם בתעודת המשלוח"
                optional
                placeholder="כפי שכתוב אצל הספק"
                value={externalName}
                onChange={(e) => onExternalName(e.target.value)}
                onFocus={() => setSuggestOpen(true)}
                onBlur={() => window.setTimeout(() => setSuggestOpen(false), 120)}
                onKeyDown={onNameKeyDown}
                autoComplete="off"
                role="combobox"
                aria-expanded={suggestOpen && suggestions.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
              />
              {suggestOpen && suggestions.length > 0 ? (
                <div className="sa-menu" id={listId} role="listbox" aria-label="שמות מהמילון" style={{ top: "100%" }}>
                  <div className="sa-menu-list">
                    {suggestions.map((s, i) => {
                      const mapped = s.product_id ? product(s.product_id) : undefined;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          role="option"
                          aria-selected={i === activeIdx}
                          className={`sa-menu-item${i === activeIdx ? " is-active" : ""}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickSuggestion(s)}
                        >
                          <span className="flex flex-col min-w-0 flex-1">
                            <span className="flex items-center gap-[var(--space-2)] min-w-0">
                              <span className="truncate">{s.external_name}</span>
                              {s.external_sku ? <span className="sa-mono ltr sa-faint">{s.external_sku}</span> : null}
                            </span>
                            <span className="sa-menu-item-sub">
                              {mapped ? mapped.name : "ללא התאמה"}
                              {" · "}
                              נראה <span className="sa-mono">{s.times_seen}</span> פעמים
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            <Input
              label={'מק"ט חיצוני'}
              optional
              mono
              value={externalSku}
              onChange={(e) => setExternalSku(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {resolutionLine}
        </div>
      ) : null}

      <hr className="sa-form-break" />
      <div className="sa-field">
        <Select label="מוצר" options={prodOpts} value={productId} onChange={onProduct} placeholder="בחירת מוצר" block />
        {form.errors.product ? <span className="sa-error" role="alert">{form.errors.product}</span> : null}
      </div>
      <QtyField label="כמות" value={qty} onChange={(n) => { setQty(n); form.clearField("qty"); }} unit={unit || undefined} min={1} error={form.errors.qty} required />
      <hr className="sa-form-break" />
      <Select label="עובד" options={workOpts} value={workerId} onChange={onWorker} allLabel="ללא" block />
      <Input label="מספר תעודה" optional mono placeholder="תעודת משלוח / הזמנה" value={reference} onChange={(e) => setReference(e.target.value)} />
      <Input label="הערה" optional multiline value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={submitOnEnter} />
    </FormPanel>
  );
}
