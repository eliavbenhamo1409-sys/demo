"use client";

/**
 * סקירה in the first five seconds: the state of the factory in one sentence and three figures, the warehouse as the one
 * large thing on the page, what needs a hand on the side, and the day's activity along the foot. The sums are the shared
 * ones (src/lib/snapshot.ts), so this page and every other style can never disagree.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";
import { useTwin } from "@/components/merhav/twin/Twin";
import { Button, cx } from "@/components/ui";
import { useDismissedAlerts } from "@/lib/dismissed-alerts";
import { daysUntil, fmtName, fmtQty, fmtSigned, fmtTime, fmtToday, isToday, MOVEMENT_LABEL } from "@/lib/format";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { movedWorth, shelfWorth } from "@/lib/snapshot";
import { available, useData, type AttentionEntry, type AttentionKind, type Movement } from "@/lib/store";
import { ModelFrame } from "../Frame";
import { HomeButton } from "../HomeButton";
import { Side } from "../side";

const whole = (n: number) => fmtQty(Math.round(n));

/** "תקלה אחת פתוחה" / "3 תקלות פתוחות": Hebrew counts one thing differently. */
const some = (n: number, one: string, many: string) => (n === 1 ? one : `${fmtQty(n)} ${many}`);

/* ───────── the day along the foot ───────── */

const HOURS = [0, 6, 12, 18, 24];

function DayLine({ onHover, onOpen }: { onHover: (m: Movement | null) => void; onOpen: (m: Movement) => void }): ReactElement {
  const { state, product } = useData();
  const today = useMemo(() => state.movements.filter((m) => isToday(m.created_at)).slice().reverse(), [state.movements]);
  const start = midnight();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(clock);
  }, []);
  const at = (t: number) => `${Math.min(Math.max(((t - start) / 86_400_000) * 100, 0), 100)}%`;
  const [hover, setHover] = useState<Movement | null>(null);
  const point = (m: Movement | null) => {
    setHover(m);
    onHover(m);
  };
  const name = (m: Movement) => {
    const p = product(m.product_id);
    return p ? fmtName(p.name) : "מוצר שנמחק";
  };

  return (
    <div className="at-day" dir="ltr">
      <i className="at-day-line" aria-hidden="true" />
      {HOURS.map((h) => (
        <span key={h} className="at-day-hour" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, "0")}</span>
      ))}
      <i className="at-day-now" style={{ left: at(now) }} aria-hidden="true" />
      {today.map((m) => (
        <button
          key={m.id}
          type="button"
          className={cx("at-tick", m.type === "in" && "is-in", m.type === "out" && "is-out")}
          style={{ left: at(Date.parse(m.created_at)) }}
          aria-label={`${MOVEMENT_LABEL[m.type]} ${fmtQty(m.qty)} ${name(m)}, ${fmtTime(m.created_at)}`}
          onPointerEnter={() => point(m)}
          onPointerLeave={() => point(null)}
          onFocus={() => point(m)}
          onBlur={() => point(null)}
          onClick={() => onOpen(m)}
        />
      ))}
      {hover ? (
        <span className="at-day-tip" style={{ left: at(Date.parse(hover.created_at)) }} dir="rtl">
          <span className={cx("ltr", hover.type === "in" ? "at-tone-in" : hover.type === "out" ? "at-tone-out" : undefined)}>{fmtSigned(hover.qty, hover.type)}</span>
          {" "}
          {name(hover)}
          <span className="at-tone-quiet"> · {fmtTime(hover.created_at)}</span>
        </span>
      ) : null}
    </div>
  );
}

/* ───────── what needs a hand ───────── */

