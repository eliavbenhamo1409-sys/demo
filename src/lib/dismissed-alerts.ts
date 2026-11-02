"use client";

/**
 * Stock alerts the manager removed from the overview. Stock is a fact, not a
 * record to close, so a removal only hides the row: it lives in this browser's
 * localStorage ("sa-dismissed-alerts") as { alertId: available when removed } and
 * the alert comes back by itself as soon as what is available changes.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "sa-dismissed-alerts";
const EMPTY = "{}";

const listeners = new Set<() => void>();

function readRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getServerSnapshot(): string {
  return EMPTY;
}

export function useDismissedAlerts() {
  const raw = useSyncExternalStore(subscribe, readRaw, getServerSnapshot);
  const dismissed = useMemo<Record<string, number>>(() => {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }, [raw]);

  const dismiss = useCallback(
    (id: string, qty: number) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...dismissed, [id]: qty }));
      } catch {
        /* private mode: nothing to remember the removal in */
      }
      listeners.forEach((l) => l());
    },
    [dismissed],
  );

  return { dismissed, dismiss };
}
