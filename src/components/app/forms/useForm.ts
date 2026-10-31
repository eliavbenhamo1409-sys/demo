"use client";

/**
 * Tiny shared helpers for the action forms: async submit state, error text,
 * field-error map, number parsing and Cmd/Ctrl+Enter submit.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

export const REQUIRED = "שדה חובה";

export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "הפעולה נכשלה";
}

/** Postgres FK violation → friendly Hebrew. */
export function friendlyDeleteError(e: unknown, fallback: string): string {
  const msg = errorMessage(e);
  if (/foreign key|violates|23503/i.test(msg)) return fallback;
  return msg;
}

/** "12", "12.5", "12,5" → number; anything else → NaN. */
export function parseNum(raw: string): number {
  const s = raw.trim().replace(",", ".");
  if (s === "") return Number.NaN;
  return Number(s);
}

export function useForm<F extends string = string>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<F, string>>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Runs an async action, capturing a thrown error into `error`. Returns true on success. */
  const run = useCallback(async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  const clearField = useCallback((field: F) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  return { busy, error, setError, errors, setErrors, clearField, run };
}

/** Cmd/Ctrl+Enter anywhere in the form submits it. */
export function submitOnModEnter(e: KeyboardEvent<HTMLElement>) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.closest("form")?.requestSubmit();
  }
}

/** Plain Enter (no Shift) in a textarea/last field submits the enclosing form. */
export function submitOnEnter(e: KeyboardEvent<HTMLElement>) {
  if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    e.currentTarget.closest("form")?.requestSubmit();
  }
}

/** Focuses the first focusable control inside the referenced element on mount. */
export function useAutofocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const first =
      root.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ??
      root.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), button.sa-select-trigger:not([disabled])',
      );
    const t = window.setTimeout(() => first?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);
  return ref;
}
