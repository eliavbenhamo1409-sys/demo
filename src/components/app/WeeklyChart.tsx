"use client";

import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { DayPoint } from "@/lib/store";
import { Card } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import { CountUp } from "./Viz";
import "./overview.css";

export interface WeeklyChartProps {
  days: DayPoint[];
  className?: string;
}

const SHORT_DAY: Record<string, string> = {
  ראשון: "א׳",
  שני: "ב׳",
  שלישי: "ג׳",
  רביעי: "ד׳",
  חמישי: "ה׳",
  שישי: "ו׳",
  שבת: "ש׳",
};

/** Seven days of movements as rounded bars: goods in over goods out, with the week's total above them. */
export function WeeklyChart({ days, className }: WeeklyChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();

  const total = days.reduce((s, d) => s + d.total, 0);
  const max = Math.max(0, ...days.map((d) => d.total));
  const allZero = max === 0;
  const n = Math.max(1, days.length);

  const onKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key === "Escape") {
      setActive(null);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? i + 1 : i - 1;
      const target = (e.currentTarget.parentElement?.querySelectorAll<HTMLDivElement>("[data-bar]") ?? [])[
        (next + n) % n
      ];
      target?.focus();
    }
  };

  const word = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const tip = active != null ? days[active] : undefined;
  const tipStyle =
    active != null
      ? ({ "--wk-at": allZero ? 0 : days[active].total / max, "--wk-x": `${((active + 0.5) / n) * 100}%` } as CSSProperties)
      : undefined;
  // The first and last tips hold to the plot's edge so the card never crops them.
  const tipClass = ["wk-tip", active === 0 && "is-first", active === n - 1 && "is-last"].filter(Boolean).join(" ");

  return (
    <Card
      title="תנועות השבוע"
      actions={
        allZero ? undefined : (
          <span className="wk-legend">
            <span><i className="is-in" />קליטה</span>
            <span><i className="is-out" />הוצאה</span>
            {days.some((d) => d.total > d.in + d.out) ? <span><i className="is-other" />אחר</span> : null}
          </span>
        )
      }
      className={["wk-card", className].filter(Boolean).join(" ")}
    >
      {allZero ? null : (
        <div className="wk-sum">
          <span className="wk-sum-n ltr"><CountUp value={total} /></span>
          <span className="wk-sum-unit">{word(total, "תנועה", "תנועות")}</span>
        </div>
      )}
      <div
        dir="ltr"
        role="group"
        aria-label="תנועות לפי יום, שבעת הימים האחרונים"
        className={active != null ? "wk is-dim" : "wk"}
        onMouseLeave={() => setActive(null)}
      >
        {allZero ? (
          <span className="wk-none" dir="rtl">
            אין תנועות השבוע
          </span>
        ) : null}

        {days.map((d, i) => {
          const isToday = i === days.length - 1;
          const h = allZero || d.total === 0 ? 0 : Math.max(6, (d.total / max) * 100);
          const other = d.total - d.in - d.out;
          const isActive = active === i;
          const label = `${d.label}: ${fmtQty(d.total)} תנועות, ${fmtQty(d.in)} קליטות, ${fmtQty(d.out)} הוצאות`;
          return (
            <div
              key={d.day}
              data-bar=""
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-describedby={isActive ? tipId : undefined}
              className={["wk-col", isToday && "is-today", isActive && "is-active"].filter(Boolean).join(" ")}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((cur) => (cur === i ? null : cur))}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="wk-track">
                {h > 0 ? (
                  <span className="wk-stack" style={{ height: `${h}%`, "--i": i } as CSSProperties}>
                    {other > 0 ? <span className="wk-seg is-other" style={{ flexGrow: other }} /> : null}
                    {d.out > 0 ? <span className="wk-seg is-out" style={{ flexGrow: d.out }} /> : null}
                    {d.in > 0 ? <span className="wk-seg is-in" style={{ flexGrow: d.in }} /> : null}
                  </span>
                ) : null}
              </span>
              <span className="wk-day" dir="rtl">
                {SHORT_DAY[d.label] ?? d.label}
              </span>
            </div>
          );
        })}

        {tip && tipStyle ? (
          <div id={tipId} role="tooltip" dir="rtl" className={tipClass} style={tipStyle}>
            <div className="wk-tip-value">
              <span className="sa-mono ltr">{fmtQty(tip.total)}</span> {word(tip.total, "תנועה", "תנועות")} · {tip.label}
            </div>
            <div className="wk-tip-sub">
              <span className="sa-mono ltr">{fmtQty(tip.in)}</span> {word(tip.in, "קליטה", "קליטות")} · <span className="sa-mono ltr">{fmtQty(tip.out)}</span>{" "}
              {word(tip.out, "הוצאה", "הוצאות")}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
