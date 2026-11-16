"use client";

/**
 * סקירה as mission control, and only that: what waits for a person. The model keeps the stage, as in מרחב; where the big
 * figure stood there is one sentence that says how the factory is, worked out from the rows by plain rules, then one
 * line that counts everything waiting, each count a way to the page that owns it, then the few things that need a
 * decision, each with what it is, what it costs, where it is and the one press that starts dealing with it. The money
 * stands under them, quiet. Lists of products and orders are their pages' own, so none stands here. The sums are the
 * shared ones (src/lib/snapshot.ts), and the counts are the ones those pages show, so the two can never disagree.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";
import { Button, cx, Notice } from "@/components/ui";
import { byPromise, daysUntil, fmtAge, fmtCompact, fmtName, fmtPrice, fmtQty, fmtRelative, fmtToday } from "@/lib/format";
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

/** How long a product under its minimum has left at this month's pace, when there is a pace to go by. */
function runwayWord(r: Runway): string | null {
  if (r.state === "short" || r.state === "out") return null;
  if (r.free <= 0) return "הכל משוריין";
  return r.days === null ? null : fmtDays(r.days);
}

/* ───────── the page ───────── */

export function Overview(): ReactElement {
  const { state, stats, product, linesOf } = useData();
  const { openProduct, openOrder, openFault } = useUi();
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

  // Every product under its minimum, as מוצרים counts it under להשלמה: a count here that its page can't show would be a second truth.
  const soon = useMemo(() => runway(state.products, month).filter((r) => r.state !== "ok"), [state.products, month]);

  /* ───────── the facts the sentence and the rows are made of ───────── */
  const openOrders = useMemo(() => state.orders.filter((o) => o.status === "open").reverse().sort(byPromise), [state.orders]);
  const shortOf = useCallback((o: Order) => linesOf(o.id).filter((l) => {
    const p = product(l.product_id);
    return p ? available(p) < 0 : false;
  }), [linesOf, product]);
  const lateBy = (o: Order) => (o.promised_on ? -daysUntil(o.promised_on) : 0);

  const atRisk = useMemo(() => openOrders.map((o) => ({ order: o, short: shortOf(o), late: lateBy(o) })).filter((r) => r.short.length > 0 || r.late > 0), [openOrders, shortOf]);
  const openFaults = useMemo(() => state.faults.filter((f) => f.status === "open").slice().reverse(), [state.faults]);
  // The names קטלוג keeps under ממתינים לאישור: waiting for a decision, or left with no product.
  const pendingNames = useMemo(() => state.supplierItems.filter((i) => i.status === "pending" || !i.product_id || !product(i.product_id)), [state.supplierItems, product]);
  const pendingRequests = useMemo(() => state.itemRequests.filter((r) => r.status === "pending"), [state.itemRequests]);
  const pending = pendingNames.length + pendingRequests.length;
  const shortProducts = useMemo(() => soon.filter((r) => r.state === "short"), [soon]);
  const emptyProducts = useMemo(() => soon.filter((r) => r.state === "out" || r.state === "low"), [soon]);

  const placeWord = useCallback((p: Product | undefined) => (p ? itemsOf(p.id)[0]?.place ?? placeOf(p.id) ?? p.location : null), [itemsOf, placeOf]);
  const faultPlace = useCallback((f: Fault) => f.asset ?? placeWord(product(f.product_id)), [placeWord, product]);

  /* ───────── the rows: what needs a decision, the gravest first ───────── */
  const priorities = useMemo<Priority[]>(() => {
    const rows: Priority[] = [];
    for (const { order: o, short, late } of atRisk) {
      const firstShort = product(short[0]?.product_id);
      // The kind is said once, in the word הזמנות groups it under; the line under says what the word doesn't.
      const impact = [
        short.length > 0 ? `${count(short.length, "שורה אחת", "שורות")} בלי מלאי` : null,
        late > 0 ? (short.length > 0 ? `באיחור ${late === 1 ? "של יום" : `של ${fmtQty(late)} ימים`}` : `${late === 1 ? "יום אחד" : `${fmtQty(late)} ימים`} אחרי מועד המסירה`) : null,
        orderTotal(linesOf(o.id)) !== null ? fmtPrice(orderTotal(linesOf(o.id))) : null,
      ].filter(Boolean).join(" · ");
      rows.push({
        key: `order:${o.id}`,
        rank: short.length > 0 ? 0 : 2,
        tone: short.length > 0 ? "short" : "warn",
        word: short.length > 0 ? "חסר במלאי" : "באיחור",
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
      const left = runwayWord(r);
      rows.push({
        key: `stock:${r.product.id}`,
        rank: r.state === "out" ? 3 : 4,
        tone: r.state === "out" ? "out" : "warn",
        word: r.state === "out" ? "אזל" : "מתחת למינימום",
        title: fmtName(r.product.name),
        impact: r.state === "out" ? (r.product.reserved > 0 ? `${count(r.product.reserved, "יחידה אחת משוריינת", "יחידות משוריינות")} להזמנות` : "אין על המדף") : `זמין ${fmtQty(r.free)} · מינימום ${fmtQty(r.product.min_qty)}${left ? ` · ${left}` : ""}`,
        where: placeWord(r.product),
        action: "להזמין מהספק",
        productIds: [r.product.id],
        run: () => openProduct(r.product.id),
      });
    }
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
        // Everything that waits for an approval stands on קטלוג, so the key goes to that one list.
        run: () => router.push("/suppliers"),
      });
    }
    return rows.sort((a, b) => a.rank - b.rank).slice(0, PRIORITIES);
  }, [atRisk, openFaults, emptyProducts, pending, pendingNames.length, pendingRequests.length, product, linesOf, placeWord, faultPlace, openOrder, openFault, openProduct, router]);

  const shortOrders = atRisk.filter((r) => r.short.length > 0).length;
  const lateOrders = atRisk.length - shortOrders;

  /* ───────── the sentence: the gravest fact first, in plain rules ───────── */
  const pulse = useMemo(() => {
    if (shortOrders > 0) return { text: `${count(shortProducts.length, "חוסר אחד עלול", "חוסרים עלולים")} לעכב ${count(shortOrders, "הזמנה אחת", "הזמנות")}.`, tone: "short" as const };
    if (lateOrders > 0) return { text: `${count(lateOrders, "הזמנה אחת", "הזמנות")} באיחור מול הלקוח.`, tone: "warn" as const };
    if (openFaults.length > 0) return { text: `${count(openFaults.length, "תקלה אחת פתוחה", "תקלות פתוחות")} במחסן.`, tone: "out" as const };
    if (emptyProducts.length > 0) return { text: `הפעילות תקינה. ${count(emptyProducts.length, "מוצר אחד", "מוצרים")} להשלמה מהספק.`, tone: "warn" as const };
    if (pending > 0) return { text: `הפעילות תקינה. ${count(pending, "שם אחד ממתין", "שמות ממתינים")} לאישור.`, tone: "ok" as const };
    return { text: "הפעילות תקינה. אין מה לטפל.", tone: "ok" as const };
  }, [shortOrders, lateOrders, shortProducts.length, openFaults.length, emptyProducts.length, pending]);

  /* ───────── everything that waits, counted as the page that owns it counts it ───────── */
  const waiting = [
    shortOrders > 0 ? { key: "short", href: "/orders", text: count(shortOrders, "הזמנה אחת בחוסר", "הזמנות בחוסר") } : null,
    lateOrders > 0 ? { key: "late", href: "/orders", text: count(lateOrders, "הזמנה אחת באיחור", "הזמנות באיחור") } : null,
    openFaults.length > 0 ? { key: "faults", href: "/faults", text: count(openFaults.length, "תקלה פתוחה", "תקלות פתוחות") } : null,
    emptyProducts.length > 0 ? { key: "restock", href: "/inventory?filter=restock", text: count(emptyProducts.length, "מוצר אחד להשלמה", "מוצרים להשלמה") } : null,
    pending > 0 ? { key: "pending", href: "/suppliers", text: count(pending, "ממתין אחד לאישור", "ממתינים לאישור") } : null,
  ].filter((item): item is { key: string; href: string; text: string } => item !== null);

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
          {/* Everything that waits, by kind, each a way to the one page that holds it. Never a sum of unlike things. */}
          {waiting.length > 0 ? (
            <nav className="m3-waiting" aria-label="מה מחכה">
              {/* A space between two counts is where a line may break. */}
              {waiting.map((item, i) => (
                <Fragment key={item.key}>
                  {i > 0 ? " " : null}
                  <Link href={item.href}>{item.text}</Link>
                </Fragment>
              ))}
            </nav>
          ) : null}
          {fresh ? <p className="m3-pulse-sub"><span className={fresh.grave ? "mh-tone-warn" : undefined}>{fresh.text}</span></p> : null}
          {monthFailed ? (
            <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retryMonth}>הסכומים מחושבים רק לפי מה שנטען</Notice>
          ) : null}

          {priorities.length > 0 ? (
            <ol className="m3-prios" aria-label="דורש החלטה">
              {priorities.map((item) => <PriorityRow key={item.key} item={item} onSpot={onSpotMany} />)}
            </ol>
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
              <dd className="m3-ov-note">{promises.open === 0 ? "אין הזמנות פתוחות" : promises.uncovered > 0 ? `${fmtQty(promises.open - promises.uncovered)} מתוך ${fmtQty(promises.open)} פתוחות` : `${fmtQty(promises.open)} פתוחות, הכל על המדף`}</dd>
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
    </div>
  );
}
