"use client";

/**
 * הזמנות as a list of promises, not a list of customers: when each has to leave, and whether the shelf lets it.
 * The nearest delivery leads. A row answers who, when and can it go out, in that order, and its button says what
 * opening it is for: פתיחה when the goods are there, טיפול בחוסר when something is missing.
 */
import { Suspense, useCallback, useMemo, useState, useTransition, type ReactElement } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Select, Showing, Table, Tabs, Toolbar, type SelectOption, type TableColumn } from "@/components/ui";
import { byPromise, fmtCompact, fmtDay, fmtPlainDay, fmtPrice, fmtPromised, fmtQty } from "@/lib/format";
import { normalizeName, orderTotal, useData, type Order } from "@/lib/store";
import { changeWords, keptChanges } from "@/lib/worker/order-check";
import { only } from "../cells";
import { JustHandled, Page, Word, type Metric } from "../parts";
import { isLate, isUncovered, orderFacts } from "../work";

type Tab = Order["status"] | "late";

const TABS: { value: Tab; label: string; noun: string; hint: string }[] = [
  { value: "open", label: "פתוחות", noun: "הזמנות פתוחות", hint: "הזמנה חדשה של סוכן תופיע כאן" },
  { value: "late", label: "באיחור", noun: "הזמנות באיחור", hint: "כל ההזמנות הפתוחות בזמן" },
  { value: "delivered", label: "נמסרו", noun: "הזמנות שנמסרו", hint: "הזמנה שסומנה כנמסרה תופיע כאן" },
  { value: "cancelled", label: "בוטלו", noun: "הזמנות שבוטלו", hint: "הזמנה שבוטלה תופיע כאן" },
];

