"use client";

/**
 * הזמנות as one table, on the same rules as מלאי: a title and one summary line, the tabs as text with one underline, the
 * search and the agent, then every order on a row that answers in order: which, who, can it go out, when, what, how much.
 * In the open tab what the shelf can't cover stands first as a group of its own. A row opens its order beside the table,
 * with its racks in the window over the panel. Same data, same ?status= and ?q=, same search and sorting as the shared
 * page; orders come from the field agents, so the page has no primary key.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, useTransition, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { useTwin } from "@/components/merhav/twin/Twin";
import { Button, cx, EmptyState, SearchBar, Select, Tabs, type SelectOption } from "@/components/ui";
import { byPromise, daysUntil, fmtCompact, fmtDayWord, fmtName, fmtPlainDay, fmtPrice, fmtQty, fmtTime, fmtUnit } from "@/lib/format";
import { available, normalizeName, orderTotal, useData, type Order, type OrderLine, type Product } from "@/lib/store";
import { changeWords, keptChanges } from "@/lib/worker/order-check";
import { Head, Summary, type SumItem } from "../parts";

/** An order's three statuses, and the open orders past their date, a tab of its own while there are any. */
type Tab = Order["status"] | "late";

const TABS: { value: Tab; label: string; noun: string; hint: string; when: string }[] = [
  { value: "open", label: "פתוחות", noun: "הזמנות פתוחות", hint: "הזמנה חדשה של סוכן תופיע כאן", when: "מסירה" },
  { value: "late", label: "באיחור", noun: "הזמנות באיחור", hint: "כל ההזמנות הפתוחות בזמן", when: "מסירה" },
  { value: "delivered", label: "נמסרו", noun: "הזמנות שנמסרו", hint: "הזמנה שסומנה כנמסרה תופיע כאן", when: "נמסרה" },
  { value: "cancelled", label: "בוטלו", noun: "הזמנות שבוטלו", hint: "הזמנה שבוטלה תופיע כאן", when: "בוטלה" },
];

const toTab = (value: string | null): Tab => (value === "late" || value === "delivered" || value === "cancelled" ? value : "open");

const isLate = (o: Order) => o.status === "open" && o.promised_on !== null && daysUntil(o.promised_on) < 0;
const inTab = (o: Order, tab: Tab) => (tab === "late" ? isLate(o) : o.status === tab);
/** What has closed is read back from the last to close. */
const byClosing = (a: Order, b: Order) => (b.closed_at ?? "").localeCompare(a.closed_at ?? "");

const digitsOf = (text: string) => text.replace(/\D/g, "");
/** A search with letters in it looks for a name, even one with a number in it, so it never matches a phone. */
const phoneDigits = (q: string) => (/\p{L}/u.test(q) ? "" : digitsOf(q));

/** "הזמנה אחת" / "3 הזמנות". */
const someOrders = (n: number) => (n === 1 ? "הזמנה אחת" : `${fmtQty(n)} הזמנות`);

/** A name cut at the end of a right-to-left line loses a size from its first digit: 100×10 would read 00×10. Figures go whole. */
const wholeFigures = (name: string): ReactNode[] =>
  fmtName(name)
    .split(/(\S*\d\S*)/)
    .map((part, i) => (i % 2 ? <span key={i} className="at-or-figure">{part}</span> : part));

/** How far a promised day stands from today, in plain words. */
function distance(days: number): string {
  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  if (days === 2) return "בעוד יומיים";
  if (days > 2) return `בעוד ${fmtQty(days)} ימים`;
  if (days === -1) return "אתמול";
  if (days === -2) return "לפני יומיים";
  return `לפני ${fmtQty(-days)} ימים`;
}

const NO_LINES: OrderLine[] = [];

/* ───────── an order, as this page reads it ───────── */

interface Row {
  order: Order;
  lines: OrderLine[];
  /** The product the row names: the first line's. */
  first: Product | undefined;
  /** Lines of a product held past its shelf, the same reading as סקירה and מלאי; none once the order has closed. */
  short: OrderLine[];
  /** The short product, when one line is short: the row says how much is missing. */
  lead: Product | undefined;
  /** Every rack that holds its lines, for the model. */
  racks: string[];
  total: number | null;
  late: boolean;
}

