"use client";

import type { ReactElement, ReactNode } from "react";
import { cx } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import type { StockState } from "@/lib/map3d/types";

/** A page's head: the title, one line that says what the page holds, and the page's one primary key at the end. */
export function Head({ title, line, children }: { title: string; line?: ReactNode; children?: ReactNode }): ReactElement {
  return (
    <header className="at-head">
      <div className="at-head-text">
        <h1 className="at-title">{title}</h1>
        {line ? <div className="at-line">{line}</div> : null}
      </div>
      {children ? <div className="at-head-end">{children}</div> : null}
    </header>
  );
}

export interface SumItem {
  label: string;
  value: number | string;
  tone?: "warn" | "out" | "short" | "ok";
}

/** One summary line: a figure and its word, ruled apart from the next. */
export function Summary({ items }: { items: SumItem[] }): ReactElement {
  return (
    <ul className="at-sum">
      {items.map((item) => (
        <li key={item.label} className={item.tone ? `at-tone-${item.tone}` : undefined}>
          <b className="ltr">{typeof item.value === "number" ? fmtQty(item.value) : item.value}</b>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export const STATE_WORD: Record<StockState, string> = { ok: "תקין", low: "מתחת למינימום", out: "אזל", short: "חסר להזמנות" };
export const STATE_TONE: Record<StockState, string> = { ok: "at-tone-ok", low: "at-tone-warn", out: "at-tone-out", short: "at-tone-short" };

/** A state is a word in its colour, never colour alone. */
export function StateWord({ state, sub, className }: { state: StockState; sub?: ReactNode; className?: string }): ReactElement {
  return (
    <span className={cx("at-state", `is-${state}`, className)}>
      {STATE_WORD[state]}
      {sub ? <span className="at-state-sub">{sub}</span> : null}
    </span>
  );
}

/** What is free against the minimum, as a short bar: the mark in the middle is the minimum, so anything short of it reads at once. */
export function Meter({ value, min, state }: { value: number; min: number; state: StockState }): ReactElement {
  const full = Math.max(1, min * 2);
  const at = Math.round((Math.min(full, Math.max(0, value)) / full) * 100);
  return (
    <span className={cx("at-meter", `is-${state}`)} aria-hidden="true">
      <i style={{ width: `${at}%` }} />
      {min > 0 ? <u style={{ left: "50%" }} /> : null}
    </span>
  );
}
