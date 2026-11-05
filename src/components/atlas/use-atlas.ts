"use client";

import { useEffect, useReducer } from "react";
import { splitTheme, useTheme } from "@/lib/theme";
import type { AtlasShell } from "./Shell";
import "@/design/atlas/first-paint.css";

type Shell = typeof AtlasShell;

let shell: Shell | null = null;

/**
 * The whole style behind one import(), stylesheets included. Anywhere else it reaches everyone: a static import would
 * put it on every route, worker and catalogue too, and pull its stylesheets ahead of the shell's in every style.
 */
export const loadAtlas = (): Promise<Shell> => import("./Shell").then((module) => (shell = module.AtlasShell));

// The boot script has already painted the id, so this needn't wait for the session.
if (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme")?.startsWith("atlas")) void loadAtlas().catch(() => undefined);

/** The admin's ATLAS 2028 style (מרחב 4 in the settings dialog). See src/design/atlas and the brief. */
export function useAtlas(): boolean {
  return splitTheme(useTheme().theme).style === "atlas";
}

/**
 * The shell for this style: undefined until its code is here, null if it isn't this style or the code never came, and
 * the default shell takes over. Not React.lazy: a Suspense fallback holds the page back longer than the code does.
 */
export function useAtlasShell(on: boolean): Shell | null | undefined {
  const [failed, fail] = useReducer(() => true, false);
  const [, arrived] = useReducer((turn: number) => turn + 1, 0);
  const here = shell;

  // Asks what this render saw, not what is true now: the code may land between the render and this effect.
  useEffect(() => {
    if (on && !here) loadAtlas().then(() => arrived(), () => fail());
  }, [on, here]);

  if (!on || failed) return null;
  return here ?? undefined;
}
