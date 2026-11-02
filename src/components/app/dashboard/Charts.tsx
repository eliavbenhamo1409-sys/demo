"use client";

/**
 * The control room's pictures, drawn by hand so they stay thin, take their colours from the style's --viz tokens and
 * read the same in light and dark. Time runs left to right, as on any chart, inside the right-to-left page.
 * The rules: one axis, thin marks with a 2px gap, a legend for two series or more, a value on hover and on focus,
 * and every chart can also open as a table (ChartCard), so nothing is only a colour or only a hover.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from "react";
import { Button, Card, Table, type TableColumn } from "@/components/ui";
import { fmtPrice } from "@/lib/format";
import { fmtShort, niceScale } from "@/lib/control-room";

/** A series' place in the style's palette. Handed out in this order and never cycled: past the fifth, the rest folds into "אחרים". */
export type Hue = 1 | 2 | 3 | 4 | 5 | "other";

export const hue = (h: Hue) => (h === "other" ? "var(--viz-other)" : `var(--viz-${h})`);

/** The width a chart really has, so its marks and its type stay true at any size. */
function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const PLOT = { top: 14, right: 10, bottom: 26, left: 46 };

export interface TipRow {
  color: string;
  label: string;
  value: string;
}

/** The value leads, the name follows; a short stroke keys the series. */
function Tip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: TipRow[] }): ReactElement {
  const side: CSSProperties = x > width / 2 ? { right: width - x + 12 } : { left: x + 12 };
  return (
    <div className="dash-tip" style={{ ...side, top: y }} dir="rtl">
      <div className="dash-tip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="dash-tip-row">
          <i style={{ background: r.color }} />
          <b className="ltr">{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function Grid({ ticks, y, width, format }: { ticks: number[]; y: (v: number) => number; width: number; format: (v: number) => string }): ReactElement {
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PLOT.left} x2={width - PLOT.right} y1={y(t)} y2={y(t)} className="dash-gridline" />
          <text x={PLOT.left - 8} y={y(t)} className="dash-axis" textAnchor="end" dominantBaseline="middle">{format(t)}</text>
        </g>
      ))}
    </>
  );
}

/** A column with a rounded top, square at its foot. */
const column = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
};

export interface ColumnSeries {
  key: string;
  label: string;
  hue: Hue;
  values: number[];
}

export interface ColumnsProps {
  labels: string[];
  /** The band's full name in the tooltip. */
  titles?: string[];
  /** The bands still running, drawn lighter. */
  partial?: boolean[];
  series: ColumnSeries[];
  stacked?: boolean;
  height?: number;
  format?: (v: number) => string;
  axis?: (v: number) => string;
  label: string;
}

const shekels = (v: number) => fmtPrice(Math.round(v));
const shortShekels = (v: number) => (v === 0 ? "0" : `₪${fmtShort(v)}`);

