"use client";

/**
 * סקירת המפעל, in the order the owner drew on 2026-11-17: four counts, then three panels (what moved, what the stock
 * is worth, who it went to), then what to handle now beside the deliveries to come. Nothing here has to be worked out by the reader:
 * the first tasks are already ranked, and each says why it is there and what its button does.
 */
import Link from "next/link";
import { useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useUi } from "@/components/app/ui-state";
import { CountUp, percents, Ring } from "@/components/app/Viz";
import "@/components/app/overview.css";
import { EmptyState, Notice } from "@/components/ui";
import { byPromise, daysUntil, fmtAge, fmtCompact, fmtName, fmtPromised, fmtQty, fmtToday, fmtUnit } from "@/lib/format";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { movedWorth, PACE_DAYS, REST, salesByCustomer, shelfWorth, sumShares, topShares, worthByCategory, type Share } from "@/lib/snapshot";
import { useData } from "@/lib/store";
import type { LineName } from "../icons";
import { Line } from "../icons";
import { useLastVisit } from "../last-visit";
import { Check, DayRing, JustHandled, lineTone, Page, useDayProgress, Word, type Tone } from "../parts";
import { useShortages, useWaiting } from "../use-work";
import { ageDays, isLate, isUncovered, listWords, many, orderFacts, pendingNames, pendingRequests } from "../work";

/** The tasks the overview names; the pages under דורש טיפול hold the rest. */
const FIRST_TASKS = 5;
const ORDER_ROWS = 6;
const CHART_DAYS = 7;

type Task = { key: string; icon: LineName; tone: Tone; title: string; why: string; action: string; rank: number; run: () => void };

const count = (n: number, one: string, more: string) => `${fmtQty(n)} ${n === 1 ? one : more}`;

