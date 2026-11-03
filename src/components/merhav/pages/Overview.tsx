"use client";

/**
 * The first screen is a look at the warehouse, not a page about it: the model on the bare surface, the figures the owner
 * sleeps on beside it, the day along the floor. Scrolling lifts a sheet over the model with everything else.
 * The sums are the shared ones (src/lib/snapshot.ts), so this page and every other style can never disagree.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, cx, Notice } from "@/components/ui";
import { useDismissedAlerts } from "@/lib/dismissed-alerts";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { byPromise, daysUntil, fmtAge, fmtName, fmtPrice, fmtPromised, fmtQty, fmtRelative, fmtSigned, fmtTime, fmtToday, fmtWhen, isToday, MOVEMENT_LABEL } from "@/lib/format";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { movedWorth, PACE_DAYS, runway, shelfWorth, type Runway } from "@/lib/snapshot";
import { available, orderTotal, useData, type AttentionEntry, type AttentionKind, type Movement } from "@/lib/store";
import { Figure } from "../Figure";
import { useTwin } from "../twin/Twin";

const whole = (n: number) => fmtQty(Math.round(n));

const isStock = (a: { kind: AttentionKind }) => a.kind === "out" || a.kind === "low";

/* ───────── the day along the floor ───────── */

const HOURS = [0, 6, 12, 18, 24];

