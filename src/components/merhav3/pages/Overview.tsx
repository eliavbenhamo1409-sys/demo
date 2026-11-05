"use client";

/**
 * סקירה as mission control. The model keeps the stage, as in מרחב; where the big figure stood there is now one sentence
 * that says how the factory is, worked out from the rows by plain rules, and under it the few things that need a
 * decision, each with what it is, what it costs, where it is and the one press that starts dealing with it. The money
 * stands under them, quiet. What changed since this browser last looked is said in one line. The sums are the shared
 * ones (src/lib/snapshot.ts), so this page and every other style can never disagree.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, cx, Notice } from "@/components/ui";
import { useDismissedAlerts } from "@/lib/dismissed-alerts";
import { byPromise, daysUntil, fmtAge, fmtCompact, fmtName, fmtPrice, fmtPromised, fmtQty, fmtRelative, fmtToday } from "@/lib/format";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { movedWorth, PACE_DAYS, pctChange, runway, shelfWorth, type Runway } from "@/lib/snapshot";
import { available, orderTotal, useData, type Fault, type Movement, type Order, type Product } from "@/lib/store";
import { Figure } from "@/components/merhav/Figure";
import { DayStrip } from "@/components/merhav/pages/Overview";
import { useTwin } from "@/components/merhav/twin/Twin";

const whole = (n: number) => fmtQty(Math.round(n));

/** When this browser last looked at the overview; the next visit says what came in since. */
const SEEN_KEY = "m3-overview-seen";

/** The rows that stand under the sentence: the few that need a decision, the gravest first. */
const PRIORITIES = 5;

