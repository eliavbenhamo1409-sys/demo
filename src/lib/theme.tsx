"use client";

/**
 * Appearance. Two styles, each in light or dark:
 *   classic — graphite ink on warm paper, the original language;
 *   minimal — neutral white or near-black, hairlines, one green, numbers in a monospace.
 * The choice is one id ("light", "dark", "minimal", "minimal-dark") in localStorage
 * ("sa-theme"), mirrored to <html data-theme="…">; a tiny inline script in the root
 * layout applies it before first paint so there is no flash.
 * Minimal is the default. A saved choice stays; older saved values ("classic", "modern",
 * "modern-dark") still resolve to the classic style they meant.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type ThemeId = "light" | "dark" | "minimal" | "minimal-dark";
export type ThemeStyle = "classic" | "minimal";
export type ThemeMode = "light" | "dark";

export const THEME_STYLES: readonly { id: ThemeStyle; label: string }[] = [
  { id: "classic", label: "קלאסי" },
  { id: "minimal", label: "מינימל" },
] as const;

export const THEME_MODES: readonly { id: ThemeMode; label: string }[] = [
  { id: "light", label: "בהיר" },
  { id: "dark", label: "כהה" },
] as const;

export const THEME_STORAGE_KEY = "sa-theme";
export const DEFAULT_THEME: ThemeId = "minimal";

/** The id is style and mode in one word; these take it apart and put it back together. */
export function splitTheme(id: ThemeId): { style: ThemeStyle; mode: ThemeMode } {
  return {
    style: id === "minimal" || id === "minimal-dark" ? "minimal" : "classic",
    mode: id === "dark" || id === "minimal-dark" ? "dark" : "light",
  };
}

export function joinTheme(style: ThemeStyle, mode: ThemeMode): ThemeId {
  if (style === "minimal") return mode === "dark" ? "minimal-dark" : "minimal";
  return mode;
}

function resolve(v: string | null): ThemeId {
  if (v === "dark" || v === "modern-dark") return "dark";
  if (v === "light" || v === "classic" || v === "modern") return "light";
  if (v === "minimal-dark") return v;
  return DEFAULT_THEME;
}

/** Runs before hydration; keep it tiny and self-contained (no imports). Mirrors resolve(). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.setAttribute("data-theme",t==="dark"||t==="modern-dark"?"dark":t==="light"||t==="classic"||t==="modern"?"light":t==="minimal-dark"?t:${JSON.stringify(DEFAULT_THEME)});}catch(e){}})();`;

/* ── A tiny external store over localStorage ─────────────────────────────── */
const listeners = new Set<() => void>();

function readStored(): ThemeId {
  try {
    return resolve(localStorage.getItem(THEME_STORAGE_KEY));
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

  // Keep <html data-theme> in step with the store (the boot script did the first paint),
  // and the phone's status bar in step with the page.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    meta.content = getComputedStyle(root).getPropertyValue("--bg-canvas").trim();
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    document.documentElement.setAttribute("data-theme", id);
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
