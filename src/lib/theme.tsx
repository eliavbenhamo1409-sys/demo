"use client";

/**
 * Theme switching. The chosen theme lives in localStorage ("sa-theme") and is
 * mirrored to <html data-theme="…">; a tiny inline script in the root layout
 * applies it before first paint so there is no flash of the wrong skin.
 *
 *   classic      → data-theme="light"        (the original design, untouched)
 *   modern       → data-theme="modern"       (src/design/theme-modern.css)
 *   modern-dark  → data-theme="modern-dark"  (same skin, dark palette)
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type ThemeId = "classic" | "modern" | "modern-dark";

export interface ThemeMeta {
  id: ThemeId;
  /** data-theme attribute value. */
  attr: string;
  label: string;
  description: string;
}

export const THEMES: readonly ThemeMeta[] = [
  { id: "classic", attr: "light", label: "קלאסי", description: "העיצוב המקורי: דיו לפני צבע, קווים דקים ורווח נדיב." },
  { id: "modern", attr: "modern", label: "מודרני", description: "פינות רכות, משטחים מרחפים וצבע עדין למצבים." },
  { id: "modern-dark", attr: "modern-dark", label: "מודרני כהה", description: "אותו עיצוב מודרני על רקע כהה, נוח לעיניים בלילה." },
] as const;

export const THEME_STORAGE_KEY = "sa-theme";
export const DEFAULT_THEME: ThemeId = "classic";

const ATTR_BY_ID: Record<ThemeId, string> = { classic: "light", modern: "modern", "modern-dark": "modern-dark" };

export function isThemeId(v: unknown): v is ThemeId {
  return v === "classic" || v === "modern" || v === "modern-dark";
}

/** Runs before hydration; keep it tiny and self-contained (no imports). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var m={classic:"light",modern:"modern","modern-dark":"modern-dark"};document.documentElement.setAttribute("data-theme",m[t]||"light");}catch(e){}})();`;

/* ── A tiny external store over localStorage ─────────────────────────────── */
const listeners = new Set<() => void>();

function readStored(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === THEME_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot(): ThemeId {
  return DEFAULT_THEME;
}

function writeStored(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* private mode: the choice lives for this page only */
  }
  listeners.forEach((l) => l());
}

/* ── Context ─────────────────────────────────────────────────────────────── */
interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readStored, getServerSnapshot);

  // Keep <html data-theme> in step with the store (the boot script did the first paint).
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", ATTR_BY_ID[theme]);
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    // Apply to the DOM immediately so the switch feels instant, then persist + notify.
    document.documentElement.setAttribute("data-theme", ATTR_BY_ID[id]);
    writeStored(id);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
