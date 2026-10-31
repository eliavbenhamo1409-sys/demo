"use client";

/**
 * New worker, or edit an existing one (name, role, active). Workers are never
 * deleted: movements and faults keep pointing at them, so an ex-employee is
 * deactivated instead and disappears from the phone app.
 */
import { useState } from "react";
import { Button, Input, Notice, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { ROLE_OPTIONS } from "./options";
import { REQUIRED, errorMessage, useForm } from "./useForm";

type Field = "name";

export function WorkerForm({ ctx, mode = "new" }: { ctx?: ActionContext; mode?: "new" | "edit" }) {
  const { state, worker, createWorker, updateWorker } = useData();
  const { close, notify } = useUi();
  const form = useForm<Field>();

  const editing = mode === "edit" ? worker(ctx?.workerId) : undefined;
  const [name, setName] = useState(editing?.name ?? "");
  const [role, setRole] = useState(editing?.role ?? ROLE_OPTIONS[0]);
  const [toggling, setToggling] = useState(false);

  const roleOptions = editing && !ROLE_OPTIONS.includes(editing.role) ? [editing.role, ...ROLE_OPTIONS] : ROLE_OPTIONS;

  const submit = () => {
    const trimmed = name.trim();
    const errors: Partial<Record<Field, string>> = {};
    if (!trimmed) errors.name = REQUIRED;
    else if (state.workers.some((w) => w.name.trim() === trimmed && w.id !== editing?.id)) errors.name = "עובד בשם זה כבר קיים";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;
    void form.run(async () => {
      if (editing) {
        await updateWorker(editing.id, { name: trimmed, role });
        notify({ tone: "success", title: `העובד ${trimmed} עודכן` });
      } else {
        await createWorker({ name: trimmed, role, active: true });
        notify({ tone: "success", title: `העובד ${trimmed} נוסף` });
      }
      close();
    });
  };

  const toggleActive = async () => {
    if (!editing || toggling) return;
    setToggling(true);
    form.setError(null);
    const next = !editing.active;
    try {
      await updateWorker(editing.id, { active: next });
      notify({
        tone: "success",
        title: next ? `${editing.name} הופעל מחדש` : `${editing.name} הושבת`,
        text: next ? "יופיע שוב באפליקציית הטלפון" : "לא יופיע יותר באפליקציית הטלפון",
      });
      close();
    } catch (e) {
      form.setError(errorMessage(e));
    } finally {
      setToggling(false);
    }
  };

  const missing = mode === "edit" && !editing;

  return (
    <FormPanel
      title={mode === "edit" ? "עריכת עובד" : "עובד חדש"}
      subtitle={editing ? (editing.active ? editing.role : `${editing.role} · לא פעיל`) : undefined}
      onClose={close}
      onSubmit={submit}
      submitLabel={mode === "edit" ? "שמור" : "הוסף"}
      submitDisabled={missing}
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
      footerStart={
        editing ? (
          editing.active ? (
            <Button variant="ghost" icon="log-out" onClick={() => void toggleActive()} isLoading={toggling} disabled={form.busy}>
              השבת עובד
            </Button>
          ) : (
            <Button variant="secondary" icon="refresh" onClick={() => void toggleActive()} isLoading={toggling} disabled={form.busy}>
              הפעל מחדש
            </Button>
          )
        ) : null
      }
    >
      {missing ? (
        <Notice tone="warning" title="העובד לא נמצא">ייתכן שנמחק ממכשיר אחר.</Notice>
      ) : (
        <>
          {editing && !editing.active ? (
            <Notice tone="neutral" title="עובד לא פעיל">לא מופיע באפליקציית הטלפון. ההיסטוריה שלו נשמרת.</Notice>
          ) : null}
          <Input
            label="שם"
            required
            value={name}
            onChange={(e) => { setName(e.target.value); form.clearField("name"); }}
            error={form.errors.name}
            autoComplete="off"
          />
          <Select label="תפקיד" options={roleOptions} value={role} onChange={setRole} searchable={false} block />
          {!editing ? <p className="sa-muted m-0 text-[12px]">העובד יוכל להיכנס לאפליקציית הטלפון ולדווח קליטות, הוצאות ותקלות.</p> : null}
        </>
      )}
    </FormPanel>
  );
}
