"use client";

import type { ReactNode } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Icon } from "./Icon";

export interface AttentionItem {
  id?: string | number;
  severity?: "danger" | "warning" | "neutral";
  /** The word in the badge: אזל, תקלה, ממתין, מינימום. */
  label?: string;
  title: ReactNode;
  meta?: ReactNode[];
  /** Photo attached to the item (e.g. a worker's fault photo); opens full-size in a new tab. */
  thumb?: { src: string; alt: string };
  /** Makes the whole row open the item. */
  onOpen?: () => void;
  /** Removes the row. */
  onDismiss?: () => void;
  /** Names a dismiss that changes data; it then shows as a word instead of the X. */
  dismissLabel?: string;
}

export interface AttentionProps {
  items: AttentionItem[];
  className?: string;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** The "needs attention" list of the overview. */
export function Attention({ items, className }: AttentionProps) {
  return (
    <ul className={cx("sa-attention", "m-0 list-none p-0", className)}>
      {items.map((it, i) => {
        const sev = it.severity ?? "warning";
        const text = (
          <>
            <span className="sa-attention-title">{it.title}</span>
            {it.meta && it.meta.length > 0 ? (
              <span className="sa-attention-meta">
                {it.meta.map((m, j) => (
                  <span key={j}>{j > 0 ? "· " : ""}{m}</span>
                ))}
              </span>
            ) : null}
          </>
        );
        return (
          <li key={it.id ?? i} className="sa-attention-item">
            <Badge tone={sev}>{it.label}</Badge>
            {it.thumb ? (
              <a className="sa-attention-thumb" href={it.thumb.src} target="_blank" rel="noreferrer" aria-label="פתיחת התמונה">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.thumb.src} alt={it.thumb.alt} loading="lazy" />
              </a>
            ) : null}
            {it.onOpen ? (
              <button type="button" className="sa-attention-body sa-attention-open" onClick={it.onOpen}>{text}</button>
            ) : (
              <div className="sa-attention-body">{text}</div>
            )}
            {it.onDismiss ? (
              <div className="sa-attention-actions">
                {it.dismissLabel ? (
                  <Button variant="secondary" size="sm" icon="check" onClick={it.onDismiss}>{it.dismissLabel}</Button>
                ) : (
                  <Button variant="ghost" size="sm" iconOnly icon="x" title="הסרה מהרשימה" onClick={it.onDismiss} />
                )}
              </div>
            ) : it.onOpen ? (
              <span className="sa-attention-chev"><Icon name="chevron-left" size={16} /></span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
