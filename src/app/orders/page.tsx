"use client";

/**
 * הזמנות — what the agents ordered for their customers. An open order holds its
 * stock until the manager closes it in its panel, as delivered or cancelled.
 */
import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { normalizeName, orderTotal, useData, type Order } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Count, EmptyState, PageHead, Select, Showing, Table, Tabs, Toolbar, type SelectOption, type TableColumn } from "@/components/ui";
import { fmtAge, fmtDay, fmtName, fmtPrice, ORDER_STATUS_LABEL } from "@/lib/format";

type Status = Order["status"];

const TABS: { value: Status; label: string; empty: string }[] = [
  { value: "open", label: "פתוחות", empty: "אין הזמנות פתוחות" },
  { value: "delivered", label: "נמסרו", empty: "אין הזמנות שנמסרו" },
  { value: "cancelled", label: "בוטלו", empty: "אין הזמנות שבוטלו" },
];

/** Phones keep the customer and the total; each carries the rest on its second line, and the order panel has everything. */
const PHONE_ORDERS = "max-[600px]:[&_:is(td,th):is(:nth-child(2),:nth-child(4))]:hidden";

/** These two cells share what the figures leave, so a long name truncates and no column is ever cut. On phones the customer takes it all. */
const WHO_CELL = "w-[36%] max-w-0 max-[600px]:w-full";
const WHAT_CELL = "w-[36%] max-w-0";

function toStatus(value: string | null): Status {
  return value === "delivered" || value === "cancelled" ? value : "open";
}

/** Where an order stands, in its colour. An open order that asks for more than the shelf has says so, in the one loud colour. */
function OrderState({ status, short }: { status: Status; short: boolean }) {
  return <span className={`sa-order-state is-${short ? "short" : status}`}>{short ? "חסר במלאי" : ORDER_STATUS_LABEL[status]}</span>;
}

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
  const { state, stats, agent, product, linesOf } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The active tab lives in the URL (?status=delivered|cancelled).
  const status = toStatus(params.get("status"));
  const setStatus = useCallback(
    (next: Status) => {
      const sp = new URLSearchParams(params.toString());
      sp.delete("status");
      if (next !== "open") sp.set("status", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
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
    const byStatus: Record<Status, number> = { open: 0, delivered: 0, cancelled: 0 };
    for (const o of baseOrders) byStatus[o.status] += 1;
    return byStatus;
  }, [baseOrders]);

  const q = normalizeName(query);
  const orders = useMemo(() => {
    const digits = phoneDigits(q);
    return baseOrders.filter((o) => {
      if (o.status !== status) return false;
      if (!q) return true;
      return normalizeName(o.customer).includes(q) || String(o.number).includes(q) || (digits !== "" && digitsOf(o.customer_phone ?? "").includes(digits));
    });
  }, [baseOrders, status, q]);

  const tabTotal = useMemo(() => state.orders.filter((o) => o.status === status).length, [state.orders, status]);

  const selectedId = ui.panel?.type === "order" ? ui.panel.id : undefined;

  const columns = useMemo<TableColumn<Order>[]>(() => {
    const age = (o: Order) => (o.status === "open" ? fmtAge(o.created_at) : fmtDay(o.closed_at ?? o.created_at));
    const short = (o: Order) =>
      o.status === "open" &&
      linesOf(o.id).some((l) => {
        const p = product(l.product_id);
        return p !== undefined && p.qty < l.qty;
      });
    return [
      {
        key: "customer",
        title: "לקוח",
        className: WHO_CELL,
        render: (o) => {
          const name = agent(o.agent_id)?.name;
          return (
            <>
              <span className="sa-cell-primary sa-row-lead sa-truncate block" title={o.customer}>{o.customer}</span>
              <span className="sa-cell-sub sa-truncate">
                הזמנה {o.number}
                <span className="max-[600px]:hidden">{name ? ` · ${name}` : null}</span>
                <span className="min-[601px]:hidden"> · {age(o)}</span>
              </span>
            </>
          );
        },
      },
      {
        key: "products",
        title: "מוצרים",
        className: WHAT_CELL,
        render: (o) => {
          const lines = linesOf(o.id);
          const p = product(lines[0]?.product_id);
          return (
            <span className="sa-thumbed">
              <ProductThumb product={p} small />
              <span className="sa-order-what">
                <span className="sa-truncate" title={p?.name}>{p ? fmtName(p.name) : "—"}</span>
                {lines.length > 1 ? <span className="sa-order-more ltr">+{lines.length - 1}</span> : null}
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
          return (
            <>
              <span className={total === null ? "text-ink-3" : "sa-row-figure"}>{fmtPrice(total)}</span>
              <span className="block min-[601px]:hidden">
                <OrderState status={o.status} short={short(o)} />
              </span>
            </>
          );
        },
      },
      {
        key: "status",
        title: "מצב",
        render: (o) => (
          <span className="block whitespace-nowrap">
            <OrderState status={o.status} short={short(o)} />
            <span className="sa-cell-sub">{age(o)}</span>
          </span>
        ),
      },
    ];
  }, [agent, product, linesOf]);

  /* ───────── header ───────── */
  const tabs = TABS.map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }));

  const empty =
    state.orders.length === 0 ? (
      <EmptyState title="אין הזמנות" hint="הזמנה מאתר הקטלוג תופיע כאן" />
    ) : q ? (
      <EmptyState title="לא נמצאו הזמנות" hint={<>עבור „{query.trim()}”</>} />
    ) : (
      <EmptyState title={TABS.find((t) => t.value === status)?.empty} hint={agentId ? "אפשר להסיר את הסינון" : undefined} />
    );

  return (
    <div className="sa-page">
      <PageHead
        title="הזמנות"
        sub={<Count n={stats.reservedProducts} one="מוצר משוריין" many="מוצרים משוריינים" />}
      />

      <Toolbar
        tabs={<Tabs tabs={tabs} value={status} onChange={(v) => setStatus(toStatus(v))} />}
        filters={<Select options={agentOptions} value={agentId} onChange={setAgentId} allLabel="כל הסוכנים" placeholder="סוכן" />}
        query={query}
        onQuery={setQuery}
        placeholder="חיפוש לפי לקוח, מספר הזמנה או טלפון"
      />

      <Table<Order>
        caption="רשימת הזמנות"
        className={`sa-orders-table ${PHONE_ORDERS}`}
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