/** The state as a word in its tone, readable without the colour, and under it what the word rests on. */
function State({ row }: { row: Row }): ReactElement {
  const { order: o, short, lead, late } = row;
  if (o.status === "cancelled") return <span className="at-state is-ok">בוטלה</span>;
  if (o.status === "delivered") {
    // Whether the receipt read as the order said. Null is a closing nobody compared: the admin's, or an old phone's.
    const changes = keptChanges(o).length;
    const receipt = changes > 0 ? <span className="at-tone-warn">{changeWords(changes)}</span> : o.receipt_read === null ? "קבלה לא נבדקה" : o.receipt_read ? "קבלה תואמת" : "קבלה לא נקראה";
    return (
      <span className="at-state is-ok">
        נמסרה
        <span className="at-state-sub">{receipt}</span>
      </span>
    );
  }
  if (short.length > 0) {
    const missing = lead ? -available(lead) : 0;
    const gap = short.length === 1 && lead ? `חסר ${fmtQty(missing)} ${fmtUnit(missing, lead.unit) ?? ""}` : `חסר ב-${fmtQty(short.length)} פריטים`;
    return (
      <span className="at-state is-short">
        חסר במלאי
        <span className="at-state-sub">{gap}</span>
      </span>
    );
  }
  if (late) return <span className="at-state at-tone-warn">באיחור</span>;
  return <span className="at-state is-ok">מכוסה</span>;
}

/** The date that matters: the day promised to the customer while the order is open, the closing once it has closed. */
function When({ row }: { row: Row }): ReactElement {
  const o = row.order;
  if (o.status !== "open") {
    const at = o.closed_at ?? o.created_at;
    return (
      <span className="at-cell-text">
        <span>{fmtDayWord(at)}</span>
        <span className="at-cell-sub">{fmtTime(at)}</span>
      </span>
    );
  }
  if (!o.promised_on) return <span className="at-tone-quiet">ללא מועד</span>;
  const days = daysUntil(o.promised_on);
  return (
    <span className="at-cell-text">
      <span>{fmtPlainDay(o.promised_on)}</span>
      <span className={cx("at-cell-sub", days === 0 && "at-or-today")}>{distance(days)}</span>
    </span>
  );
}

/* ───────── the page ───────── */

export function Orders(): ReactElement {
  return (
    <Suspense fallback={null}>
      <OrdersInner />
    </Suspense>
  );
}

