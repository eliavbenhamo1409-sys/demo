"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, type ButtonProps } from "./Button";
import { Icon, type IconName } from "./Icon";

export interface ActionItem {
  key: string;
  label: string;
  icon?: IconName;
  /** The next item starts another group, so a rule falls under this one. */
  endsGroup?: boolean;
}

export interface ActionMenuProps {
  actions?: ActionItem[];
  onSelect?: (key: string) => void;
  label?: string;
  variant?: ButtonProps["variant"];
  /** Leads the button and replaces its chevron. */
  icon?: IconName;
  open?: boolean;
  defaultOpen?: boolean;
  inline?: boolean;
  activeIndex?: number;
  className?: string;
}

export const DEFAULT_ACTIONS: ActionItem[] = [
  { key: "receive", label: "קליטת סחורה", icon: "arrow-down-left" },
  { key: "issue", label: "הוצאת סחורה", icon: "arrow-up-right" },
  { key: "fault", label: "דיווח תקלה", icon: "tool", endsGroup: true },
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
  icon,
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
        icon={icon}
        iconEnd={icon ? undefined : "chevron-down"}
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
                className={cx("sa-menu-item", i === active && "is-active", a.endsGroup && i < actions.length - 1 && "ends-group")}
                onMouseEnter={() => setActive(i)}
                onClick={() => select(a.key)}
              >
                {a.icon ? <Icon name={a.icon} size={16} /> : null}
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