/** Months side by side, or stacked when the parts add up to something. */
export function Columns({ labels, titles, partial, series, stacked, height = 260, format = shekels, axis = shortShekels, label }: ColumnsProps): ReactElement {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const totals = labels.map((_, i) => (stacked ? series.reduce((sum, s) => sum + s.values[i], 0) : Math.max(...series.map((s) => s.values[i]))));
  const ticks = niceScale(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1];
  const y = (v: number) => PLOT.top + (1 - v / top) * (height - PLOT.top - PLOT.bottom);
  const band = (width - PLOT.left - PLOT.right) / Math.max(1, labels.length);
  const groups = stacked ? 1 : series.length;
  const bar = Math.max(4, Math.min(24, (band * 0.66 - (groups - 1) * 2) / groups));
  const spread = groups * bar + (groups - 1) * 2;

  return (
    <div className="dash-plot" ref={ref} style={{ height }} dir="ltr" onPointerLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label}>
          <Grid ticks={ticks} y={y} width={width} format={axis} />
          {labels.map((text, i) => {
            const x = PLOT.left + i * band;
            let base = 0;
            return (
              <g key={i}>
                {hover === i ? <rect x={x} y={PLOT.top - 6} width={band} height={height - PLOT.top - PLOT.bottom + 6} className="dash-band" rx={6} /> : null}
                {series.map((s, n) => {
                  const value = s.values[i];
                  if (value <= 0) return null;
                  const left = stacked ? x + (band - bar) / 2 : x + (band - spread) / 2 + n * (bar + 2);
                  const tip = y(stacked ? base + value : value);
                  const foot = y(stacked ? base : 0);
                  base += value;
                  return <path key={s.key} d={column(left, tip, bar, Math.max(1, foot - tip - (stacked && n > 0 ? 2 : 0)))} fill={hue(s.hue)} fillOpacity={partial?.[i] ? 0.42 : 1} />;
                })}
                <text x={x + band / 2} y={height - 8} className="dash-axis" textAnchor="middle">{band < 34 && i % 2 ? "" : text}</text>
                <rect
                  x={x}
                  y={0}
                  width={band}
                  height={height}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${titles?.[i] ?? text}: ${series.map((s) => `${s.label} ${format(s.values[i])}`).join(", ")}`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      ) : null}
      {hover !== null ? (
        <Tip
          x={PLOT.left + (hover + 0.5) * band}
          y={Math.max(4, y(totals[hover]) - 8)}
          width={width}
          title={titles?.[hover] ?? labels[hover]}
          rows={series.map((s) => ({ color: hue(s.hue), label: s.label, value: format(s.values[hover]) }))}
        />
      ) : null}
    </div>
  );
}

export interface AreaProps {
  labels: string[];
  titles?: string[];
  values: number[];
  name: string;
  hue?: Hue;
  height?: number;
  format?: (v: number) => string;
  axis?: (v: number) => string;
  label: string;
}

/** One figure over time: a thin line over a wash, with a hairline that finds the month under the pointer. */
export function Area({ labels, titles, values, name, hue: tone = 1, height = 220, format = shekels, axis = shortShekels, label }: AreaProps): ReactElement {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const ticks = niceScale(Math.max(...values, 0));
  const top = ticks[ticks.length - 1];
  const y = (v: number) => PLOT.top + (1 - v / top) * (height - PLOT.top - PLOT.bottom);
  const step = (width - PLOT.left - PLOT.right - 8) / Math.max(1, values.length - 1);
  const x = (i: number) => PLOT.left + 4 + i * step;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const fill = `${line} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const last = values.length - 1;

  const onMove = (clientX: number, left: number) => {
    const i = Math.round((clientX - left - PLOT.left - 4) / step);
    setHover(Math.min(last, Math.max(0, i)));
  };

  return (
    <div
      className="dash-plot"
      ref={ref}
      style={{ height }}
      dir="ltr"
      tabIndex={0}
      role="img"
      aria-label={label}
      onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect().left)}
      onPointerLeave={() => setHover(null)}
      onFocus={() => setHover(last)}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        if (hover === null) return;
        if (e.key === "ArrowLeft") setHover(Math.max(0, hover - 1));
        else if (e.key === "ArrowRight") setHover(Math.min(last, hover + 1));
      }}
    >
      {width > 0 && values.length > 1 ? (
        <svg width={width} height={height} aria-hidden="true">
          <Grid ticks={ticks} y={y} width={width} format={axis} />
          <path d={fill} fill={hue(tone)} fillOpacity={0.12} />
          <path d={line} fill="none" stroke={hue(tone)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {labels.map((text, i) => (
            <text key={i} x={x(i)} y={height - 8} className="dash-axis" textAnchor="middle">{step < 30 && (last - i) % 2 ? "" : text}</text>
          ))}
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={PLOT.top} y2={y(0)} className="dash-cross" /> : null}
          <circle cx={x(hover ?? last)} cy={y(values[hover ?? last])} r={5} fill={hue(tone)} className="dash-dot" />
        </svg>
      ) : null}
      {hover !== null ? (
        <Tip x={x(hover)} y={Math.max(4, y(values[hover]) - 34)} width={width} title={titles?.[hover] ?? labels[hover]} rows={[{ color: hue(tone), label: name, value: format(values[hover]) }]} />
      ) : null}
    </div>
  );
}

export interface Slice {
  key: string;
  label: string;
  value: number;
  hue: Hue;
  /** A second figure in the legend, in words. */
  note?: string;
}

export interface RingProps {
  slices: Slice[];
  /** The figure in the hole; it stays the whole. */
  center: ReactNode;
  centerLabel: string;
  format?: (v: number) => string;
  label: string;
}

const RING = 148;
const STROKE = 22;