const fmtDays = (n: number) => (n >= 90 ? "מעל 3 חודשים" : n === 1 ? "עוד יום" : n === 2 ? "עוד יומיים" : `עוד ${fmtQty(n)} ימים`);

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${fmtQty(n)} ${many}`);

type Tone = "short" | "out" | "warn" | "ok";

interface Priority {
  key: string;
  /** Lower first. */
  rank: number;
  tone: Tone;
  /** The kind, in a word. */
  word: string;
  title: string;
  /** What it costs or holds up. */
  impact: string;
  /** Where it stands on the floor. */
  where: string | null;
  /** The one press that starts dealing with it. */
  action: string;
  productIds: readonly string[];
  run: () => void;
}

/** When this browser last looked, read once on arrival and written on the way out. */
function useLastSeen(): number | null {
  const [seen] = useState<number | null>(() => {
    try {
      const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SEEN_KEY);
      return raw ? Number(raw) || null : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const write = () => {
      try {
        localStorage.setItem(SEEN_KEY, String(Date.now()));
      } catch {
        // A browser without storage simply never says what changed.
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") write();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      write();
    };
  }, []);
  return seen;
}

/* ───────── one row of what needs a decision ───────── */

function PriorityRow({ item, onSpot }: { item: Priority; onSpot: (ids: readonly string[] | null) => void }): ReactElement {
  return (
    <li className={cx("m3-prio", `is-${item.tone}`)} onPointerEnter={() => onSpot(item.productIds)} onPointerLeave={() => onSpot(null)} onFocus={() => onSpot(item.productIds)} onBlur={() => onSpot(null)}>
      <button type="button" className="m3-prio-main" onClick={item.run}>
        <span className="m3-prio-word">{item.word}</span>
        <span className="m3-prio-text">
          <span className="m3-prio-title">{item.title}</span>
          <span className="m3-prio-sub">
            {item.impact}
            {item.where ? <> · <span className="ltr">{item.where}</span></> : null}
          </span>
        </span>
      </button>
      <Button variant="secondary" size="sm" className="m3-prio-key" onClick={item.run}>{item.action}</Button>
    </li>
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

function runwayWord(r: Runway): { word: string; tone: string } {
  if (r.state === "short") return { word: `חסר ${fmtQty(-r.free)}`, tone: "mh-tone-short" };
  if (r.state === "out") return { word: "אזל", tone: "mh-tone-out" };
  if (r.free <= 0) return { word: "הכל משוריין", tone: "mh-tone-warn" };
  if (r.days === null) return { word: "מתחת למינימום", tone: "mh-tone-warn" };
  return { word: fmtDays(r.days), tone: r.state === "low" ? "mh-tone-warn" : "" };
}

/* ───────── the page ───────── */

export function Overview(): ReactElement {
  const { state, stats, product, linesOf } = useData();
  const { openProduct, openOrder, openFault, openAction } = useUi();
  const { dismissed, dismiss } = useDismissedAlerts();
  const { spotProduct, spotObjects, itemsOf, placeOf } = useTwin();
  const router = useRouter();
  const lastSeen = useLastSeen();

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

  /* ───────── the facts the sentence and the rows are made of ───────── */
  const openOrders = useMemo(() => state.orders.filter((o) => o.status === "open").reverse().sort(byPromise), [state.orders]);
  const shortOf = useCallback((o: Order) => linesOf(o.id).filter((l) => {
    const p = product(l.product_id);
    return p ? available(p) < 0 : false;
  }), [linesOf, product]);
  const lateBy = (o: Order) => (o.promised_on ? -daysUntil(o.promised_on) : 0);

  const atRisk = useMemo(() => openOrders.map((o) => ({ order: o, short: shortOf(o), late: lateBy(o) })).filter((r) => r.short.length > 0 || r.late > 0), [openOrders, shortOf]);
  const openFaults = useMemo(() => state.faults.filter((f) => f.status === "open").slice().reverse(), [state.faults]);
  const pendingNames = useMemo(() => state.supplierItems.filter((i) => i.status === "pending"), [state.supplierItems]);
  const pendingRequests = useMemo(() => state.itemRequests.filter((r) => r.status === "pending"), [state.itemRequests]);
  const shortProducts = useMemo(() => soon.filter((r) => r.state === "short"), [soon]);
  const emptyProducts = useMemo(() => soon.filter((r) => r.state === "out" || r.state === "low"), [soon]);

  const placeWord = useCallback((p: Product | undefined) => (p ? itemsOf(p.id)[0]?.place ?? placeOf(p.id) ?? p.location : null), [itemsOf, placeOf]);
  const faultPlace = useCallback((f: Fault) => f.asset ?? placeWord(product(f.product_id)), [placeWord, product]);

  /* ───────── the rows: what needs a decision, the gravest first ───────── */
  const priorities = useMemo<Priority[]>(() => {
    const rows: Priority[] = [];
    for (const { order: o, short, late } of atRisk) {
      const firstShort = product(short[0]?.product_id);
      const impact = [
        short.length > 0 ? `חסר במלאי ל-${count(short.length, "שורה אחת", "שורות")}` : null,
        late > 0 ? `באיחור ${late === 1 ? "של יום" : `של ${fmtQty(late)} ימים`}` : null,
        orderTotal(linesOf(o.id)) !== null ? fmtPrice(orderTotal(linesOf(o.id))) : null,
      ].filter(Boolean).join(" · ");
      rows.push({
        key: `order:${o.id}`,
        rank: short.length > 0 ? 0 : 2,
        tone: short.length > 0 ? "short" : "warn",
        word: short.length > 0 ? "הזמנה בסיכון" : "הזמנה באיחור",
        title: `${o.customer} · הזמנה ${o.number}`,
        impact,
        where: placeWord(firstShort),
        action: short.length > 0 ? "פתיחת ההזמנה" : "סימון כנמסרה",
        productIds: short.map((l) => l.product_id),
        run: () => openOrder(o.id),
      });
    }
    for (const f of openFaults) {
      const p = product(f.product_id);
      rows.push({
        key: `fault:${f.id}`,
        rank: 1,
        tone: "out",
        word: "תקלה",
        title: f.description,
        impact: [`פתוחה ${fmtAge(f.created_at)}`, p ? fmtName(p.name) : null].filter(Boolean).join(" · "),
        where: faultPlace(f),
        action: "סגירה עם תיעוד",
        productIds: f.product_id ? [f.product_id] : [],
        run: () => openFault(f.id),
      });
    }
    for (const r of emptyProducts) {
      const { word } = runwayWord(r);
      rows.push({
        key: `stock:${r.product.id}`,
        rank: r.state === "out" ? 3 : 4,
        tone: r.state === "out" ? "out" : "warn",
        word: r.state === "out" ? "אזל" : "מתחת למינימום",
        title: fmtName(r.product.name),
        impact: r.state === "out" ? (r.product.reserved > 0 ? `${count(r.product.reserved, "יחידה אחת משוריינת", "יחידות משוריינות")} להזמנות` : "אין על המדף") : `זמין ${fmtQty(r.free)} · מינימום ${fmtQty(r.product.min_qty)}${r.days !== null ? ` · ${word}` : ""}`,
        where: placeWord(r.product),
        action: "להזמין מהספק",
        productIds: [r.product.id],
        run: () => openProduct(r.product.id),
      });
    }
    const pending = pendingNames.length + pendingRequests.length;
    if (pending > 0) {
      rows.push({
        key: "pending",
        rank: 5,
        tone: "warn",
        word: "ממתין לאישור",
        title: [pendingNames.length > 0 ? count(pendingNames.length, "שם ספק אחד", "שמות ספקים") : null, pendingRequests.length > 0 ? count(pendingRequests.length, "שורה אחת מקליטה", "שורות מקליטה") : null].filter(Boolean).join(" ו-"),
        impact: "קליטה בשם הזה לא תזוהה עד שיאושר",
        where: null,
        action: "לאשר",
        productIds: [],
        run: () => (pendingRequests[0] ? openAction("review-item-request", { requestId: pendingRequests[0].id }) : router.push("/suppliers")),
      });
    }
    return rows.sort((a, b) => a.rank - b.rank).slice(0, PRIORITIES);
  }, [atRisk, openFaults, emptyProducts, pendingNames, pendingRequests, product, linesOf, placeWord, faultPlace, openOrder, openFault, openProduct, openAction, router]);

  const decisions = atRisk.length + openFaults.length + emptyProducts.length + (pendingNames.length + pendingRequests.length > 0 ? 1 : 0);

  /* ───────── the sentence: the gravest fact first, in plain rules ───────── */
  const pulse = useMemo(() => {
    const shortOrders = atRisk.filter((r) => r.short.length > 0).length;
    const lateOrders = atRisk.filter((r) => r.short.length === 0).length;
    if (shortOrders > 0) return { text: `${count(shortProducts.length, "חוסר אחד עלול", "חוסרים עלולים")} לעכב ${count(shortOrders, "הזמנה אחת", "הזמנות")}.`, tone: "short" as const };
    if (lateOrders > 0) return { text: `${count(lateOrders, "הזמנה אחת", "הזמנות")} באיחור מול הלקוח.`, tone: "warn" as const };
    if (openFaults.length > 0) return { text: `${count(openFaults.length, "תקלה אחת פתוחה", "תקלות פתוחות")} במחסן.`, tone: "out" as const };
    if (emptyProducts.length > 0) return { text: `הפעילות תקינה. ${count(emptyProducts.length, "מוצר אחד", "מוצרים")} להשלמה מהספק.`, tone: "warn" as const };
    return { text: decisions > 0 ? `הפעילות תקינה. ${count(decisions, "נושא אחד דורש", "נושאים דורשים")} החלטה.` : "הפעילות תקינה. אין מה לטפל.", tone: "ok" as const };
  }, [atRisk, shortProducts.length, openFaults.length, emptyProducts.length, decisions]);

  /* ───────── what came in since this browser last looked ───────── */
  const fresh = useMemo(() => {
    if (lastSeen === null) return null;
    const after = (iso: string) => Date.parse(iso) > lastSeen;
    const moves = state.movements.filter((m) => after(m.created_at)).length;
    const faults = state.faults.filter((f) => after(f.created_at)).length;
    const orders = state.orders.filter((o) => after(o.created_at)).length;
    const names = state.supplierItems.filter((i) => i.status === "pending" && after(i.created_at)).length;
    const parts = [
      moves > 0 ? count(moves, "תנועה אחת", "תנועות") : null,
      orders > 0 ? count(orders, "הזמנה חדשה", "הזמנות חדשות") : null,
      faults > 0 ? count(faults, "תקלה חדשה", "תקלות חדשות") : null,
      names > 0 ? count(names, "שם ספק חדש", "שמות ספק חדשים") : null,
    ].filter((v): v is string => v !== null);
    const grave = faults > 0 || names > 0;
    return { text: parts.length ? `מאז הביקור האחרון: ${parts.join(" · ")}` : "לא זוהו אירועים חדשים מאז הביקור האחרון", grave, when: fmtRelative(new Date(lastSeen).toISOString()) };
  }, [lastSeen, state.movements, state.faults, state.orders, state.supplierItems]);

  const promises = { open: openOrders.length, uncovered: atRisk.filter((r) => r.short.length > 0).length };
  const covered = promises.open > 0 ? Math.floor(((promises.open - promises.uncovered) / promises.open) * 100) : 0;

  /* ───────── the model answers what you point at ───────── */
  const onSpot = useCallback((id: string | null | undefined) => spotProduct(id ?? null), [spotProduct]);
  const onSpotMany = useCallback(
    (ids: readonly string[] | null) => {
      if (!ids || ids.length === 0) {
        spotObjects(null);
        return;
      }
      const places = [...new Set(ids.flatMap((id) => itemsOf(id).map((item) => item.objectId)))];
      spotObjects(places.length ? places : null);
    },
    [spotObjects, itemsOf],
  );
  const onSpotMove = useCallback((m: Movement | null) => spotProduct(m?.product_id ?? null), [spotProduct]);

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

  useLayoutEffect(() => {
    const figures = stage.current;
    return () => {
      const world = document.querySelector(".mh-world");
      if (!figures || !world || window.scrollY > 0 || document.querySelector(".app-panelHost") || window.matchMedia("(max-width: 899px), (prefers-reduced-motion: reduce)").matches) return;
      const ghost = figures.cloneNode(true) as HTMLElement;
      ghost.classList.add("mh-ghost");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.addEventListener("animationend", () => ghost.remove());
      world.append(ghost);
    };
  }, []);

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

  const latest = state.movements[0];
  const outChange = pctChange(flow.outWeek, flow.outBefore);
  const inChange = pctChange(flow.inWeek, flow.inBefore);
  const change = (n: number | null) => (n === null ? null : <span className={cx("ltr", n > 0 ? "mh-tone-in" : n < 0 ? "mh-tone-out" : undefined)}>{`${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtQty(Math.abs(n))}%`}</span>);

  return (
    <div className="mh-ov m3-ov">
      <h1 className="sa-sr">סקירה</h1>
      <section ref={stage} className="mh-ov-stage" aria-label="תמונת מצב">
        <div className="mh-ov-figures m3-ov-figures">
          <p className="mh-ov-date">{fmtToday()}</p>

          {/* The sentence: how the factory is, in the gravest fact. */}
          <p className={cx("m3-pulse", `is-${pulse.tone}`)} role="status">{pulse.text}</p>
          <p className="m3-pulse-sub">
            {decisions > 0 ? count(decisions, "נושא אחד דורש החלטה", "נושאים דורשים החלטה") : "אין נושאים פתוחים"}
            {fresh ? <> · <span className={fresh.grave ? "mh-tone-warn" : undefined}>{fresh.text}</span></> : null}
          </p>

          {priorities.length > 0 ? (
            <ol className="m3-prios" aria-label="דורש החלטה">
              {priorities.map((item) => <PriorityRow key={item.key} item={item} onSpot={onSpotMany} />)}
            </ol>
          ) : null}

          {decisions > PRIORITIES ? (
            <p className="m3-prios-more">
              {atRisk.length > 0 ? <Link href="/orders">{count(atRisk.length, "הזמנה אחת בסיכון", "הזמנות בסיכון")}</Link> : null}
              {openFaults.length > 0 ? <Link href="/faults">{count(openFaults.length, "תקלה אחת", "תקלות")}</Link> : null}
              {emptyProducts.length > 0 ? <Link href={stats.out > 0 ? "/inventory?filter=out" : "/inventory?filter=low"}>{count(emptyProducts.length, "מוצר אחד להשלמה", "מוצרים להשלמה")}</Link> : null}
              {pendingNames.length + pendingRequests.length > 0 ? <Link href="/suppliers">{count(pendingNames.length + pendingRequests.length, "ממתין אחד", "ממתינים")}</Link> : null}
            </p>
          ) : null}

          {/* The money, quiet, each figure a way to its page. */}
          <dl className="m3-ov-strip">
            <Link href="/inventory" className="m3-ov-fig">
              <dt>שווי המלאי במחירון</dt>
              <dd><Figure sign="₪" text={fmtCompact(worth.total).replace("₪", "")} /></dd>
              <dd className="m3-ov-note">{worth.unpriced > 0 ? `${fmtQty(worth.unpriced)} מוצרים ללא מחיר` : `זמין ${fmtCompact(worth.free)} · משוריין ${fmtCompact(worth.held)}`}</dd>
            </Link>
            <Link href="/orders" className="m3-ov-fig">
              <dt>הזמנות מכוסות</dt>
              <dd><Figure className={cx(promises.open === 0 ? "" : promises.uncovered > 0 ? "mh-tone-short" : "mh-tone-ok")} text={promises.open === 0 ? "—" : `${covered}%`} /></dd>
              <dd className="m3-ov-note">{promises.open === 0 ? "אין הזמנות פתוחות" : promises.uncovered > 0 ? `חסר מלאי ל-${fmtQty(promises.uncovered)} מתוך ${fmtQty(promises.open)}` : `${fmtQty(promises.open)} פתוחות, הכל על המדף`}</dd>
            </Link>
          </dl>
        </div>

        <div className="mh-ov-floor">
          <div className="mh-ov-bottom">
            <dl className="mh-ov-week">
              <div>
                <dt>יצא השבוע</dt>
                <dd><Figure sign="₪" text={whole(flow.outWeek)} /></dd>
                <dd className="mh-ov-before">{change(outChange) ?? <>שבוע קודם ₪{whole(flow.outBefore)}</>}{outChange !== null ? " משבוע קודם" : null}</dd>
              </div>
              <div>
                <dt>נכנס השבוע</dt>
                <dd><Figure sign="₪" text={whole(flow.inWeek)} /></dd>
                <dd className="mh-ov-before">{change(inChange) ?? <>שבוע קודם ₪{whole(flow.inBefore)}</>}{inChange !== null ? " משבוע קודם" : null}</dd>
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
              {openOrders.slice(0, 6).map((o) => {
                const lines = linesOf(o.id);
                const first = product(lines[0]?.product_id);
                const total = orderTotal(lines);
                const short = shortOf(o).length > 0;
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
              {openOrders.length === 0 ? <li className="mh-empty">אין הזמנות פתוחות</li> : null}
            </ul>
          </Column>
        </div>
      </div>
    </div>
  );
}
