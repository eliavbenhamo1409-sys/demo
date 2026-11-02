"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { Trail } from "@/lib/map3d/trail";

interface TimeRulerProps {
  trail: Trail;
  /** Null: today, the live view. */
  at: number | null;
  onAt: (at: number | null) => void;
}

/** Past this share of the line the handle is back on today. */
const TODAY_EDGE = 0.995;
const PLAY_MS = 18_000;
const STEP_MIN_MS = 80;
const STEP_MAX_MS = 600;

/** One line under the map: a tick for every movement, a handle for the moment shown. */
export function TimeRuler({ trail, at, onAt }: TimeRulerProps) {
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const span = Math.max(1, trail.to - trail.from);
  const ticks = trail.ticks;

  const paths = useMemo(() => {
    const x = (t: number) => (((t - trail.from) / span) * 1000).toFixed(1);
    const line = (types: readonly string[]) =>
      ticks.filter((t) => types.includes(t.type)).map((t) => `M${x(t.at)} 0V10`).join("");
    return { in: line(["in"]), out: line(["out"]), rest: line(["adjust", "fault"]) };
  }, [ticks, trail.from, span]);

  const moveTo = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    onAt(share >= TODAY_EDGE ? null : trail.from + share * span);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setPlaying(false);
    moveTo(e.clientX);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const now = at ?? trail.to;
    let next: number | null | undefined;
    if (e.key === "ArrowLeft") next = ticks.findLast((t) => t.at < now)?.at ?? trail.from;
    else if (e.key === "ArrowRight") next = ticks.find((t) => t.at > now)?.at ?? null;
    else if (e.key === "Home") next = ticks[0]?.at ?? trail.from;
    else if (e.key === "End") next = null;
    if (next === undefined) return;
    e.preventDefault();
    setPlaying(false);
    onAt(next);
  };

  const step = useEffectEvent(() => {
    const next = ticks.find((t) => at === null || t.at > at);
    if (next) {
      onAt(next.at);
    } else {
      setPlaying(false);
      onAt(null);
    }
  });

  const stepMs = Math.min(STEP_MAX_MS, Math.max(STEP_MIN_MS, PLAY_MS / Math.max(1, ticks.length)));

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => step(), stepMs);
    return () => clearInterval(id);
  }, [playing, stepMs]);

  const share = at === null ? 1 : (at - trail.from) / span;
  const when = at === null ? null : fmtDateTime(new Date(at).toISOString());

  return (
    <div className="m3d-ruler" dir="ltr" role="group" aria-label="ציר הזמן">
      <Button variant="link" size="sm" onClick={() => setPlaying(!playing)}>
        {playing ? "עצירה" : "הפעלה"}
      </Button>
      <div ref={track} className="m3d-track" onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
        <svg className="m3d-ticks" viewBox="0 0 1000 10" preserveAspectRatio="none" aria-hidden="true">
          <path d={paths.rest} />
          <path className="is-in" d={paths.in} />
          <path className="is-out" d={paths.out} />
        </svg>
        <div
          className="m3d-handle"
          role="slider"
          tabIndex={0}
          aria-label="המועד המוצג"
          aria-valuemin={trail.from}
          aria-valuemax={trail.to}
          aria-valuenow={at ?? trail.to}
          aria-valuetext={when ?? "היום"}
          style={{ left: `${share * 100}%` }}
          onKeyDown={onKeyDown}
        />
        {when ? <span className="m3d-when" style={{ left: `${Math.min(92, Math.max(8, share * 100))}%` }}>{when}</span> : null}
      </div>
      {at === null ? (
        <span className="m3d-edge" dir="rtl">היום</span>
      ) : (
        <Button variant="link" size="sm" onClick={() => { setPlaying(false); onAt(null); }}>
          חזרה להיום
        </Button>
      )}
    </div>
  );
}
