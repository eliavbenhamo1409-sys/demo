"use client";

import { useCallback, useSyncExternalStore, type RefObject } from "react";

function mediaHook(query: string): () => boolean {
  const subscribe = (onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  };
  const read = () => window.matchMedia(query).matches;
  return function useMedia() {
    return useSyncExternalStore(subscribe, read, () => false);
  };
}

export const COARSE_POINTER = "(pointer: coarse)";
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export const useCoarsePointer = mediaHook(COARSE_POINTER);
export const useReducedMotion = mediaHook(REDUCED_MOTION);
export const useNarrow = mediaHook("(max-width: 899px)");

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

const neverChanges = () => () => {};

export function useFullscreen(target: RefObject<HTMLElement | null>) {
  const available = useSyncExternalStore(neverChanges, () => document.fullscreenEnabled, () => false);
  const active = useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement !== null, () => false);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target.current?.requestFullscreen();
  }, [target]);
  return { available, active, toggle };
}
