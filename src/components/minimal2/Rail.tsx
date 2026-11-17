"use client";

/**
 * The way around מינימל 2, in two pieces that never repeat each other. The rail is six areas, a word each, and one
 * number: how much waits under משימות לביצוע, with a check in its place when nothing does. An area's pages are not
 * listed under it; they stand in one rectangle at the head of the page (`AreaHead`), and the thumb slides between them.
 */
import Link from "next/link";
import { useEffect, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { fmtQty } from "@/lib/format";
import { AREAS, areaOf, TASKS, type AreaDef, type PageId } from "./areas";
import { Line } from "./icons";
import { Check } from "./parts";
import type { Waiting } from "./work";

const countOf = (id: PageId, waiting: Waiting): number | undefined =>
  id === "faults" ? waiting.faults : id === "approvals" ? waiting.approvals : id === "shortages" ? waiting.shortages : undefined;

/** What a waiting count is, in its colour: a fault is something wrong, a shortage that holds an order back is missing, the rest only waits. */
const toneOf = (id: PageId, waiting: Waiting): "bad" | "short" | "warn" => (id === "faults" ? "bad" : id === "shortages" && waiting.hurting > 0 ? "short" : "warn");

/** Where an area opens: on its first page, and the tasks on the first kind that has something waiting. */
const landing = (area: AreaDef, waiting: Waiting, ready: boolean): string =>
  (ready ? area.pages.find((p) => (countOf(p.id, waiting) ?? 0) > 0) : undefined)?.href ?? area.pages[0].href;

/** Where the tasks open from anywhere else: on the first kind that has something waiting. */
export const tasksHref = (waiting: Waiting): string => landing(AREAS.find((a) => a.id === TASKS) ?? AREAS[0], waiting, true);

/** A press on the way around starts the page at its top, also where only the view changed and the address's path did not. */
const toTop = () => window.scrollTo({ top: 0 });

/** How long the thumb waits on a pressed page that has not arrived before it goes back to the one shown. */
const PRESS_WAIT_MS = 8000;

export function Rail({ here, waiting, ready, foot }: { here: PageId | null; waiting: Waiting; ready: boolean; foot: ReactNode }): ReactElement {
  const current = here ? areaOf(here) : null;
  return (
    <aside className="sa-sidebar mn2-rail">
      <div className="sa-brand">ניהול מלאי</div>
      <nav className="sa-nav mn2-nav" aria-label="ניווט ראשי">
        {AREAS.map((area) => {
          const active = area === current;
          return (
            <Link
              key={area.id}
              href={landing(area, waiting, ready)}
              className={`sa-nav-item mn2-area${active ? " is-active" : ""}`}
              aria-current={active ? (area.pages.length === 1 ? "page" : "true") : undefined}
              onClick={toTop}
            >
              <Line name={area.icon} size={20} className="mn2-area-icon" />
              <span className="mn2-area-name">{area.label}</span>
              {area.id !== TASKS || !ready ? null : waiting.total > 0 ? (
                <span className="mn2-area-count" aria-label={`${fmtQty(waiting.total)} מחכים לטיפול`}>{fmtQty(waiting.total)}</span>
              ) : (
                <span className="mn2-area-clear" aria-label="הכל טופל"><Check size={18} /></span>
              )}
            </Link>
          );
        })}
      </nav>
      {foot ? <div className="sa-nav-foot">{foot}</div> : null}
    </aside>
  );
}

/**
 * The head of an area that holds more than one page: its name, and under it the rectangle that moves between its
 * pages. It belongs to the shell, so it stays in place from page to page and the thumb slides instead of jumping.
 */
export function AreaHead({ area, here, waiting, ready, aside, toolsRef }: {
  area: AreaDef;
  here: PageId;
  waiting: Waiting;
  ready: boolean;
  aside?: ReactNode;
  /** Takes the free end of the rectangle's row, where a page may stand its search. */
  toolsRef: (slot: HTMLElement | null) => void;
}): ReactElement {
  // The thumb moves with the press; the page follows when its address lands.
  const [pressed, setPressed] = useState<PageId | null>(null);
  const [seen, setSeen] = useState(here);
  if (seen !== here) {
    setSeen(here);
    setPressed(null);
  }
  const shown = pressed ?? here;

  // A press whose page never arrives (the network dropped, the move was stopped) gives the thumb back to the page that is shown.
  useEffect(() => {
    if (pressed === null) return;
    const timer = setTimeout(() => setPressed(null), PRESS_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pressed]);

  const press = (id: PageId) => (e: MouseEvent) => {
    // A press that opens another tab or window leaves this page where it is.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    setPressed(id);
    toTop();
  };

  return (
    <header className="mn2-areahead">
      <div className="mn2-areahead-top">
        <h1 className="sa-page-title">{area.label}</h1>
        {aside}
      </div>
      <div className="mn2-areahead-row">
        <nav className="mn2-switch" aria-label={area.label}>
          {area.pages.map((p) => {
            const n = ready ? countOf(p.id, waiting) : undefined;
            return (
              <Link key={p.id} href={p.href} className={`mn2-seg${p.id === shown ? " is-active" : ""}`} aria-current={p.id === here ? "page" : undefined} onClick={press(p.id)}>
                <Line name={p.icon} size={18} className="mn2-seg-icon" />
                {p.label}
                {n === undefined ? null : n > 0 ? <span className={`mn2-seg-n is-${toneOf(p.id, waiting)}`}>{fmtQty(n)}</span> : <Check size={16} />}
              </Link>
            );
          })}
        </nav>
        <div className="mn2-areahead-tools" ref={toolsRef} />
      </div>
    </header>
  );
}