function OrdersInner(): ReactElement {
  const { state, agent, product, linesOf } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { spotObjects, itemsOf } = useTwin();

  // The active tab lives in the URL (?status=late|delivered|cancelled).
  const tab = toTab(params.get("status"));
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      sp.delete("status");
      if (next !== "open") sp.set("status", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // The search plate sends a customer's name as ?q=: the box starts from it, and follows when another name is sent.
  // Typing takes the name off the URL, so a reload keeps the box as it was left and the same name can be sent again.
  const sent = params.get("q") ?? "";
  const [typed, setTyped] = useState({ sent, value: sent });
  const [leaving, startLeaving] = useTransition();
  const query = typed.sent === sent || leaving ? typed.value : sent;
  const setQuery = useCallback(
    (value: string) => {
      setTyped({ sent: "", value });
      if (!sent) return;
      const sp = new URLSearchParams(params.toString());
      sp.delete("q");
      const qs = sp.toString();
      startLeaving(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [sent, params, pathname, router],
  );

  const [agentId, setAgentId] = useState("");
  const agentOptions = useMemo<SelectOption[]>(() => state.agents.map((a) => ({ value: a.id, label: a.name })), [state.agents]);

  /* ───────── orders ───────── */
  const baseOrders = useMemo(() => (agentId ? state.orders.filter((o) => o.agent_id === agentId) : state.orders), [state.orders, agentId]);

  // A line is short when its product is held past the shelf: the same reading as סקירה and מלאי.
  const shortOf = useCallback(
    (o: Order): OrderLine[] =>
      o.status === "open"
        ? linesOf(o.id).filter((l) => {
            const p = product(l.product_id);
            return p !== undefined && available(p) < 0;
          })
        : NO_LINES,
    [linesOf, product],
  );

  const counts = useMemo(() => {
    const c: Record<Tab | "short" | "month", number> = { open: 0, late: 0, delivered: 0, cancelled: 0, short: 0, month: 0 };
    const now = new Date();
    for (const o of baseOrders) {
      c[o.status] += 1;
      if (o.status === "open") {
        if (isLate(o)) c.late += 1;
        if (shortOf(o).length > 0) c.short += 1;
      } else if (o.status === "delivered" && o.closed_at) {
        const closed = new Date(o.closed_at);
        if (closed.getFullYear() === now.getFullYear() && closed.getMonth() === now.getMonth()) c.month += 1;
      }
    }
    return c;
  }, [baseOrders, shortOf]);

  const worth = useMemo(() => {
    const totals = baseOrders.filter((o) => o.status === "open").map((o) => orderTotal(linesOf(o.id)));
    return { open: totals.length, total: totals.reduce<number>((sum, t) => sum + (t ?? 0), 0), unpriced: totals.filter((t) => t === null).length };
  }, [baseOrders, linesOf]);

  const q = normalizeName(query);
  const hits = useMemo(() => {
    if (!q) return baseOrders;
    const digits = phoneDigits(q);
    return baseOrders.filter((o) => normalizeName(o.customer).includes(q) || String(o.number).includes(q) || (digits !== "" && digitsOf(o.customer_phone ?? "").includes(digits)));
  }, [baseOrders, q]);

  const orders = useMemo(() => {
    const found = hits.filter((o) => inTab(o, tab));
    // What still has to go out is read by the date promised to the customer, the nearest first and, on one date, the oldest
    // first (state.orders is newest first). What has closed is read back from the last to close.
    return tab === "open" || tab === "late" ? found.reverse().sort(byPromise) : found.sort(byClosing);
  }, [hits, tab]);

  const tabTotal = useMemo(() => state.orders.filter((o) => inTab(o, tab)).length, [state.orders, tab]);

  const rows = useMemo<Row[]>(
    () =>
      orders.map((order) => {
        const lines = linesOf(order.id);
        const short = shortOf(order);
        return {
          order,
          lines,
          first: product(lines[0]?.product_id),
          short,
          lead: product(short[0]?.product_id),
          racks: [...new Set(lines.flatMap((l) => itemsOf(l.product_id).map((item) => item.objectId)))],
          total: orderTotal(lines),
          late: isLate(order),
        };
      }),
    [orders, linesOf, shortOf, product, itemsOf],
  );

  // In the open tab what the shelf can't cover stands first, as a group of its own; with nothing short there are no groups.
  const groups = useMemo(() => {
    if (tab !== "open") return null;
    const uncovered = rows.filter((r) => r.short.length > 0);
    return uncovered.length > 0 ? { uncovered, covered: rows.filter((r) => r.short.length === 0) } : null;
  }, [rows, tab]);

  // Pointing at a row lights the racks that hold its lines. A list that ends under the pointer never sends its row's leave.
  const point = useCallback((row: Row | null) => spotObjects(row && row.racks.length > 0 ? row.racks : null), [spotObjects]);
  useEffect(() => () => spotObjects(null), [spotObjects]);

  const selected = ui.panel?.type === "order" ? ui.panel.id : undefined;
  const filtered = Boolean(q || agentId);
  const here = TABS.find((t) => t.value === tab) ?? TABS[0];

  const summary: SumItem[] = [
    ...(worth.open > 0 ? [{ label: "במחירון", value: fmtCompact(worth.total) }] : []),
    ...(worth.unpriced > 0 ? [{ label: "ללא מחיר", value: worth.unpriced }] : []),
    ...(counts.short > 0 ? [{ label: "חסר במלאי", value: counts.short, tone: "short" as const }] : []),
    { label: "נמסרו החודש", value: counts.month },
  ];

  const tabs = TABS.filter((t) => t.value !== "late" || counts.late > 0 || tab === "late").map((t) => ({
    value: t.value,
    label: (
      <>
        {t.label}
        <span className="at-or-tab-n ltr">{fmtQty(counts[t.value])}</span>
      </>
    ),
  }));

  // Nothing here for this search may still be elsewhere: the plate sends a customer whose orders have all closed.
  const elsewhere = q ? TABS.find((t) => t.value !== "late" && hits.some((o) => inTab(o, t.value))) : undefined;

  const empty =
    state.orders.length === 0 ? (
      <EmptyState title="אין הזמנות" hint="הזמנה מאתר הקטלוג תופיע כאן">
        <Link href="/catalog" className="sa-btn sa-btn-secondary">פתיחת הקטלוג</Link>
      </EmptyState>
    ) : q ? (
      <EmptyState title={`לא נמצאו ${here.noun}`} hint={<>עבור „{query.trim()}”</>}>
        {elsewhere ? <Button variant="secondary" onClick={() => setTab(elsewhere.value)}>הצגת {elsewhere.noun}</Button> : null}
        <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
      </EmptyState>
    ) : agentId ? (
      <EmptyState title={`אין ${here.noun}`} hint={`אצל ${agent(agentId)?.name ?? ""}`}>
        <Button variant="secondary" onClick={() => setAgentId("")}>הסרת הסינון</Button>
      </EmptyState>
    ) : (
      <EmptyState title={`אין ${here.noun}`} hint={here.hint}>
        {tab !== "open" && counts.open > 0 ? <Button variant="secondary" onClick={() => setTab("open")}>הצגת הזמנות פתוחות</Button> : null}
      </EmptyState>
    );

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, o: Order) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ui.openOrder(o.id);
    }
  };

  /** A quiet ruled line inside the body: the group's word and how many stand under it. */
  const groupRow = (key: string, word: string, n: number) => (
    <tr key={key} className="at-or-group">
      <td colSpan={6}>
        {word} <b className="ltr">{fmtQty(n)}</b>
      </td>
    </tr>
  );

  const rowOf = (row: Row) => {
    const o = row.order;
    const agentName = agent(o.agent_id)?.name;
    return (
      <tr
        key={o.id}
        tabIndex={0}
        aria-current={o.id === selected ? "true" : undefined}
        className={cx(o.id === selected && "is-selected")}
        onClick={() => ui.openOrder(o.id)}
        onKeyDown={(e) => onRowKey(e, o)}
        onPointerEnter={() => point(row)}
        onPointerLeave={() => point(null)}
        onFocus={() => point(row)}
        onBlur={() => point(null)}
      >
        <td className="at-or-n">
          <span className="ltr">{o.number}</span>
        </td>
        <td className="at-or-customer">
          <span className="at-cell-text">
            <span className="at-cell-title" title={o.customer}>{o.customer}</span>
            <span className="at-cell-sub">
              <span className="at-or-phone-n">
                הזמנה <span className="ltr">{o.number}</span>
                {agentName ? " · " : ""}
              </span>
              {agentName}
            </span>
          </span>
        </td>
        <td className="at-or-state">
          <State row={row} />
        </td>
        <td className="at-or-when">
          <When row={row} />
        </td>
        <td className="at-or-items">
          <span className="at-cell">
            <ProductThumb product={row.first} />
            <span className="at-cell-text">
              <span className="at-cell-title">{row.lines.length === 1 ? "פריט אחד" : `${fmtQty(row.lines.length)} פריטים`}</span>
              <span className="at-cell-sub" title={row.first?.name}>{row.first ? wholeFigures(row.first.name) : "—"}</span>
            </span>
          </span>
        </td>
        <td className="at-or-total is-num">{row.total === null ? <span className="at-tone-quiet">—</span> : <span className="ltr">{fmtPrice(row.total)}</span>}</td>
      </tr>
    );
  };

  return (
    <div className="at-or">
      <Head title="הזמנות" line={<Summary items={summary} />} />

      <div className="at-or-controls">
        <Tabs variant="line" className="at-or-tabs" tabs={tabs} value={tab} onChange={(v) => setTab(toTab(v))} />
        <div className="at-tools">
          <SearchBar kbd={false} value={query} onChange={setQuery} placeholder="חיפוש לפי לקוח, מספר הזמנה או טלפון" />
          <Select options={agentOptions} value={agentId} onChange={setAgentId} allLabel="כל הסוכנים" placeholder="סוכן" />
        </div>
      </div>

      <div className="at-table-wrap">
        <table className="at-table at-or-table">
          <caption className="sa-sr">{here.noun}</caption>
          <thead>
            <tr>
              <th scope="col" className="at-or-n">הזמנה</th>
              <th scope="col" className="at-or-customer">לקוח</th>
              <th scope="col" className="at-or-state">מצב</th>
              <th scope="col" className="at-or-when">{here.when}</th>
              <th scope="col" className="at-or-items">פריטים</th>
              <th scope="col" className="at-or-total is-num">סכום</th>
            </tr>
          </thead>
          <tbody>
            {groups ? (
              <>
                {groupRow("short", "חסר במלאי", groups.uncovered.length)}
                {groups.uncovered.map(rowOf)}
                {groups.covered.length > 0 ? groupRow("covered", "מכוסות", groups.covered.length) : null}
                {groups.covered.map(rowOf)}
              </>
            ) : (
              rows.map(rowOf)
            )}
          </tbody>
        </table>
        {rows.length === 0 ? (
          empty
        ) : filtered ? (
          <div className="at-table-foot">
            <span>{rows.length < tabTotal ? `${fmtQty(rows.length)} מתוך ${fmtQty(tabTotal)} הזמנות` : someOrders(rows.length)}</span>
            <button
              type="button"
              className="sa-btn sa-btn-link"
              onClick={() => {
                setQuery("");
                setAgentId("");
              }}
            >
              הצגת הכול
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
