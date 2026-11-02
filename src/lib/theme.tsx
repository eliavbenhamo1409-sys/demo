"use client";

/**
 * Appearance. Three styles, each in light or dark:
 *   classic — graphite ink on warm paper, the original language;
 *   minimal — neutral white or near-black, hairlines, one green, numbers in a monospace;
 *   bokeh — the control room: violet on lavender, cards standing off out-of-focus light, charts of the past year;
 *   merhav — the warehouse is the interface: one live model under the whole admin, plates sliding over it (admin only).
 * The choice is one id ("light", "dark", "minimal", "minimal-dark", "minimal-bokeh", "minimal-bokeh-dark")
 * in localStorage ("sa-theme"), mirrored to <html data-theme="…">; a tiny inline script in the root
 * layout applies it before first paint so there is no flash.
 * Bokeh's ids start with "minimal" on purpose: every [data-theme^="minimal"] rule gives it the aluminium
 * shapes on all pages, and src/design/bokeh.css changes only what makes it bokeh.
 * Minimal is the default. A saved choice stays; older saved values ("classic", "modern",
 * "modern-dark") still resolve to the classic style they meant.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export type ThemeId = "light" | "dark" | "minimal" | "minimal-dark" | "minimal-bokeh" | "minimal-bokeh-dark" | "merhav" | "merhav-dark";
export type ThemeStyle = "classic" | "minimal" | "bokeh" | "merhav";
export type ThemeMode = "light" | "dark";

export const THEME_STYLES: readonly { id: ThemeStyle; label: string }[] = [
  { id: "classic", label: "קלאסי" },
  { id: "minimal", label: "מינימל" },
  { id: "bokeh", label: "בוקה" },
  { id: "merhav", label: "מרחב" },
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
    style: id === "merhav" || id === "merhav-dark" ? "merhav" : id === "minimal-bokeh" || id === "minimal-bokeh-dark" ? "bokeh" : id === "minimal" || id === "minimal-dark" ? "minimal" : "classic",
    mode: id === "dark" || id === "minimal-dark" || id === "minimal-bokeh-dark" || id === "merhav-dark" ? "dark" : "light",
  };
}

export function joinTheme(style: ThemeStyle, mode: ThemeMode): ThemeId {
  if (style === "merhav") return mode === "dark" ? "merhav-dark" : "merhav";
  if (style === "bokeh") return mode === "dark" ? "minimal-bokeh-dark" : "minimal-bokeh";
  if (style === "minimal") return mode === "dark" ? "minimal-dark" : "minimal";
  return mode;
}

function resolve(v: string | null): ThemeId {
  if (v === "dark" || v === "modern-dark") return "dark";
  if (v === "light" || v === "classic" || v === "modern") return "light";
  if (v === "minimal-dark" || v === "minimal-bokeh" || v === "minimal-bokeh-dark" || v === "merhav" || v === "merhav-dark") return v;
  return DEFAULT_THEME;
}

/** Merhav is the admin's alone: the worker and the catalogue keep the default style, in the same light or dark. */
function painted(id: ThemeId, pathname: string): ThemeId {
  if (!/^\/(worker|catalog)(\/|$)/.test(pathname)) return id;
  return id === "merhav-dark" ? "minimal-dark" : id === "merhav" ? "minimal" : id;
}

/** Runs before hydration; keep it tiny and self-contained (no imports). Mirrors resolve(). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var v=t==="dark"||t==="modern-dark"?"dark":t==="light"||t==="classic"||t==="modern"?"light":t==="minimal-dark"||t==="minimal-bokeh"||t==="minimal-bokeh-dark"||t==="merhav"||t==="merhav-dark"?t:${JSON.stringify(DEFAULT_THEME)};if(/^\\/(worker|catalog)(\\/|$)/.test(location.pathname)&&(v==="merhav"||v==="merhav-dark"))v=v==="merhav"?"minimal":"minimal-dark";document.documentElement.setAttribute("data-theme",v);}catch(e){}})();`;

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
  const pathname = usePathname();

  // Keep <html data-theme> in step with the store (the boot script did the first paint),
  // and the phone's status bar in step with the page.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", painted(theme, pathname));
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    meta.content = getComputedStyle(root).getPropertyValue("--bg-canvas").trim();
  }, [theme, pathname]);

  const setTheme = useCallback((id: ThemeId) => {
    document.documentElement.setAttribute("data-theme", painted(id, window.location.pathname));
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
