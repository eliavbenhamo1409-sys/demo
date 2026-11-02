"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RECENT_MOVEMENTS, useData, type Movement } from "@/lib/store";

/** Local midnight, `offset` days from `day`. */
export function midnight(offset = 0, day = new Date()): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset).getTime();
}

/** Every movement in the range, newest first: the store's live rows on top of whatever had to come from the database. */
export function useMovementsInRange(from: number | null, to: number | null) {
  const { state, fetchMovements } = useData();
  const [older, setOlder] = useState<{ key: string; rows: Movement[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const key = `${from}|${to}`;
  const oldest = state.movements[state.movements.length - 1];
  const complete = state.movements.length < RECENT_MOVEMENTS || (from !== null && from >= Date.parse(oldest.created_at));

  useEffect(() => {
    if (complete) return;
    let current = true;
    fetchMovements(from, to).then(
      (rows) => {
        if (current) setOlder({ key, rows });
      },
      () => {
        if (current) setFailedKey(key);
      },
    );
    return () => {
      current = false;
    };
  }, [complete, key, from, to, attempt, fetchMovements]);

  const fetched = !complete && older?.key === key ? older.rows : null;

  const rows = useMemo(() => {
    const byId = new Map<string, Movement>();
    for (const m of fetched ?? []) byId.set(m.id, m);
    for (const m of state.movements) {
      const t = Date.parse(m.created_at);
      if ((from === null || t >= from) && (to === null || t < to)) byId.set(m.id, m);
    }
    return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [fetched, state.movements, from, to]);

  const failed = !complete && !fetched && failedKey === key;
  const retry = useCallback(() => {
    setFailedKey(null);
    setAttempt((n) => n + 1);
  }, []);

  return { rows, isLoading: !complete && !fetched && !failed, failed, retry };
}
