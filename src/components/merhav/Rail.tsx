"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { fmtQty } from "@/lib/format";

export interface RailItem {
  key: string;
  label: string;
  href: string;
  count?: number;
}

/** The place of the work first, the work on it after. A rule between them says so without a heading. */
const AREAS = ["overview", "inventory", "map", "suppliers"];

/** The rail's own order, so the search lists the pages the way the rail does. */
export function railOrder(items: RailItem[]): { areas: RailItem[]; rest: RailItem[] } {
  return {
    areas: items.filter((item) => AREAS.includes(item.key)).sort((a, b) => AREAS.indexOf(a.key) - AREAS.indexOf(b.key)),
    rest: items.filter((item) => !AREAS.includes(item.key)),
  };
}

/** Words this style uses for the same pages. */
export const WORDS: Record<string, string> = { map: "מחסן" };

/** A stop on the bar is one narrow word: a second line would run into its own tick and count. */
const BAR_WORDS: Record<string, string> = { ...WORDS, suppliers: "מיפוי" };

/** What stays under the thumb on a phone. The rest waits behind עוד. */
const NEAR = ["overview", "inventory", "map", "orders"];

interface RailProps {
  items: RailItem[];
  active: string;
  foot: ReactNode;
  offline: boolean;
  onSearch: () => void;
  action: ReactNode;
}

/** A row that is really on screen: the rail and the bar each hide what the other holds. */
const onScreen = (el: Element | null | undefined) => (el && el.getClientRects().length > 0 ? el : null);

/** Writes a mark without its move: a window that changed size is not someone going somewhere. */
function still(mark: HTMLElement, write: () => void): void {
  mark.style.transition = "none";
  write();
  void mark.offsetWidth;
  mark.style.transition = "";
}

/**
 * The navigation is a scale cut into the door's housing: words against a ruled edge, and one carriage that slides to
 * where you are. The carriage is the only moving thing here, and it moves because you did. On a phone the same scale
 * turns on its side along the bottom edge, and the rest of the rail rises from behind it.
 */
