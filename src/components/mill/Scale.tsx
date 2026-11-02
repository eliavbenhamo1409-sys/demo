import type { CSSProperties, ReactElement } from "react";

export type ScaleTone = "ok" | "low" | "out" | "short";

export interface ScaleProps {
  /** How far the fill reaches, 0 to 1. */
  at: number;
  /** A second run of ticks after the first, in ink: what is held. */
  more?: number;
  /** A tall tick at this point: the minimum. */
  mark?: number;
  tone?: ScaleTone;
  width?: number | string;
  height?: number;
  label?: string;
  className?: string;
}

const percent = (n: number) => `${(Math.max(0, Math.min(1, n)) * 100).toFixed(1)}%`;

/** Every level in the product, read off one ruled scale, the way a caliper reads. */
export function Scale({ at, more, mark, tone = "ok", width, height, label, className }: ScaleProps): ReactElement {
  const style = {
    "--at": percent(at),
    "--more": more === undefined ? undefined : percent(more),
    "--mark": mark === undefined ? undefined : percent(mark),
    "--w": typeof width === "number" ? `${width}px` : width,
    "--h": height === undefined ? undefined : `${height}px`,
  } as CSSProperties;
  const cls = ["ml-scale", tone !== "ok" && `is-${tone}`, more !== undefined && "is-held", className].filter(Boolean).join(" ");
  return (
    <span className={cls} style={style} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <i />
      {more !== undefined ? <i /> : null}
      {mark !== undefined ? <b /> : null}
    </span>
  );
}

/** A product's level: the middle of the scale is its minimum, so what stands short of the tall tick reads at once. */
export function stockScale(free: number, min: number): { at: number; mark: number } {
  return { at: free / Math.max(1, min * 2), mark: 0.5 };
}
