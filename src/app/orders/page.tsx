"use client";

/**
 * הזמנות — what the agents ordered for their customers. An open order holds its
 * stock until the manager closes it in its panel, as delivered or cancelled.
 * A row reads in the order a manager asks: who, what, how much, can it go out, when.
 * Whether an order is open is the tab's job, so no column says it.
 */
import { Suspense, useCallback, useMemo, useState, useTransition, type ReactElement } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { available, normalizeName, orderTotal, useData, type Order } from "@/lib/store";
import { changeWords, keptChanges } from "@/lib/worker/order-check";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, EmptyState, PageHead, Select, Showing, Table, Tabs, Toolbar, type SelectOption, type TableColumn } from "@/components/ui";
import { byPromise, daysUntil, fmtCompact, fmtDay, fmtDayWord, fmtName, fmtPlainDay, fmtPrice, fmtPromised, fmtQty, fmtUnit, ORDER_STATUS_LABEL } from "@/lib/format";
// The overview's figure and state word, so a row of orders reads the same on both pages.
import "@/components/app/overview.css";

/** An order's three statuses, and the open orders past their date, a tab of its own while there are any. */
type Tab = Order["status"] | "late";

const TABS: { value: Tab; label: string; noun: string; hint: string }[] = [
  { value: "open", label: "פתוחות", noun: "הזמנות פתוחות", hint: "הזמנה חדשה של סוכן תופיע כאן" },
  { value: "late", label: "באיחור", noun: "הזמנות באיחור", hint: "כל ההזמנות הפתוחות בזמן" },
  { value: "delivered", label: "נמסרו", noun: "הזמנות שנמסרו", hint: "הזמנה שסומנה כנמסרה תופיע כאן" },
  { value: "cancelled", label: "בוטלו", noun: "הזמנות שבוטלו", hint: "הזמנה שבוטלה תופיע כאן" },
];

function toTab(value: string | null): Tab {
  return value === "late" || value === "delivered" || value === "cancelled" ? value : "open";
}

const isLate = (o: Order) => o.status === "open" && o.promised_on !== null && daysUntil(o.promised_on) < 0;

const inTab = (o: Order, tab: Tab) => (tab === "late" ? isLate(o) : o.status === tab);

const byClosing = (a: Order, b: Order) => (b.closed_at ?? "").localeCompare(a.closed_at ?? "");

const NO_DATE = "ללא מועד";

/** Whether the receipt read as the order said. Null is a closing nobody compared: the admin's, or an old phone's. Under a total, where no column names it, it says קבלה. */
function Receipt({ order, named }: { order: Order; named?: boolean }): ReactElement {
  const changes = keptChanges(order).length;
  if (changes > 0) return <span className="ov-fig-word is-warn block">{changeWords(changes)}</span>;
  const name = named ? "קבלה " : "";
  if (order.receipt_read === null) return <span className="ov-fig-word text-ink-3 block">{name}לא נבדקה</span>;
  return order.receipt_read ? <span className="ov-fig-word is-ok block">{name}תואמת</span> : <span className="ov-fig-word is-none block">{name}לא נקראה</span>;
}

/** The date promised to the customer and, as a word of its own under it, how late it is. */
function Promised({ order }: { order: Order }): ReactElement {
  if (!order.promised_on) return <span className="text-ink-3">{NO_DATE}</span>;
  if (!isLate(order)) return <>{fmtPromised(order.promised_on)}</>;
  return (
    <>
      {fmtPlainDay(order.promised_on)}
      <span className="ov-fig-word is-warn block">{fmtPromised(order.promised_on)}</span>
    </>
  );
}

/** What a phone reads after the order's number, where the columns that say it are gone. */
function PhoneWhen({ order }: { order: Order }): ReactElement {
  if (order.status !== "open") return <>{ORDER_STATUS_LABEL[order.status]} {fmtDayWord(order.closed_at ?? order.created_at)}</>;
  if (!order.promised_on) return <>{NO_DATE}</>;
  return isLate(order) ? <span className="ov-fig-word is-warn">{fmtPromised(order.promised_on)}</span> : <>מסירה {fmtPromised(order.promised_on)}</>;
}

/** A name is cut at the end of its line, and in a right-to-left line that eats a size from its first digit: 100×10 would read 00×10. Figures go whole. */
const wholeFigures = (name: string) =>
  fmtName(name)
    .split(/(\S*\d\S*)/)
    .map((part, i) => (i % 2 ? <span key={i} className="inline-block">{part}</span> : part));

const digitsOf = (text: string) => text.replace(/\D/g, "");

/** A search with letters in it looks for a name, even one with a number in it, so it never matches a phone. */
const phoneDigits = (q: string) => (/\p{L}/u.test(q) ? "" : digitsOf(q));

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersInner />
    </Suspense>
  );
}

