"use client";

/**
 * When the manager last looked, so the overview can open with what happened while they were away.
 * This browser notes the time once a minute while the admin is on screen. Coming back after half an hour or more
 * counts as a new visit, and the moment last noted becomes "since". A reload inside a visit keeps the same moment.
 */
import { useSyncExternalStore } from "react";

const SEEN_KEY = "mn2-seen";
const SINCE_KEY = "mn2-since";
const AWAY_MS = 30 * 60_000;
const BEAT_MS = 60_000;

let since: number | null = null;
let started = false;
const listeners = new Set<() => void>();

function readNumber(store: Storage, key: string): number | null {
  const value = Number(store.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function beat(): void {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // A browser without storage simply never has a "since".
  }
}

/** A return after long enough away moves "since" to when the screen was last seen. */
function arrive(): boolean {
  try {
    const last = readNumber(localStorage, SEEN_KEY);
    if (last === null || Date.now() - last < AWAY_MS) return false;
    since = last;
    sessionStorage.setItem(SINCE_KEY, String(last));
    return true;
  } catch {
    return false;
  }
}

function start(): void {
  if (started) return;
  started = true;
  if (!arrive()) {
    try {
      since = readNumber(sessionStorage, SINCE_KEY);
    } catch {
      since = null;
    }
  }
  beat();
  setInterval(() => {
    if (document.visibilityState === "visible") beat();
  }, BEAT_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const moved = arrive();
    beat();
    if (moved) for (const cb of listeners) cb();
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Starts the watch on the first read, in the browser only, so the first paint already has the answer. */
function snapshot(): number | null {
  start();
  return since;
}

/** The moment the manager was last here before this visit; null on a first visit. */
export function useLastVisit(): number | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
