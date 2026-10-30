"use client";

import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { DayPoint } from "@/lib/store";
import { Card } from "@/components/ui";
import { fmtQty } from "@/lib/format";

export interface WeeklyChartProps {
  days: DayPoint[];
  className?: string;
}

/* Geometry (viewBox units). The svg scales to the card width. */
const W = 320;
const H = 150;
const PAD_X = 12;
const TOP = 12;
const BASE_Y = 116; // baseline
const LABEL_Y = 138;
const BAR_W = 26;
const RADIUS = 4;

const SHORT_DAY: Record<string, string> = {
  ראשון: "א׳",
  שני: "ב׳",
  שלישי: "ג׳",
  רביעי: "ד׳",
  חמישי: "ה׳",
  שישי: "ו׳",
  שבת: "ש׳",
};

/** Rounded-top bar path (bottom corners square so it sits flush on the baseline). */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h / 2, w / 2);
  if (h <= 0) return "";
  return [
    `M${x},${y + h}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
}

/** Seven-day bar chart of movements. Pure SVG; today's bar in the accent colour. */
export function WeeklyChart({ days, className }: WeeklyChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();

  const total = days.reduce((s, d) => s + d.total, 0);
  const max = Math.max(0, ...days.map((d) => d.total));
  const allZero = max === 0;
  const n = Math.max(1, days.length);
  const slot = (W - PAD_X * 2) / n;
  const plotH = BASE_Y - TOP;

  const subtitle = allZero ? "אין תנועות השבוע" : `${fmtQty(total)} תנועות בשבעת הימים האחרונים`;

  const onKey = (e: KeyboardEvent<SVGGElement>, i: number) => {
    if (e.key === "Escape") {
      setActive(null);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? i + 1 : i - 1;
      const target = (e.currentTarget.parentElement?.querySelectorAll<SVGGElement>("[data-bar]") ?? [])[
        (next + n) % n
      ];
      target?.focus();
    }
  };

  const tip = active != null ? days[active] : undefined;
  const tipStyle: CSSProperties | undefined =
    active != null
      ? {
          left: `${((PAD_X + slot * active + slot / 2) / W) * 100}%`,
          bottom: `${((H - (allZero ? BASE_Y : Math.max(TOP, BASE_Y - (days[active].total / Math.max(1, max)) * plotH))) / H) * 100}%`,
        }
      : undefined;

  return (
    <Card title="תנועות השבוע" subtitle={subtitle} className={className}>
      <div className="relative" dir="ltr">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="group"
          aria-label="תנועות לפי יום, שבעת הימים האחרונים"
          className="block w-full select-none"
          style={{ height: "auto", overflow: "visible" }}
          onMouseLeave={() => setActive(null)}
        >
          {/* baseline */}
          <line x1={PAD_X} x2={W - PAD_X} y1={BASE_Y + 0.5} y2={BASE_Y + 0.5} stroke="var(--border-base)" strokeWidth={1} />

          {allZero ? (
            <text
              x={W / 2}
              y={TOP + plotH / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--text-tertiary)"
              fontSize={12}
              fontFamily="var(--font-sans)"
              direction="rtl"
            >
              אין תנועות השבוע
            </text>
          ) : null}

          {days.map((d, i) => {
            const isToday = i === days.length - 1;
            const h = allZero ? 0 : Math.max(d.total > 0 ? 3 : 0, (d.total / max) * plotH);
            const x = PAD_X + slot * i + (slot - BAR_W) / 2;
            const y = BASE_Y - h;
            const isActive = active === i;
            const label = `${d.label}: ${fmtQty(d.total)} תנועות, ${fmtQty(d.in)} קליטות, ${fmtQty(d.out)} הוצאות`;
            return (
              <g
                key={d.day}
                data-bar=""
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-describedby={isActive ? tipId : undefined}
                style={{ cursor: "default", outline: "none" }}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((cur) => (cur === i ? null : cur))}
                onKeyDown={(e) => onKey(e, i)}
              >
                {/* hit area for the whole column */}
                <rect x={PAD_X + slot * i} y={TOP} width={slot} height={BASE_Y - TOP} fill="transparent" />
                {h > 0 ? (
                  <path
                    d={barPath(x, y, BAR_W, h)}
                    fill={isToday ? "var(--accent)" : "var(--bg-muted)"}
                    stroke={isToday ? "var(--accent)" : "var(--border-base)"}
                    strokeWidth={1}
                    opacity={active != null && !isActive ? 0.6 : 1}
                    style={{ transition: "opacity 0.1s" }}
                  />
                ) : null}
                {isActive ? (
                  <rect
                    x={x - 3}
                    y={Math.min(y, BASE_Y) - 3}
                    width={BAR_W + 6}
                    height={Math.max(h, 1) + 6}
                    rx={RADIUS + 2}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                    strokeDasharray={h > 0 ? undefined : "2 2"}
                    pointerEvents="none"
                  />
                ) : null}
                <text
                  x={PAD_X + slot * i + slot / 2}
                  y={LABEL_Y}
                  textAnchor="middle"
                  fontSize={11}
                  fontFamily="var(--font-sans)"
                  fontWeight={isToday ? 600 : 500}
                  fill={isToday ? "var(--text-primary)" : "var(--text-tertiary)"}
                  direction="rtl"
                >
                  {SHORT_DAY[d.label] ?? d.label}
                </text>
              </g>
            );
          })}
        </svg>

        {tip && tipStyle ? (
          <div
            id={tipId}
            role="tooltip"
            dir="rtl"
            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap"
            style={{
              ...tipStyle,
              marginBottom: 8,
              background: "var(--bg-inverse)",
              color: "var(--text-inverse)",
              borderRadius: "var(--radius-md)",
              padding: "6px 10px",
              boxShadow: "var(--shadow-md)",
              fontSize: 12,
              lineHeight: "16px",
            }}
          >
            <div className="font-semibold">
              <span className="sa-mono ltr">{fmtQty(tip.total)}</span> תנועות · {tip.label}
            </div>
            <div style={{ opacity: 0.75 }}>
              <span className="sa-mono ltr">{fmtQty(tip.in)}</span> קליטות · <span className="sa-mono ltr">{fmtQty(tip.out)}</span> הוצאות
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