function OrdersInner() {
  const { state, agent, product, linesOf } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

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

  // The top search sends a customer's name as ?q=: the box starts from it, and follows when another name is sent.
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

  const agentOptions = useMemo<SelectOption[]>(
    () => state.agents.map((a) => ({ value: a.id, label: a.name })),
    [state.agents],
  );

  /* ───────── orders ───────── */
  const baseOrders = useMemo(
    () => (agentId ? state.orders.filter((o) => o.agent_id === agentId) : state.orders),
    [state.orders, agentId],
  );

  const counts = useMemo(() => {
    const byTab: Record<Tab, number> = { open: 0, late: 0, delivered: 0, cancelled: 0 };
    for (const o of baseOrders) {
      byTab[o.status] += 1;
      if (isLate(o)) byTab.late += 1;
    }
    return byTab;
  }, [baseOrders]);

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
    // What still has to go out is read by the date promised to the customer, the nearest first and, on one date, the oldest first
    // (state.orders is newest first). What has closed is read back from the last to close.
    return tab === "open" || tab === "late" ? found.reverse().sort(byPromise) : found.sort(byClosing);
  }, [hits, tab]);

  const tabTotal = useMemo(() => state.orders.filter((o) => inTab(o, tab)).length, [state.orders, tab]);

  const selectedId = ui.panel?.type === "order" ? ui.panel.id : undefined;

  const columns = useMemo<TableColumn<Order>[]>(() => {
    // The same reading as the overview: a line is short when its product is held past the shelf.
    const isShort = (o: Order) =>
      linesOf(o.id).some((l) => {
        const p = product(l.product_id);
        return p !== undefined && available(p) < 0;
      });

    /** The fourth question. It has a column of its own from 1100px; below that it stands under the total. */
    const word = (o: Order, named?: boolean) => {
      if (o.status === "delivered") return <Receipt order={o} named={named} />;
      if (o.status === "cancelled") return null;
      return isShort(o) ? <span className="ov-fig-word is-short block">חסר במלאי</span> : <span className="ov-fig-word is-ok block">מוכן למסירה</span>;
    };

    const closedOn = (o: Order) => fmtDay(o.closed_at ?? o.created_at);

    const last: TableColumn<Order>[] =
      tab === "cancelled"
        ? [{ key: "closed_at", title: "בוטלה", render: closedOn }]
        : tab === "delivered"
          ? [
              { key: "receipt", title: "קבלה", render: (o) => word(o) },
              { key: "closed_at", title: "נמסרה", render: closedOn },
            ]
          : [
              { key: "supply", title: "אספקה", render: (o) => word(o) },
              { key: "promised_on", title: "מסירה", render: (o) => <Promised order={o} /> },
            ];

    return [
      {
        key: "customer",
        title: "לקוח",
        render: (o) => {
          const name = agent(o.agent_id)?.name;
          return (
            <>
              <span className="sa-cell-primary sa-truncate block" title={o.customer}>{o.customer}</span>
              <span className="sa-cell-sub sa-order-meta">
                <span className="sa-truncate">
                  הזמנה <span className="inline-block">{o.number}</span>
                  <span className="max-[600px]:hidden">{name ? ` · ${name}` : null}</span>
                </span>
                <span className="min-[601px]:hidden">· <PhoneWhen order={o} /></span>
              </span>
            </>
          );
        },
      },
      {
        key: "products",
        title: "מוצרים",
        render: (o) => {
          const lines = linesOf(o.id);
          const first = lines[0];
          const p = product(first?.product_id);
          const more = lines.length - 1;
          return (
            <span className="sa-thumbed">
              <ProductThumb product={p} small />
              <span className="sa-order-what">
                <span className="sa-truncate" title={p?.name}>{p ? wholeFigures(p.name) : "—"}</span>
                {first ? <span className="sa-order-qty">{fmtQty(first.qty)} {fmtUnit(first.qty, p?.unit)}</span> : null}
                {more > 0 ? <span className="sa-order-more sa-cell-sub">{more === 1 ? "+שורה אחת" : <><span className="ltr inline-block">+{more}</span> שורות</>}</span> : null}
              </span>
            </span>
          );
        },
      },
      {
        key: "total",
        title: "סכום",
        align: "num",
        render: (o) => {
          const total = orderTotal(linesOf(o.id));
          const said = word(o, true);
          return (
            <>
              <span className={total === null ? "text-ink-3" : "ov-fig-n"}>{fmtPrice(total)}</span>
              {said ? <span className="block min-[1100px]:hidden">{said}</span> : null}
            </>
          );
        },
      },
      ...last,
    ];
  }, [tab, agent, product, linesOf]);

  /* ───────── header ───────── */
  const tabs = TABS.filter((t) => t.value !== "late" || counts.late > 0 || tab === "late").map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }));

  const here = TABS.find((t) => t.value === tab) ?? TABS[0];
  // Nothing here for this search may still be elsewhere: the top search sends a customer whose orders have all closed.
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
      <EmptyState title={`אין ${here.noun}`} hint={`אצל ${agent(agentId)?.name}`}>
        <Button variant="secondary" onClick={() => setAgentId("")}>הסרת הסינון</Button>
      </EmptyState>
    ) : (
      <EmptyState title={`אין ${here.noun}`} hint={here.hint}>
        {tab !== "open" && counts.open > 0 ? <Button variant="secondary" onClick={() => setTab("open")}>הצגת הזמנות פתוחות</Button> : undefined}
      </EmptyState>
    );

  return (
    <div className="sa-page">
      <PageHead
        title="הזמנות"
        sub={worth.open > 0 ? <><span className="ltr">{fmtCompact(worth.total)}</span> פתוחות · במחירון{worth.unpriced > 0 ? ` · ${fmtQty(worth.unpriced)} ללא מחיר` : ""}</> : undefined}
      />

      <Toolbar
        tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab(toTab(v))} />}
        filters={<Select options={agentOptions} value={agentId} onChange={setAgentId} allLabel="כל הסוכנים" placeholder="סוכן" />}
        query={query}
        onQuery={setQuery}
        placeholder="חיפוש לפי לקוח, מספר הזמנה או טלפון"
      />

      <Table<Order>
        caption="רשימת הזמנות"
        className="sa-orders-table"
        columns={columns}
        data={orders}
        selectedId={selectedId}
        empty={empty}
        onRowClick={(o) => ui.openOrder(o.id)}
        footer={orders.length > 0 && orders.length < tabTotal ? <Showing shown={orders.length} total={tabTotal} /> : undefined}
      />
    </div>
  );
}
