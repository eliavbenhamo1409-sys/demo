"use client";

import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Badge } from "./Badge";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface TabItem { value: string; label: ReactNode; count?: number; icon?: IconName }

export interface TabsProps {
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  variant?: "segmented" | "line";
  className?: string;
}

/** Segmented (default) or `line` tabs; `count` renders a Badge per tab. */
export function Tabs({ tabs, value: valueProp, defaultValue, onChange, variant = "segmented", className }: TabsProps): ReactElement {
  const [valueState, setValueState] = useState(defaultValue ?? tabs[0]?.value ?? "");
  const value = valueProp !== undefined ? valueProp : valueState;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const activate = (v: string, focusIdx?: number) => {
    setValueState(v);
    onChange?.(v);
    if (focusIdx !== undefined) refs.current[focusIdx]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!tabs.length) return;
    const idx = tabs.findIndex((t) => t.value === value);
    let next: number | null = null;
    // RTL document: ArrowLeft moves forward, ArrowRight moves back.
    const rtl = (e.currentTarget.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir) === "rtl";
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === fwd || e.key === "ArrowDown") next = (idx + 1) % tabs.length;
    else if (e.key === back || e.key === "ArrowUp") next = idx <= 0 ? tabs.length - 1 : idx - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      activate(tabs[next].value, next);
    }
  };

  return (
    <div className={cx("sa-tabs", variant === "line" && "sa-tabs-line", className)} role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cx("sa-tab", active && "is-active")}
            onClick={() => activate(t.value)}
          >
            {t.icon ? <Icon name={t.icon} size={14} /> : null}
            {t.label}
            {t.count != null ? (
              <Badge tone={active ? "inverse" : "neutral"} count>{String(t.count)}</Badge>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
