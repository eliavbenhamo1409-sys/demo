"use client";

/**
 * One quantity field: a typed Input beside the stepper's − and + (its own number
 * box is hidden, the Input shows the same value). `value` is NaN while the typed text is invalid.
 */
import { useRef, useState, type KeyboardEvent } from "react";
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
  const rootRef = useRef<HTMLDivElement>(null);

  const fromStepper = (n: number) => {
    // − + and the arrow keys fire no input event, so a real change announces itself.
    if (n !== value) rootRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
    setText(String(n));
    onChange(n);
  };
  const fromInput = (raw: string) => {
    setText(raw);
    const n = parseNum(raw);
    onChange(Number.isFinite(n) && n >= min ? n : Number.NaN);
  };

  const stepperValue = Number.isFinite(value) ? value : min;

  const onArrow = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    fromStepper(Math.max(min, stepperValue + (e.key === "ArrowUp" ? 1 : -1)));
  };

  return (
    <div ref={rootRef} className="sa-field">
      <span className="sa-label">
        <span>{label}</span>
        {optional ? <span className="sa-faint font-normal">לא חובה</span> : null}
      </span>
      <div className="sa-qtyfield flex items-start gap-[var(--space-2)]">
        <Input
          aria-label={`${label} — הקלדה`}
          aria-required={required}
          mono
          inputMode="decimal"
          value={text}
          onChange={(e) => fromInput(e.target.value)}
          onBlur={() => { if (Number.isFinite(value)) setText(String(value)); }}
          onKeyDown={onArrow}
          className="min-w-0 flex-1"
          end={unit ? <span className="sa-hint px-[var(--space-1)]">{unit}</span> : undefined}
          error={error}
          hint={error ? undefined : hint}
        />
        <QuantityStepper size="sm" label={label} value={stepperValue} onChange={fromStepper} min={min} className="[&_input]:hidden" />
      </div>
    </div>
  );
}
