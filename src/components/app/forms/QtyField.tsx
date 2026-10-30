"use client";

/** QuantityStepper (sm) + a mono text Input kept in sync; `value` is NaN while the typed text is invalid. */
import { useState } from "react";
import { Input, QuantityStepper } from "@/components/ui";
import { parseNum } from "./useForm";

export interface QtyFieldProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  min?: number;
  error?: string;
  hint?: string;
  required?: boolean;
  optional?: boolean;
}

export function QtyField({ label, value, onChange, unit, min = 0, error, hint, required, optional }: QtyFieldProps) {
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value) : ""));

  const fromStepper = (n: number) => {
    setText(String(n));
    onChange(n);
  };
  const fromInput = (raw: string) => {
    setText(raw);
    const n = parseNum(raw);
    onChange(Number.isFinite(n) && n >= min ? n : Number.NaN);
  };

  const stepperValue = Number.isFinite(value) ? value : min;

  return (
    <div className="sa-field">
      <span className="sa-label">
        <span>
          {label}
          {required ? <span className="sa-label-req" aria-hidden="true"> *</span> : null}
        </span>
        {optional ? <span className="sa-faint" style={{ fontWeight: 400 }}>אופציונלי</span> : null}
      </span>
      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <QuantityStepper size="sm" label={label} value={stepperValue} onChange={fromStepper} min={min} unit={unit} />
        <Input
          aria-label={`${label} — הקלדה`}
          mono
          inputMode="decimal"
          value={text}
          onChange={(e) => fromInput(e.target.value)}
          onBlur={() => { if (Number.isFinite(value)) setText(String(value)); }}
          className="w-[120px]"
          error={error}
          hint={error ? undefined : hint}
        />
      </div>
    </div>
  );
}
