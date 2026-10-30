"use client";

import type * as React from "react";
import type { IconName } from "./Icon";
import { Avatar } from "./Avatar";
import { NavItem } from "./NavItem";

export interface SidebarItem {
  key: string;
  label: string;
  icon?: IconName;
  count?: number;
  href?: string;
}

export interface SidebarProps {
  items?: SidebarItem[];
  active?: string;
  onNavigate?: (key: string) => void;
  brand?: string;
  brandSub?: string;
  mark?: React.ReactNode;
  user?: { name: string; role?: string };
  onSignOut?: (e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const DEFAULT_SIDEBAR_ITEMS: SidebarItem[] = [
  { key: "overview", label: "סקירה", icon: "grid", href: "/" },
  { key: "inventory", label: "מלאי", icon: "package", href: "/inventory" },
  { key: "suppliers", label: "מילון ספקים", icon: "book-open", href: "/suppliers" },
];

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The fixed side navigation: brand, three destinations, user, sign out. */
export function Sidebar({
  items = DEFAULT_SIDEBAR_ITEMS,
  active,
  onNavigate,
  brand = "Super Admin",
  brandSub,
  mark,
  user,
  onSignOut,
  className,
  style,
}: SidebarProps) {
  return (
    <aside className={cx("sa-sidebar", className)} style={style}>
      <div className="sa-brand">
        <span className="sa-brand-mark" aria-hidden>
          {mark ?? "SA"}
        </span>
        <span>
          {brand}
          {brandSub ? <span className="sa-brand-sub block">{brandSub}</span> : null}
        </span>
      </div>
      <nav className="sa-nav" aria-label="ניווט ראשי">
        {items.map((it) => (
          <NavItem
            key={it.key}
            icon={it.icon}
            active={it.key === active}
            count={it.count}
            href={it.href}
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
      <div className="sa-nav-foot">
        {user ? (
          <div className="sa-user">
            <Avatar name={user.name} />
            <div className="min-w-0">
              <div className="sa-user-name">{user.name}</div>
              {user.role ? <div className="sa-user-role">{user.role}</div> : null}
            </div>
          </div>
        ) : null}
        {onSignOut ? (
          <NavItem icon="log-out" onClick={onSignOut}>
            יציאה
          </NavItem>
        ) : null}
      </div>
    </aside>
  );
}
