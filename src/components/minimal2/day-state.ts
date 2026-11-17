"use client";

/**
 * Whether today has been closed and signed, for the rail: the one fact about the day that is not in the store.
 * Read once when the shell arrives; the closing page tells it the moment a signature lands, so the rail never lags
 * behind a press made on this screen. Unknown (no answer, or no right to ask) stays unknown and the rail says nothing.
 */
import { useEffect, useSyncExternalStore } from "react";
import { israelToday } from "@/lib/day-closing";
import { supabase } from "@/lib/supabase/client";

type Known = { day: string; signed: boolean };

let known: Known | null = null;
let asked: string | null = null;
const listeners = new Set<() => void>();

function set(next: Known): void {
  known = next;
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Called by the closing page when a day is signed. */
export function markDaySigned(day: string): void {
  if (day === israelToday()) set({ day, signed: true });
}

/** True once today is signed, false while it is open, null while that isn't known. */
export function useTodaySigned(): boolean | null {
  const today = israelToday();
  const state = useSyncExternalStore(subscribe, () => known, () => null);

  useEffect(() => {
    if (asked === today) return;
    asked = today;
    void supabase().from("day_signoffs").select("day").eq("day", today).maybeSingle().then(({ data, error }) => {
      if (!error) set({ day: today, signed: data !== null });
    });
  }, [today]);

  return state?.day === today ? state.signed : null;
}