/** Part to whole at a glance: at most six slices, each named in the legend with its figure, so colour is never the only key. */
export function Ring({ slices, center, centerLabel, format = shekels, label }: RingProps): ReactElement {
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const r = (RING - STROKE) / 2;
  const round = 2 * Math.PI * r;
  const starts = slices.map((_, i) => (total > 0 ? slices.slice(0, i).reduce((sum, s) => sum + s.value, 0) / total : 0));
  return (
    <div className="dash-ring">
      <div className="dash-ring-art">
        <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} role="img" aria-label={label}>
          <g transform={`rotate(-90 ${RING / 2} ${RING / 2})`}>
            {slices.map((s, i) => {
              const dash = Math.max(0, (total > 0 ? s.value / total : 0) * round - 2);
              return (
                <circle
                  key={s.key}
                  cx={RING / 2}
                  cy={RING / 2}
                  r={r}
                  fill="none"
                  stroke={hue(s.hue)}
                  strokeWidth={hover === s.key ? STROKE + 5 : STROKE}
                  strokeDasharray={`${dash} ${round - dash}`}
                  strokeDashoffset={-starts[i] * round}
                  onPointerEnter={() => setHover(s.key)}
                  onPointerLeave={() => setHover(null)}
                />
              );
            })}
          </g>
        </svg>
        <div className="dash-ring-mid">
          <b className="ltr">{center}</b>
          <span>{centerLabel}</span>
        </div>
      </div>
      <ul className="dash-legend">
        {slices.map((s) => (
          <li key={s.key} className={hover === s.key ? "is-on" : undefined} onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}>
            <i style={{ background: hue(s.hue) }} />
            <span className="dash-legend-name">{s.label}</span>
            <span className="dash-legend-figs">
              <span className="dash-legend-n ltr">{format(s.value)}</span>
              <span className="dash-legend-pct ltr">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** A quiet line under the name. */
  sub?: ReactNode;
  /** A thumbnail, or anything else, at the head of the row. */
  lead?: ReactNode;
  onOpen?: () => void;
}

export interface BarsProps {
  rows: BarRow[];
  hue?: Hue;
  format?: (v: number) => string;
  label: string;
}

/** Ranked names: one series, so one colour, the figure at the end of the row. */
export function Bars({ rows, hue: tone = 1, format = shekels, label }: BarsProps): ReactElement {
  const top = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="dash-bars" aria-label={label}>
      {rows.map((r) => {
        const body = (
          <>
            {r.lead}
            <span className="dash-bar-text">
              <span className="dash-bar-top">
                <span className="dash-bar-name">{r.label}</span>
                <b className="dash-bar-n ltr">{format(r.value)}</b>
              </span>
              <span className="dash-bar-track"><i style={{ width: `${Math.max(1.5, (r.value / top) * 100)}%`, background: hue(tone) }} /></span>
              {r.sub ? <span className="dash-bar-sub">{r.sub}</span> : null}
            </span>
          </>
        );
        return <li key={r.key}>{r.onOpen ? <button type="button" className="dash-bar is-open" onClick={r.onOpen}>{body}</button> : <div className="dash-bar">{body}</div>}</li>;
      })}
    </ul>
  );
}

export interface SparkProps {
  values: number[];
  hue?: Hue;
  label: string;
}

/** The figure's last year in one line, the current window a dot at its end. */
export function Spark({ values, hue: tone = 1, label }: SparkProps): ReactElement {
  const [ref, width] = useWidth();
  const height = 40;
  const top = Math.max(...values, 1);
  const low = Math.min(...values, top);
  const span = Math.max(1, top - low);
  const x = (i: number) => 3 + (i / Math.max(1, values.length - 1)) * (width - 8);
  const y = (v: number) => 4 + (1 - (v - low) / span) * (height - 12);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <div className="dash-spark" ref={ref} dir="ltr">
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label}>
          <path d={`${line} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill={hue(tone)} fillOpacity={0.12} />
          <path d={line} fill="none" stroke={hue(tone)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={4} fill={hue(tone)} className="dash-dot" />
        </svg>
      ) : null}
    </div>
  );
}

export interface HeatProps {
  rows: string[];
  columns: string[];
  values: number[][];
  unit: string;
  label: string;
}

/** A grid of one hue, deeper where there is more. Every cell says its count on hover and in the table. */
export function Heat({ rows, columns, values, unit, label }: HeatProps): ReactElement {
  const top = Math.max(...values.flat(), 1);
  return (
    <div className="dash-heat" role="img" aria-label={label} dir="ltr" style={{ gridTemplateColumns: `auto repeat(${columns.length}, minmax(0, 1fr))` }}>
      <span />
      {columns.map((c) => <span key={c} className="dash-axis-html">{c}</span>)}
      {rows.map((row, r) => (
        <div key={row} className="dash-heat-row">
          <span className="dash-axis-html">{row}</span>
          {columns.map((c, i) => {
            const v = values[r][i];
            return <i key={c} title={`${row} ${c}: ${v} ${unit}`} style={{ opacity: v > 0 ? 0.14 + 0.86 * (v / top) : 0.05 }} />;
          })}
        </div>
      ))}
    </div>
  );
}

/** A chart's figures as a table: the first column names the row, the rest are numbers. */
export interface FigureTable {
  head: string[];
  rows: string[][];
}

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** The same figures as a table, one button away. */
  table?: FigureTable;
  className?: string;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}

type FigureRow = { id: number; cells: string[] };

/** A card that holds one chart, and its figures as a table for whoever would rather read them. */
export function ChartCard({ title, subtitle, table, className, actions, flush, children }: ChartCardProps): ReactElement {
  const [asTable, setAsTable] = useState(false);
  const columns = (table?.head ?? []).map<TableColumn<FigureRow>>((heading, i) => ({ key: String(i), title: heading, align: i > 0 ? "num" : undefined, render: (r) => r.cells[i] }));
  return (
    <Card
      title={title}
      subtitle={subtitle}
      flush={flush || asTable}
      className={`dash-card ${className ?? ""}`}
      actions={
        table || actions ? (
          <>
            {actions}
            {table ? (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon={asTable ? "activity" : "file-text"}
                aria-label={asTable ? "הצגה כגרף" : "הצגה כטבלה"}
                title={asTable ? "גרף" : "טבלה"}
                aria-pressed={asTable}
                onClick={() => setAsTable((v) => !v)}
              />
            ) : null}
          </>
        ) : undefined
      }
    >
      {asTable && table ? <Table columns={columns} data={table.rows.map((cells, id) => ({ id, cells }))} className="dash-table" /> : children}
    </Card>
  );
}
