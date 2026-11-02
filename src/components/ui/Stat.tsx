"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Dot } from "./Dot";
import { Icon, type IconName } from "./Icon";

export interface StatProps {
  label: string;
  /** Takes the tone's colour and stands in for its dot. */
  icon?: IconName;
  value: ReactNode;
  unit?: string;
  delta?: number;
  deltaUnit?: string;
  /** Whether a positive delta is good (default true). */
  deltaGood?: boolean;
  note?: ReactNode;
  tone?: "warning" | "danger";
  /** A small picture of the number, under it or beside it. */
  viz?: ReactNode;
  /** Makes the whole tile a link to the page that explains the number. */
  href?: string;
  className?: string;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const ICON_TONE = { warning: "text-warning-text", danger: "text-danger-text" } as const;

/** KPI tile — four per overview. */
export function Stat({ label, icon, value, unit, delta, deltaUnit, deltaGood = true, note, tone, viz, href, className }: StatProps) {
  const dir = delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const good = dir === "up" ? deltaGood : dir === "down" ? !deltaGood : null;
  // A unit that starts with % or a Latin word glues onto the number; a Hebrew unit sits beside it.
  const inlineUnit = deltaUnit != null && /^[%\w]/.test(deltaUnit);

  const body = (
    <>
      <div className="sa-stat-label">
        {icon ? <Icon name={icon} size={16} className={tone ? ICON_TONE[tone] : "text-ink-3"} /> : tone ? <Dot tone={tone} /> : null}
        {label}
      </div>
      <div className="sa-stat-value">
        <span>{value}</span>
        {unit ? <span className="sa-stat-unit">{unit}</span> : null}
      </div>
      {viz}
      <div className="sa-stat-foot">
        {dir && delta != null ? (
          <span className={cx("sa-delta", dir === "flat" ? "is-flat" : good ? "is-up" : "is-down")}>
            <span className="sa-delta-num">
              {(delta > 0 ? "+" : delta < 0 ? "−" : "") + String(Math.abs(delta)) + (inlineUnit ? deltaUnit : "")}
            </span>
            {deltaUnit && !inlineUnit ? <span>{deltaUnit.trim()}</span> : null}
          </span>
        ) : null}
        {note ? <span>{note}</span> : null}
      </div>
    </>
  );
  const classes = cx("sa-stat", className);
  return href ? <Link href={href} className={classes}>{body}</Link> : <div className={classes}>{body}</div>;
}
