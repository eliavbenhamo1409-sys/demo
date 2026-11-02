"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui";
import { Command, type CommandEntry, type CommandSearch } from "./Command";
import { useMillSurface } from "./use-mill";

export interface RailItem {
  key: string;
  label: string;
  href: string;
  count?: number;
}

export interface MillShellProps {
  items: RailItem[];
  active: string;
  /** Settings and sign-out, at the foot of the rail. */
  foot: ReactNode;
  /** Pages that have no row of their own: reached from the search and from settings. */
  morePages: { key: string; label: string; href: string }[];
  actions: { key: string; label: string; icon?: IconName }[];
  onAction: (key: string) => void;
  search: CommandSearch;
  offline: boolean;
  page: ReactNode;
  overlays: ReactNode;
  panelOpen: boolean;
}

/** The three the system is built around, set larger; the rest of the floor follows under a rule. */
const LEAD = new Set(["overview", "inventory", "suppliers"]);

/** What a phone's dock keeps under the thumb. The rest is one tap away in the search surface. */
const DOCK = new Set(["overview", "inventory", "orders", "suppliers"]);

const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;

/** Moves between pages inside a view transition, so the plate turns over and the rail stays still. */
function useFlow(): (href: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  const landed = useRef<(() => void) | null>(null);

  useEffect(() => {
    landed.current?.();
    landed.current = null;
  }, [pathname]);

  return useCallback(
    (href: string) => {
      if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.push(href);
        return;
      }
      document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            landed.current = resolve;
            router.push(href);
            // A page that takes longer simply lands without the turn.
            window.setTimeout(resolve, 380);
          }),
      );
    },
    [router],
  );
}

function RailLink({ item, current, go }: { item: RailItem; current: boolean; go: (href: string) => void }): ReactElement {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (!current) go(item.href);
  };
  const cls = ["ml-link", LEAD.has(item.key) && "is-lead", DOCK.has(item.key) ? "is-dock" : "is-spare"].filter(Boolean).join(" ");
  return (
    <Link href={item.href} className={cls} aria-current={current ? "page" : undefined} onClick={onClick}>
      <span>{item.label}</span>
      {item.count != null ? <span className="ml-count">{item.count}</span> : null}
    </Link>
  );
}

/** The rail, the plate, and the one surface over them. Everything the shell does stays in AppShell; this is only how it stands. */
export function MillShell({ items, active, foot, morePages, actions, onAction, search, offline, page, overlays, panelOpen }: MillShellProps): ReactElement {
  useMillSurface();
  const go = useFlow();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const [commanding, setCommanding] = useState(false);

  const { onQuery } = search;
  const closeCommand = useCallback(() => {
    setCommanding(false);
    onQuery("");
  }, [onQuery]);

  // Any letter typed on the page starts a search. The 3D page keeps its keys for walking.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || commanding || panelOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && (FIELD.test(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommanding(true);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || pathname.startsWith("/3d")) return;
      if (e.key === "/") {
        e.preventDefault();
        setCommanding(true);
      } else if (e.key.length === 1 && e.key !== " ") {
        onQuery(e.key);
        setCommanding(true);
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [commanding, panelOpen, pathname, onQuery]);

  // The bright rule stands beside the page you are on, wherever that row is.
  useLayoutEffect(() => {
    const row = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const mark = markRef.current;
    if (!mark) return;
    if (!row || !navRef.current) {
      mark.style.opacity = "0";
      return;
    }
    const nav = navRef.current.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    mark.style.opacity = "1";
    mark.style.setProperty("--y", `${Math.round(box.top - nav.top + (box.height - mark.offsetHeight) / 2)}px`);
  }, [active, items]);

  const entries = useMemo<CommandEntry[]>(
    () =>
      actions.map((a) => ({
        key: `action:${a.key}`,
        label: a.label,
        icon: a.icon,
        run: () => {
          closeCommand();
          onAction(a.key);
        },
      })),
    [actions, onAction, closeCommand],
  );

  const pages = useMemo<CommandEntry[]>(
    () =>
      [...items, ...morePages].map((p) => ({
        key: `page:${p.key}`,
        label: p.label,
        icon: "arrow-left" as const,
        run: () => {
          closeCommand();
          go(p.href);
        },
      })),
    [items, morePages, go, closeCommand],
  );

  // A pick from the search list closes it as well, whatever it opened.
  const searching = useMemo<CommandSearch>(
    () => ({
      ...search,
      pick: (hit) => {
        search.pick(hit);
        setCommanding(false);
      },
    }),
    [search],
  );

  const lead = items.filter((i) => LEAD.has(i.key));
  const rest = items.filter((i) => !LEAD.has(i.key));

  return (
    <div className="ml-shell">
      <aside className="ml-rail">
        <div className="ml-brand">ניהול מלאי</div>
        <button type="button" className="ml-find" onClick={() => setCommanding(true)}>
          <Icon name="search" size={16} strokeWidth={1.5} />
          <span>חיפוש ופעולות</span>
        </button>
        <nav className="ml-nav" ref={navRef} aria-label="ניווט ראשי">
          <span className="ml-mark" ref={markRef} aria-hidden="true" />
          <div className="ml-nav-group">{lead.map((item) => <RailLink key={item.key} item={item} current={item.key === active} go={go} />)}</div>
          <div className="ml-nav-group">
            {rest.map((item) => <RailLink key={item.key} item={item} current={item.key === active} go={go} />)}
            <button type="button" className="ml-link ml-more" onClick={() => setCommanding(true)}>עוד</button>
          </div>
        </nav>
        <div className="ml-foot">
          {offline ? <span className="ml-live" role="status" aria-live="polite">מתחבר</span> : null}
          {foot}
        </div>
      </aside>

      <div className="app-main ml-main">
        <main className="app-content">{page}</main>
      </div>

      {commanding ? <Command search={searching} actions={entries} pages={pages} onClose={closeCommand} /> : null}
      {overlays}
    </div>
  );
}
