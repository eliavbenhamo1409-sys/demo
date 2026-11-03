"use client";

import { useMemo, useState } from "react";
import { Select, type SelectOption } from "@/components/ui";
import { useFloorObjects } from "@/components/map3d/use-floor-objects";
import { fmtQty, fmtUnit } from "@/lib/format";
import { placeWords } from "@/lib/map3d/place";
import { placeStock, useShelves } from "@/lib/map3d/shelves";
import { useData } from "@/lib/store";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { PlaceField } from "./PlaceField";
import { QtyField } from "./QtyField";
import { REQUIRED, useForm } from "./useForm";

type Field = "product" | "place" | "qty";

/** "Waiting for a place", as a value of the source list. */
const WAITING = "waiting";

/** Puts what waits for a place on a shelf, or moves stock between shelves. The total stays as it is, so nothing here reaches the ledger. */
export function PlaceForm({ ctx }: { ctx: ActionContext }) {
  const { state, product } = useData();
  const { rows } = useShelves();
  const objects = useFloorObjects();
  const { close, notify } = useUi();
  const form = useForm<Field>();

  const [productId, setProductId] = useState(ctx.productId ?? "");
  const [sourceChoice, setSource] = useState(ctx.from ?? "");
  const [target, setTarget] = useState(ctx.place ?? "");
  const [typed, setTyped] = useState<number | null>(null);

  const selected = product(productId);

  // Only a shelf row can be moved: stock the map draws at the product's home has no row yet, so it still waits for a place.
  const standing = useMemo(() => {
    const places = (rows ?? []).filter((row) => row.product_id === productId);
    const placed = places.reduce((sum, row) => sum + row.qty, 0);
    return { places, waiting: Math.max((selected?.qty ?? 0) - placed, 0) };
  }, [rows, productId, selected]);

  const sources = useMemo<SelectOption[]>(() => {
    const unit = selected?.unit ?? "";
    const wait = standing.waiting > 0 ? [{ value: WAITING, label: `ממתין לשיבוץ · ${fmtQty(standing.waiting)} ${fmtUnit(standing.waiting, unit)}` }] : [];
    return [...wait, ...standing.places.map((row) => ({ value: row.place, label: `${placeWords(row.place, objects)} · ${fmtQty(row.qty)} ${fmtUnit(row.qty, unit)}` }))];
  }, [selected, standing, objects]);

  // What can be placed comes first: stock with no place, then products that stand elsewhere.
  const products = useMemo<SelectOption[]>(() => {
    const placed = new Map<string, number>();
    for (const row of rows ?? []) placed.set(row.product_id, (placed.get(row.product_id) ?? 0) + row.qty);
    const waiting = new Set(state.products.filter((p) => p.qty > (placed.get(p.id) ?? 0)).map((p) => p.id));
    const list = state.products.filter((p) => p.qty > 0);
    return [...list.filter((p) => waiting.has(p.id)), ...list.filter((p) => !waiting.has(p.id))].map((p) => ({
      value: p.id,
      label: `${p.name}${waiting.has(p.id) ? " · ממתין לשיבוץ" : ""}`,
    }));
  }, [rows, state.products]);

  const source = sources.some((option) => option.value === sourceChoice) ? sourceChoice : (sources[0]?.value ?? "");
  const most = source === WAITING ? standing.waiting : (standing.places.find((row) => row.place === source)?.qty ?? 0);
  const qty = typed ?? most;

  const submit = () => {
    const errors: Partial<Record<Field, string>> = {};
    if (!productId) errors.product = REQUIRED;
    if (!target) errors.place = REQUIRED;
    if (!Number.isFinite(qty) || qty <= 0) errors.qty = "כמות לא תקינה";
    else if (qty > most) errors.qty = `יש כאן רק ${fmtQty(most)}`;
    form.setErrors(errors);
    if (Object.keys(errors).length > 0 || !selected) return;
    void form.run(async () => {
      await placeStock(productId, target, qty, source === WAITING ? null : source);
      notify({ tone: "success", title: `${fmtQty(qty)} ${fmtUnit(qty, selected.unit)} ב-${placeWords(target, objects)}`, text: selected.name });
      close();
    });
  };

  return (
    <FormPanel
      title={ctx.from ? "העברה בין מדפים" : "שיבוץ מוצר"}
      onClose={close}
      onSubmit={submit}
      submitLabel={ctx.from ? "העברה" : "שיבוץ"}
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      <div className="sa-field">
        <Select label="מוצר" options={products} value={productId} onChange={(id) => { setProductId(id); setTyped(null); setSource(""); form.clearField("product"); }} placeholder="בחירת מוצר" searchPlaceholder="חיפוש מוצר" emptyLabel="אין מוצרים לשיבוץ" block disabled={Boolean(ctx.productId)} />
        {form.errors.product ? <span className="sa-error" role="alert">{form.errors.product}</span> : null}
      </div>
      {selected && sources.length > 1 ? <Select label="מאיפה" options={sources} value={source} onChange={(next) => { setSource(next); setTyped(null); }} searchable={false} block /> : null}
      {selected ? <PlaceField label="לאן" product={selected} value={target} onChange={(next) => { setTarget(next); form.clearField("place"); }} error={form.errors.place} /> : null}
      {selected ? <QtyField label="כמות" value={qty} onChange={(n) => { setTyped(n); form.clearField("qty"); }} unit={selected.unit} min={1} error={form.errors.qty} required /> : null}
    </FormPanel>
  );
}
