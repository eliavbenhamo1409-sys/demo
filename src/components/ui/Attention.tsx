"use client";

import type { ReactNode } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

export interface AttentionItem {
  id?: string | number;
  severity?: "danger" | "warning" | "neutral";
  /** The word in the solid badge: אזל, תקלה, לא מאושר, מינימום. */
  label?: string;
  title: ReactNode;
  meta?: ReactNode[];
  /** Photo attached to the item (e.g. a worker's fault photo); opens full-size in a new tab. */
  thumb?: { src: string; alt: string };
  action?: string;
  onAction?: () => void;
  secondary?: string;
  onSecondary?: () => void;
}

export interface AttentionProps {
  items: AttentionItem[];
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const SEVERITY_WORD: Record<NonNullable<AttentionItem["severity"]>, string> = {
  danger: "דחוף",
  warning: "לטיפול",
  neutral: "מידע",
};

/** The "needs attention" list of the overview; renders an EmptyState when empty. */
export function Attention({ items, emptyTitle, emptyHint, className }: AttentionProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon="check-circle"
        title={emptyTitle ?? "אין פריטים שדורשים טיפול"}
        hint={emptyHint ?? "כל החריגות טופלו. נעדכן כאן ברגע שמשהו ידרוש תשומת לב."}
        className={className}
      />
    );
  }
  return (
    <ul className={cx("sa-attention", "m-0 list-none p-0", className)}>
      {items.map((it, i) => {
        const sev = it.severity ?? "warning";
        return (
          <li key={it.id ?? i} className={cx("sa-attention-item", `is-${sev}`)}>
            <Badge tone={sev} solid>{it.label ?? SEVERITY_WORD[sev]}</Badge>
            {it.thumb ? (
              <a className="sa-attention-thumb" href={it.thumb.src} target="_blank" rel="noreferrer" aria-label="פתח את התמונה">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.thumb.src} alt={it.thumb.alt} loading="lazy" />
              </a>
            ) : null}
            <div className="sa-attention-body">
              <p className="sa-attention-title">{it.title}</p>
              {it.meta && it.meta.length > 0 ? (
                <p className="sa-attention-meta">
                  {it.meta.map((m, j) => (
                    <span key={j}>{j > 0 ? "· " : ""}{m}</span>
                  ))}
                </p>
              ) : null}
            </div>
            {it.action || it.secondary ? (
              <div className="sa-attention-actions">
                {it.secondary ? <Button variant="ghost" size="sm" onClick={it.onSecondary}>{it.secondary}</Button> : null}
                {it.action ? <Button variant="secondary" size="sm" onClick={it.onAction}>{it.action}</Button> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
