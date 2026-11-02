"use client";

import { useState } from "react";
import { MinusIcon, PlusIcon } from "./Icons";

type Props = {
  value: number;
  onChange: (n: number) => void;
  label: string;
  small?: boolean;
};

/**
 * Plus and minus for a few, typing for a pallet. Never below one.
 * There is no top: an agent may ask for more than the stock, and hears why at the button, not from a number that won't move.
 */
export function Stepper({ value, onChange, label, small }: Props) {
  const [typing, setTyping] = useState<string | null>(null);
  const commit = (raw: string) => {
    setTyping(null);
    const n = Math.floor(Number(raw));
    // Tapping the box and leaving changes nothing, and must not count as a new order.
    if (Number.isFinite(n) && n >= 1 && n !== value) onChange(n);
  };

  return (
    <span className={`cg-stepper${small ? " cg-stepper--small" : ""}`} role="group" aria-label={label}>
      <button type="button" aria-label="הוספה" onClick={() => onChange(value + 1)}>
        <PlusIcon />
      </button>
      <input
        className="cg-num"
        inputMode="numeric"
        aria-label="כמות"
        value={typing ?? String(value)}
        onChange={(e) => setTyping(e.target.value.split(/[.,]/)[0].replace(/\D/g, "").slice(0, 6))}
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
