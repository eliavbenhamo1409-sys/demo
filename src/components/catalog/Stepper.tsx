"use client";

import { useState } from "react";
import { MinusIcon, PlusIcon } from "./Icons";

type Props = {
  value: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
  small?: boolean;
};

/** Plus and minus for a few, typing for a pallet. Never below one or above `max`. */
export function Stepper({ value, max, onChange, label, small }: Props) {
  const [typing, setTyping] = useState<string | null>(null);
  const top = Math.max(1, Math.floor(max));
  const commit = (raw: string) => {
    setTyping(null);
    const n = Math.min(Math.floor(Number(raw)), top);
    // Tapping the box and leaving changes nothing, and must not count as a new order.
    if (Number.isFinite(n) && n >= 1 && n !== value) onChange(n);
  };

  return (
    <span className={`cg-stepper${small ? " cg-stepper--small" : ""}`} role="group" aria-label={label}>
      <button type="button" aria-label="הוספה" disabled={value >= top} onClick={() => onChange(value + 1)}>
        <PlusIcon />
      </button>
      <input
        className="cg-num"
        inputMode="numeric"
        aria-label="כמות"
        value={typing ?? String(value)}
        onChange={(e) => setTyping(e.target.value.split(/[.,]/)[0].replace(/\D/g, ""))}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <button type="button" aria-label="הפחתה" disabled={value <= 1} onClick={() => onChange(value - 1)}>
        <MinusIcon />
      </button>
    </span>
  );
}
