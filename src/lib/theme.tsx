"use client";

/**
 * Appearance. Three styles, each in light or dark:
 *   classic — graphite ink on warm paper, the original language;
 *   minimal — neutral white or near-black, hairlines, one green, numbers in a monospace;
 *   bokeh — the control room: violet on lavender, cards standing off out-of-focus light, charts of the past year;
 *   merhav — the warehouse is the interface: one live model under the whole admin, plates sliding over it (admin only);
 *   merhav2 — מרחב 2: the same world and door, cut down to five areas (admin only);
 *   merhav3 — מרחב 3: מרחב 2 with the overview as mission control and the model as a lens (admin only);
 *   atlas — ATLAS 2028 (label מרחב 4): the industrial clarity system, a shell of its own on the same live model (admin only).
 * מרחב 2 and מרחב 3 are painted as מרחב: the document carries מרחב's id and a mark (data-merhav2 / data-merhav3), so every
 * rule of מרחב applies and each adds its own under its mark. Their stored ids are their own, so a saved choice is its own.
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

export type ThemeId = "light" | "dark" | "minimal" | "minimal-dark" | "minimal-bokeh" | "minimal-bokeh-dark" | "merhav" | "merhav-dark" | "merhav2" | "merhav2-dark" | "merhav3" | "merhav3-dark" | "atlas" | "atlas-dark";
export type ThemeStyle = "classic" | "minimal" | "bokeh" | "merhav" | "merhav2" | "merhav3" | "atlas";
export type ThemeMode = "light" | "dark";

export const THEME_STYLES: readonly { id: ThemeStyle; label: string }[] = [
  { id: "classic", label: "קלאסי" },
  { id: "minimal", label: "מינימל" },
  { id: "bokeh", label: "בוקה" },
  { id: "merhav", label: "מרחב" },
  { id: "merhav2", label: "מרחב 2" },
  { id: "merhav3", label: "מרחב 3" },
  { id: "atlas", label: "מרחב 4" },
] as const;

export const THEME_MODES: readonly { id: ThemeMode; label: string }[] = [
  { id: "light", label: "בהיר" },
  { id: "dark", label: "כהה" },
] as const;

export const THEME_STORAGE_KEY = "sa-theme";
export const DEFAULT_THEME: ThemeId = "minimal";

/** The marks that tell מרחב 2 and מרחב 3 from מרחב on the document. */
export const MERHAV2_ATTR = "data-merhav2";
export const MERHAV3_ATTR = "data-merhav3";

/** The id is style and mode in one word; these take it apart and put it back together. */
export function splitTheme(id: ThemeId): { style: ThemeStyle; mode: ThemeMode } {
  return {
    style:
      id === "merhav" || id === "merhav-dark" ? "merhav"
      : id === "merhav2" || id === "merhav2-dark" ? "merhav2"
      : id === "merhav3" || id === "merhav3-dark" ? "merhav3"
      : id === "atlas" || id === "atlas-dark" ? "atlas"
      : id === "minimal-bokeh" || id === "minimal-bokeh-dark" ? "bokeh"
      : id === "minimal" || id === "minimal-dark" ? "minimal"
      : "classic",
    mode: id === "dark" || id === "minimal-dark" || id === "minimal-bokeh-dark" || id === "merhav-dark" || id === "merhav2-dark" || id === "merhav3-dark" || id === "atlas-dark" ? "dark" : "light",
  };
}

export function joinTheme(style: ThemeStyle, mode: ThemeMode): ThemeId {
  if (style === "merhav") return mode === "dark" ? "merhav-dark" : "merhav";
  if (style === "merhav2") return mode === "dark" ? "merhav2-dark" : "merhav2";
  if (style === "merhav3") return mode === "dark" ? "merhav3-dark" : "merhav3";
  if (style === "atlas") return mode === "dark" ? "atlas-dark" : "atlas";
  if (style === "bokeh") return mode === "dark" ? "minimal-bokeh-dark" : "minimal-bokeh";
  if (style === "minimal") return mode === "dark" ? "minimal-dark" : "minimal";
  return mode;
}

function resolve(v: string | null): ThemeId {
  if (v === "dark" || v === "modern-dark") return "dark";
  if (v === "light" || v === "classic" || v === "modern") return "light";
  if (v === "minimal-dark" || v === "minimal-bokeh" || v === "minimal-bokeh-dark" || v === "merhav" || v === "merhav-dark" || v === "merhav2" || v === "merhav2-dark" || v === "merhav3" || v === "merhav3-dark" || v === "atlas" || v === "atlas-dark") return v;
  return DEFAULT_THEME;
}

const OTHER_SYSTEM = /^\/(worker|catalog)(\/|$)/;

/** Merhav and its variants are the admin's alone: the worker and the catalogue keep the default style, in the same light or dark. On the admin a variant wears מרחב's id. */
function painted(id: ThemeId, pathname: string): ThemeId {
  const { style, mode } = splitTheme(id);
  if (OTHER_SYSTEM.test(pathname)) return style === "merhav" || style === "merhav2" || style === "merhav3" || style === "atlas" ? joinTheme("minimal", mode) : id;
  return style === "merhav2" || style === "merhav3" ? joinTheme("merhav", mode) : id;
}

/** Which mark the document carries for this choice: a variant's own, none for everything else and on the other two systems. */
function markOf(id: ThemeId, pathname: string): string | null {
  if (OTHER_SYSTEM.test(pathname)) return null;
  const { style } = splitTheme(id);
  return style === "merhav2" ? MERHAV2_ATTR : style === "merhav3" ? MERHAV3_ATTR : null;
}

function mark(root: HTMLElement, id: ThemeId, pathname: string): void {
  const attr = markOf(id, pathname);
  root.toggleAttribute(MERHAV2_ATTR, attr === MERHAV2_ATTR);
  root.toggleAttribute(MERHAV3_ATTR, attr === MERHAV3_ATTR);
}

/** Runs before hydration; keep it tiny and self-contained (no imports). Mirrors resolve(). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var v=t==="dark"||t==="modern-dark"?"dark":t==="light"||t==="classic"||t==="modern"?"light":t==="minimal-dark"||t==="minimal-bokeh"||t==="minimal-bokeh-dark"||t==="merhav"||t==="merhav-dark"||t==="merhav2"||t==="merhav2-dark"||t==="merhav3"||t==="merhav3-dark"||t==="atlas"||t==="atlas-dark"?t:${JSON.stringify(DEFAULT_THEME)};var w=/^\\/(worker|catalog)(\\/|$)/.test(location.pathname);var m=/^merhav(2|3)?(-dark)?$/.exec(v);var d=v.slice(-5)==="-dark";if(w&&(m||v==="atlas"||v==="atlas-dark"))v=d?"minimal-dark":"minimal";else if(m&&m[1])v=d?"merhav-dark":"merhav";var r=document.documentElement;r.setAttribute("data-theme",v);if(!w&&m&&m[1]==="2")r.setAttribute(${JSON.stringify(MERHAV2_ATTR)},"");if(!w&&m&&m[1]==="3")r.setAttribute(${JSON.stringify(MERHAV3_ATTR)},"");}catch(e){}})();`;

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
    mark(root, theme, pathname);
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
    mark(document.documentElement, id, window.location.pathname);
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
