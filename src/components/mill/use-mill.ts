"use client";

import { useEffect, useLayoutEffect } from "react";
import { splitTheme, useTheme } from "@/lib/theme";

/** The third style in the settings dialog. Its id stays "bokeh" so a saved choice stays; its language is Mill. */
export function useMill(): boolean {
  return splitTheme(useTheme().theme).style === "bokeh";
}

const HOUR = 3_600_000;

/** Where the light stands at this hour: -1 in the morning, 1 toward evening, 0 at one in the afternoon. */
function sunAt(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60;
  return Math.max(-1, Math.min(1, (hours - 13) / 6));
}

/** Marks the page as Mill's, so its rules run on the admin alone, and lets every shadow in it fall the way the day's light falls. */
export function useMillSurface(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-mill", "");
    return () => root.removeAttribute("data-mill");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const place = () => root.style.setProperty("--sun-x", sunAt(new Date()).toFixed(2));
    place();
    const timer = setInterval(place, HOUR / 6);
    return () => {
      clearInterval(timer);
      root.style.removeProperty("--sun-x");
    };
  }, []);
}
