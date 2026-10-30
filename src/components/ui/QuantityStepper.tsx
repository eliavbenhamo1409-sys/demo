"use client";

import { useState, type ReactElement } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";

export interface QuantityStepperProps {
  value?: number;
  defaultValue?: number;
  onChange?: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  size?: "md" | "sm";
  className?: string;
}

/** −/+ quantity control with a large mono number; `size="sm"` inside panels. */
export function QuantityStepper({
  value: valueProp, defaultValue = 1, onChange, min = 0, max = Infinity, step = 1, unit, label = "כמות", size = "md", className,
}: QuantityStepperProps): ReactElement {
  const [valueState, setValueState] = useState(defaultValue);
  const [draft, setDraft] = useState<string | null>(null);
  const value = valueProp !== undefined ? valueProp : valueState;

  const set = (n: number) => {
    const clamped = Math.max(min, Math.min(max, n));
    setValueState(clamped);
    onChange?.(clamped);
  };

  const iconSize = size === "sm" ? 14 : 20;

  return (
    <div style={{ display: "inline-flex", alignItems: "center" }}>
      <div className={cx("sa-qty", size === "sm" && "is-sm", className)} role="group" aria-label={label}>
        <button type="button" aria-label="הפחת" disabled={value <= min} onClick={() => set(value - step)}>
          <Icon name="minus" size={iconSize} strokeWidth={2.5} />
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={draft ?? String(value)}
          min={min}
          max={max === Infinity ? undefined : max}
          step={step}
          aria-label={label}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const n = Number(raw);
            if (raw !== "" && Number.isFinite(n)) set(n);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") { e.preventDefault(); set(value + step); setDraft(null); }
            if (e.key === "ArrowDown") { e.preventDefault(); set(value - step); setDraft(null); }
          }}
        />
        <button type="button" aria-label="הוסף" disabled={value >= max} onClick={() => set(value + step)}>
          <Icon name="plus" size={iconSize} strokeWidth={2.5} />
        </button>
      </div>
      {unit ? <span className="sa-qty-unit">{unit}</span> : null}
    </div>
  );
}
