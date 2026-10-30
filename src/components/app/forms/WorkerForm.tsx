"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { useData } from "@/lib/store";
import { useUi } from "../ui-state";
import { FormPanel } from "./FormPanel";
import { ROLE_OPTIONS } from "./options";
import { REQUIRED, useForm } from "./useForm";

type Field = "name";

export function WorkerForm() {
  const { state, createWorker } = useData();
  const { close, notify } = useUi();
  const form = useForm<Field>();

  const [name, setName] = useState("");
  const [role, setRole] = useState(ROLE_OPTIONS[0]);

  const submit = () => {
    const trimmed = name.trim();
    const errors: Partial<Record<Field, string>> = {};
    if (!trimmed) errors.name = REQUIRED;
    else if (state.workers.some((w) => w.name.trim() === trimmed)) errors.name = "עובד בשם זה כבר קיים";
    form.setErrors(errors);
    if (Object.keys(errors).length > 0) return;
    void form.run(async () => {
      await createWorker({ name: trimmed, role, active: true });
      notify({ tone: "success", title: `העובד ${trimmed} נוסף` });
      close();
    });
  };

  return (
    <FormPanel
      title="עובד חדש"
      onClose={close}
      onSubmit={submit}
      submitLabel="הוסף"
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      <Input
        label="שם"
        required
        value={name}
        onChange={(e) => { setName(e.target.value); form.clearField("name"); }}
        error={form.errors.name}
        autoComplete="off"
      />
      <Select label="תפקיד" options={ROLE_OPTIONS} value={role} onChange={setRole} searchable={false} block />
    </FormPanel>
  );
}
