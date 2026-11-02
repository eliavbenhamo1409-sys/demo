"use client";

/**
 * The manager's decision on a receipt line a worker could not settle: link it
 * to a product (or add a new one), which records the delivery, or reject it.
 * Stock only moves on approval.
 */
import { useMemo, useState } from "react";
import { Button, Fields, Modal, Notice, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { fmtQty, fmtRelative } from "@/lib/format";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { productOptions } from "./options";
import { REQUIRED, errorMessage, useForm } from "./useForm";

type Field = "product";

export function ReviewItemRequestForm({ ctx }: { ctx: ActionContext }) {
  const { state, worker, product, approveItemRequest, rejectItemRequest } = useData();
  const { close, notify, openAction } = useUi();
  const form = useForm<Field>();

  const request = useMemo(() => state.itemRequests.find((r) => r.id === ctx.requestId && r.status === "pending"), [state.itemRequests, ctx.requestId]);
  const isNew = request?.kind === "new_product";
  const [productId, setProductId] = useState("");
  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);
  const target = product(productId);
  const addsProduct = isNew && !productId;

  const [confirmReject, setConfirmReject] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const addProduct = () => {
    if (request) openAction("new-product", { requestId: request.id });
  };

  const submit = () => {
    if (!request) return;
    if (addsProduct) {
      addProduct();
      return;
    }
    if (!productId) {
      form.setErrors({ product: REQUIRED });
      return;
    }
    form.setErrors({});
    void form.run(async () => {
      await approveItemRequest(request.id, productId);
      notify({ tone: "success", title: "אושר וההוצאה נרשמה", text: `${request.external_name} ← ${target?.name ?? ""}` });
      close();
    });
  };

  const onReject = async () => {
    if (!request) return;
    setRejecting(true);
    setRejectError(null);
    try {
      await rejectItemRequest(request.id);
      notify({ tone: "success", title: "הבקשה נדחתה", text: request.external_name });
      close();
    } catch (e) {
      setRejectError(errorMessage(e));
      setRejecting(false);
    }
  };

  return (
    <>
      <FormPanel
        title={isNew ? "בקשה למוצר חדש" : "שורה שהעובד לא זיהה"}
        subtitle={request?.customer ? `ללקוח ${request.customer}` : undefined}
        onClose={close}
        onSubmit={submit}
        submitLabel={addsProduct ? "הוספת מוצר" : "אישור ורישום הוצאה"}
        submitDisabled={!request}
        busy={form.busy}
        error={form.error}
        onDismissError={() => form.setError(null)}
        footerStart={
          request ? (
            <Button variant="danger" onClick={() => setConfirmReject(true)} disabled={form.busy}>
              דחייה
            </Button>
          ) : null
        }
        secondary={
          request && !isNew ? (
            <Button variant="ghost" onClick={addProduct} disabled={form.busy}>
              מוצר חדש
            </Button>
          ) : !request ? (
            <Button variant="ghost" onClick={close}>
              סגירה
            </Button>
          ) : null
        }
      >
        {!request ? (
          <Notice tone="warning" title="הבקשה כבר טופלה">ייתכן שטופלה ממכשיר אחר.</Notice>
        ) : (
          <>
            <Fields
              items={[
                { label: "כתוב בקבלה", value: request.external_name },
                ...(request.proposed_name && request.proposed_name !== request.external_name ? [{ label: "שם שהעובד הציע", value: request.proposed_name }] : []),
                { label: "כמות שהוצאה", value: fmtQty(request.qty), num: true },
                { label: "מספר תעודה", value: request.reference ?? undefined, num: true },
                { label: "עובד", value: worker(request.worker_id)?.name },
                { label: "נשלח", value: fmtRelative(request.created_at) },
                ...(request.worker_note ? [{ label: "הערת העובד", value: request.worker_note }] : []),
              ].filter((f) => f.value?.trim())}
            />
            <div className="sa-field">
              <Select
                label={isNew ? "כבר יש מוצר כזה?" : "איזה מוצר זה?"}
                options={prodOpts}
                value={productId}
                onChange={(v) => { setProductId(v); form.clearField("product"); }}
                placeholder="בחירת מוצר מהמחסן"
                searchPlaceholder='חיפוש לפי שם או מק"ט'
                block
              />
              {form.errors.product ? (
                <span className="sa-error" role="alert">{form.errors.product}</span>
              ) : target ? (
                <span className="sa-hint">
                  {fmtQty(request.qty)} {target.unit} ירדו מהמלאי · במלאי כעת {fmtQty(target.qty)}
                </span>
              ) : (
                <span className="sa-hint">יזוהה אוטומטית בקבלה הבאה</span>
              )}
            </div>
          </>
        )}
      </FormPanel>

      {confirmReject && request ? (
        <Modal
          title="לדחות את הבקשה?"
          tone="danger"
          confirmLabel="דחייה"
          busy={rejecting}
          onConfirm={() => void onReject()}
          onClose={() => { if (!rejecting) { setConfirmReject(false); setRejectError(null); } }}
        >
          <div className="flex flex-col gap-[var(--space-3)]">
            <p className="m-0">{request.external_name} לא יתווסף כמוצר חדש והכמות לא תרד מהמלאי.</p>
            {rejectError ? <Notice tone="danger">{rejectError}</Notice> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
