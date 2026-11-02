"use client";

import { useRef, type KeyboardEvent } from "react";
import { cx } from "@/components/ui";
import type { ViewMode } from "@/lib/map3d/types";

const VIEWS: readonly { id: ViewMode; label: string }[] = [
  { id: "orbit", label: "חופשי" },
  { id: "top", label: "מבט על" },
  { id: "walk", label: "סיור" },
];

interface ViewSwitchProps {
  view: ViewMode;
  /** Walking needs a keyboard, so a touch screen doesn't get it. */
  walk: boolean;
  onView: (view: ViewMode) => void;
}

export function ViewSwitch({ view, walk, onView }: ViewSwitchProps) {
  const group = useRef<HTMLDivElement>(null);
  const views = walk ? VIEWS : VIEWS.filter((v) => v.id !== "walk");

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowLeft" ? 1 : views.length - 1)) % views.length;
    onView(views[next].id);
    group.current?.querySelectorAll("button")[next]?.focus();
  };

  return (
    <div ref={group} className="sa-appearance-opts" role="radiogroup" aria-label="מבט">
      {views.map((v, i) => {
        const active = v.id === view;
        return (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={cx("sa-appearance-opt", active && "is-active")}
            onClick={() => onView(v.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
