"use client";

import { useMemo, useState } from "react";
import { Fields, Input, Notice, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { fmtQty } from "@/lib/format";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { QtyField } from "./QtyField";
import { workerOptions } from "./options";
import { submitOnEnter, useForm } from "./useForm";

type Field = "qty";

export function AdjustForm({ ctx }: { ctx: ActionContext }) {
  const { state, product, adjust } = useData();
  const { close, notify } = useUi();
  const form = useForm<Field>();

  const selected = product(ctx.productId);
  const [qty, setQty] = useState(selected?.qty ?? 0);
  const [workerId, setWorkerId] = useState(ctx.workerId ?? "");
  const [note, setNote] = useState("");
  const workOpts = useMemo(() => workerOptions(state.workers), [state.workers]);

  const delta = selected && Number.isFinite(qty) ? qty - selected.qty : 0;

  const submit = () => {
    if (!selected) return;
    if (!Number.isFinite(qty) || qty < 0) {
      form.setErrors({ qty: "הזן כמות תקינה (0 ומעלה)" });
      return;
    }
    form.setErrors({});
    void form.run(async () => {
      await adjust(selected.id, qty, workerId || null, note.trim() || null);
      notify({ tone: "success", title: `הספירה של ${selected.name} עודכנה ל-${fmtQty(qty)} ${selected.unit}` });
      close();
    });
  };

  return (
    <FormPanel
      title="תיקון ספירה"
      subtitle={selected?.name}
      onClose={close}
      onSubmit={submit}
      submitLabel="עדכן ספירה"
      submitDisabled={!selected}
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      {!selected ? (
        <Notice tone="warning" title="לא נבחר מוצר">פתח תיקון ספירה מתוך שורת מוצר במלאי.</Notice>
      ) : (
        <>
          <Fields
            items={[
              { label: "מוצר", value: selected.name },
              { label: "מק\"ט", value: selected.sku, num: true },
              { label: "במלאי כעת", value: `${fmtQty(selected.qty)} ${selected.unit}`, num: true },
              { label: "מיקום", value: selected.location ?? undefined },
            ]}
          />
          <QtyField
            label="כמות בפועל"
            required
            value={qty}
            onChange={(n) => { setQty(n); form.clearField("qty"); }}
            unit={selected.unit}
            min={0}
            error={form.errors.qty}
            hint={delta === 0 ? "ללא שינוי" : `שינוי: ${delta > 0 ? "+" : "−"}${fmtQty(Math.abs(delta))}`}
          />
          <Select label="עובד" options={workOpts} value={workerId} onChange={setWorkerId} allLabel="ללא" block />
          <Input label="הערה" optional multiline placeholder="סיבת התיקון" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={submitOnEnter} />
        </>
      )}
    </FormPanel>
  );
}
