"use client";

import Link from "next/link";
import type { CSSProperties, PointerEvent, ReactElement, ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui";
import { CountUp } from "@/components/app/Viz";
import { fmtShort } from "@/lib/control-room";
import { hue, Spark, type Hue } from "./Charts";

/** How far a card leans toward the pointer. Enough to feel the slab, never enough to read it askew. */
const TILT_DEG = 5;

/** The card leans toward a mouse and its light follows. A finger gets none of this, and reduced motion turns it off in the CSS. */
export function tilt(e: PointerEvent<HTMLElement>, degrees = TILT_DEG) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const box = el.getBoundingClientRect();
  const x = (e.clientX - box.left) / box.width - 0.5;
  const y = (e.clientY - box.top) / box.height - 0.5;
  el.style.setProperty("--rx", `${(-y * degrees).toFixed(2)}deg`);
  el.style.setProperty("--ry", `${(x * degrees).toFixed(2)}deg`);
  el.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
  el.style.setProperty("--my", `${((y + 0.5) * 100).toFixed(1)}%`);
}

export function level(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.style.removeProperty("--rx");
  el.style.removeProperty("--ry");
}

/** A sum of shekels that climbs when it arrives; past seven figures it takes the short form, or six tiles would not fit a row. */
export function Money({ value }: { value: number }): ReactElement {
  const whole = Math.round(value);
  return <span className="ltr"><span className="dash-cur">₪</span>{whole >= 10_000_000 ? fmtShort(whole) : <CountUp value={whole} />}</span>;
}

export interface TileProps {
  label: string;
  icon: IconName;
  hue: Hue;
  value: ReactNode;
  unit?: string;
  /** Percent against the window before. */
  delta?: number | null;
  /** Whether up is good. Left out, the change is only a fact and stays ink. */
  upIsGood?: boolean;
  note?: ReactNode;
  /** The figure's last year. */
  spark?: number[];
  href?: string;
}

/** One figure on a slab: what it is, how much, against what, and its last year in a line. */
export function Tile({ label, icon, hue: tone, value, unit, delta, upIsGood, note, spark, href }: TileProps): ReactElement {
  const shown = delta ?? null;
  const dir = shown === null || shown === 0 ? "flat" : shown > 0 ? "up" : "down";
  const mood = upIsGood === undefined || dir === "flat" ? "is-flat" : (dir === "up") === upIsGood ? "is-good" : "is-bad";
  const body = (
    <>
      <span className="dash-tile-label"><Icon name={icon} size={18} />{label}</span>
      <span className="dash-tile-value"><span>{value}</span>{unit ? <span className="dash-tile-unit">{unit}</span> : null}</span>
      <span className="dash-tile-foot">
        {shown !== null ? (
          <span className={`dash-delta ${mood}`}>
            {dir !== "flat" ? <Icon name={dir === "up" ? "arrow-up" : "arrow-down"} size={14} /> : null}
            <span className="ltr">{Math.abs(shown)}%</span>
          </span>
        ) : null}
        {note ? <span className="dash-tile-note">{note}</span> : null}
      </span>
      {spark ? <Spark values={spark} hue={tone} label={`${label}, 12 תקופות אחרונות`} /> : null}
    </>
  );
  const style = { "--tone": hue(tone) } as CSSProperties;
  return href ? (
    <Link href={href} className="dash-tile" style={style} onPointerMove={tilt} onPointerLeave={level}>{body}</Link>
  ) : (
    <div className="dash-tile" style={style} onPointerMove={tilt} onPointerLeave={level}>{body}</div>
  );
}

export function TileSkeleton(): ReactElement {
  return <div className="dash-tile is-empty" aria-hidden="true"><span className="sa-skeleton" /><span className="sa-skeleton" /></div>;
}
