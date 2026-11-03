"use client";

import { useMemo, useState } from "react";
import { Fields, Input, Notice, Select } from "@/components/ui";
import { removeWithoutReceipt, useSuperAdminPhone } from "@/lib/exit-pass";
import { useData } from "@/lib/store";
import { fmtQty, fmtUnit } from "@/lib/format";
import { useUi, type ActionContext } from "../ui-state";
import { CodeDialog } from "./CodeDialog";
import { FormPanel } from "./FormPanel";
import { QtyField } from "./QtyField";
import { workerOptions } from "./options";
import { submitOnEnter, useForm } from "./useForm";

type Field = "qty" | "note";

export function AdjustForm({ ctx }: { ctx: ActionContext }) {
  const { state, product, adjust, reload } = useData();
  const { close, notify } = useUi();
  const form = useForm<Field>();
  const phone = useSuperAdminPhone();

  const selected = product(ctx.productId);
  const [qty, setQty] = useState(selected?.qty ?? 0);
  const [workerId, setWorkerId] = useState(ctx.workerId ?? "");
  const [note, setNote] = useState("");
  const [proving, setProving] = useState(false);
  const workOpts = useMemo(() => workerOptions(state.workers), [state.workers]);

  const delta = selected && Number.isFinite(qty) ? qty - selected.qty : 0;
  // Goods that vanished from the count left with no receipt, so this takes the same code.
  const lowers = delta < 0;

  const done = () => {
    if (selected) notify({ tone: "success", title: `הספירה של ${selected.name} עודכנה ל-${fmtQty(qty)} ${fmtUnit(qty, selected.unit)}` });
    close();
  };

  const submit = () => {
    if (!selected) return;
    if (!Number.isFinite(qty) || qty < 0) {
      form.setErrors({ qty: "כמות לא תקינה (0 ומעלה)" });
      return;
    }
    if (lowers && !note.trim()) {
      form.setErrors({ note: "חסרה סיבה" });
      return;
    }
    form.setErrors({});
    if (lowers) {
      setProving(true);
      return;
    }
    void form.run(async () => {
      await adjust(selected.id, qty, workerId || null, note.trim() || null);
      done();
    });
  };

  return (
    <>
      <FormPanel
        title="תיקון ספירה"
        subtitle={selected?.name}
        onClose={close}
        onSubmit={submit}
        submitLabel={lowers && phone ? "שליחת קוד" : "עדכון ספירה"}
        submitDisabled={!selected || (lowers && !phone)}
        busy={form.busy}
        error={form.error}
        onDismissError={() => form.setError(null)}
      >
        {!selected ? (
          <Notice tone="warning" title="לא נבחר מוצר">תיקון ספירה נפתח מתוך שורת מוצר במלאי.</Notice>
        ) : (
          <>
            <Fields
              columns={3}
              items={[
                { label: "מק\"ט", value: selected.sku, num: true },
                { label: "במלאי כעת", value: `${fmtQty(selected.qty)} ${fmtUnit(selected.qty, selected.unit)}`, num: true },
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
            {lowers && !phone ? <Notice tone="warning" title="הורדת כמות דורשת קוד של מנהל ראשי" /> : null}
            <hr className="sa-form-break" />
            <Select label="עובד" options={workOpts} value={workerId} onChange={setWorkerId} allLabel="ללא" block />
            <Input
              label={lowers ? "סיבה" : "הערה"}
              required={lowers}
              optional={!lowers}
              multiline
              placeholder="סיבת התיקון"
              hint={lowers && phone ? `קוד יישלח לנייד שמסתיים ב-${phone.slice(-4)}` : undefined}
              value={note}
              error={form.errors.note}
              onChange={(e) => { setNote(e.target.value); form.clearField("note"); }}
              onKeyDown={submitOnEnter}
            />
          </>
        )}
      </FormPanel>

      {proving && phone && selected ? (
        <CodeDialog
          phone={phone}
          title="הורדת כמות בספירה"
          action={async (client) => {
            await removeWithoutReceipt(client, { kind: "adjust", productId: selected.id, qty, why: note.trim(), workerId: workerId || null });
            await reload();
          }}
          onDone={done}
          onClose={() => setProving(false)}
        />
      ) : null}
    </>
  );
}
