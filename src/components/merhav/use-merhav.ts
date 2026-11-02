"use client";

import { splitTheme, useTheme } from "@/lib/theme";

/** The admin's fourth style. See src/design/merhav and the brief. */
export function useMerhav(): boolean {
  return splitTheme(useTheme().theme).style === "merhav";
}
