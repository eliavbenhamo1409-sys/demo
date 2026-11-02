"use client";

import type { CSSProperties, ReactElement } from "react";
import { cx } from "@/components/ui";

const WHEEL = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface FigureProps {
  /** The figure as it should read, grouped and all: "2,486,120". */
  text: string;
  /** A sign set smaller, before the digits: ₪. */
  sign?: string;
  /** What a screen reader says. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** A counter with a wheel per digit, keyed from the right, so a new value turns only the wheels that change. */
export function Figure({ text, sign, label, className, style }: FigureProps): ReactElement {
  const chars = [...text];
  return (
    <span className={cx("mh-figure", className)} style={style} role="img" aria-label={label ?? `${sign ?? ""}${text}`}>
      {sign ? <span className="mh-figure-sign" aria-hidden="true">{sign}</span> : null}
      {chars.map((char, i) => {
        const fromEnd = chars.length - i;
        if (!/\d/.test(char)) {
          return <span key={`s${fromEnd}`} className={cx("mh-figure-sep", char === "," && "is-thin")} aria-hidden="true">{char}</span>;
        }
        return (
          <span key={`d${fromEnd}`} className="mh-digit" aria-hidden="true" style={{ "--d": Number(char), "--i": fromEnd } as CSSProperties}>
            <span className="mh-digit-strip">
              {WHEEL.map((digit) => <span key={digit}>{digit}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
