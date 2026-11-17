"use client";

/**
 * לקוחות: who the factory sells to, read off the orders themselves. There is no customer file to fill in; a customer
 * is the name an agent wrote on an order. Each row says what that customer is waiting for now and what they took
 * lately, and opens their orders.
 */
import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Showing, Table, Tabs, Toolbar, type TableColumn } from "@/components/ui";
import { fmtCompact, fmtDayWord, fmtPrice, fmtQty } from "@/lib/format";
import { normalizeName, orderTotal, useData } from "@/lib/store";
import { goColumn } from "../cells";
import { Page, Word, type Metric } from "../parts";
import { daysBack, isLate } from "../work";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  open: number;
  late: number;
  /** ₪ of what was delivered to them in the last 30 days; null while one of those orders has no price. */
  taken: number | null;
  delivered: number;
  orders: number;
  last: string;
};

type Tab = "waiting" | "all";

export function Customers(): ReactElement {
  const { state, linesOf } = useData();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("waiting");
  const [query, setQuery] = useState("");

  const customers = useMemo<Customer[]>(() => {
    const since = daysBack(30);
    const by = new Map<string, Customer>();
    // Newest first, so the first phone seen for a customer is the latest one given.
    for (const o of state.orders) {
      const name = o.customer.trim();
      const key = normalizeName(name);
      const c = by.get(key) ?? { id: key, name, phone: null, open: 0, late: 0, taken: 0, delivered: 0, orders: 0, last: o.created_at };
      c.orders += 1;
      if (!c.phone && o.customer_phone) c.phone = o.customer_phone;
      if (o.status === "open") {
        c.open += 1;
        if (isLate(o)) c.late += 1;
      }
      if (o.status === "delivered" && o.closed_at && Date.parse(o.closed_at) >= since) {
        c.delivered += 1;
        const total = orderTotal(linesOf(o.id));
        c.taken = c.taken === null || total === null ? null : c.taken + total;
      }
      by.set(key, c);
    }
    return [...by.values()];
  }, [state.orders, linesOf]);

  const waiting = customers.filter((c) => c.open > 0);
  const q = normalizeName(query);
  const rows = useMemo(() => {
    const list = (tab === "waiting" ? customers.filter((c) => c.open > 0) : customers).filter((c) => !q || normalizeName(c.name).includes(q) || (c.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "~"));
    return list.sort((a, b) => b.late - a.late || b.open - a.open || (b.taken ?? 0) - (a.taken ?? 0) || a.name.localeCompare(b.name, "he"));
  }, [customers, tab, q]);

  const openOrders = (c: Customer) => router.push(`/orders?q=${encodeURIComponent(c.name)}${c.open === 0 ? "&status=delivered" : ""}`);

  const columns: TableColumn<Customer>[] = [
    {
      key: "name",
      title: "לקוח",
      className: "mn2-cell-main",
      render: (c) => (
        <>
          <span className="mn2-cell-title"><bdi>{c.name}</bdi></span>
          <span className="mn2-cell-sub">{c.orders === 1 ? "הזמנה אחת" : `${fmtQty(c.orders)} הזמנות`}</span>
        </>
      ),
    },
    {
      key: "phone",
      title: "טלפון",
      render: (c) => (c.phone ? <a className="mn2-cell-text mn2-tel ltr" href={`tel:${c.phone.replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()}>{c.phone}</a> : <span className="mn2-cell-unset">לא נמסר</span>),
    },
    {
      key: "open",
      title: "הזמנות פתוחות",
      render: (c) =>
        c.open === 0 ? <span className="mn2-cell-unset">אין</span> : (
          <>
            <span className="mn2-qty"><span className="ltr">{fmtQty(c.open)}</span></span>
            {c.late > 0 ? <span className="mn2-cell-sub"><Word tone="warn">{c.late === 1 ? "אחת באיחור" : `${fmtQty(c.late)} באיחור`}</Word></span> : null}
          </>
        ),
    },
    {
      key: "taken",
      title: "נמסר ב-30 יום",
      render: (c) =>
        c.delivered === 0 ? <span className="mn2-cell-unset">לא נמסר</span> : (
          <>
            <span className="mn2-qty"><span className="ltr">{c.taken === null ? "לא זמין" : fmtPrice(Math.round(c.taken))}</span></span>
            <span className="mn2-cell-sub">{c.delivered === 1 ? "הזמנה אחת" : `${fmtQty(c.delivered)} הזמנות`}</span>
          </>
        ),
    },
    { key: "last", title: "הזמנה אחרונה", render: (c) => <span className="mn2-cell-text">{fmtDayWord(c.last)}</span> },
    goColumn(),
  ];

  const month = customers.filter((c) => c.delivered > 0);
  const biggest = [...month].sort((a, b) => (b.taken ?? 0) - (a.taken ?? 0))[0];
  const sold = month.reduce((sum, c) => sum + (c.taken ?? 0), 0);
  const late = customers.filter((c) => c.late > 0).length;

  const metrics: Metric[] = [
    { key: "waiting", label: "מחכים להזמנה", icon: "users", value: waiting.length },
    { key: "late", label: "באיחור", icon: "clock", value: late, tone: late > 0 ? "warn" : "ok" },
    { key: "month", label: "נמסר ב-30 יום", icon: "arrow-up-from-line", value: <span className="ltr">{fmtCompact(sold)}</span> },
    { key: "biggest", label: "הלקוח הגדול החודש", icon: "chart-pie", value: biggest ? <bdi className="mn2-metric-name">{biggest.name}</bdi> : "אין" },
  ];

  // The count of those who wait stands in the figures; the tab only says which list this is.
  const tabs = [
    { value: "waiting", label: "מחכים להזמנה" },
    { value: "all", label: "כל הלקוחות", count: customers.length },
  ];

  return (
    <Page
      title="לקוחות"
      metrics={metrics}
      toolbar={<Toolbar tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v === "all" ? "all" : "waiting")} />} query={query} onQuery={setQuery} placeholder="חיפוש לקוח או טלפון" />}
    >
      <Table<Customer>
        caption="רשימת לקוחות"
        className="mn2-table mn2-customers-table"
        columns={columns}
        data={rows}
        empty={
          q ? (
            <EmptyState title="לא נמצאו לקוחות" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
              <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
            </EmptyState>
          ) : tab === "waiting" && customers.length > 0 ? (
            <EmptyState title="אף לקוח לא מחכה להזמנה">
              <Button variant="secondary" onClick={() => setTab("all")}>כל הלקוחות</Button>
            </EmptyState>
          ) : (
            <EmptyState title="אין לקוחות" hint="לקוח נוסף כשנפתחת לו הזמנה" />
          )
        }
        onRowClick={openOrders}
        footer={rows.length > 0 && rows.length < customers.length ? <Showing shown={rows.length} total={customers.length} /> : undefined}
      />
    </Page>
  );
}
