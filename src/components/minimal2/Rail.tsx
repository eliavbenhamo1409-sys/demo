"use client";

/**
 * The rail of מינימל 2: six areas, not a list of pages, and a board the manager can read without opening anything.
 * Under each area's name stands where it is right now: how many orders are open and how many late, what the stock is
 * worth, whether the day is closed. The area you are in stands open with its pages under it. One number leads the eye:
 * how much waits under דורש טיפול, and a check takes its place when nothing does.
 */
import Link from "next/link";
import { useMemo, type ReactElement, type ReactNode } from "react";
import { fmtCompact, fmtQty } from "@/lib/format";
import { shelfWorth } from "@/lib/snapshot";
import { useData } from "@/lib/store";
import { AREAS, areaOf, type AreaDef, type PageId } from "./areas";
import { useTodaySigned } from "./day-state";
import { Line } from "./icons";
import { Check } from "./parts";
import { isLate, pendingNames, type Waiting } from "./work";

const countOf = (id: PageId, waiting: Waiting): number | undefined =>
  id === "faults" ? waiting.faults : id === "approvals" ? waiting.approvals : id === "shortages" ? waiting.shortages : undefined;

/** Where each area stands now, in a few words. An area with nothing to add keeps the line that says what it holds. */
function useStanding(waiting: Waiting, ready: boolean): Record<string, ReactNode> {
  const { state, product } = useData();
  const signed = useTodaySigned();
  return useMemo(() => {
    if (!ready) return {};
    const open = state.orders.filter((o) => o.status === "open");
    const late = open.filter(isLate).length;
    const names = pendingNames(state.supplierItems, product).length;
    return {
      attention: waiting.total === 0 ? <span className="is-ok">הכל טופל</span> : undefined,
      sales:
        open.length === 0 ? "אין הזמנות פתוחות" : (
          <>
            {fmtQty(open.length)} פתוחות · {late > 0 ? <span className="is-warn">{fmtQty(late)} באיחור</span> : <span className="is-ok">הכל בזמן</span>}
          </>
        ),
      warehouse: state.products.length > 0 ? <>{fmtQty(state.products.length)} מוצרים · <span className="ltr">{fmtCompact(shelfWorth(state.products).total)}</span></> : undefined,
      buying:
        state.suppliers.length === 0 ? undefined : (
          <>
            {fmtQty(state.suppliers.length)} ספקים · {names > 0 ? <span className="is-warn">{fmtQty(names)} לשיוך</span> : <span className="is-ok">הכל משויך</span>}
          </>
        ),
      control: signed === null ? undefined : signed ? <span className="is-ok">היום נסגר ואושר</span> : "היום עוד לא נסגר",
    };
  }, [ready, waiting.total, state.orders, state.products, state.suppliers, state.supplierItems, product, signed]);
}

function AreaCount({ area, waiting, ready }: { area: AreaDef; waiting: Waiting; ready: boolean }): ReactElement | null {
  if (area.id !== "attention" || !ready) return null;
  return waiting.total > 0 ? (
    <span className="mn2-area-count" aria-label={`${fmtQty(waiting.total)} מחכים לטיפול`}>{fmtQty(waiting.total)}</span>
  ) : (
    <span className="mn2-area-clear" aria-label="הכל טופל"><Check size={18} /></span>
  );
}

/** A press on the rail starts the page at its top, also where only the view changed and the address's path did not. */
const toTop = () => window.scrollTo({ top: 0 });

export function Rail({ here, waiting, ready, foot }: { here: PageId | null; waiting: Waiting; ready: boolean; foot: ReactNode }): ReactElement {
  const current = here ? areaOf(here) : null;
  const standing = useStanding(waiting, ready);
  return (
    <aside className="sa-sidebar mn2-rail">
      <div className="sa-brand">ניהול מלאי</div>
      <nav className="sa-nav mn2-nav" aria-label="ניווט ראשי">
        {AREAS.map((area) => {
          const open = area === current;
          const single = area.pages.length === 1;
          return (
            <div key={area.id} className={`mn2-group${open ? " is-open" : ""}`}>
              <Link
                href={area.pages[0].href}
                className={`sa-nav-item mn2-area${open && single ? " is-active" : ""}${open ? " is-here" : ""}`}
                aria-current={open && single ? "page" : undefined}
                aria-expanded={single ? undefined : open}
                onClick={toTop}
              >
                <Line name={area.icon} size={20} className="mn2-area-icon" />
                <span className="mn2-area-name">{area.label}</span>
                <AreaCount area={area} waiting={waiting} ready={ready} />
                <span className="mn2-area-about">{standing[area.id] ?? area.about}</span>
              </Link>
              {single ? null : (
                <div className="mn2-fold">
                  <div className="mn2-fold-body">
                    {area.pages.map((p) => {
                      const n = ready ? countOf(p.id, waiting) : undefined;
                      return (
                        <Link key={p.id} href={p.href} className={`sa-nav-item mn2-sub${p.id === here ? " is-active" : ""}`} aria-current={p.id === here ? "page" : undefined} tabIndex={open ? undefined : -1} onClick={toTop}>
                          <span className="sa-truncate">{p.label}</span>
                          {n !== undefined && n > 0 ? <span className="mn2-sub-count">{fmtQty(n)}</span> : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      {foot ? <div className="sa-nav-foot">{foot}</div> : null}
    </aside>
  );
}

/** On a phone the rail is one row of areas, so the pages of the area you are in stand in a row of their own over the page. */
export function AreaBar({ here, waiting }: { here: PageId | null; waiting: Waiting }): ReactElement | null {
  const area = here ? areaOf(here) : null;
  if (!area || area.pages.length === 1) return null;
  return (
    <nav className="mn2-areabar" aria-label={area.label}>
      {area.pages.map((p) => {
        const n = countOf(p.id, waiting);
        return (
          <Link key={p.id} href={p.href} className={`mn2-areabar-item${p.id === here ? " is-active" : ""}`} aria-current={p.id === here ? "page" : undefined}>
            {p.label}
            {n !== undefined && n > 0 ? <span className="mn2-sub-count">{fmtQty(n)}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
