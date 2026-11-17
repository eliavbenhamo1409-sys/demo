"use client";

/**
 * סקירת מנהל, in the order a manager thinks at the start of a day: what needs me, where the factory stands, what is
 * going out and what just happened, and only then money and shares. Nothing here has to be worked out by the reader:
 * the first tasks are already ranked, and each says why it is there and what its button does.
 */
import Link from "next/link";
import { useMemo, type ReactElement, type ReactNode } from "react";
import { PieSheet, type Pie } from "@/components/app/Snapshot";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, EmptyState, MovementQty, Notice } from "@/components/ui";
import { byPromise, daysUntil, fmtAge, fmtCompact, fmtName, fmtPrice, fmtPromised, fmtQty, fmtRelative, fmtToday, fmtUnit, MOVEMENT_LABEL } from "@/lib/format";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { inBySupplier, movedWorth, PACE_DAYS, pctChange, salesByCustomer, shelfWorth, sumShares, topShares, worthByCategory } from "@/lib/snapshot";
import { orderTotal, useData } from "@/lib/store";
import type { LineName } from "../icons";
import { Line } from "../icons";
import { useLastVisit } from "../last-visit";
import { Block, Chapter, Check, DayRing, JustHandled, lineTone, Metrics, Page, useDayProgress, Word, type Metric, type Tone } from "../parts";
import { useShortages, useWaiting } from "../use-work";
import { ageDays, isLate, isUncovered, listWords, many, orderFacts, pendingNames, pendingRequests } from "../work";

/** The tasks the overview names; the pages under דורש טיפול hold the rest. */
const FIRST_TASKS = 5;
const ORDER_ROWS = 6;
const MOVE_ROWS = 6;

type Task = { key: string; icon: LineName; tone: Tone; title: string; why: string; action: string; rank: number; run: () => void };

const count = (n: number, one: string, more: string) => `${fmtQty(n)} ${n === 1 ? one : more}`;

/** A week's sum against the week before, as a signed percent in its colour. */
function weekNote(now: number, before: number): ReactNode {
  const change = pctChange(now, before);
  if (change === null) return <>שבוע קודם <span className="ltr">{fmtCompact(before)}</span></>;
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return (
    <>
      <span className={`ltr ${change > 0 ? "is-up" : change < 0 ? "is-down" : ""}`}>{`${sign}${fmtQty(Math.abs(change))}%`}</span> משבוע קודם
    </>
  );
}