function DayStrip({ onHover, onOpen }: { onHover: (m: Movement | null) => void; onOpen: (m: Movement) => void }): ReactElement {
  const { state, product } = useData();
  const today = useMemo(() => state.movements.filter((m) => isToday(m.created_at)).slice().reverse(), [state.movements]);
  const start = midnight();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(clock);
  }, []);
  const place = (at: number) => ((at - start) / 86_400_000) * 100;
  const [hover, setHover] = useState<Movement | null>(null);
  // A tick says what it is only here, so the keyboard reaches it the way the pointer does.
  const point = (m: Movement | null) => {
    setHover(m);
    onHover(m);
  };

  return (
    <div className="mh-day">
      <div className="mh-day-line" dir="ltr">
        <i className="mh-day-now" style={{ left: `${place(now)}%` }} />
        {today.map((m) => {
          const p = product(m.product_id);
          return (
            <button
              key={m.id}
              type="button"
              className={`mh-tick is-${m.type}`}
              style={{ left: `${place(Date.parse(m.created_at))}%` }}
              aria-label={`${MOVEMENT_LABEL[m.type]} ${fmtQty(m.qty)} ${p?.name ?? ""}, ${fmtTime(m.created_at)}`}
              onPointerEnter={() => point(m)}
              onPointerLeave={() => point(null)}
              onFocus={() => point(m)}
              onBlur={() => point(null)}
              onClick={() => onOpen(m)}
            />
          );
        })}
        {HOURS.map((h) => <span key={h} className="mh-day-hour" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, "0")}</span>)}
        {hover ? (
          <span className="mh-day-tip" style={{ left: `${place(Date.parse(hover.created_at))}%` }} dir="rtl">
            <span className={cx("ltr", hover.type === "in" ? "mh-tone-in" : hover.type === "out" ? "mh-tone-out" : undefined)}>{fmtSigned(hover.qty, hover.type)}</span>
            {" "}{product(hover.product_id) ? fmtName(product(hover.product_id)?.name ?? "") : "מוצר שנמחק"}
            <span className="mh-tone-quiet"> · {fmtTime(hover.created_at)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ───────── one list on the sheet ───────── */

function Column({ title, note, href, link, children }: { title: string; note?: string; href?: string; link?: string; children: ReactNode }): ReactElement {
  return (
    <section className="mh-col">
      <header className="mh-col-head">
        <h2>{title}</h2>
        {note ? <span className="mh-col-note">{note}</span> : null}
        {href ? <Link href={href} className="mh-col-link">{link}</Link> : null}
      </header>
      {children}
    </section>
  );
}

const fmtDays = (n: number) => (n >= 90 ? "מעל 3 חודשים" : n === 1 ? "עוד יום" : n === 2 ? "עוד יומיים" : `עוד ${fmtQty(n)} ימים`);

function runwayWord(r: Runway): { word: string; tone: string } {
  if (r.state === "short") return { word: `חסר ${fmtQty(-r.free)}`, tone: "mh-tone-short" };
  if (r.state === "out") return { word: "אזל", tone: "mh-tone-out" };
  if (r.free <= 0) return { word: "הכל משוריין", tone: "mh-tone-warn" };
  if (r.days === null) return { word: "מתחת למינימום", tone: "mh-tone-warn" };
  return { word: fmtDays(r.days), tone: r.state === "low" ? "mh-tone-warn" : "" };
}

/* ───────── the page ───────── */

export function Overview(): ReactElement {
  const { state, stats, attention, product, linesOf } = useData();
  const { openAction, openProduct, openOrder, openFault } = useUi();
  const { dismissed, dismiss } = useDismissedAlerts();
  const { spotProduct, spotObjects, itemsOf } = useTwin();
  const router = useRouter();

  const since = useMemo(() => midnight(1 - PACE_DAYS), []);
  const { rows: month, failed: monthFailed, retry: retryMonth } = useMovementsInRange(since, null);

  const worth = useMemo(() => shelfWorth(state.products), [state.products]);

  const flow = useMemo(() => {
    const week = midnight(-6), weekBefore = midnight(-13);
    const moved = (type: "in" | "out", from: number, to = Number.POSITIVE_INFINITY) => movedWorth(month, type, from, to, product);
    return { outWeek: moved("out", week), outBefore: moved("out", weekBefore, week), inWeek: moved("in", week), inBefore: moved("in", weekBefore, week) };
  }, [month, product]);

  const soon = useMemo(() => {
    const removed = (r: Runway) => (r.state === "out" || r.state === "low") && dismissed[`${r.state}:${r.product.id}`] === r.free;
    return runway(state.products, month).filter((r) => (r.days !== null || r.state !== "ok") && !removed(r));
  }, [state.products, month, dismissed]);

  const promises = useMemo(() => {
    const open = state.orders.filter((o) => o.status === "open");
    const short = (id: string) => {
      const p = product(id);
      return p ? available(p) < 0 : false;
    };
    return {
      open: open.length,
      uncovered: open.filter((o) => linesOf(o.id).some((l) => short(l.product_id))).length,
      late: open.filter((o) => o.promised_on && daysUntil(o.promised_on) < 0).length,
    };
  }, [state.orders, linesOf, product]);

  const covered = promises.open > 0 ? Math.floor(((promises.open - promises.uncovered) / promises.open) * 100) : 0;
  const pending = stats.pendingRequests + stats.pendingMappings;
  const toRefill = soon.filter((r) => r.state === "out" || r.state === "low").length;

  /* ───────── what waits on a person ───────── */
  const work = useMemo(() => attention.filter((a) => !isStock(a)), [attention]);

  const openEntry = (a: AttentionEntry) => {
    if (a.kind === "request") openAction("review-item-request", { requestId: a.requestId });
    else if (a.kind === "mapping") openAction("map-supplier-item", { supplierItemId: a.supplierItemId });
    else if (a.productId) openProduct(a.productId);
    // A fault on a machine has no product to open, and its place is on תקלות.
    else router.push("/faults");
  };

  /* ───────── the model answers what you point at ───────── */
  const onSpot = useCallback((id: string | null | undefined) => spotProduct(id ?? null), [spotProduct]);
  const onSpotMove = useCallback((m: Movement | null) => spotProduct(m?.product_id ?? null), [spotProduct]);

  // The wheel belongs to the page here, so scrolling over the model lifts the sheet. A pinch still zooms.
  const stage = useRef<HTMLElement>(null);
  useEffect(() => {
    const world = document.querySelector(".mh-world");
    if (!world) return;
    const onWheel = (e: Event) => {
      if (!(e as WheelEvent).ctrlKey) e.stopPropagation();
    };
    world.addEventListener("wheel", onWheel, { capture: true });
    return () => world.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  useEffect(() => () => spotObjects(null), [spotObjects]);

  // The figures stand on the world, so when the page leaves they stay there a moment and the door closes over them.
  useLayoutEffect(() => {
    const figures = stage.current;
    return () => {
      const world = document.querySelector(".mh-world");
      // Under a drawer they were already gone, and a clone would bring them back.
      if (!figures || !world || window.scrollY > 0 || document.querySelector(".app-panelHost") || window.matchMedia("(max-width: 899px), (prefers-reduced-motion: reduce)").matches) return;
      const ghost = figures.cloneNode(true) as HTMLElement;
      ghost.classList.add("mh-ghost");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.addEventListener("animationend", () => ghost.remove());
      world.append(ghost);
    };
  }, []);

  // As the sheet rises the model sinks a little and the figures make way, so nothing is ever read through something else.
  useEffect(() => {
    const app = document.querySelector<HTMLElement>(".mh-app");
    if (!app) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => app.style.setProperty("--lift", Math.min(window.scrollY / window.innerHeight, 1).toFixed(3)));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      app.style.removeProperty("--lift");
      if (app.style.length === 0) app.removeAttribute("style");
    };
  }, []);

  const recent = useMemo(() => state.movements.slice(0, 6), [state.movements]);
  const orders = useMemo(() => state.orders.filter((o) => o.status === "open").reverse().sort(byPromise), [state.orders]);
  const worthText = whole(worth.total);
  const firstNote = worth.unpriced > 0 ? `${fmtQty(worth.unpriced)} מוצרים ללא מחיר` : `${fmtQty(state.products.filter((p) => p.qty > 0).length)} מוצרים על המדפים`;
  const heldShare = worth.total > 0 ? (worth.held / worth.total) * 100 : 0;
  const latest = state.movements[0];

  return (
    <div className="mh-ov">
      <h1 className="sa-sr">סקירה</h1>
      <section ref={stage} className="mh-ov-stage" aria-label="תמונת מצב">
        <div className="mh-ov-figures">
          <p className="mh-ov-date">{fmtToday()}</p>

          <div className="mh-ov-worth">
            <span className="mh-label">שווי המלאי במחירון</span>
            <Figure className="mh-ov-worth-n" sign="₪" text={worthText} style={{ "--len": worthText.length } as CSSProperties} />
            <span className="mh-ov-note">{firstNote}</span>
          </div>

          <div className="mh-ov-held">
            {worth.total > 0 ? (
              <div className="mh-ov-bar" dir="ltr" role="img" aria-label={`${fmtPrice(Math.round(worth.free))} זמין, ${fmtPrice(Math.round(worth.held))} משוריין`}>
                <i style={{ width: `${100 - heldShare}%` }} />
                <b style={{ width: `${heldShare}%` }} />
              </div>
            ) : null}
            <dl>
              <div><dt>זמין</dt><dd className="ltr">₪{whole(worth.free)}</dd></div>
              <div><dt>משוריין</dt><dd className="ltr">₪{whole(worth.held)}</dd></div>
            </dl>
          </div>

          <Link href={promises.uncovered > 0 ? "/orders?filter=short" : "/orders"} className="mh-ov-cover">
            <span className="mh-label">הזמנות מכוסות</span>
            <Figure className={cx("mh-ov-cover-n", promises.open === 0 ? "" : promises.uncovered > 0 ? "mh-tone-short" : "mh-tone-ok")} text={promises.open === 0 ? "—" : `${covered}%`} />
            <span className="mh-ov-note">
              {promises.open === 0 ? "אין הזמנות פתוחות" : promises.uncovered > 0 ? `חסר מלאי ל-${fmtQty(promises.uncovered)} מתוך ${fmtQty(promises.open)}` : `${fmtQty(promises.open)} פתוחות, הכל על המדף`}
              {promises.late > 0 ? <span className="mh-tone-warn"> · {promises.late === 1 ? "אחת באיחור" : `${fmtQty(promises.late)} באיחור`}</span> : null}
            </span>
          </Link>

        </div>

        <div className="mh-ov-floor">
          <div className="mh-ov-bottom">
            <div className="mh-ov-answers">
              <Link href="/faults"><span>תקלות</span> <b className={stats.openFaults > 0 ? "mh-tone-out" : "mh-tone-ok"}>{stats.openFaults > 0 ? `${fmtQty(stats.openFaults)} פתוחות` : "אין פתוחות"}</b></Link>
              <Link href="/suppliers"><span>אישורים</span> <b className={pending > 0 ? "mh-tone-warn" : "mh-tone-ok"}>{pending > 0 ? `${fmtQty(pending)} ממתינים` : "אין ממתינים"}</b></Link>
              <Link href={stats.low > 0 ? "/inventory?filter=low" : stats.out > 0 ? "/inventory?filter=out" : "/inventory"}><span>מלאי</span> <b className={toRefill > 0 ? "mh-tone-warn" : "mh-tone-ok"}>{toRefill > 0 ? `${fmtQty(toRefill)} להשלמה` : "אין מה להשלים"}</b></Link>
            </div>
            <dl className="mh-ov-week">
            <div>
              <dt>יצא השבוע</dt>
              <dd><Figure sign="₪" text={whole(flow.outWeek)} /></dd>
              <dd className="mh-ov-before">שבוע קודם ₪{whole(flow.outBefore)}</dd>
            </div>
            <div>
              <dt>נכנס השבוע</dt>
              <dd><Figure sign="₪" text={whole(flow.inWeek)} /></dd>
              <dd className="mh-ov-before">שבוע קודם ₪{whole(flow.inBefore)}</dd>
            </div>
            <div>
              <dt>היום במחסן</dt>
              <dd><Figure text={fmtQty(stats.movementsToday)} /></dd>
              <dd className="mh-ov-before">{latest ? `אחרונה ${fmtRelative(latest.created_at)}` : "אין תנועות"}</dd>
            </div>
            </dl>
          </div>
          <DayStrip onHover={onSpotMove} onOpen={(m) => openProduct(m.product_id, "history")} />
        </div>
      </section>

      <div className="mh-sheet">
        {monthFailed ? (
          <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retryMonth}>הסכומים מחושבים רק לפי מה שנטען</Notice>
        ) : null}

        {work.length > 0 ? (
          <Column title="דורש טיפול" note={fmtQty(work.length)}>
            <ul className="mh-rows">
              {work.map((a) => {
                const photo = a.kind === "fault" ? faultPhotoUrl(a.photoPath) : null;
                return (
                  <li key={a.id} onPointerEnter={() => onSpot(a.productId)} onPointerLeave={() => onSpot(null)} onFocus={() => onSpot(a.productId)} onBlur={() => onSpot(null)}>
                    <button type="button" className="mh-row" onClick={() => openEntry(a)}>
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="sa-thumb" src={photo} alt="" loading="lazy" />
                      ) : null}
                      <span className="mh-row-main">
                        <span className="mh-row-title">{a.title}</span>
                        <span className="mh-row-sub">{a.meta.join(" · ")}</span>
                      </span>
                      <span className={cx("mh-row-word", a.kind === "short" ? "mh-tone-short" : a.severity === "danger" ? "mh-tone-out" : "mh-tone-warn")}>{a.label}</span>
                    </button>
                    {a.faultId ? <Button variant="ghost" size="sm" aria-label={`סגירה עם תיעוד: ${a.title}`} onClick={() => openFault(a.faultId ?? "")}>סגירה עם תיעוד</Button> : null}
                  </li>
                );
              })}
            </ul>
          </Column>
        ) : null}

        <div className="mh-sheet-split">
          <Column title="מה ייגמר ראשון" note="לפי קצב ההוצאה בחודש האחרון" href="/inventory" link="כל המלאי">
            <ul className="mh-rows">
              {soon.slice(0, 6).map((r) => {
                const { word, tone } = runwayWord(r);
                const removable = r.state === "out" || r.state === "low";
                return (
                  <li key={r.product.id} onPointerEnter={() => onSpot(r.product.id)} onPointerLeave={() => onSpot(null)} onFocus={() => onSpot(r.product.id)} onBlur={() => onSpot(null)}>
                    <button type="button" className="mh-row" onClick={() => openProduct(r.product.id)}>
                      <ProductThumb product={r.product} />
                      <span className="mh-row-main">
                        <span className="mh-row-title">{fmtName(r.product.name)}</span>
                        <span className="mh-row-sub">{r.product.qty > 0 ? `זמין ${fmtQty(r.free)} ${r.product.unit}` : r.product.sku}{itemsOf(r.product.id)[0] ? ` · ${itemsOf(r.product.id)[0].place}` : ""}</span>
                      </span>
                      <span className={cx("mh-row-word", tone)}>{word}</span>
                    </button>
                    {removable ? <Button variant="ghost" size="sm" iconOnly icon="x" title="הסרה מהרשימה" aria-label={`הסרה מהרשימה: ${fmtName(r.product.name)}`} onClick={() => dismiss(`${r.state}:${r.product.id}`, r.free)} /> : null}
                  </li>
                );
              })}
              {soon.length === 0 ? <li className="mh-empty">אין מוצרים שעומדים להיגמר</li> : null}
            </ul>
          </Column>

          <Column title="הזמנות פתוחות" note="לפי מועד המסירה" href="/orders" link="כל ההזמנות">
            <ul className="mh-rows">
              {orders.slice(0, 6).map((o) => {
                const lines = linesOf(o.id);
                const first = product(lines[0]?.product_id);
                const total = orderTotal(lines);
                const short = lines.some((l) => {
                  const p = product(l.product_id);
                  return p ? available(p) < 0 : false;
                });
                const spots = lines.flatMap((l) => itemsOf(l.product_id).map((item) => item.objectId));
                return (
                  <li key={o.id} onPointerEnter={() => spotObjects(spots)} onPointerLeave={() => spotObjects(null)} onFocus={() => spotObjects(spots)} onBlur={() => spotObjects(null)}>
                    <button type="button" className="mh-row" onClick={() => openOrder(o.id)}>
                      <ProductThumb product={first} />
                      <span className="mh-row-main">
                        <span className="mh-row-title">{o.customer}</span>
                        <span className="mh-row-sub">
                          {first ? fmtName(first.name) : "—"}{lines.length > 1 ? ` +${lines.length - 1}` : ""}
                          {o.promised_on ? <span className={daysUntil(o.promised_on) < 0 ? "mh-tone-warn" : undefined}> · מסירה {fmtPromised(o.promised_on)}</span> : <span> · {fmtAge(o.created_at)}</span>}
                        </span>
                      </span>
                      <span className="mh-row-end">
                        <span className="mh-row-fig ltr">{fmtPrice(total)}</span>
                        <span className={cx("mh-row-state", short ? "mh-tone-short" : "mh-tone-ok")}>{short ? "חסר במלאי" : "מכוסה"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {orders.length === 0 ? <li className="mh-empty">אין הזמנות פתוחות</li> : null}
            </ul>
          </Column>
        </div>

        <Column title="תנועות אחרונות" href="/movements?period=all" link="כל התנועות">
          <ul className="mh-rows">
            {recent.map((m) => {
              const p = product(m.product_id);
              return (
                <li key={m.id} onPointerEnter={() => onSpot(m.product_id)} onPointerLeave={() => onSpot(null)} onFocus={() => onSpot(m.product_id)} onBlur={() => onSpot(null)}>
                  <button type="button" className="mh-row" onClick={() => openProduct(m.product_id, "history")}>
                    <ProductThumb product={p} />
                    <span className="mh-row-main">
                      <span className="mh-row-title">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
                      <span className="mh-row-sub">{MOVEMENT_LABEL[m.type]} · {fmtWhen(m.created_at)}</span>
                    </span>
                    <span className="mh-row-fig">
                      <span className={cx("ltr", m.type === "in" ? "mh-tone-in" : m.type === "out" ? "mh-tone-out" : undefined)}>{fmtSigned(m.qty, m.type)}</span>
                      <small>{p?.unit}</small>
                    </span>
                  </button>
                </li>
              );
            })}
            {recent.length === 0 ? <li className="mh-empty">אין תנועות</li> : null}
          </ul>
        </Column>
      </div>

    </div>
  );
}
