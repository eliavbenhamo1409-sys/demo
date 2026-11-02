"use client";

import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { fmtQty } from "@/lib/format";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export interface FigureProps {
  value: number;
  /** Sets the money sign beside the number, small and raised, so the number stands alone. */
  shekel?: boolean;
  /** What a screen reader says instead of the digits. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** A number that rolls to its value like a counter on a machine. Every digit holds its place, so nothing around it ever moves. */
export function Figure({ value, shekel, label, className, style }: FigureProps): ReactElement {
  const text = fmtQty(Math.round(value));
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setArrived(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const chars = [...text];
  return (
    <span className={className ? `ml-fig ${className}` : "ml-fig"} style={style} role="img" aria-label={label ?? (shekel ? `${text} שקלים` : text)}>
      {shekel ? <span className="ml-fig-cur" aria-hidden="true">₪</span> : null}
      {chars.map((char, index) => {
        // Counted from the end, so a number that gains a digit keeps the ones it had.
        const place = chars.length - index;
        const digit = DIGITS.indexOf(char);
        if (digit < 0) return <span key={place} className="ml-sep" aria-hidden="true">{char}</span>;
        return (
          <span key={place} className="ml-d" aria-hidden="true" style={{ "--v": arrived ? digit : 0, "--i": place } as CSSProperties}>
            <i>{DIGITS.map((d) => <b key={d}>{d}</b>)}</i>
          </span>
        );
      })}
    </span>
  );
}
