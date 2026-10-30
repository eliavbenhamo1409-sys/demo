"use client";

import type { ReactNode } from "react";
import { Mark } from "./Mark";
import { MOVEMENT_ICON, type MovementType } from "./Movement";
import { fmtSigned, MOVEMENT_LABEL } from "@/lib/format";

export interface TimelineItem {
  id?: string | number;
  type?: MovementType;
  title?: ReactNode;
  when?: string;
  by?: string;
  qty?: number;
}

export interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Movement history of one product. */
export function Timeline({ items, className }: TimelineProps) {
  return (
    <ul className={cx("sa-timeline", className)}>
      {items.map((it, i) => {
        const t = it.type ?? "in";
        const meta = [it.when, it.by].filter(Boolean).join(" · ");
        return (
          <li key={it.id ?? i} className={cx("sa-timeline-item", `is-${t}`)}>
            <Mark type={t} icon={MOVEMENT_ICON[t]} size="md" />
            <div className="sa-timeline-body">
              <div className="min-w-0">
                <p className="sa-timeline-title">{it.title ?? MOVEMENT_LABEL[t]}</p>
                {meta ? <p className="sa-timeline-meta">{meta}</p> : null}
              </div>
              {it.qty != null ? <span className="sa-timeline-qty">{fmtSigned(it.qty, t)}</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