export function Overview(): ReactElement {
  const { state, product, supplier, worker, linesOf } = useData();
  const { openAction, openFault, openOrder, openProduct } = useUi();
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

  /* ───────── the four counts ───────── */
  const orders = useMemo(() => orderFacts(state.orders, linesOf, product), [state.orders, linesOf, product]);
  const unheld = state.faults.filter((f) => f.status === "open" && !f.assigned_to).length;
  const kpis: Kpi[] = [
    {
      key: "orders", label: "הזמנות פתוחות", icon: "receipt-text", value: orders.open, href: "/orders",
      note: orders.late > 0 ? <span className="is-warn">{fmtQty(orders.late)} באיחור</span> : orders.open === 0 ? "אין הזמנות פתוחות" : <span className="is-ok">הכל בזמן</span>,
    },
    {
      key: "approvals", label: "ממתינים לאישור", icon: "clipboard-check", value: waiting.approvals, href: "/closing?view=approvals",
      note: waiting.approvals === 0 ? <span className="is-ok">אין מה לאשר</span> : "להחלטת מנהל",
    },
    {
      key: "shortages", label: "חוסרים במלאי", icon: hurting > 0 ? "package-x" : "package-minus", tone: hurting > 0 ? "short" : undefined, value: waiting.shortages, href: "/inventory?view=shortages",
      note: waiting.shortages === 0 ? <span className="is-ok">המלאי מעל המינימום</span> : hurting > 0 ? <span className="is-short">{hurting === 1 ? "אחד משפיע" : `${fmtQty(hurting)} משפיעים`} על הזמנות</span> : "מתחת למינימום",
    },
    {
      key: "faults", label: "תקלות פתוחות", icon: "wrench", value: waiting.faults, href: "/faults",
      note: waiting.faults === 0 ? <span className="is-ok">אין תקלות פתוחות</span> : unheld > 0 ? `${unheld === 1 ? "אחת" : fmtQty(unheld)} ללא אחראי` : "כולן אצל עובד",
    },
  ];

  /* ───────── stock movement, the last seven days, today at the right ───────── */
  const days = useMemo(() => {
    const list = [];
    for (let i = 0; i < CHART_DAYS; i++) {
      const from = midnight(-i), to = midnight(1 - i);
      const d = new Date(from);
      list.push({
        key: from,
        day: d.toLocaleDateString("he-IL", { weekday: "narrow" }),
        date: `${d.getDate()}.${d.getMonth() + 1}`,
        in: movedWorth(month, "in", from, to, product),
        out: movedWorth(month, "out", from, to, product),
      });
    }
    return list;
  }, [month, product]);
  const peak = Math.max(1, ...days.flatMap((d) => [d.in, d.out]));
  const weekIn = days.reduce((sum, d) => sum + d.in, 0);
  const weekOut = days.reduce((sum, d) => sum + d.out, 0);

  /* ───────── the two rings ───────── */
  const worth = useMemo(() => shelfWorth(state.products), [state.products]);
  const stockShares = useMemo(() => topShares(worthByCategory(state.products), 4), [state.products]);
  const salesShares = useMemo(() => topShares(salesByCustomer(state.orders, linesOf, since), 4), [state.orders, linesOf, since]);
  const delivered = useMemo(() => state.orders.filter((o) => o.status === "delivered" && o.closed_at && Date.parse(o.closed_at) >= since).length, [state.orders, since]);

  /* ───────── the deliveries to come ───────── */
  const nextOrders = useMemo(() => state.orders.filter((o) => o.status === "open").reverse().sort(byPromise), [state.orders]);

  return (
    <Page
      className="mn2-overview"
      title="סקירת המפעל"
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
      {/* ── 1. Four counts, each a card that opens its list ── */}
      <div className="mn2-kpis">
        {kpis.map((k) => (
          <Link key={k.key} href={k.href} className="sa-card mn2-kpi">
            <span className="mn2-kpi-label">
              <Line name={k.icon} size={20} tone={lineTone(k.tone)} />
              {k.label}
            </span>
            <span className="mn2-kpi-n"><CountUp value={k.value} /></span>
            <span className="mn2-kpi-note">{k.note}</span>
          </Link>
        ))}
      </div>

      {/* ── 2. Three panels: what moved, what the stock is worth, who it went to ── */}
      <div className="mn2-panels">
        <Panel title="תנועת מלאי" sub={`${CHART_DAYS} הימים האחרונים · במחירון`} href="/movements?period=week">
          {monthLoading ? (
            <div className="mn2-chart is-loading" aria-hidden="true" />
          ) : (
            <>
              <div className="mn2-chart-key">
                <span><i className="is-in" />נכנס <b className="ltr">{fmtCompact(weekIn)}</b></span>
                <span><i className="is-out" />יצא <b className="ltr">{fmtCompact(weekOut)}</b></span>
              </div>
              <div className="mn2-chart" role="img" aria-label={`תנועת מלאי ב-${CHART_DAYS} הימים האחרונים: ${days.map((d) => `${d.date} נכנס ${fmtCompact(d.in)} יצא ${fmtCompact(d.out)}`).join(", ")}`}>
                {days.map((d, i) => (
                  <div key={d.key} className={`mn2-chart-day${i === 0 ? " is-today" : ""}`}>
                    <div className="mn2-chart-bars">
                      <span className="mn2-bar is-in" style={{ "--h": d.in / peak } as CSSProperties} title={`נכנס ${fmtCompact(d.in)}`}>
                        {d.in > 0 ? <em className="ltr">{fmtCompact(d.in)}</em> : null}
                      </span>
                      <span className="mn2-bar is-out" style={{ "--h": d.out / peak } as CSSProperties} title={`יצא ${fmtCompact(d.out)}`}>
                        {d.out > 0 ? <em className="ltr">{fmtCompact(d.out)}</em> : null}
                      </span>
                    </div>
                    <span className="mn2-chart-label">{i === 0 ? "היום" : d.day}<span className="ltr">{d.date}</span></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel title="שווי המלאי" sub="לפי קטגוריה · במחירון" href="/inventory">
          <RingPanel shares={stockShares} total={worth.total} caption="סה״כ מלאי" empty="אין מלאי עם מחיר" />
        </Panel>

        <Panel title="מסירות ללקוחות" sub="לפי לקוח · 30 הימים האחרונים" href="/orders?view=customers">
          <RingPanel shares={salesShares} total={sumShares(salesShares)} caption={count(delivered, "הזמנה", "הזמנות")} empty="לא נמסרו הזמנות בחודש האחרון" />
        </Panel>
      </div>

      {/* ── 3. What to handle now, beside the deliveries to come ── */}
      <div className="mn2-pair">
        <Panel title="לטיפול עכשיו" sub={tasks.length > 0 ? "מה שחוסם הזמנה או עבודה עומד ראשון" : undefined} href="/faults">
          <JustHandled kind="fault" />
          <JustHandled kind="approval" />
          {tasks.length === 0 ? (
            <div className="mn2-clear">
              <Check size={36} />
              <p className="mn2-clear-title">אין משימות פתוחות</p>
              <p className="mn2-clear-hint">כל מה שחיכה טופל. דיווח חדש מהמחסן יופיע כאן.</p>
            </div>
          ) : (
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
          )}
        </Panel>

        <Panel title="המסירות הקרובות" sub={orders.open > 0 ? `${count(orders.open, "הזמנה פתוחה", "הזמנות פתוחות")} · לפי מועד המסירה` : undefined} href="/orders">
          <JustHandled kind="order" />
          {nextOrders.length === 0 ? (
            <EmptyState title="אין הזמנות פתוחות" hint="הזמנה של סוכן תופיע כאן" />
          ) : (
            <table className="mn2-next">
              <thead>
                <tr><th>לקוח</th><th>מועד מסירה</th><th>סטטוס</th></tr>
              </thead>
              <tbody>
                {nextOrders.slice(0, ORDER_ROWS).map((o) => {
                  const late = isLate(o);
                  const short = isUncovered(o, linesOf, product);
                  return (
                    <tr key={o.id} onClick={() => openOrder(o.id)}>
                      <td><button type="button" className="mn2-next-name" onClick={(e) => { e.stopPropagation(); openOrder(o.id); }}>{o.customer}</button></td>
                      <td className="ltr-num">{o.promised_on ? fmtDate(o.promised_on) : "לא נקבע"}</td>
                      <td><Word tone={late ? "bad" : short ? "short" : "ok"}>{late ? "באיחור" : short ? "חסר במלאי" : "במועד"}</Word></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {monthFailed ? (
        <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retryMonth}>
          הסכומים מחושבים רק לפי מה שנטען
        </Notice>
      ) : null}
    </Page>
  );
}

/** A promised day as the date itself (17.11.2026); the status beside it says whether it is late. */
const fmtDate = (day: string) => {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return `${d}.${m}.${y}`;
};

type Kpi = { key: string; label: string; icon: LineName; tone?: Tone; value: number; note: ReactNode; href: string };

/** One sheet of the home page: a name, what it counts, and הצג הכל to its page. */
function Panel({ title, sub, href, children }: { title: string; sub?: string; href: string; children: ReactNode }): ReactElement {
  return (
    <section className="sa-card mn2-panel">
      <header className="mn2-panel-head">
        <div className="mn2-panel-text">
          <h2 className="mn2-panel-title">{title}</h2>
          {sub ? <p className="mn2-panel-sub">{sub}</p> : null}
        </div>
        <Link href={href} className="mn2-panel-all">הצג הכל</Link>
      </header>
      {children}
    </section>
  );
}

const hueOf = (s: Share, i: number) => (s.key === REST ? "var(--pie-other)" : `var(--pie-${i + 1})`);

/** A whole and its parts: the total above, the ring, and a legend with each part's share and ₪. */
function RingPanel({ shares, total, caption, empty }: { shares: Share[]; total: number; caption: string; empty: string }): ReactElement {
  const [active, setActive] = useState<number | null>(null);
  const slices = useMemo(() => shares.map((s, i) => ({ ...s, color: hueOf(s, i) })), [shares]);
  const pcts = useMemo(() => percents(shares.map((s) => s.value)), [shares]);
  if (total <= 0) return <p className="mn2-panel-empty">{empty}</p>;
  return (
    <div className="mn2-ring ov-pies">
      <p className="mn2-ring-total ltr">{fmtCompact(total)}</p>
      <div className="mn2-ring-body">
        <Ring slices={slices} shares={pcts} total={total} caption={caption} active={active} onActive={setActive} label={slices.map((s, i) => `${s.label} ${pcts[i]}%`).join(", ")} />
        <ul className="mn2-ring-legend">
          {slices.map((s, i) => (
            <li key={s.key} className={active === i ? "is-active" : undefined} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
              <i style={{ background: s.color }} aria-hidden="true" />
              <span className="mn2-ring-name">{s.label}</span>
              <span className="mn2-ring-worth ltr">{fmtCompact(s.value)}</span>
              <span className="mn2-ring-pct ltr">{pcts[i]}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
