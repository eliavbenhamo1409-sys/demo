"use client";

import { useEffect, useReducer } from "react";
import { splitTheme, useTheme } from "@/lib/theme";
import type { MerhavShell } from "./Shell";
import "@/design/merhav/first-paint.css";

type Shell = typeof MerhavShell;

let shell: Shell | null = null;

/**
 * The whole style behind one import(), stylesheets included. Anywhere else it reaches everyone: a static import would
 * put it on every route, worker and catalogue too, and pull page stylesheets ahead of the shell's, in every style.
 */
export const loadMerhav = (): Promise<Shell> => import("./Shell").then((module) => (shell = module.MerhavShell));

// The boot script has already painted the id, so this needn't wait for the session. The login stands on these stylesheets too.
if (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme")?.startsWith("merhav")) void loadMerhav().catch(() => undefined);

/** The admin's fourth style, and its fifth, which stands on the same shell. See src/design/merhav and the brief. */
export function useMerhav(): boolean {
  const { style } = splitTheme(useTheme().theme);
  return style === "merhav" || style === "merhav2";
}

/** Which of the two: מרחב with its eight rows, or מרחב 2 with its five areas. */
export function useMerhavVariant(): "merhav" | "merhav2" {
  return splitTheme(useTheme().theme).style === "merhav2" ? "merhav2" : "merhav";
}

/**
 * The shell for this style: undefined until its code is here, null if it isn't this style or the code never came, and
 * the default shell takes over. Not React.lazy: a Suspense fallback holds the page back 300ms longer than the code does.
 */
export function useMerhavShell(on: boolean): Shell | null | undefined {
  const [failed, fail] = useReducer(() => true, false);
  const [, arrived] = useReducer((turn: number) => turn + 1, 0);
  const here = shell;

  // Asks what this render saw, not what is true now: the code may land between the render and this effect.
  useEffect(() => {
    if (on && !here) loadMerhav().then(() => arrived(), () => fail());
  }, [on, here]);

  if (!on || failed) return null;
  return here ?? undefined;
}
