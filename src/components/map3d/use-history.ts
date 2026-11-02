"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isTempId, RECENT_MOVEMENTS, useData, type Movement } from "@/lib/store";

export interface MovementHistory {
  /** Newest first, deduped, with the store's live rows on top of what came from the database. */
  rows: Movement[];
  ready: boolean;
  failed: boolean;
  retry: () => void;
}

/** Every movement since `from`, null meaning all of them. The store keeps only the latest rows, so a window past them is fetched. */
export function useMovementHistory(from: number | null, enabled: boolean): MovementHistory {
  const { state, fetchMovements } = useData();
  const [older, setOlder] = useState<Movement[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const oldest = state.movements[state.movements.length - 1];
  const complete = state.movements.length < RECENT_MOVEMENTS || (from !== null && from >= Date.parse(oldest.created_at));

  useEffect(() => {
    if (complete || !enabled) return;
    let current = true;
    fetchMovements(from, null).then(
      (rows) => {
        if (!current) return;
        setOlder(rows);
        setFailed(false);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [complete, enabled, from, attempt, fetchMovements]);

  const fetched = complete ? null : older;

  const rows = useMemo(() => {
    const byId = new Map<string, Movement>();
    for (const m of fetched ?? []) byId.set(m.id, m);
    for (const m of state.movements) {
      if (!isTempId(m.id) && (from === null || Date.parse(m.created_at) >= from)) byId.set(m.id, m);
    }
    return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id));
  }, [fetched, state.movements, from]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  return { rows, ready: complete || fetched !== null, failed: !complete && failed, retry };
}
