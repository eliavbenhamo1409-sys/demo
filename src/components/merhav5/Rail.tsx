"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import type { RailItem } from "@/components/merhav/Rail";
import { AREAS, areaOf } from "./areas";

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
 * מרחב's scale with five words on it, read like a ruler: an area is a word at a long tick, and the pages of the area you
 * are in stand as rows at short ticks under it, gliding open when you arrive and shut when you leave. The carriage rides
 * to the page you are on. On a phone the five words stand along the bottom edge, and the area's pages stand over the
 * page (AreaBar).
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

  const counts: Record<string, number | undefined> = Object.fromEntries(items.map((i) => [i.key, i.count]));
  const area = areaOf(active);

  /**
   * Where a row will stand once every fold has settled: the rows of other areas are still gliding shut when the
   * carriage sets out, so it aims at the end of their move, not at where they are.
   */
  const restingTop = useCallback((row: Element) => {
    const nav = list.current;
    if (!nav) return 0;
    let y = row.getBoundingClientRect().top - nav.getBoundingClientRect().top;
    const rowTop = row.getBoundingClientRect().top;
    for (const fold of nav.querySelectorAll<HTMLElement>(".m5-pages")) {
      const box = fold.getBoundingClientRect();
      if (box.top >= rowTop || fold.contains(row)) continue;
      const body = fold.firstElementChild;
      const open = fold.parentElement?.hasAttribute("data-here") ?? false;
      const resting = open && body ? body.scrollHeight : 0;
      y += resting - box.height;
    }
    return y;
  }, []);

  const seat = useCallback(
    (mark: HTMLElement | null, row: Element | null) => {
      if (!mark || !list.current) return;
      if (!row) {
        mark.style.opacity = "0";
        return;
      }
      mark.style.setProperty("--y", `${restingTop(row)}px`);
      mark.style.setProperty("--h", `${row.getBoundingClientRect().height}px`);
      mark.style.opacity = "1";
    },
    [restingTop],
  );

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

  /** Both shapes of the rail find where you are: the page's row, or the area's word where the area is its one page. A page outside every area marks nothing. */
  const settle = useCallback(
    (quiet = false) => {
      const key = going.current ?? here.current;
      const areaKey = areaOf(key)?.key;
      const onRail = areaKey
        ? onScreen(rail.current?.querySelector(`.m5-page[data-key="${key}"]`)) ?? onScreen(rail.current?.querySelector(`.m5-area[data-area="${areaKey}"] > .mh-nav-row`))
        : onScreen(rail.current?.querySelector('.mh-rail-foot [aria-current="page"]'));
      const onBar = areaKey ? onScreen(bar.current?.querySelector(`.mh-stop[data-area="${areaKey}"]`)) : null;
      const open = rail.current?.hasAttribute("data-more") ?? false;
      const write = () => {
        seat(carriage.current, onRail);
        seatBar(open ? onScreen(moreKey.current) : onBar);
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

  // The carriage stays exact through any change of size, or of which shape the rail has taken, or when the font lands.
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
    // A press with a pointer leaves no ring behind on the word; the keyboard keeps its place.
    if (e.detail > 0) e.currentTarget.blur();
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    going.current = key === active ? null : key;
    settle();
  };

  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    const row = e.target instanceof Element ? e.target.closest(".mh-nav-row, .m5-page") : null;
    seat(ghost.current, row);
  };

  // A keyboard walks the rail the way a pointer does.
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    if (e.target.matches(".mh-nav-row:focus-visible, .m5-page:focus-visible")) seat(ghost.current, e.target);
  };

  const count = (n: number | undefined, cls: string) => (n ? <span className={`${cls} ltr`}>{fmtQty(n)}</span> : null);

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
          className="mh-nav m5-nav"
          aria-label="ניווט ראשי"
          onPointerMove={onMove}
          onPointerLeave={() => seat(ghost.current, null)}
          onFocus={onFocus}
          onBlur={() => seat(ghost.current, null)}
        >
          <i ref={ghost} className="mh-carriage is-ghost" style={{ opacity: 0 }} aria-hidden="true" />
          <i ref={carriage} className="mh-carriage" aria-hidden="true" />
          {AREAS.map((a) => {
            const inside = area?.key === a.key;
            const own = a.views.length === 0;
            const sum = a.views.reduce((n, v) => n + (counts[v.key] ?? 0), 0);
            return (
              <div key={a.key} className="m5-area" data-area={a.key} data-here={inside || undefined}>
                <Link href={a.href} className="mh-nav-row" data-key={a.key} aria-current={inside ? (own ? "page" : "true") : undefined} onClick={(e) => onPick(e, a.views[0]?.key ?? a.key)}>
                  <span>{a.label}</span>
                  {own ? count(counts[a.key], "mh-nav-count") : count(sum, "mh-nav-count m5-sum")}
                </Link>
                {a.views.length ? (
                  <div className="m5-pages" aria-hidden={inside ? undefined : true}>
                    <div className="m5-pages-body" inert={inside ? undefined : true}>
                      {a.views.map((v) => (
                        <Link key={v.key} href={v.href} className="m5-page" data-key={v.key} aria-current={v.key === active ? "page" : undefined} onClick={(e) => onPick(e, v.key)}>
                          <span>{v.label}</span>
                          {count(counts[v.key], "mh-nav-count")}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
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
          {AREAS.map((a) => {
            const inside = area?.key === a.key;
            const own = a.views.length === 0;
            return (
              <Link
                key={a.key}
                href={a.href}
                className="mh-stop"
                data-area={a.key}
                data-near
                data-here={inside && !own ? "" : undefined}
                aria-current={inside ? (own ? "page" : "true") : undefined}
                onClick={(e) => onPick(e, a.views[0]?.key ?? a.key)}
              >
                <span className="mh-stop-word" data-word={a.label}>{a.label}</span>
                {own ? count(counts[a.key], "mh-stop-count") : null}
              </Link>
            );
          })}
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

/** On a phone the rail has no room for an area's pages, so they stand over the page as one ruled row. Hidden on wider windows by CSS. */
export function AreaBar({ items, active }: { items: RailItem[]; active: string }): ReactElement | null {
  const area = areaOf(active);
  if (!area || area.views.length < 2) return null;
  const counts: Record<string, number | undefined> = Object.fromEntries(items.map((i) => [i.key, i.count]));
  return (
    <nav className="m5-areabar" aria-label={area.label}>
      <div className="m5-seg">
        {area.views.map((v) => (
          <Link key={v.key} href={v.href} className="m5-seg-item" aria-current={v.key === active ? "page" : undefined}>
            <span>{v.label}</span>
            {counts[v.key] ? <span className="m5-seg-count ltr">{fmtQty(counts[v.key] ?? 0)}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
