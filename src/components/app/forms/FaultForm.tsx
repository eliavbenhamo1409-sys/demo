"use client";

import { useMemo, useState } from "react";
import { Input, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { QtyField } from "./QtyField";
import { NEW_OPTION, productOptions, workerOptions } from "./options";
import { REQUIRED, useForm } from "./useForm";

type Field = "description" | "qty";

export function FaultForm({ ctx }: { ctx: ActionContext }) {
  const { state, product, reportFault } = useData();
  const { close, notify, openAction } = useUi();
  const form = useForm<Field>();

  const [productId, setProductId] = useState(ctx.productId ?? "");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState(0);
  const [workerId, setWorkerId] = useState(ctx.workerId ?? "");

  const selected = product(productId);
  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);
  const workOpts = useMemo(() => workerOptions(state.workers, true), [state.workers]);

  const onWorker = (v: string) => {
    if (v === NEW_OPTION) { openAction("new-worker"); return; }
    setWorkerId(v);
  };

  const submit = () => {
    const errors: Partial<Record<Field, string>> = {};
    if (!description.trim()) errors.description = REQUIRED;
    if (!Number.isFinite(qty) || qty < 0) errors.qty = "הזן כמות תקינה";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;
    void form.run(async () => {
      await reportFault({
        productId: productId || null,
        description: description.trim(),
        workerId: workerId || null,
        qty: productId && qty > 0 ? qty : null,
      });
      notify({ tone: "success", title: selected ? `התקלה דווחה — ${selected.name}` : "התקלה דווחה" });
      close();
    });
  };

  return (
    <FormPanel
      title="דיווח תקלה"
      onClose={close}
      onSubmit={submit}
      submitLabel="דווח"
      submitVariant="danger"
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      <Select label="מוצר" options={prodOpts} value={productId} onChange={setProductId} allLabel="ללא מוצר" block />
      <Input
        label="תיאור"
        required
        multiline
        placeholder="מה קרה, היכן, ומה נדרש"
        value={description}
        onChange={(e) => { setDescription(e.target.value); form.clearField("description"); }}
        error={form.errors.description}
      />
      <QtyField
        label="כמות פגומה"
        optional
        value={qty}
        onChange={(n) => { setQty(n); form.clearField("qty"); }}
        unit={selected?.unit}
        min={0}
        error={form.errors.qty}
        hint={selected ? "0 = ללא תנועת מלאי" : "נרשם רק כשנבחר מוצר"}
      />
      <Select label="עובד" options={workOpts} value={workerId} onChange={onWorker} allLabel="ללא" block />
    </FormPanel>
  );
}
