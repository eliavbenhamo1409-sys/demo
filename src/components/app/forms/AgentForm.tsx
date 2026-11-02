"use client";

/**
 * New agent, or edit an existing one (name, phone, active). Agents are never
 * deleted: orders keep pointing at them, so one who left is deactivated instead
 * and disappears from the catalogue site's sign-in list.
 */
import { useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { useData } from "@/lib/store";
import { useUi, type ActionContext } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { PHONE_RE } from "./SupplierForm";
import { REQUIRED, errorMessage, useForm } from "./useForm";

type Field = "name" | "phone";

export function AgentForm({ ctx, mode = "new" }: { ctx?: ActionContext; mode?: "new" | "edit" }) {
  const { state, agent, createAgent, updateAgent } = useData();
  const { close, notify } = useUi();
  const form = useForm<Field>();

  const editing = mode === "edit" ? agent(ctx?.agentId) : undefined;
  const [name, setName] = useState(editing?.name ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [toggling, setToggling] = useState(false);

  const submit = () => {
    const trimmed = name.trim();
    const errors: Partial<Record<Field, string>> = {};
    if (!trimmed) errors.name = REQUIRED;
    else if (state.agents.some((a) => a.name.trim() === trimmed && a.id !== editing?.id)) errors.name = "סוכן בשם זה כבר קיים";
    if (phone.trim() && !PHONE_RE.test(phone.trim())) errors.phone = "מספר טלפון לא תקין";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const patch = { name: trimmed, phone: phone.trim() || null };
    void form.run(async () => {
      if (editing) {
        await updateAgent(editing.id, patch);
        notify({ tone: "success", title: `הפרטים של ${trimmed} נשמרו` });
      } else {
        await createAgent({ ...patch, active: true });
        notify({ tone: "success", title: `${trimmed} ברשימת הסוכנים` });
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
      await updateAgent(editing.id, { active: next });
      notify({
        tone: "success",
        title: next ? `${editing.name} שוב ברשימת הסוכנים` : `${editing.name} מחוץ לרשימת הסוכנים`,
        text: next ? "השם שוב בכניסה לאתר הקטלוג" : "השם לא בכניסה לאתר הקטלוג",
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
      title={mode === "edit" ? "עריכת סוכן" : "סוכן חדש"}
      onClose={close}
      onSubmit={submit}
      submitLabel={mode === "edit" ? "שמירה" : "הוספת סוכן"}
      submitDisabled={missing}
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
      footerStart={
        editing ? (
          editing.active ? (
            <Button variant="ghost" onClick={() => void toggleActive()} isLoading={toggling} disabled={form.busy}>
              השבתת סוכן
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void toggleActive()} isLoading={toggling} disabled={form.busy}>
              הפעלה מחדש
            </Button>
          )
        ) : null
      }
    >
      {missing ? (
        <Notice tone="warning" title="הסוכן לא נמצא" />
      ) : (
        <>
          {editing && !editing.active ? (
            <Notice tone="neutral" title="סוכן לא פעיל">לא מופיע בכניסה לאתר הקטלוג. ההזמנות נשמרות.</Notice>
          ) : null}
          <Input
            label="שם"
            required
            value={name}
            onChange={(e) => { setName(e.target.value); form.clearField("name"); }}
            error={form.errors.name}
            autoComplete="off"
          />
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
          {!editing ? <p className="sa-hint m-0">השם יופיע בכניסה לאתר הקטלוג</p> : null}
        </>
      )}
    </FormPanel>
  );
}
