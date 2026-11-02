"use client";

import { useMemo, useState } from "react";
import { Button, Input, Modal, Notice } from "@/components/ui";
import { useData } from "@/lib/store";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { REQUIRED, errorMessage, submitOnEnter, useForm } from "./useForm";

type Field = "name" | "email" | "phone";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[+\d][\d\s()-]{5,}$/;

export function SupplierForm({ ctx, mode }: { ctx: ActionContext; mode: "new" | "edit" }) {
  const { state, supplier, createSupplier, updateSupplier, deleteSupplier } = useData();
  const { close, notify } = useUi();
  const form = useForm<Field>();

  const editing = mode === "edit" ? supplier(ctx.supplierId) : undefined;
  const [name, setName] = useState(editing?.name ?? "");
  const [contact, setContact] = useState(editing?.contact ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const itemCount = useMemo(
    () => (editing ? state.supplierItems.filter((i) => i.supplier_id === editing.id).length : 0),
    [state.supplierItems, editing],
  );

  const submit = () => {
    const trimmed = name.trim();
    const errors: Partial<Record<Field, string>> = {};
    if (!trimmed) errors.name = REQUIRED;
    else if (state.suppliers.some((s) => s.name.trim() === trimmed && s.id !== editing?.id)) errors.name = "ספק בשם זה כבר קיים";
    if (email.trim() && !EMAIL_RE.test(email.trim())) errors.email = "כתובת אימייל לא תקינה";
    if (phone.trim() && !PHONE_RE.test(phone.trim())) errors.phone = "מספר טלפון לא תקין";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const patch = {
      name: trimmed,
      contact: contact.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      notes: notes.trim() || null,
    };
    void form.run(async () => {
      if (editing) {
        await updateSupplier(editing.id, patch);
        notify({ tone: "success", title: `הספק ${trimmed} עודכן` });
      } else {
        await createSupplier(patch);
        notify({ tone: "success", title: `הספק ${trimmed} נוסף` });
      }
      close();
    });
  };

  const onDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSupplier(editing.id);
      notify({ tone: "success", title: `הספק ${editing.name} נמחק` });
      close();
    } catch (e) {
      setDeleteError(errorMessage(e));
      setDeleting(false);
    }
  };

  const missing = mode === "edit" && !editing;

  return (
    <>
      <FormPanel
        title={mode === "edit" ? "עריכת ספק" : "ספק חדש"}
        subtitle={editing?.name}
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
              מחיקת ספק
            </Button>
          ) : null
        }
      >
        {missing ? (
          <Notice tone="warning" title="הספק לא נמצא">ייתכן שנמחק ממכשיר אחר.</Notice>
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
            <Input label="איש קשר" optional value={contact} onChange={(e) => setContact(e.target.value)} />
            <hr className="sa-form-break" />
            <Input
              label="טלפון"
              optional
              mono
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); form.clearField("phone"); }}
              error={form.errors.phone}
            />
            <Input
              label="אימייל"
              optional
              mono
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); form.clearField("email"); }}
              error={form.errors.email}
            />
            <hr className="sa-form-break" />
            <Input label="הערות" optional multiline value={notes} onChange={(e) => setNotes(e.target.value)} onKeyDown={submitOnEnter} />
          </>
        )}
      </FormPanel>

      {confirmDelete && editing ? (
        <Modal
          title={`למחוק את הספק ${editing.name}?`}
          tone="danger"
          confirmLabel="מחיקת ספק"
          busy={deleting}
          onConfirm={() => void onDelete()}
          onClose={() => { if (!deleting) { setConfirmDelete(false); setDeleteError(null); } }}
        >
          <div className="flex flex-col gap-[var(--space-3)]">
            <p className="m-0">
              הפעולה אינה הפיכה.
              {itemCount > 0 ? (
                <> יימחקו גם {itemCount} שמות של הספק במיפוי.</>
              ) : (
                <> שמות של הספק במיפוי יימחקו גם הם.</>
              )}
            </p>
            {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