const toTab = (v: string | null): Tab => (v === "late" || v === "delivered" || v === "cancelled" ? v : "open");
const inTab = (o: Order, tab: Tab) => (tab === "late" ? isLate(o) : o.status === tab);
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
  const base = useMemo(() => (agentId ? state.orders.filter((o) => o.agent_id === agentId) : state.orders), [state.orders, agentId]);
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { open: 0, late: 0, delivered: 0, cancelled: 0 };
    for (const o of base) {
      c[o.status] += 1;
      if (isLate(o)) c.late += 1;
    }
    return c;
  }, [base]);

  const q = normalizeName(query);
  const hits = useMemo(() => {
    if (!q) return base;
    const digits = /\p{L}/u.test(q) ? "" : digitsOf(q);
    return base.filter((o) => normalizeName(o.customer).includes(q) || String(o.number).includes(q) || (digits !== "" && digitsOf(o.customer_phone ?? "").includes(digits)));
  }, [base, q]);

  const rows = useMemo(() => {
    const found = hits.filter((o) => inTab(o, tab));
    // What still has to leave reads by the day promised, the nearest first; what closed reads back from the last to close.
    return tab === "open" || tab === "late" ? found.reverse().sort(byPromise) : found.sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));
  }, [hits, tab]);

  const columns = useMemo<TableColumn<Order>[]>(() => {
    const short = (o: Order) => isUncovered(o, linesOf, product);
    const closedOn = (o: Order) => <span className="mn2-cell-text">{fmtDay(o.closed_at ?? o.created_at)}</span>;
    const customer: TableColumn<Order> = {
      key: "customer",
      title: "לקוח והזמנה",
      className: "mn2-cell-main",
      // Who and which order; what is in it waits in the drawer, so nobody reads a product's description to see who is stuck.
      render: (o) => {
        const lines = linesOf(o.id).length;
        return (
          <>
            <span className="mn2-cell-title"><bdi>{o.customer}</bdi></span>
            <span className="mn2-cell-sub">
              הזמנה <span className="ltr">{o.number}</span>
              {agent(o.agent_id)?.name ? ` · ${agent(o.agent_id)?.name}` : null}
              {lines > 0 ? ` · ${lines === 1 ? "שורה אחת" : `${fmtQty(lines)} שורות`}` : null}
            </span>
          </>
        );
      },
    };
    const total: TableColumn<Order> = {
      key: "total",
      title: "סכום",
      render: (o) => {
        const sum = orderTotal(linesOf(o.id));
        return sum === null ? <span className="mn2-cell-unset">לא זמין</span> : <span className="mn2-qty"><span className="ltr">{fmtPrice(sum)}</span></span>;
      },
    };
    const act = (label: (o: Order) => string): TableColumn<Order> => ({
      key: "act",
      title: "פעולה",
      className: "mn2-cell-act",
      render: (o) => (
        <span className="mn2-acts">
          <Button variant="secondary" size="sm" onClick={only(() => openOrder(o.id))}>{label(o)}</Button>
        </span>
      ),
    });

    if (tab === "cancelled") return [customer, { key: "closed", title: "בוטלה", render: closedOn }, total, act(() => "פתיחה")];
    if (tab === "delivered") {
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
        total,
        act(() => "פתיחה"),
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
              <span className="mn2-cell-text ltr">{fmtPlainDay(o.promised_on)}</span>
              <span className="mn2-cell-sub"><Word tone="warn">{fmtPromised(o.promised_on)}</Word></span>
            </>
          ) : (
            <span className="mn2-cell-text">{fmtPromised(o.promised_on)}</span>
          ),
      },
      { key: "stock", title: "מצב המלאי", render: (o) => (short(o) ? <Word tone="short">חסר במלאי</Word> : <Word tone="ok">מוכן למסירה</Word>) },
      total,
      act((o) => (short(o) ? "טיפול בחוסר" : "פתיחה")),
    ];
  }, [tab, agent, product, linesOf, openOrder]);

  /* ───────── the head ───────── */
  const facts = useMemo(() => orderFacts(state.orders, linesOf, product), [state.orders, linesOf, product]);
  const lead =
    state.orders.length === 0 ? "עוד אין הזמנות. הזמנה של סוכן מהקטלוג תופיע כאן."
    : facts.open === 0 ? "אין הזמנות פתוחות. כל מה שהובטח ללקוחות נמסר או בוטל."
    : `${facts.open === 1 ? "הזמנה אחת פתוחה" : `${fmtQty(facts.open)} הזמנות פתוחות`}: ${fmtQty(facts.ready)} מוכנות למסירה${facts.waiting > 0 ? ` ו-${fmtQty(facts.waiting)} מחכות למלאי` : ""}.${facts.late > 0 ? ` ${facts.late === 1 ? "אחת כבר באיחור" : `${fmtQty(facts.late)} כבר באיחור`}${facts.lateWaiting > 0 ? `, ${facts.lateWaiting === 1 ? "ואחת מהן תקועה" : `ו-${fmtQty(facts.lateWaiting)} מהן תקועות`} בגלל חוסר` : ", וכולן מוכנות לצאת"}.` : " אף אחת לא באיחור."}`;

  const metrics: Metric[] = [
    { key: "open", label: "פתוחות", icon: "receipt-text", value: facts.open, note: facts.unpriced > 0 ? `${fmtCompact(facts.worth)} · ${fmtQty(facts.unpriced)} בלי מחיר` : `${fmtCompact(facts.worth)} במחירון`, onClick: () => setTab("open"), current: tab === "open" },
    { key: "late", label: "באיחור", icon: "clock", value: facts.late, tone: facts.late > 0 ? "warn" : "ok", note: facts.late === 0 ? <span className="is-ok">הכל בזמן</span> : "עבר המועד שהובטח ללקוח", onClick: () => setTab("late"), current: tab === "late" },
    { key: "ready", label: "מוכנות למסירה", icon: "package-check", value: facts.ready, tone: facts.ready > 0 ? "ok" : "none", note: "כל השורות על המדף" },
    { key: "waiting", label: "מחכות למלאי", icon: "package-x", value: facts.waiting, tone: facts.waiting > 0 ? "short" : "ok", note: facts.waiting === 0 ? <span className="is-ok">המדף מכסה הכל</span> : "מוצר אחד לפחות חסר", href: facts.waiting > 0 ? "/inventory?view=shortages" : undefined },
  ];

  const tabs = TABS.filter((t) => t.value !== "late" || counts.late > 0 || tab === "late").map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }));
  const here = TABS.find((t) => t.value === tab) ?? TABS[0];
  const elsewhere = q ? TABS.find((t) => t.value !== "late" && t.value !== tab && hits.some((o) => inTab(o, t.value))) : undefined;
  const tabTotal = counts[tab];

  const empty =
    state.orders.length === 0 ? (
      <EmptyState title="אין הזמנות" hint="הזמנה מאתר הקטלוג תופיע כאן">
        <Link href="/catalog" className="sa-btn sa-btn-secondary">פתיחת הקטלוג</Link>
      </EmptyState>
    ) : q ? (
      <EmptyState title={`לא נמצאו ${here.noun}`} hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
        {elsewhere ? <Button variant="secondary" onClick={() => setTab(elsewhere.value)}>הצגת {elsewhere.noun}</Button> : null}
        <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
      </EmptyState>
    ) : agentId ? (
      <EmptyState title={`אין ${here.noun}`} hint={`אצל ${agent(agentId)?.name ?? "הסוכן"}`}>
        <Button variant="secondary" onClick={() => setAgentId("")}>הסרת הסינון</Button>
      </EmptyState>
    ) : (
      <EmptyState title={`אין ${here.noun}`} hint={here.hint}>
        {tab !== "open" && counts.open > 0 ? <Button variant="secondary" onClick={() => setTab("open")}>הזמנות פתוחות</Button> : undefined}
      </EmptyState>
    );

  return (
    <Page
      title="הזמנות"
      state={facts.late > 0 ? { word: `${fmtQty(facts.late)} באיחור`, tone: "warn" } : facts.open > 0 ? { word: "הכל בזמן", tone: "ok" } : undefined}
      lead={lead}
      metrics={metrics}
      toolbar={
        <Toolbar
          tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab(toTab(v))} />}
          filters={<Select options={agentOptions} value={agentId} onChange={setAgentId} allLabel="כל הסוכנים" placeholder="סוכן" />}
          query={query}
          onQuery={setQuery}
          placeholder="חיפוש לפי לקוח, מספר הזמנה או טלפון"
        />
      }
    >
      <div className="sa-card mn2-sheet">
        {tab === "open" || tab === "late" ? <JustHandled kind="order" /> : null}
        <Table<Order>
          caption="רשימת הזמנות"
          className="mn2-table mn2-orders-table"
          columns={columns}
          data={rows}
          selectedId={panel?.type === "order" ? panel.id : undefined}
          empty={empty}
          onRowClick={(o) => openOrder(o.id)}
          footer={rows.length > 0 && rows.length < tabTotal ? <Showing shown={rows.length} total={tabTotal} /> : undefined}
        />
      </div>
    </Page>
  );
}
