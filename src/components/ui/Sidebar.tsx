"use client";

import { Fragment, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import type * as React from "react";
import { Icon, type IconName } from "./Icon";
import { NavItem } from "./NavItem";

export interface SidebarItem {
  key: string;
  label: string;
  count?: number;
  href?: string;
  icon?: IconName;
}

/** A word over some of the rows, so the rail reads as chapters, not a list. Each chapter folds under its word. */
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

/* ───── Which chapters are folded. This browser remembers their words ("sa-nav-folds"); everything stands open until someone folds it. ───── */
const FOLDS_KEY = "sa-nav-folds";
const NONE = "[]";
const listeners = new Set<() => void>();

function readFolds(): string {
  try {
    return localStorage.getItem(FOLDS_KEY) ?? NONE;
  } catch {
    return NONE;
  }
}

function writeFolds(labels: string[]) {
  try {
    if (labels.length) localStorage.setItem(FOLDS_KEY, JSON.stringify(labels));
    else localStorage.removeItem(FOLDS_KEY);
  } catch {
    // A browser without storage forgets on reload, and that is all.
  }
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function parseFolds(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
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

  /* ───── folds ───── */
  // The server and the first paint show every chapter open; the browser's memory lands during hydration, before anyone sees it.
  const raw = useSyncExternalStore(subscribe, readFolds, () => NONE);
  const folded = useMemo(() => parseFolds(raw), [raw]);
  // The chapter that holds the page you are on unfolds on arrival, so the row you are on is never out of sight. A hand can still fold it.
  const holder = groups?.find((g) => active !== undefined && g.keys.includes(active))?.label;
  const [arrived, setArrived] = useState(holder);
  const [seen, setSeen] = useState(active);
  if (active !== seen) {
    setSeen(active);
    setArrived(holder);
  }
  const isOpen = (label: string) => label === arrived || !folded.includes(label);
  const toggle = (label: string) => {
    const others = folded.filter((l) => l !== label);
    writeFolds(isOpen(label) ? [...others, label] : others);
    if (label === arrived) setArrived(undefined);
  };
  // No motion on the way in: the rows may move only once the first frame has been painted, by a hand.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const foldId = useId();

  return (
    <aside className={cx("sa-sidebar", className)} style={style}>
      <div className="sa-brand">{brand}</div>
      <nav className={cx("sa-nav", settled && "is-settled")} aria-label="ניווט ראשי">
        {chapters?.map((g, i) => {
          const open = isOpen(g.label);
          const id = `${foldId}-${i}`;
          return (
            <Fragment key={g.label}>
              <button type="button" className="sa-nav-group" aria-expanded={open} aria-controls={id} onClick={() => toggle(g.label)}>
                <span className="sa-truncate">{g.label}</span>
                <Icon name="chevron-down" size={14} className="sa-nav-group-chev" />
              </button>
              <div id={id} className={cx("sa-nav-fold", !open && "is-closed")}>
                <div className="sa-nav-fold-body">{g.items.map(row)}</div>
              </div>
            </Fragment>
          );
        })}
        {rest.map(row)}
      </nav>
      {foot ? <div className="sa-nav-foot">{foot}</div> : null}
    </aside>
  );
}
