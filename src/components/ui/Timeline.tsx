"use client";

import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { MOVEMENT_ICON, type MovementType } from "./Movement";
import { fmtSigned, MOVEMENT_LABEL } from "@/lib/format";

export interface TimelineItem {
  id?: string | number;
  type?: MovementType;
  title?: ReactNode;
  when?: string;
  by?: string;
  qty?: number;
  /** Extra content under the row, e.g. a fault's note and photo. */
  detail?: ReactNode;
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
            <div className="sa-timeline-body">
              <Icon name={MOVEMENT_ICON[t]} size={20} strokeWidth={1.5} className="sa-timeline-icon" />
              <div className="min-w-0">
                <p className="sa-timeline-title">{it.title ?? MOVEMENT_LABEL[t]}</p>
                {meta ? <p className="sa-timeline-meta">{meta}</p> : null}
              </div>
              {it.qty != null ? <span className="sa-timeline-qty">{fmtSigned(it.qty, t)}</span> : null}
            </div>
            {it.detail}
          </li>
        );
      })}
    </ul>
  );
}
