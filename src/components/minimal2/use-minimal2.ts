"use client";

import { useEffect, useReducer } from "react";
import { MINIMAL2_ATTR, splitTheme, useTheme } from "@/lib/theme";
import type { Minimal2Shell } from "./Shell";

type Shell = typeof Minimal2Shell;

let shell: Shell | null = null;

/**
 * The whole style behind one import(), stylesheets included, so no other style, the worker's phone or the catalogue
 * ever downloads it. Everything it styles stands under html[data-minimal2].
 */
export const loadMinimal2 = (): Promise<Shell> => import("./Shell").then((module) => (shell = module.Minimal2Shell));

// The boot script has already set the mark, so this needn't wait for the session.
if (typeof document !== "undefined" && document.documentElement.hasAttribute(MINIMAL2_ATTR)) void loadMinimal2().catch(() => undefined);

/** מינימל 2: the aluminium look, the admin ordered by what a manager decides. See src/design/minimal2 and the brief. */
export function useMinimal2(): boolean {
  return splitTheme(useTheme().theme).style === "minimal2";
}

/**
 * The shell for this style: undefined until its code is here, null if it isn't this style or the code never came, and
 * the default shell takes over. Not React.lazy: a Suspense fallback holds the page back longer than the code does.
 */
export function useMinimal2Shell(on: boolean): Shell | null | undefined {
  const [failed, fail] = useReducer(() => true, false);
  const [, arrived] = useReducer((turn: number) => turn + 1, 0);
  const here = shell;

  // Asks what this render saw, not what is true now: the code may land between the render and this effect.
  useEffect(() => {
    if (on && !here) loadMinimal2().then(() => arrived(), () => fail());
  }, [on, here]);

  if (!on || failed) return null;
  return here ?? undefined;
}
