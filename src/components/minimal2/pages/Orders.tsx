"use client";

/**
 * הזמנות as a list of promises, not a list of customers: when each has to leave, and whether the shelf lets it.
 * The nearest delivery leads. Four figures stand over the list and each is a press away from its orders: all the
 * open ones, the late ones, the ones waiting for stock, and what the open ones are worth. A row answers who, when and
 * can it go out, in that order; pressing it opens the order.
 */
import { Suspense, useCallback, useMemo, useState, useTransition, type ReactElement } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Select, Showing, Table, Tabs, Toolbar, type SelectOption, type TableColumn } from "@/components/ui";
import { byPromise, DIRECT_ORDER, fmtCompact, fmtDay, fmtPlainDay, fmtPrice, fmtPromised, fmtQty } from "@/lib/format";
import { normalizeName, orderTotal, useData, type Order } from "@/lib/store";
import { changeWords, keptChanges } from "@/lib/worker/order-check";
import { goColumn } from "../cells";
import { JustHandled, Page, Word, type Metric } from "../parts";
import { isLate, isUncovered, orderFacts } from "../work";

/** `?status=`: an order's own state, or one of two cuts of the open ones that a figure above the list shows. */
type View = Order["status"] | "late" | "waiting";

const STATUS_TABS: { value: Order["status"]; label: string }[] = [
  { value: "open", label: "פתוחות" },
  { value: "delivered", label: "נמסרו" },
  { value: "cancelled", label: "בוטלו" },
];

const NOUN: Record<View, string> = { open: "הזמנות פתוחות", late: "הזמנות באיחור", waiting: "הזמנות שמחכות למלאי", delivered: "הזמנות שנמסרו", cancelled: "הזמנות שבוטלו" };

const toView = (v: string | null): View => (v === "late" || v === "waiting" || v === "delivered" || v === "cancelled" ? v : "open");
const isOpenView = (view: View) => view === "open" || view === "late" || view === "waiting";
const digitsOf = (text: string) => text.replace(/\D/g, "");

export function Orders(): ReactElement {
  return (
    <Suspense fallback={null}>
      <OrdersInner />
    </Suspense>
  );
}