const KIND_ORDER: Record<AttentionKind, number> = { fault: 0, short: 1, request: 2, mapping: 2, out: 3, low: 4 };
const KIND_GROUP: Record<AttentionKind, string> = { fault: "תקלות פתוחות", short: "חסר להזמנות", request: "ממתין לאישור", mapping: "ממתין לאישור", out: "אזל מהמדף", low: "מתחת למינימום" };
const KIND_WORD: Record<AttentionKind, string> = { fault: "תקלה", short: "חסר", request: "לאישור", mapping: "שם חדש", out: "אזל", low: "מתחת למינימום" };
const KIND_TONE: Record<AttentionKind, string> = { fault: "at-tone-out", short: "at-tone-short", request: "at-tone-warn", mapping: "at-tone-warn", out: "at-tone-out", low: "at-tone-warn" };

/* ───────── the page ───────── */

export function Overview(): ReactElement {
  const { state, stats, attention, product, linesOf } = useData();
  const { openAction, openProduct, openFault } = useUi();
  const { spotProduct, spotObjects, itemsOf, objects, world, home } = useTwin();
  const { dismissed, dismiss } = useDismissedAlerts();
  const router = useRouter();

  const worth = useMemo(() => shelfWorth(state.products), [state.products]);

  const promises = useMemo(() => {
    const open = state.orders.filter((o) => o.status === "open");
    const short = (id: string) => {
      const p = product(id);
      return p ? available(p) < 0 : false;
    };
    return {
      open: open.length,
      uncovered: open.filter((o) => linesOf(o.id).some((l) => short(l.product_id))).length,
      late: open.filter((o) => o.promised_on !== null && daysUntil(o.promised_on) < 0).length,
    };
  }, [state.orders, linesOf, product]);

  const pending = stats.pendingRequests + stats.pendingMappings;
  const refill = stats.low + stats.out;

  // Two weeks of movements, for the ₪ that went out and came in this week.
  const since = useMemo(() => midnight(-13), []);
  const { rows: fortnight } = useMovementsInRange(since, null);
  const week = useMemo(() => {
    const from = midnight(-6);
    return {
      out: movedWorth(fortnight, "out", from, Number.POSITIVE_INFINITY, product),
      in: movedWorth(fortnight, "in", from, Number.POSITIVE_INFINITY, product),
    };
  }, [fortnight, product]);

  const today = useMemo(() => {
    let ins = 0, outs = 0, all = 0;
    for (const m of state.movements) {
      if (!isToday(m.created_at)) continue;
      all += 1;
      if (m.type === "in") ins += 1;
      else if (m.type === "out") outs += 1;
    }
    return { all, ins, outs };
  }, [state.movements]);

  /* ───────── one business sentence ───────── */
  const line = useMemo(() => {
    const parts: string[] = [];
    if (promises.uncovered > 0) parts.push(promises.uncovered === 1 ? "חסר מלאי להזמנה אחת" : `חסר מלאי ל-${fmtQty(promises.uncovered)} הזמנות`);
    if (stats.openFaults > 0) parts.push(some(stats.openFaults, "תקלה אחת פתוחה", "תקלות פתוחות"));
    if (refill > 0) parts.push(some(refill, "מוצר אחד להשלמה", "מוצרים להשלמה"));
    if (pending > 0) parts.push(some(pending, "אישור אחד ממתין", "אישורים ממתינים"));
    if (promises.late > 0) parts.push(some(promises.late, "הזמנה אחת באיחור", "הזמנות באיחור"));
    if (parts.length > 0) return `${parts.join(", ")}.`;
    if (promises.open > 0) return `הכול מכוסה: ${some(promises.open, "הזמנה אחת פתוחה", "הזמנות פתוחות")} על המדף, ואין תקלות פתוחות.`;
    return "הכול מסודר: אין הזמנות פתוחות ואין תקלות.";
  }, [promises, stats.openFaults, refill, pending]);

  /* ───────── the list on the side ───────── */
  const needs = useMemo(() => {
    const kept = attention.filter((a) => {
      if (a.kind !== "out" && a.kind !== "low") return true;
      const p = a.productId ? product(a.productId) : undefined;
      return !(p && dismissed[`${a.kind}:${p.id}`] === available(p));
    });
    return [...kept].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.at.localeCompare(a.at));
  }, [attention, dismissed, product]);

  const openEntry = useCallback(
    (a: AttentionEntry) => {
      if (a.kind === "request") openAction("review-item-request", { requestId: a.requestId });
      else if (a.kind === "mapping") openAction("map-supplier-item", { supplierItemId: a.supplierItemId });
      else if (a.kind === "fault" && a.faultId) openFault(a.faultId);
      else if (a.productId) openProduct(a.productId);
      else router.push("/faults");
    },
    [openAction, openFault, openProduct, router],
  );

  // Pointing at a row lights its place on the model: a fault on a machine lights the machine.
  const assetOf = useCallback(
    (a: AttentionEntry) => {
      const fault = a.faultId ? state.faults.find((f) => f.id === a.faultId) : undefined;
      return fault?.asset && objects.some((o) => o.id === fault.asset) ? fault.asset : null;
    },
    [state.faults, objects],
  );
  const point = useCallback(
    (a: AttentionEntry | null) => {
      if (!a) {
        spotProduct(null);
        return;
      }
      const asset = assetOf(a);
      if (asset) spotObjects([asset]);
      else spotProduct(a.productId ?? null);
    },
    [assetOf, spotObjects, spotProduct],
  );
  useEffect(() => () => spotObjects(null), [spotObjects]);
  const onSpotMove = useCallback((m: Movement | null) => spotProduct(m?.product_id ?? null), [spotProduct]);

  const placeOf = (a: AttentionEntry): string | null => {
    const item = a.productId ? itemsOf(a.productId)[0] : undefined;
    return item?.place ?? assetOf(a);
  };

  const places = objects.filter((o) => o.kind === "rack" || o.kind === "floor").length;
  const trouble = stats.openFaults + refill;

  return (
    <div className="at-ov">
      <header className="at-ov-head">
        <div className="at-ov-title">
          <h1>סקירה</h1>
          <p className="at-ov-state">{line}</p>
          <span className="at-ov-date">{fmtToday()}</span>
        </div>
        <dl className="at-ov-keys">
          <div>
            <dt>שווי המלאי במחירון</dt>
            <dd className="is-money ltr"><small>₪</small>{whole(worth.total)}</dd>
            <span className="at-ov-note">{worth.unpriced > 0 ? `${fmtQty(worth.unpriced)} מוצרים ללא מחיר` : `זמין ₪${whole(worth.free)} · משוריין ₪${whole(worth.held)}`}</span>
          </div>
          <div>
            <dt>הזמנות פתוחות</dt>
            <dd className={cx("ltr", promises.open === 0 && "is-calm")}>{fmtQty(promises.open)}</dd>
            <span className={cx("at-ov-note", promises.uncovered > 0 && "at-tone-short")}>
              {promises.open === 0 ? "אין הזמנות פתוחות" : promises.uncovered > 0 ? `חסר מלאי ל-${fmtQty(promises.uncovered)}` : "הכול על המדף"}
              {promises.late > 0 ? <span className="at-tone-warn"> · {some(promises.late, "אחת באיחור", "באיחור")}</span> : null}
            </span>
          </div>
          <div>
            <dt>תקלות וחוסרים</dt>
            <dd className={cx("ltr", trouble === 0 ? "is-calm" : stats.openFaults > 0 ? "at-tone-out" : "at-tone-warn")}>{fmtQty(trouble)}</dd>
            <span className="at-ov-note">{trouble === 0 ? "אין תקלות ואין חוסרים" : `${some(stats.openFaults, "תקלה אחת", "תקלות")} · ${some(refill, "מוצר אחד להשלמה", "להשלמה")}`}</span>
          </div>
        </dl>
      </header>

      <ModelFrame className="at-ov-model">
        <div className="at-ov-model-caption">
          <span>המחסן · {fmtQty(places)} מיקומים</span>
          <Link href="/3d">למחסן המלא</Link>
        </div>
        <div className="at-ov-model-legend" aria-hidden="true">
          <span className="is-low">מתחת למינימום</span>
          <span className="is-out">אזל או חסר</span>
        </div>
        <HomeButton world={world} onHome={home} />
      </ModelFrame>

      <footer className="at-ov-day">
        <div className="at-ov-day-head">
          <h2>היום במחסן</h2>
          <span className="at-ov-day-sum">{today.all > 0 ? `${some(today.all, "תנועה אחת", "תנועות")} · ${some(today.ins, "קליטה אחת", "קליטות")} · ${some(today.outs, "הוצאה אחת", "הוצאות")}` : "עדיין אין תנועות היום"}</span>
          <span className="at-ov-day-week">
            <span>יצא השבוע <b className="ltr">₪{whole(week.out)}</b></span>
            <span>נכנס השבוע <b className="ltr is-in">₪{whole(week.in)}</b></span>
          </span>
          <span className="at-ov-day-legend" aria-hidden="true">
            <span className="is-in">קליטה</span>
            <span className="is-out">הוצאה</span>
            <span>אחר</span>
          </span>
        </div>
        <DayLine onHover={onSpotMove} onOpen={(m) => openProduct(m.product_id, "history")} />
      </footer>

      <Side label="דורש טיפול">
        <header className="at-side-head">
          <h2>דורש טיפול</h2>
          {needs.length > 0 ? <span className="at-side-n ltr">{fmtQty(needs.length)}</span> : null}
        </header>
        {needs.length === 0 ? (
          <p className="at-need-empty">
            <b>אין מה לטפל בו עכשיו</b>
            תקלות, אישורים וחוסרים יופיעו כאן ברגע שיהיו.
          </p>
        ) : (
          <ul className="at-need-list">
            {needs.map((a, i) => {
              const heads = i === 0 || KIND_GROUP[needs[i - 1].kind] !== KIND_GROUP[a.kind];
              const p = a.productId ? product(a.productId) : undefined;
              const place = placeOf(a);
              const measure =
                a.kind === "short" && p ? `חסר ${fmtQty(-available(p))} ${p.unit} להזמנות`
                : a.kind === "low" && p ? `${fmtQty(Math.max(available(p), 0))} מתוך מינימום ${fmtQty(p.min_qty)}`
                : a.kind === "out" && p ? "אין על המדף"
                : (a.meta[0] ?? "");
              return (
                <Fragment key={a.id}>
                  {heads ? <li className="at-need-group" aria-hidden="true">{KIND_GROUP[a.kind]}</li> : null}
                  <li className="at-need" onPointerEnter={() => point(a)} onPointerLeave={() => point(null)} onFocus={() => point(a)} onBlur={() => point(null)}>
                    <button type="button" className="at-need-main" onClick={() => openEntry(a)}>
                      <span className="at-need-title">{p && a.kind !== "fault" ? fmtName(p.name) : a.title}</span>
                      <span className="at-need-sub">
                        {place ? <span className="ltr">{place}</span> : null}
                        {place && measure ? " · " : ""}
                        {measure}
                      </span>
                    </button>
                    <span className="at-need-end">
                      <span className={cx("at-need-word", KIND_TONE[a.kind])}>{KIND_WORD[a.kind]}</span>
                      {a.kind === "fault" && a.faultId ? (
                        <span className="at-need-act">
                          <Button variant="ghost" size="sm" onClick={() => openFault(a.faultId ?? "")}>סגירה</Button>
                        </span>
                      ) : null}
                      {(a.kind === "out" || a.kind === "low") && p ? (
                        <span className="at-need-act">
                          <Button variant="ghost" size="sm" iconOnly icon="x" title="הסרה מהרשימה" aria-label={`הסרה מהרשימה: ${fmtName(p.name)}`} onClick={() => dismiss(`${a.kind}:${p.id}`, available(p))} />
                        </span>
                      ) : null}
                    </span>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}
      </Side>
    </div>
  );
}
