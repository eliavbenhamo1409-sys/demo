"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

const KEY = "mh-dock";
const MIN = 280;
const STEP = 40;
/** The list keeps at least this much beside the model. */
const LIST = 620;
const WIDE = "(min-width: 1100px)";

const value = (px: number) => `min(${Math.round(px)}px, calc(100vw - var(--mh-rail) - ${LIST}px))`;
const root = () => document.documentElement;

/** The door's edge can be taken by hand: more of the model, or more of the list. The model re-centres when it lets go, and this browser remembers. */
export function DoorHandle(): ReactElement {
  const [held, setHeld] = useState(false);
  const left = useRef(0);

  useEffect(() => {
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(KEY));
    } catch {
      /* private mode: the door stands where it stands */
    }
    if (saved && window.matchMedia(WIDE).matches) root().style.setProperty("--mh-dock", value(saved));
    return () => {
      root().style.removeProperty("--mh-dock");
    };
  }, []);

  useEffect(() => {
    const app = document.querySelector(".mh-app");
    app?.toggleAttribute("data-door-held", held);
  }, [held]);

  const write = useCallback((px: number) => {
    const most = window.innerWidth - parseFloat(getComputedStyle(root()).getPropertyValue("--mh-rail")) - LIST;
    left.current = Math.max(MIN, Math.min(px, most));
    root().style.setProperty("--mh-dock", value(left.current));
  }, []);

  const settle = useCallback(() => {
    try {
      localStorage.setItem(KEY, String(Math.round(left.current)));
    } catch {
      /* private mode: it holds for this page only */
    }
    window.dispatchEvent(new Event("resize"));
  }, []);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setHeld(true);
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (held) write(e.clientX);
  };

  const onUp = () => {
    if (!held) return;
    setHeld(false);
    settle();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    write(e.currentTarget.getBoundingClientRect().left + 6 + (e.key === "ArrowRight" ? STEP : -STEP));
    settle();
  };

  return (
    <div
      className="mh-door-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="גודל המודל מול הרשימה"
      tabIndex={0}
      data-held={held || undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
    />
  );
}
