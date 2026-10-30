"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Square } from "./Mark";

export interface StatProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: IconName;
  delta?: number;
  deltaUnit?: string;
  /** Whether a positive delta is good (default true). */
  deltaGood?: boolean;
  note?: ReactNode;
  tone?: "warning" | "danger";
  className?: string;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** KPI tile — three per overview. */
export function Stat({ label, value, unit, icon, delta, deltaUnit, deltaGood = true, note, tone, className }: StatProps) {
  const dir = delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const good = dir === "up" ? deltaGood : dir === "down" ? !deltaGood : null;
  // A unit that starts with % or a Latin word glues onto the number; a Hebrew unit sits beside it.
  const inlineUnit = deltaUnit != null && /^[%\w]/.test(deltaUnit);

  return (
    <div className={cx("sa-stat", tone && `is-${tone}`, className)}>
      <div className="sa-stat-label">
        <span className="inline-flex items-center gap-2">
          {tone ? <Square tone={tone} /> : null}
          {label}
        </span>
        {icon ? <Icon name={icon} /> : null}
      </div>
      <div className="sa-stat-value">
        <span>{value}</span>
        {unit ? <span className="sa-stat-unit">{unit}</span> : null}
      </div>
      <div className="sa-stat-foot">
        {dir && delta != null ? (
          <span className={cx("sa-delta", dir === "flat" ? "is-flat" : good ? "is-up" : "is-down")}>
            <span className="sa-delta-num">
              {dir !== "flat" ? <Icon name={dir === "up" ? "arrow-up" : "arrow-down"} size={12} strokeWidth={2.5} /> : null}
              {(delta > 0 ? "+" : "") + String(delta) + (inlineUnit ? deltaUnit : "")}
            </span>
            {deltaUnit && !inlineUnit ? <span>{deltaUnit.trim()}</span> : null}
          </span>
        ) : null}
        {note ? <span>{note}</span> : null}
      </div>
    </div>
  );
}
