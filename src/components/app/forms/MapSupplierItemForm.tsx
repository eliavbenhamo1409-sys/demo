"use client";

import { useMemo, useState } from "react";
import { Button, Fields, Modal, Notice, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { productOptions } from "./options";
import { REQUIRED, errorMessage, useForm } from "./useForm";

type Field = "product";

export function MapSupplierItemForm({ ctx }: { ctx: ActionContext }) {
  const { state, supplier, product, mapSupplierItem, deleteSupplierItem } = useData();
  const { close, notify } = useUi();
  const form = useForm<Field>();

  const item = useMemo(() => state.supplierItems.find((i) => i.id === ctx.supplierItemId), [state.supplierItems, ctx.supplierItemId]);
  const sup = supplier(item?.supplier_id);
  const [productId, setProductId] = useState(item?.product_id ?? "");
  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);
  const target = product(productId);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const submit = () => {
    if (!item) return;
    if (!productId) {
      form.setErrors({ product: REQUIRED });
      return;
    }
    form.setErrors({});
    void form.run(async () => {
      await mapSupplierItem(item.id, productId);
      notify({ tone: "success", title: target ? `${item.external_name} הותאם ל-${target.name}` : "ההתאמה אושרה" });
      close();
    });
  };

  const onDelete = async () => {
    if (!item) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSupplierItem(item.id);
      notify({ tone: "success", title: `${item.external_name} נמחק מהמילון` });
      close();
    } catch (e) {
      setDeleteError(errorMessage(e));
      setDeleting(false);
    }
  };

  return (
    <>
      <FormPanel
        title="תיקון התאמה"
        subtitle={sup?.name}
        onClose={close}
        onSubmit={submit}
        submitLabel="אשר התאמה"
        submitDisabled={!item}
        busy={form.busy}
        error={form.error}
        onDismissError={() => form.setError(null)}
        footerStart={
          item ? (
            <Button variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)} disabled={form.busy} style={{ color: "var(--danger-text)" }}>
              מחק
            </Button>
          ) : null
        }
        secondary={
          <Button variant="ghost" onClick={close} disabled={form.busy}>
            השאר לא מאושר
          </Button>
        }
      >
        {!item ? (
          <Notice tone="warning" title="השם החיצוני לא נמצא">ייתכן שנמחק ממכשיר אחר.</Notice>
        ) : (
          <>
            <Fields
              items={[
                { label: "ספק", value: sup?.name },
                { label: "סטטוס", value: item.status === "approved" ? "מאושר" : "לא מאושר" },
                { label: "שם אצל הספק", value: item.external_name },
                { label: "מק\"ט חיצוני", value: item.external_sku ?? undefined, num: true },
              ]}
            />
            <div className="sa-field">
              <Select
                label="מוצר במפעל"
                options={prodOpts}
                value={productId}
                onChange={(v) => { setProductId(v); form.clearField("product"); }}
                placeholder="בחר מוצר"
                block
              />
              {form.errors.product ? (
                <span className="sa-error" role="alert">{form.errors.product}</span>
              ) : target ? (
                <span className="sa-hint">
                  <span className="sa-num">{target.sku}</span> · במלאי {target.qty} {target.unit}
                </span>
              ) : (
                <span className="sa-hint">אישור ההתאמה יסמן את השם כמאושר</span>
              )}
            </div>
          </>
        )}
      </FormPanel>

      {confirmDelete && item ? (
        <Modal
          title={`למחוק את ${item.external_name}?`}
          tone="danger"
          confirmLabel="מחק"
          busy={deleting}
          onConfirm={() => void onDelete()}
          onClose={() => { if (!deleting) { setConfirmDelete(false); setDeleteError(null); } }}
        >
          <div className="flex flex-col gap-[var(--space-3)]">
            <p className="m-0">השם החיצוני יוסר ממילון הספק{sup ? ` ${sup.name}` : ""}. הפעולה אינה הפיכה.</p>
            {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
