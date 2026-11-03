"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useData } from "@/lib/store";
import { isToday } from "@/lib/format";

/** Often enough to stay true, seldom enough not to flicker in the corner of the eye. */
const TICK_MS = 5_000;

function fmtAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return "עכשיו";
  if (seconds < 60) return `לפני ${seconds} שניות`;
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? "לפני דקה" : `לפני ${minutes} דקות`;
}

/** That the screen is live, in real facts: when the store last heard something and who worked today. Offline it says only that. */
export function LiveStatus(): ReactElement | null {
  const { state } = useData();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const workers = useMemo(() => new Set(state.movements.filter((m) => m.worker_id && isToday(m.created_at)).map((m) => m.worker_id)).size, [state.movements]);

  if (!state.live) return <span className="app-live" role="status" aria-live="polite">מתחבר</span>;
  if (state.heardAt === null) return null;
  return (
    <span className="app-pulse">
      <i className="sa-dot sa-dot-success" aria-hidden="true" />
      עודכן {fmtAgo(Math.max(0, now - state.heardAt))}
      {workers > 0 ? <span className="app-pulse-more"> · {workers === 1 ? "עובד אחד פעיל היום" : `${workers} עובדים פעילים היום`}</span> : null}
    </span>
  );
}
