"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { fmtQty } from "@/lib/format";
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
