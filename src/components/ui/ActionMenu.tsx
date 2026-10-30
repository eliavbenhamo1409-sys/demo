"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { IconName, Tone } from "./Icon";
import { Button, type ButtonProps } from "./Button";
import { Mark } from "./Mark";

export interface ActionItem {
  key: string;
  label: string;
  sub?: string;
  icon: IconName;
  tone?: Tone;
}

export interface ActionMenuProps {
  actions?: ActionItem[];
  onSelect?: (key: string) => void;
  label?: string;
  variant?: ButtonProps["variant"];
  open?: boolean;
  defaultOpen?: boolean;
  inline?: boolean;
  activeIndex?: number;
  className?: string;
}

export const DEFAULT_ACTIONS: ActionItem[] = [
  { key: "receive", label: "קליטת סחורה", sub: "כניסה למלאי מספק", icon: "arrow-down-left", tone: "success" },
  { key: "issue", label: "הוצאת סחורה", sub: "יציאה לייצור או ללקוח", icon: "arrow-up-right", tone: "accent" },
  { key: "fault", label: "דיווח תקלה", sub: "פריט פגום, חוסר או חריגה", icon: "alert-triangle", tone: "danger" },
];

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The main actions button + menu. Arrows move, Enter selects, Escape / click-outside closes. */
export function ActionMenu({
  actions = DEFAULT_ACTIONS,
  onSelect,
  label = "פעולות",
  variant = "primary",
  open: openProp,
  defaultOpen = false,
  inline,
  activeIndex: activeProp,
  className,
}: ActionMenuProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const [active, setActive] = useState<number>(activeProp ?? -1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next) setActive(-1);
    },
    [],
  );

  const select = useCallback(
    (key: string) => {
      setOpen(false);
      onSelect?.(key);
      triggerRef.current?.focus();
    },
    [onSelect, setOpen],
  );

  // click outside closes
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, setOpen]);

  // focus follows the active item
  useEffect(() => {
    if (open && active >= 0) itemRefs.current[active]?.focus();
  }, [open, active]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = actions.length;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        if (e.key === "Enter" || e.key === " ") return; // native button click handles toggling
        e.preventDefault();
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : n - 1);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i + 1) % n);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i <= 0 ? n - 1 : i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(n - 1);
        break;
      case "Enter":
      case " ":
        if (active >= 0) {
          e.preventDefault();
          select(actions[active].key);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className={cx("sa-actionmenu", className)} onKeyDown={onKeyDown}>
      <Button
        ref={triggerRef}
        variant={variant}
        icon="plus"
        iconEnd="chevron-down"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen(!open);
          if (!open) setActive(0);
        }}
      >
        {label}
      </Button>
      {open ? (
        <div id={menuId} className={cx("sa-menu", inline && "is-static")} role="menu" aria-label={label}>
          <div className="sa-menu-list">
            {actions.map((a, i) => (
              <button
                key={a.key}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={i === active || (active < 0 && i === 0) ? 0 : -1}
                className={cx("sa-menu-item", `is-${a.tone ?? "neutral"}`, i === active && "is-active")}
                onMouseEnter={() => setActive(i)}
                onClick={() => select(a.key)}
              >
                <Mark tone={a.tone ?? "neutral"} icon={a.icon} />
                <span>
                  {a.label}
                  {a.sub ? <span className="sa-menu-item-sub">{a.sub}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
