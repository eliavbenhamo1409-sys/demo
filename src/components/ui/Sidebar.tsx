"use client";

import type * as React from "react";
import type { IconName } from "./Icon";
import { NavItem } from "./NavItem";

export interface SidebarItem {
  key: string;
  label: string;
  count?: number;
  href?: string;
  icon?: IconName;
}

export interface SidebarProps {
  items?: SidebarItem[];
  active?: string;
  onNavigate?: (key: string) => void;
  brand?: string;
  /** Extra rows at the bottom of the sidebar (e.g. settings). */
  foot?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const DEFAULT_SIDEBAR_ITEMS: SidebarItem[] = [
  { key: "overview", label: "סקירה", href: "/" },
  { key: "inventory", label: "מלאי", href: "/inventory" },
  { key: "suppliers", label: "מילון ספקים", href: "/suppliers" },
];

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The fixed side navigation: the name, the destinations, settings. */
export function Sidebar({
  items = DEFAULT_SIDEBAR_ITEMS,
  active,
  onNavigate,
  brand = "ניהול מלאי",
  foot,
  className,
  style,
}: SidebarProps) {
  return (
    <aside className={cx("sa-sidebar", className)} style={style}>
      <div className="sa-brand">{brand}</div>
      <nav className="sa-nav" aria-label="ניווט ראשי">
        {items.map((it) => (
          <NavItem
            key={it.key}
            active={it.key === active}
            count={it.count}
            href={it.href}
            icon={it.icon}
            onClick={
              onNavigate
                ? (e) => {
                    e.preventDefault();
                    onNavigate(it.key);
                  }
                : undefined
            }
          >
            {it.label}
          </NavItem>
        ))}
      </nav>
      {foot ? <div className="sa-nav-foot">{foot}</div> : null}
    </aside>
  );
}
