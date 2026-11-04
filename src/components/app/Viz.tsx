"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { fmtCompact, fmtQty } from "@/lib/format";
import { productPhotoUrl } from "@/lib/product-photos";
import type { Product } from "@/lib/store";
import "./overview.css";

/** The product's own photo at the head of a row. With no photo the frame stays, empty, so names keep one edge. */
export function ProductThumb({ product, small }: { product?: Pick<Product, "image_path"> | null; small?: boolean }): ReactElement {
  const src = productPhotoUrl(product?.image_path);
  const cls = small ? "sa-thumb is-sm" : "sa-thumb";
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img className={cls} src={src} alt="" loading="lazy" /> : <span className={cls} aria-hidden="true" />;
}

/** What is left against the minimum, like a battery: the mark in the middle is the minimum, so anything short of it reads at once. */
export function StockMeter({ value, min, tone }: { value: number; min: number; tone: "ok" | "low" | "out" }): ReactElement {
  const full = Math.max(1, min * 2);
  const at = Math.round((Math.min(full, Math.max(0, value)) / full) * 100);
  return (
    <span className={`sa-meter is-${tone}`} aria-hidden="true">
      <i style={{ width: `${at}%` }} />
    </span>
  );
}

/** Seven small days beside a figure; the last one is today. */
export function SparkBars({ values, label }: { values: number[]; label: string }): ReactElement {
  const max = Math.max(1, ...values);
  return (
    <div className="viz-spark" role="img" aria-label={label}>
      {values.map((v, i) => (
        <span
          key={i}
          className={i === values.length - 1 ? "is-today" : v > 0 ? "is-on" : undefined}
          style={{ height: `${Math.max(17, (v / max) * 100)}%`, "--i": i } as CSSProperties}
        />
      ))}
    </div>
  );
}

/** One part of a ring, with the colour it keeps in the legend beside it. */
export interface RingSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

const RING = 128;
const RING_WIDTH = 14;
/** The sheet shows through between two parts, so neighbours read apart with no drawn edge. */
const RING_GAP = 2;

/** Whole percents that add up to 100: each part's floor, and what is left to the parts that lost the most. */
export function percents(values: number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const whole = exact.map(Math.floor);
  let left = 100 - whole.reduce((sum, v) => sum + v, 0);
  for (const { i } of exact.map((e, i) => ({ i, lost: e - whole[i] })).sort((a, b) => b.lost - a.lost)) {
    if (left <= 0) break;
    whole[i] += 1;
    left -= 1;
  }
  return whole;
}

const point = (r: number, a: number) => `${(RING / 2 + r * Math.sin(a)).toFixed(2)},${(RING / 2 - r * Math.cos(a)).toFixed(2)}`;

/** The arc between two angles, clockwise from the top. */
const arc = (r: number, a0: number, a1: number) => `M${point(r, a0)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${point(r, a1)}`;

/**
 * A whole and its parts as a ring, the total in the middle. The part under the pointer, here or in the legend
 * beside it, thickens and takes the middle with its share; every value is in the legend too, so nothing needs the pointer.
 */
export function Ring({ slices, shares, total, caption, active, onActive, label }: {
  slices: RingSlice[];
  /** Each part's whole percent, in the parts' order. */
  shares: number[];
  total: number;
  /** Under the total: how many things make it up. */
  caption: string;
  active: number | null;
  onActive: (i: number | null) => void;
  label: string;
}): ReactElement {
  const r = (RING - RING_WIDTH) / 2;
  const gap = RING_GAP / r;
  const shown = active !== null ? slices[active] : undefined;
  let at = 0;
  return (
    <div className={`ov-ring${active !== null ? " has-active" : ""}`}>
      <svg viewBox={`0 0 ${RING} ${RING}`} role="img" aria-label={label}>
        {slices.length === 1 ? (
          <circle className="ov-ring-arc" cx={RING / 2} cy={RING / 2} r={r} stroke={slices[0].color} pathLength={1} />
        ) : (
          slices.map((s, i) => {
            const sweep = (s.value / total) * Math.PI * 2;
            const from = at;
            at += sweep;
            // A part thinner than a few gaps keeps its whole angle, or it would vanish.
            const g = sweep > gap * 3 ? gap / 2 : 0;
            const d = arc(r, from + g, at - g);
            return (
              <g key={s.key} onMouseEnter={() => onActive(i)} onMouseLeave={() => onActive(null)}>
                <title>{`${s.label} · ${fmtCompact(s.value)} · ${shares[i]}%`}</title>
                <path className="ov-ring-hit" d={d} />
                <path className={`ov-ring-arc${active === i ? " is-active" : ""}`} d={d} stroke={s.color} pathLength={1} style={{ "--i": i } as CSSProperties} />
              </g>
            );
          })
        )}
      </svg>
      <div className="ov-ring-centre" aria-hidden="true">
        <span className="ov-ring-total ltr">{shown && active !== null ? `${shares[active]}%` : fmtCompact(total)}</span>
        <span className="ov-ring-caption">{shown ? <span className="ltr">{fmtCompact(shown.value)}</span> : caption}</span>
      </div>
    </div>
  );
}

const COUNT_MS = 700;

/** A figure that climbs to its value when the page arrives and when the data moves. Reduced motion sets it at once. */
export function CountUp({ value }: { value: number }): ReactElement {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      const frame = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(frame);
    }
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / COUNT_MS);
      const eased = 1 - Math.pow(1 - t, 4);
      const next = Math.round(start + (value - start) * eased);
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{fmtQty(shown)}</>;
}