export function Rail({ items, active, foot, offline, onSearch, action }: RailProps): ReactElement {
  const rail = useRef<HTMLElement>(null);
  const list = useRef<HTMLElement>(null);
  const bar = useRef<HTMLElement>(null);
  const moreKey = useRef<HTMLButtonElement>(null);
  const carriage = useRef<HTMLElement>(null);
  const ghost = useRef<HTMLElement>(null);
  const barCarriage = useRef<HTMLElement>(null);

  // The page you pressed, until the route arrives, so the carriage answers the press and never goes back to wait.
  const going = useRef<string | null>(null);
  const here = useRef(active);

  // Held as the page it was opened on, so arriving anywhere else closes it.
  const [moreOn, setMoreOn] = useState<string | null>(null);
  const more = moreOn === active;
  const closeMore = useCallback(() => setMoreOn(null), []);

  const { areas, rest } = railOrder(items);

  const seat = useCallback((mark: HTMLElement | null, row: Element | null) => {
    if (!mark || !list.current) return;
    if (!row) {
      mark.style.opacity = "0";
      return;
    }
    const box = row.getBoundingClientRect();
    const top = list.current.getBoundingClientRect().top;
    mark.style.setProperty("--y", `${box.top - top}px`);
    mark.style.setProperty("--h", `${box.height}px`);
    mark.style.opacity = "1";
  }, []);

  const seatBar = useCallback((row: Element | null) => {
    const mark = barCarriage.current;
    if (!mark || !bar.current) return;
    if (!row) {
      mark.style.opacity = "0";
      return;
    }
    const box = row.getBoundingClientRect();
    mark.style.setProperty("--x", `${box.left + box.width / 2 - bar.current.getBoundingClientRect().left}px`);
    mark.style.opacity = "1";
  }, []);

  /** Both shapes of the rail find where you are. A page with no row of its own marks the row that leads to it. */
  const settle = useCallback(
    (quiet = false) => {
      const key = going.current ?? here.current;
      const onRail = onScreen(rail.current?.querySelector(`[data-key="${key}"]`) ?? rail.current?.querySelector('.mh-rail-foot [aria-current="page"]'));
      const onBar = onScreen(bar.current?.querySelector(`[data-key="${key}"]`));
      const behind = onBar ? null : onScreen(moreKey.current);
      const open = rail.current?.hasAttribute("data-more") ?? false;
      moreKey.current?.toggleAttribute("data-here", Boolean(behind));
      const write = () => {
        seat(carriage.current, onRail);
        seatBar(open ? onScreen(moreKey.current) : (onBar ?? behind));
      };
      const mark = carriage.current;
      const markBar = barCarriage.current;
      if (quiet && mark && markBar) still(mark, () => still(markBar, write));
      else write();
    },
    [seat, seatBar],
  );

  useLayoutEffect(() => {
    if (here.current !== active) {
      here.current = active;
      going.current = null;
    }
    settle();
  }, [active, more, offline, settle]);

  // The carriage stays exact through any change of size, or of which shape the rail has taken, or when the font lands and the words change width.
  useEffect(() => {
    const again = () => settle(true);
    const watcher = new ResizeObserver(again);
    for (const el of [rail.current, bar.current]) {
      if (el) watcher.observe(el);
    }
    document.fonts.addEventListener("loadingdone", again);
    return () => {
      watcher.disconnect();
      document.fonts.removeEventListener("loadingdone", again);
    };
  }, [settle]);

  useEffect(() => {
    if (!more) return;
    const first = [...(rail.current?.querySelectorAll<HTMLElement>("a, button") ?? [])].find((el) => onScreen(el));
    first?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setMoreOn(null);
      moreKey.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [more]);

  const onPick = (e: MouseEvent<HTMLElement>, key: string) => {
    closeMore();
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    // Pressing where you are takes back a press still on its way: nothing will arrive to bring the carriage home.
    going.current = key === active ? null : key;
    settle();
  };

  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    const row = e.target instanceof Element ? e.target.closest("a") : null;
    if (row) seat(ghost.current, row);
  };

  // A keyboard walks the rail the way a pointer does.
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    if (e.target.matches(":focus-visible")) seat(ghost.current, e.target);
  };

  const row = (item: RailItem) => (
    <Link
      key={item.key}
      href={item.href}
      className="mh-nav-row"
      data-key={item.key}
      data-near={NEAR.includes(item.key) || undefined}
      aria-current={item.key === active ? "page" : undefined}
      onClick={(e) => onPick(e, item.key)}
    >
      <span>{WORDS[item.key] ?? item.label}</span>
      {item.count ? <span className="mh-nav-count ltr">{fmtQty(item.count)}</span> : null}
    </Link>
  );

  const stop = (item: RailItem) => (
    <Link
      key={item.key}
      href={item.href}
      className="mh-stop"
      data-key={item.key}
      data-near={NEAR.includes(item.key) || undefined}
      aria-current={item.key === active ? "page" : undefined}
      onClick={(e) => onPick(e, item.key)}
    >
      <span className="mh-stop-word" data-word={BAR_WORDS[item.key] ?? item.label}>{BAR_WORDS[item.key] ?? item.label}</span>
      {item.count ? <span className="mh-stop-count ltr">{fmtQty(item.count)}</span> : null}
    </Link>
  );

  return (
    <>
      <aside ref={rail} id="mh-more" className="mh-rail" data-more={more || undefined}>
        <div className="mh-brand">ניהול מלאי</div>

        <button type="button" className="mh-seek" onClick={onSearch}>
          <Icon name="search" size={16} />
          <span>חיפוש</span>
        </button>

        <nav
          ref={list}
          className="mh-nav"
          aria-label="ניווט ראשי"
          onPointerMove={onMove}
          onPointerLeave={() => seat(ghost.current, null)}
          onFocus={onFocus}
          onBlur={() => seat(ghost.current, null)}
        >
          <i ref={ghost} className="mh-carriage is-ghost" style={{ opacity: 0 }} aria-hidden="true" />
          <i ref={carriage} className="mh-carriage" aria-hidden="true" />
          {areas.map(row)}
          <span className="mh-nav-gap" aria-hidden="true" />
          {rest.map(row)}
        </nav>

        <div
          className="mh-rail-foot"
          onClick={(e) => {
            if (e.target instanceof Element && e.target.closest("a, button")) closeMore();
          }}
        >
          {offline ? <p className="mh-offline" role="status" aria-live="polite">מתחבר</p> : null}
          {action}
          {foot}
        </div>
      </aside>

      <div className="mh-more-scrim" data-open={more || undefined} onClick={closeMore} aria-hidden="true" />

      <nav ref={bar} className="mh-bar" aria-label="ניווט ראשי">
        {offline ? <p className="mh-bar-offline" role="status" aria-live="polite">מתחבר</p> : null}
        <button
          type="button"
          className="mh-bar-seek"
          onClick={() => {
            closeMore();
            onSearch();
          }}
        >
          <Icon name="search" size={16} />
          <span>חיפוש</span>
        </button>
        <div className="mh-scale">
          <i ref={barCarriage} className="mh-bar-carriage" style={{ opacity: 0 }} aria-hidden="true" />
          {areas.map(stop)}
          {rest.map(stop)}
          <button
            ref={moreKey}
            type="button"
            className="mh-stop"
            aria-haspopup="true"
            aria-expanded={more}
            aria-controls="mh-more"
            onClick={() => setMoreOn(more ? null : active)}
          >
            <span className="mh-stop-word" data-word="עוד">עוד</span>
          </button>
        </div>
      </nav>
    </>
  );
}