function OrdersInner(): ReactElement {
  const { state, agent, product, linesOf } = useData();
  const { openOrder, panel } = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const view = toView(params.get("status"));
  const setView = useCallback(
    (next: View) => {
      const sp = new URLSearchParams(params.toString());
      sp.delete("status");
      if (next !== "open") sp.set("status", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // The top search and the customers page send a name as ?q=: the box starts from it, and typing takes it off the address.
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

  /* ───────── the rows ───────── */
  const short = useCallback((o: Order) => isUncovered(o, linesOf, product), [linesOf, product]);
  const inView = useCallback((o: Order, v: View) => (v === "late" ? isLate(o) : v === "waiting" ? o.status === "open" && short(o) : o.status === v), [short]);

  const base = useMemo(() => (agentId ? state.orders.filter((o) => o.agent_id === agentId) : state.orders), [state.orders, agentId]);

  const q = normalizeName(query);
  const hits = useMemo(() => {
    if (!q) return base;
    const digits = /\p{L}/u.test(q) ? "" : digitsOf(q);
    return base.filter((o) => normalizeName(o.customer).includes(q) || String(o.number).includes(q) || (digits !== "" && digitsOf(o.customer_phone ?? "").includes(digits)));
  }, [base, q]);

  const total = useMemo(() => base.filter((o) => inView(o, view)).length, [base, view, inView]);
  const rows = useMemo(() => {
    const found = hits.filter((o) => inView(o, view));
    // What still has to leave reads by the day promised, the nearest first; what closed reads back from the last to close.
    return isOpenView(view) ? found.reverse().sort(byPromise) : found.sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));
  }, [hits, view, inView]);

  const columns = useMemo<TableColumn<Order>[]>(() => {
    const closedOn = (o: Order) => <span className="mn2-cell-text">{fmtDay(o.closed_at ?? o.created_at)}</span>;
    const customer: TableColumn<Order> = {
      key: "customer",
      title: "לקוח",
      className: "mn2-cell-main",
      // Who and which order; what is in it waits in the drawer, so nobody reads a product's description to see who is stuck.
      render: (o) => {
        const seller = o.agent_id ? agent(o.agent_id)?.name : DIRECT_ORDER;
        return (
          <>
            <span className="mn2-cell-title"><bdi>{o.customer}</bdi></span>
            <span className="mn2-cell-sub">
              הזמנה <span className="ltr">{o.number}</span>
              {seller ? ` · ${seller}` : null}
            </span>
          </>
        );
      },
    };
    const open = goColumn<Order>("פתיחת ההזמנה", (o) => openOrder(o.id));
    const sum: TableColumn<Order> = {
      key: "total",
      title: "סכום",
      render: (o) => {
        const worth = orderTotal(linesOf(o.id));
        return worth === null ? <span className="mn2-cell-unset">לא זמין</span> : <span className="mn2-qty"><span className="ltr">{fmtPrice(worth)}</span></span>;
      },
    };

    if (view === "cancelled") return [customer, { key: "closed", title: "בוטלה", render: closedOn }, sum, open];
    if (view === "delivered") {
      return [
        customer,
        { key: "closed", title: "נמסרה", render: closedOn },
        {
          key: "receipt",
          title: "קבלה",
          render: (o) => {
            const changes = keptChanges(o).length;
            if (changes > 0) return <Word tone="warn">{changeWords(changes)}</Word>;
            if (o.receipt_read === null) return <Word>לא נבדקה</Word>;
            return o.receipt_read ? <Word tone="ok">תואמת להזמנה</Word> : <Word>לא נקראה</Word>;
          },
        },
        sum,
        open,
      ];
    }
    return [
      customer,
      {
        key: "promised",
        title: "מועד מסירה",
        render: (o) =>
          !o.promised_on ? (
            <span className="mn2-cell-unset">לא נקבע</span>
          ) : isLate(o) ? (
            <>
              <Word tone="warn">{fmtPromised(o.promised_on)}</Word>
              <span className="mn2-cell-sub"><span className="ltr">{fmtPlainDay(o.promised_on)}</span></span>
            </>
          ) : (
            <span className="mn2-cell-text">{fmtPromised(o.promised_on)}</span>
          ),
      },
      { key: "stock", title: "מלאי", render: (o) => (short(o) ? <Word tone="short">חסר במלאי</Word> : <Word tone="ok">מוכן למסירה</Word>) },
      sum,
      open,
    ];
  }, [view, agent, linesOf, short, openOrder]);

  /* ───────── the figures: each is the list it counts, one press away ───────── */
  // Counted from the same orders the list is cut from, so with an agent chosen a figure still equals its list.
  const facts = useMemo(() => orderFacts(base, linesOf, product), [base, linesOf, product]);
  const metrics: Metric[] = [
    { key: "open", label: "פתוחות", icon: "receipt-text", value: facts.open, onClick: () => setView("open"), current: view === "open" },
    { key: "late", label: "באיחור", icon: "clock", value: facts.late, tone: facts.late > 0 ? "warn" : "ok", onClick: () => setView("late"), current: view === "late" },
    { key: "waiting", label: "מחכות למלאי", icon: "package-x", value: facts.waiting, tone: facts.waiting > 0 ? "short" : "ok", onClick: () => setView("waiting"), current: view === "waiting" },
    { key: "worth", label: "שווי הפתוחות", icon: "chart-pie", value: <span className="ltr">{fmtCompact(facts.worth)}</span>, note: facts.unpriced > 0 ? `${fmtQty(facts.unpriced)} בלי מחיר` : undefined },
  ];

  const elsewhere = q ? STATUS_TABS.find((t) => t.value !== view && hits.some((o) => o.status === t.value)) : undefined;

  const empty =
    state.orders.length === 0 ? (
      <EmptyState title="אין הזמנות" hint="הזמנה מאתר הקטלוג תופיע כאן">
        <Link href="/catalog" className="sa-btn sa-btn-secondary">פתיחת הקטלוג</Link>
      </EmptyState>
    ) : q ? (
      <EmptyState title={`לא נמצאו ${NOUN[view]}`} hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
        {elsewhere ? <Button variant="secondary" onClick={() => setView(elsewhere.value)}>הצגת {NOUN[elsewhere.value]}</Button> : null}
        <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
      </EmptyState>
    ) : agentId ? (
      <EmptyState title={`אין ${NOUN[view]}`} hint={`אצל ${agent(agentId)?.name ?? "הסוכן"}`}>
        <Button variant="secondary" onClick={() => setAgentId("")}>הסרת הסינון</Button>
      </EmptyState>
    ) : (
      <EmptyState title={`אין ${NOUN[view]}`}>
        {view !== "open" && facts.open > 0 ? <Button variant="secondary" onClick={() => setView("open")}>הזמנות פתוחות</Button> : undefined}
      </EmptyState>
    );

  return (
    <Page
      title="הזמנות"
      metrics={metrics}
      toolbar={
        <Toolbar
          // Late and waiting are cuts of the open orders, so the open tab stays lit under them.
          tabs={<Tabs tabs={STATUS_TABS} value={isOpenView(view) ? "open" : view} onChange={(v) => setView(toView(v))} />}
          filters={<Select options={agentOptions} value={agentId} onChange={setAgentId} allLabel="כל הסוכנים" placeholder="סוכן" />}
          query={query}
          onQuery={setQuery}
          placeholder="חיפוש לקוח, מספר הזמנה או טלפון"
        />
      }
    >
      <div className="sa-card mn2-sheet">
        {isOpenView(view) ? <JustHandled kind="order" /> : null}
        <Table<Order>
          caption="רשימת הזמנות"
          className="mn2-table mn2-orders-table"
          columns={columns}
          data={rows}
          selectedId={panel?.type === "order" ? panel.id : undefined}
          empty={empty}
          onRowClick={(o) => openOrder(o.id)}
          footer={rows.length > 0 && rows.length < total ? <Showing shown={rows.length} total={total} /> : undefined}
        />
      </div>
    </Page>
  );
}
