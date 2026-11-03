"use client";

import { Fragment } from "react";
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

/** A word over some of the rows, so the rail reads as chapters, not a list. */
export interface SidebarGroup {
  label: string;
  /** The rows' keys, in the order they stand under the word. */
  keys: string[];
}

export interface SidebarProps {
  items?: SidebarItem[];
  /** Given, the rows stand under these words in this order; a row no group names follows at the end. */
  groups?: SidebarGroup[];
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
  { key: "suppliers", label: "ספקים", href: "/suppliers" },
];

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The fixed side navigation: the name, the destinations, settings. */
export function Sidebar({
  items = DEFAULT_SIDEBAR_ITEMS,
  groups,
  active,
  onNavigate,
  brand = "ניהול מלאי",
  foot,
  className,
  style,
}: SidebarProps) {
  const row = (it: SidebarItem) => (
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
  );
  const chapters = groups?.map((g) => ({ label: g.label, items: g.keys.map((k) => items.find((it) => it.key === k)).filter((it): it is SidebarItem => it !== undefined) }));
  const rest = groups ? items.filter((it) => !groups.some((g) => g.keys.includes(it.key))) : items;
  return (
    <aside className={cx("sa-sidebar", className)} style={style}>
      <div className="sa-brand">{brand}</div>
      <nav className="sa-nav" aria-label="ניווט ראשי">
        {chapters?.map((g) => (
          <Fragment key={g.label}>
            <div className="sa-nav-group">{g.label}</div>
            {g.items.map(row)}
          </Fragment>
        ))}
        {rest.map(row)}
      </nav>
      {foot ? <div className="sa-nav-foot">{foot}</div> : null}
    </aside>
  );
}