export function Overview(): ReactElement {
  const { state, product, supplier, worker, linesOf } = useData();
  const { openAction, openFault, openMovement, openOrder, openProduct } = useUi();
  const waiting = useWaiting();
  const shortages = useShortages();
  const progress = useDayProgress();

  const since = useMemo(() => midnight(1 - PACE_DAYS), []);
  const { rows: month, isLoading: monthLoading, failed: monthFailed, retry: retryMonth } = useMovementsInRange(since, null);

  /* ───────── the first tasks, ranked by what they block ───────── */
  const tasks = useMemo<Task[]>(() => {
    const list: Task[] = [];

    for (const s of shortages) {
      const p = s.product;
      const unit = fmtUnit(s.gap, p.unit);
      if (s.level === "short") {
        const days = s.nearest ? daysUntil(s.nearest) : null;
        const when = s.nearest ? `המסירה הקרובה ${fmtPromised(s.nearest)}` : "מועד המסירה לא נקבע";
        list.push({
          key: `short:${p.id}`, icon: "package-x", tone: "short", title: fmtName(p.name),
          why: `${s.gap === 1 ? "חסרה" : "חסרות"} ${fmtQty(s.gap)} ${unit} ${s.orders.length === 1 ? "להזמנה קיימת" : `ל-${fmtQty(s.orders.length)} הזמנות קיימות`} · ${when}`,
          action: "בדיקת חוסר", rank: 1000 + (days === null ? 0 : days < 0 ? 200 + Math.min(60, -days) : days <= 2 ? 100 : 0), run: () => openProduct(p.id),
        });
      } else if (s.level === "out") {
        list.push({ key: `out:${p.id}`, icon: "package-x", tone: "bad", title: fmtName(p.name), why: "אזל במלאי · אין הזמנה שמחכה לו", action: "פרטי מוצר", rank: 450, run: () => openProduct(p.id) });
      } else {
        const cover = p.min_qty > 0 ? Math.max(0, s.free) / p.min_qty : 1;
        list.push({
          key: `low:${p.id}`, icon: "package-minus", tone: "warn", title: fmtName(p.name),
          why: `זמין ${fmtQty(s.free)} ${fmtUnit(s.free, p.unit)} · המינימום ${fmtQty(p.min_qty)}`,
          action: "פרטי מוצר", rank: 300 + Math.round((1 - cover) * 50), run: () => openProduct(p.id),
        });
      }
    }

    for (const f of state.faults) {
      if (f.status !== "open") continue;
      const p = product(f.product_id);
      const what = p ? fmtName(p.name) : DEFAULT_OBJECTS.find((o) => o.id === f.asset)?.name ?? f.asset;
      const reporter = worker(f.reported_by)?.name;
      const holder = worker(f.assigned_to)?.name;
      const age = Math.min(30, ageDays(f.created_at));
      list.push({
        key: `fault:${f.id}`, icon: "wrench", tone: "bad", title: f.description,
        why: [what, `דווחה ${fmtAge(f.created_at)}${reporter ? ` על ידי ${reporter}` : ""}`, holder ? `אצל ${holder}${f.acknowledged_at ? ", התקבלה" : ""}` : "טרם שובץ אחראי"].filter(Boolean).join(" · "),
        action: holder ? "פרטי תקלה" : "פתיחת תקלה", rank: (holder ? 350 : 800) + age, run: () => openFault(f.id),
      });
    }

    for (const r of pendingRequests(state.itemRequests)) {
      const sender = worker(r.worker_id)?.name;
      list.push({
        key: `request:${r.id}`, icon: "stamp", tone: "warn", title: `${fmtName(r.proposed_name?.trim() || r.external_name)} × ${fmtQty(r.qty)}`,
        why: [r.kind === "new_product" ? "מוצר חדש שעובד ביקש לפתוח" : "שורה שעובד לא זיהה בקבלה", r.customer ? `ללקוח ${r.customer}` : null, sender ? `נשלח על ידי ${sender}` : null, fmtAge(r.created_at)].filter(Boolean).join(" · "),
        action: "בדיקת השורה", rank: 700, run: () => openAction("review-item-request", { requestId: r.id }),
      });
    }

    for (const i of pendingNames(state.supplierItems, product)) {
      const guess = product(i.product_id);
      list.push({
        key: `name:${i.id}`, icon: "link-2", tone: "warn", title: i.external_name,
        why: [supplier(i.supplier_id)?.name, guess ? `הוצע: ${fmtName(guess.name)}` : "ממתין לשיוך למוצר במחסן"].filter(Boolean).join(" · "),
        action: "שיוך מוצר", rank: 500 + Math.min(20, i.times_seen), run: () => openAction("map-supplier-item", { supplierItemId: i.id }),
      });
    }

    return list.sort((a, b) => b.rank - a.rank);
  }, [shortages, state.faults, state.itemRequests, state.supplierItems, product, supplier, worker, openAction, openFault, openProduct]);

  /* ───────── the head ───────── */
  const quiet = waiting.total === 0;
  const hurting = shortages.filter((s) => s.level === "short").length;
  const waitingWords = listWords([
    waiting.faults > 0 ? many(waiting.faults, "תקלה אחת", "תקלות") : "",
    waiting.approvals > 0 ? many(waiting.approvals, "אישור אחד", "אישורים") : "",
    waiting.shortages > 0 ? many(waiting.shortages, "חוסר אחד", "חוסרים") : "",
  ].filter(Boolean));
  const lead = quiet
    ? "אין תקלות פתוחות, אין אישורים שמחכים והמלאי מעל המינימום. אפשר להתרכז בעבודה."
    : <><strong>{waitingWords}</strong> {waiting.total === 1 ? "מחכה" : "מחכים"} לבדיקה{hurting > 0 ? <>, {hurting === 1 ? "ואחד מהחוסרים פוגע" : `ו-${fmtQty(hurting)} מהחוסרים פוגעים`} בהזמנות קיימות</> : null}. המשימה הראשונה ברשימה היא הדחופה ביותר.</>;

  /* ───────── what happened while the manager was away ───────── */
  const lastVisit = useLastVisit();
  const away = useMemo(() => {
    if (lastVisit === null) return null;
    // The movements at hand reach back a month, so a longer absence is told from there.
    const from = Math.max(lastVisit, since);
    const after = (iso: string | null) => iso !== null && Date.parse(iso) >= from;
    const delivered = state.orders.filter((o) => o.status === "delivered" && after(o.closed_at)).length;
    const placed = state.orders.filter((o) => after(o.created_at)).length;
    const closed = state.faults.filter((f) => f.status === "resolved" && after(f.resolved_at)).length;
    const received = movedWorth(month, "in", from, Number.POSITIVE_INFINITY, product);
    const parts = [
      delivered > 0 ? <>{delivered === 1 ? "נמסרה" : "נמסרו"} <b>{many(delivered, "הזמנה אחת", "הזמנות")}</b></> : null,
      placed > 0 ? <>{placed === 1 ? "נפתחה" : "נפתחו"} <b>{many(placed, "הזמנה חדשה", "הזמנות חדשות")}</b></> : null,
      closed > 0 ? <>{closed === 1 ? "נסגרה" : "נסגרו"} <b>{many(closed, "תקלה אחת", "תקלות")}</b></> : null,
      received > 0 ? <>נקלטה סחורה ב-<b className="ltr">{fmtCompact(received)}</b></> : null,
    ].filter((part) => part !== null);
    return { when: fmtAge(new Date(lastVisit).toISOString()), capped: lastVisit < since, parts };
  }, [lastVisit, since, state.orders, state.faults, month, product]);

  /* ───────── what needs handling ───────── */
  const unheld = state.faults.filter((f) => f.status === "open" && !f.assigned_to).length;
  const needs: Metric[] = [
    {
      key: "faults", label: "תקלות פתוחות", icon: "wrench", value: waiting.faults, tone: waiting.faults > 0 ? "bad" : "ok", href: "/faults",
      note: waiting.faults === 0 ? <span className="is-ok">אין תקלות פתוחות</span> : unheld > 0 ? `${unheld === 1 ? "אחת מחכה" : `${fmtQty(unheld)} מחכות`} לשיוך אחראי` : "כולן אצל עובד",
    },
    {
      key: "approvals", label: "ממתינים לאישור", icon: "stamp", value: waiting.approvals, tone: waiting.approvals > 0 ? "warn" : "ok", href: "/closing?view=approvals",
      note: waiting.approvals === 0 ? <span className="is-ok">אין מה לאשר</span> : "החלטת מנהל",
    },
    {
      key: "shortages", label: "חוסרים במלאי", icon: "package-x", value: waiting.shortages, tone: waiting.shortages === 0 ? "ok" : hurting > 0 ? "short" : "warn", href: "/inventory?view=shortages",
      note: waiting.shortages === 0 ? <span className="is-ok">המלאי מעל המינימום</span> : hurting > 0 ? <span className="is-short">{hurting === 1 ? "אחד פוגע" : `${fmtQty(hurting)} פוגעים`} בהזמנות</span> : "מתחת למינימום, לא חוסם הזמנה",
    },
  ];

  /* ───────── where the factory stands ───────── */
  const orders = useMemo(() => orderFacts(state.orders, linesOf, product), [state.orders, linesOf, product]);
  const worth = useMemo(() => shelfWorth(state.products), [state.products]);
  const standing: Metric[] = [
    { key: "open", label: "הזמנות פתוחות", value: orders.open, href: "/orders", note: orders.open === 0 ? "אין הזמנות פתוחות" : <span className="is-ok">{count(orders.ready, "מוכנה למסירה", "מוכנות למסירה")}</span> },
    {
      key: "late", label: "הזמנות באיחור", value: orders.late, tone: orders.late > 0 ? "warn" : "ok", href: "/orders?status=late",
      note: orders.late === 0 ? <span className="is-ok">הכל בזמן</span> : orders.lateWaiting > 0 ? <span className="is-short">{orders.lateWaiting === 1 ? "אחת מחכה" : `${fmtQty(orders.lateWaiting)} מחכות`} למלאי</span> : "כולן מוכנות למסירה",
    },
    { key: "products", label: "מוצרים במלאי", value: state.products.length, href: "/inventory", note: waiting.shortages > 0 ? `${count(waiting.shortages, "דורש", "דורשים")} בדיקה` : <span className="is-ok">כולם תקינים</span> },
    { key: "worth", label: "שווי מלאי", value: <span className="ltr">{fmtCompact(worth.total)}</span>, href: "/inventory", note: worth.unpriced > 0 ? `במחירון · ${count(worth.unpriced, "מוצר ללא מחיר", "מוצרים ללא מחיר")}` : "לפי מחירון, נכון לעכשיו" },
  ];

  /* ───────── orders and deliveries ───────── */
  const nextOrders = useMemo(() => state.orders.filter((o) => o.status === "open").reverse().sort(byPromise), [state.orders]);

  /* ───────── figures and shares ───────── */
  const flow = useMemo(() => {
    const week = midnight(-6), weekBefore = midnight(-13);
    const moved = (type: "in" | "out", from: number, to = Number.POSITIVE_INFINITY) => movedWorth(month, type, from, to, product);
    return { outWeek: moved("out", week), outBefore: moved("out", weekBefore, week), inWeek: moved("in", week), inBefore: moved("in", weekBefore, week) };
  }, [month, product]);

  const delivered = useMemo(() => {
    const rows = state.orders.filter((o) => o.status === "delivered" && o.closed_at && Date.parse(o.closed_at) >= since);
    return { count: rows.length, worth: rows.reduce((sum, o) => sum + (orderTotal(linesOf(o.id)) ?? 0), 0) };
  }, [state.orders, linesOf, since]);

  const trends: Metric[] = [
    { key: "out", label: "יצא השבוע", icon: "arrow-up-from-line", value: <span className="ltr">{fmtCompact(flow.outWeek)}</span>, note: weekNote(flow.outWeek, flow.outBefore), href: "/movements?period=week" },
    { key: "in", label: "נכנס השבוע", icon: "arrow-down-to-line", value: <span className="ltr">{fmtCompact(flow.inWeek)}</span>, tone: "ok", note: weekNote(flow.inWeek, flow.inBefore), href: "/movements?period=week" },
    { key: "sold", label: "נמסר ללקוחות ב-30 יום", icon: "truck", value: <span className="ltr">{fmtCompact(delivered.worth)}</span>, note: delivered.count > 0 ? count(delivered.count, "הזמנה נמסרה", "הזמנות נמסרו") : "לא נמסרו הזמנות", href: "/orders?status=delivered" },
  ];

  const pies = useMemo<Pie[]>(() => {
    const stock = topShares(worthByCategory(state.products));
    const sales = topShares(salesByCustomer(state.orders, linesOf, since));
    const bought = topShares(inBySupplier(month, since, product, supplier));
    const categories = new Set(state.products.filter((p) => p.price !== null && p.qty > 0).map((p) => p.category?.trim() || "")).size;
    const suppliers = new Set(month.filter((m) => m.type === "in" && Date.parse(m.created_at) >= since).map((m) => m.supplier_id ?? "")).size;
    return [
      { key: "stock", label: "שווי המלאי", sub: "לפי קטגוריה · במחירון", slices: stock, total: sumShares(stock), caption: count(categories, "קטגוריה", "קטגוריות"), href: "/inventory", empty: "אין מלאי עם מחיר", loading: false },
      { key: "sales", label: "מכירות", sub: "לפי לקוח · בחודש האחרון", slices: sales, total: sumShares(sales), caption: count(delivered.count, "הזמנה נמסרה", "הזמנות נמסרו"), href: "/orders?view=customers", empty: "לא נמסרו הזמנות בחודש האחרון", loading: false },
      { key: "bought", label: "נכנס מספקים", sub: "לפי ספק · בחודש האחרון · במחירון", slices: bought, total: sumShares(bought), caption: count(suppliers, "ספק", "ספקים"), href: "/suppliers", empty: "לא נקלטה סחורה בחודש האחרון", loading: monthLoading },
    ];
  }, [state.products, state.orders, month, since, linesOf, product, supplier, delivered.count, monthLoading]);

  const today = state.movements.filter((m) => Date.parse(m.created_at) >= midnight());

  return (
    <Page
      className="mn2-overview"
      title="היום במפעל"
      state={{ word: fmtToday(), tone: "none" }}
      lead={
        <>
          {lead}
          {away && !monthLoading ? (
            <span className="mn2-away">
              מאז הביקור האחרון שלך, {away.capped ? "ב-30 הימים האחרונים" : away.when}:{" "}
              {away.parts.length === 0 ? "לא נרשמה פעילות חדשה." : away.parts.map((part, i) => <span key={i}>{i > 0 ? (i === away.parts.length - 1 ? " ו" : ", ") : null}{part}</span>)}
              {away.parts.length > 0 ? "." : null}
            </span>
          ) : null}
        </>
      }
      action={
        <div className={`mn2-day${progress.left === 0 ? " is-full" : ""}`}>
          <DayRing progress={progress} size={48} />
          <div className="mn2-day-text">
            <span className="mn2-day-n">{progress.total === 0 ? "אין מה לטפל" : progress.left === 0 ? "הכל טופל" : <>{fmtQty(progress.done)} <span>מתוך {fmtQty(progress.total)}</span></>}</span>
            <span className="mn2-day-label">{progress.total === 0 ? "שום דבר לא מחכה להחלטה" : progress.left === 0 ? `${count(progress.done, "החלטה", "החלטות")} היום` : "טופלו היום"}</span>
          </div>
        </div>
      }
    >
      <Chapter title="מה דורש טיפול?" ask="לפי דחיפות והשפעה על העבודה · כל מספר פותח את הרשימה שלו">
        <Metrics items={needs} />
        <Block icon="list-checks" title="המשימות הראשונות לבדיקה" sub={tasks.length > 0 ? "מה שחוסם הזמנה או עבודה עומד ראשון" : undefined} count={tasks.length > 0 ? tasks.length : undefined}>
          <JustHandled kind="fault" />
          <JustHandled kind="approval" />
          {tasks.length === 0 ? (
            <div className="mn2-clear">
              <Check size={36} />
              <p className="mn2-clear-title">אין משימות פתוחות</p>
              <p className="mn2-clear-hint">כל מה שחיכה טופל. דיווח חדש מהמחסן יופיע כאן.</p>
            </div>
          ) : (
            <>
              <ul className="mn2-rows">
                {tasks.slice(0, FIRST_TASKS).map((t, i) => (
                  <li key={t.key}>
                    <button type="button" className="mn2-row" onClick={t.run}>
                      <Line name={t.icon} size={22} tone={lineTone(t.tone)} />
                      <span className="mn2-row-text">
                        <span className="mn2-row-title">{t.title}</span>
                        <span className="mn2-row-why">{t.why}</span>
                      </span>
                      <span className={`sa-btn sa-btn-sm ${i === 0 ? "sa-btn-primary" : "sa-btn-secondary"} mn2-row-act`}>{t.action}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {tasks.length > FIRST_TASKS ? <p className="mn2-block-foot">מוצגות {fmtQty(FIRST_TASKS)} הראשונות מתוך {fmtQty(tasks.length)}. הרשימות המלאות נפתחות מהמספרים שמעל.</p> : null}
            </>
          )}
        </Block>
      </Chapter>

      <Chapter title="תמונת מצב של המפעל" ask="רק לדעת · כל מספר פותח את הפירוט שלו">
        <Metrics items={standing} />
      </Chapter>

      <Chapter title="הזמנות ופעילות" ask="מה מוכן, מה מתעכב ומה קרה היום במחסן">
        <div className="mn2-split">
          <Block
            icon="truck"
            title="הזמנות ומסירות"
            sub={orders.open > 0 ? `${count(orders.open, "פתוחה", "פתוחות")} · ${fmtCompact(orders.worth)} · לפי מועד המסירה` : undefined}
            actions={<Link href="/orders" className="sa-btn sa-btn-link sa-btn-sm">כל ההזמנות</Link>}
          >
            <JustHandled kind="order" />
            {nextOrders.length === 0 ? (
              <EmptyState title="אין הזמנות פתוחות" hint="הזמנה של סוכן תופיע כאן" />
            ) : (
              <ul className="mn2-rows">
                {nextOrders.slice(0, ORDER_ROWS).map((o) => {
                  const lines = linesOf(o.id);
                  const short = isUncovered(o, linesOf, product);
                  return (
                    <li key={o.id}>
                      <button type="button" className="mn2-row" onClick={() => openOrder(o.id)}>
                        <ProductThumb product={product(lines[0]?.product_id)} small />
                        <span className="mn2-row-text">
                          <span className="mn2-row-title">{o.customer}</span>
                          <span className="mn2-row-why">
                            הזמנה {o.number} · {o.promised_on ? <span className={isLate(o) ? "mn2-late" : undefined}>{isLate(o) ? fmtPromised(o.promised_on) : `מסירה ${fmtPromised(o.promised_on)}`}</span> : "מועד המסירה לא נקבע"}
                          </span>
                        </span>
                        <span className="mn2-row-end">
                          <span className="mn2-row-n ltr">{fmtPrice(orderTotal(lines))}</span>
                          <Word tone={short ? "short" : "ok"}>{short ? "חסר במלאי" : "מוכן למסירה"}</Word>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Block>

          <Block
            icon="activity"
            title="הפעילות האחרונה במחסן"
            sub={today.length > 0 ? `${count(today.length, "תנועה", "תנועות")} היום` : "אין תנועות היום"}
            actions={<Link href="/movements?period=today" className="sa-btn sa-btn-link sa-btn-sm">כל התנועות</Link>}
          >
            {state.movements.length === 0 ? (
              <EmptyState title="עוד לא נרשמו תנועות" hint="קליטה או הוצאה ראשונה תופיע כאן">
                <Button variant="secondary" onClick={() => openAction("receive")}>קליטת סחורה</Button>
              </EmptyState>
            ) : (
              <ul className="mn2-rows">
                {state.movements.slice(0, MOVE_ROWS).map((m) => {
                  const p = product(m.product_id);
                  return (
                    <li key={m.id}>
                      <button type="button" className="mn2-row" onClick={() => openMovement(m)}>
                        <ProductThumb product={p} small />
                        <span className="mn2-row-text">
                          <span className="mn2-row-title">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
                          <span className="mn2-row-why">{[MOVEMENT_LABEL[m.type], worker(m.worker_id)?.name, fmtRelative(m.created_at)].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="mn2-row-end">
                          <span className="mn2-row-n ltr"><MovementQty qty={m.qty} type={m.type} /></span>
                          <span className="mn2-word">{fmtUnit(m.qty, p?.unit)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Block>
        </div>
      </Chapter>

      <Chapter title="נתונים ומגמות" ask="כסף וחלוקה · השבוע מול הקודם, והחודש האחרון לפי קטגוריה, לקוח וספק">
        <Metrics items={trends} />
        <PieSheet pies={pies} />
        {monthFailed ? (
          <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retryMonth}>
            הסכומים מחושבים רק לפי מה שנטען
          </Notice>
        ) : null}
      </Chapter>
    </Page>
  );
}
