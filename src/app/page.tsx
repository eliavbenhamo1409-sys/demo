"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { available, dayKey, useData, type AttentionEntry, type Movement as MovementRow, type Order } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { WeeklyChart } from "@/components/app/WeeklyChart";
import { AttentionGroups, type GroupedItem } from "@/components/app/AttentionGroups";
import { CountUp, ProductThumb, SparkBars, StockBar } from "@/components/app/Viz";
import {
  Button,
  Card,
  EmptyState,
  Movement,
  MovementQty,
  PageHead,
  Showing,
  Stat,
  Table,
  type TableColumn,
} from "@/components/ui";
import { fmtName, fmtQty, fmtToday, fmtWhen } from "@/lib/format";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { useDismissedAlerts } from "@/lib/dismissed-alerts";

const RECENT = 12;

/** The open orders listed here; the orders page has the rest. */
const OPEN_ORDERS = 6;

/** Phones keep the product, its action and its quantity; the time and worker columns go. */
const PHONE_RECENT = "max-[600px]:[&_:is(td,th):is(:nth-child(4),:nth-child(5))]:hidden";

/** Phones keep the customer, the order's number and when it came; the order panel has the rest. */
const PHONE_ORDERS = "max-[600px]:[&_:is(td,th):is(:nth-child(2),:nth-child(3))]:hidden";

/** On phones this cell takes what the other two leave, so a long name truncates instead of scrolling the table sideways. */
const PHONE_MAIN_CELL = "max-[600px]:w-full max-[600px]:max-w-0";

/** From 1100px a table clips instead of scrolling (minimal.css), so this cell gives way before מועד is cut off. */
const WIDE_PRODUCTS_CELL = "min-[1100px]:w-[30%] min-[1100px]:max-w-0";

const count = (n: number, one: string, many: string) => `${fmtQty(n)} ${n === 1 ? one : many}`;

export default function OverviewPage() {
  const { state, stats, attention, weekly, product, worker, agent, linesOf, resolveFault } = useData();
  const { openAction, openProduct, openOrder, notify } = useUi();
  const { dismissed, dismiss } = useDismissedAlerts();
  const [busyFault, setBusyFault] = useState<string | null>(null);
  const isLoading = state.status === "loading";

  /* ───────── stats ───────── */
  const stockNote =
    stats.out > 0 && stats.low > 0
      ? `${count(stats.out, "אזל", "אזלו")} · ${fmtQty(stats.low)} מתחת למינימום`
      : stats.out > 0
        ? `${count(stats.out, "אזל", "אזלו")} מהמלאי`
        : stats.low > 0
          ? `${fmtQty(stats.low)} מתחת למינימום`
          : stats.short > 0
            ? `${fmtQty(stats.short)} חסר להזמנות`
            : stats.products > 0
              ? "כל המוצרים מעל המינימום"
              : undefined;

  const delta =
    stats.movementsYesterday > 0 && stats.movementsToday > 0
      ? Math.round(((stats.movementsToday - stats.movementsYesterday) / stats.movementsYesterday) * 100)
      : undefined;

  // An empty shelf that orders still hold counts once, as short, so the note adds up to the exceptions figure.
  const stockAlerts = attention.filter((a) => a.kind === "out" || a.kind === "low").length;

  const exceptionsNote =
    stats.exceptions > 0
      ? [
          stats.openFaults > 0 ? count(stats.openFaults, "תקלה", "תקלות") : "",
          stats.short > 0 ? `${fmtQty(stats.short)} חסר להזמנות` : "",
          stats.pendingRequests > 0 ? count(stats.pendingRequests, "בקשה", "בקשות") : "",
          stats.pendingMappings > 0 ? count(stats.pendingMappings, "התאמה", "התאמות") : "",
          stockAlerts > 0 ? count(stockAlerts, "מוצר", "מוצרים") : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  // Orders placed on each of the week's days, in the same seven days as the movements.
  const ordersByDay = useMemo(() => {
    const days = new Map(weekly.map((d, i) => [d.day, i]));
    const counts = weekly.map(() => 0);
    for (const o of state.orders) {
      const i = days.get(dayKey(o.created_at));
      if (i !== undefined) counts[i] += 1;
    }
    return counts;
  }, [weekly, state.orders]);

  /* ───────── attention ───────── */
  const onResolve = useCallback(
    async (entry: AttentionEntry) => {
      if (!entry.faultId || busyFault) return;
      setBusyFault(entry.faultId);
      try {
        await resolveFault(entry.faultId);
        notify({ tone: "success", title: "התקלה סומנה כטופלה", text: entry.title });
      } catch (e) {
        notify({ tone: "danger", title: "סימון התקלה נכשל", text: e instanceof Error ? e.message : undefined });
      } finally {
        setBusyFault(null);
      }
    },
    [resolveFault, notify, busyFault],
  );

  // A removed stock alert remembers what was available, so a new reservation brings it back.
  const availableFor = useCallback(
    (entry: AttentionEntry) => {
      const p = product(entry.productId);
      return p ? available(p) : 0;
    },
    [product],
  );

  const openAttention = useMemo(
    () => attention.filter((a) => !(a.kind === "out" || a.kind === "low") || dismissed[a.id] !== availableFor(a)),
    [attention, dismissed, availableFor],
  );

  const attentionItems = useMemo<GroupedItem[]>(
    () =>
      openAttention.map((a) => {
        const base: GroupedItem = {
          kind: a.kind,
          id: a.id,
          severity: a.severity,
          label: a.label,
          title: a.title,
          // SKUs / external codes are Latin → mono LTR; Hebrew meta (e.g. "ללא התאמה") stays as text.
          meta: a.meta.map((m, i) => (i === 0 && a.kind !== "fault" && /^[\x20-\x7E]+$/.test(m) ? <span key={i} className="sa-mono ltr">{m}</span> : m)),
        };
        switch (a.kind) {
          case "out":
          case "low":
            return {
              ...base,
              onOpen: () => openProduct(a.productId as string),
              onDismiss: () => dismiss(a.id, availableFor(a)),
            };
          case "short":
            return { ...base, onOpen: () => openProduct(a.productId as string) };
          case "fault": {
            const src = faultPhotoUrl(a.photoPath);
            return {
              ...base,
              thumb: src ? { src, alt: "תצלום התקלה" } : undefined,
              onOpen: a.productId ? () => openProduct(a.productId as string) : undefined,
              onDismiss: () => void onResolve(a),
              dismissLabel: "סימון כטופל",
            };
          }
          case "request":
            return { ...base, onOpen: () => openAction("review-item-request", { requestId: a.requestId }) };
          case "mapping":
            return { ...base, onOpen: () => openAction("map-supplier-item", { supplierItemId: a.supplierItemId }) };
        }
      }),
    [openAttention, openAction, openProduct, onResolve, dismiss, availableFor],
  );

  /* ───────── open orders ───────── */
  // state.orders is newest first; the oldest has waited longest, so it leads here.
  const openOrders = useMemo(() => state.orders.filter((o) => o.status === "open").reverse(), [state.orders]);

  const orderColumns = useMemo<TableColumn<Order>[]>(
    () => [
      {
        key: "customer",
        title: "לקוח",
        className: PHONE_MAIN_CELL,
        render: (o) => <span className="sa-cell-primary sa-truncate block max-w-[240px] max-[600px]:max-w-none" title={o.customer}>{o.customer}</span>,
      },
      {
        key: "products",
        title: "מוצרים",
        className: WIDE_PRODUCTS_CELL,
        render: (o) => {
          const lines = linesOf(o.id);
          const first = product(lines[0]?.product_id);
          return (
            <span className="sa-thumbed">
              <ProductThumb product={first} small />
              <span className="flex min-w-0 items-baseline gap-[var(--space-2)]">
                <span className="sa-truncate" title={first?.name}>{first ? fmtName(first.name) : "—"}</span>
                {lines.length > 1 ? <span className="sa-mono ltr text-ink-3">+{lines.length - 1}</span> : null}
              </span>
            </span>
          );
        },
      },
      {
        key: "agent",
        title: "סוכן",
        render: (o) => {
          const name = agent(o.agent_id)?.name;
          return <span className="sa-truncate block max-w-[140px]" title={name}>{name ?? "—"}</span>;
        },
      },
      { key: "number", title: "מספר", width: "88px", mono: true, muted: true },
      { key: "created_at", title: "מועד", width: "128px", mono: true, muted: true, render: (o) => fmtWhen(o.created_at) },
    ],
    [agent, product, linesOf],
  );

  /* ───────── recent movements ───────── */
  const recent = useMemo(() => state.movements.slice(0, RECENT), [state.movements]);

  const columns = useMemo<TableColumn<MovementRow>[]>(
    () => [
      {
        key: "product_id",
        title: "מוצר",
        className: PHONE_MAIN_CELL,
        render: (m) => {
          const p = product(m.product_id);
          return (
            <span className="sa-thumbed">
              <ProductThumb product={p} />
              <span className="flex min-w-0 flex-col">
                <span className="block truncate text-ink">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
                {p ? <span className="sa-cell-sub sa-mono ltr self-start">{p.sku}</span> : null}
              </span>
            </span>
          );
        },
      },
      { key: "type", title: "פעולה", width: "128px", render: (m) => <Movement type={m.type} /> },
      {
        key: "qty",
        title: "כמות",
        width: "96px",
        align: "num",
        render: (m) => <MovementQty qty={m.qty} type={m.type} />,
      },
      {
        key: "worker_id",
        title: "עובד",
        width: "160px",
        render: (m) => {
          const w = worker(m.worker_id);
          return w ? <span className="block truncate">{w.name}</span> : <span className="text-ink-3">—</span>;
        },
      },
      { key: "created_at", title: "מועד", width: "128px", mono: true, muted: true, render: (m) => fmtWhen(m.created_at) },
    ],
    [product, worker],
  );

  return (
    <div className="sa-page">
      <PageHead title="סקירה" sub={fmtToday()} />

      <div className="sa-stats ov-stats">
        <Stat
          label="מצב מלאי"
          icon="package"
          href="/inventory"
          value={<CountUp value={stats.products} />}
          unit="מוצרים"
          note={stockNote}
          tone={stats.out > 0 || stats.low > 0 || stats.short > 0 ? "warning" : undefined}
          viz={
            <StockBar
              label={stockNote ?? "מצב המלאי"}
              parts={[
                { tone: "ok", value: Math.max(0, stats.products - stats.low - stats.out - stats.short) },
                { tone: "low", value: stats.low },
                { tone: "out", value: stats.out + stats.short },
              ]}
            />
          }
        />
        <Stat
          label="הזמנות פתוחות"
          icon="inbox"
          href="/orders"
          value={<CountUp value={stats.openOrders} />}
          note={stats.reservedProducts > 0 ? count(stats.reservedProducts, "מוצר משוריין", "מוצרים משוריינים") : undefined}
          viz={<SparkBars values={ordersByDay} label="הזמנות בשבעת הימים האחרונים" />}
        />
        <Stat
          label="תנועות היום"
          icon="activity"
          href="/movements?period=today"
          value={<CountUp value={stats.movementsToday} />}
          delta={delta}
          deltaUnit={delta != null ? "%" : undefined}
          note={stats.movementsYesterday > 0 ? "לעומת אתמול" : stats.movementsToday > 0 ? "אין תנועות אתמול" : undefined}
          viz={<SparkBars values={weekly.map((d) => d.total)} label="תנועות בשבעת הימים האחרונים" />}
        />
        <Stat
          label="חריגות פתוחות"
          icon="alert-circle"
          value={<CountUp value={stats.exceptions} />}
          note={exceptionsNote}
          tone={stats.openFaults > 0 ? "danger" : stats.exceptions > 0 ? "warning" : undefined}
          viz={
            <StockBar
              label={exceptionsNote ?? "אין חריגות"}
              parts={[
                { tone: "out", value: stats.openFaults + stats.short },
                { tone: "low", value: stockAlerts },
                { tone: "other", value: stats.pendingRequests + stats.pendingMappings },
              ]}
            />
          }
        />
      </div>

      <div className="ov-split">
        <Card title="דורש טיפול" count={openAttention.length || undefined} flush className="min-w-0">
          <AttentionGroups items={attentionItems} />
        </Card>
        <WeeklyChart days={weekly} className="min-w-0" />
      </div>

      <Card title="הזמנות פתוחות" count={openOrders.length || undefined} flush>
        <Table<Order>
          className={PHONE_ORDERS}
          columns={orderColumns}
          data={openOrders.slice(0, OPEN_ORDERS)}
          isLoading={isLoading}
          caption="ההזמנות הפתוחות, הוותיקה ראשונה"
          onRowClick={(o) => openOrder(o.id)}
          empty={<EmptyState title="אין הזמנות פתוחות" hint="הזמנה של סוכן תופיע כאן" />}
          footer={
            openOrders.length > 0 ? (
              <>
                {openOrders.length > OPEN_ORDERS ? <Showing shown={OPEN_ORDERS} total={openOrders.length} /> : null}
                <Link href="/orders" className="sa-btn sa-btn-link sa-btn-sm ms-auto">
                  כל ההזמנות
                </Link>
              </>
            ) : undefined
          }
        />
      </Card>

      <Card title="תנועות אחרונות" flush>
        <Table<MovementRow>
          className={PHONE_RECENT}
          columns={columns}
          data={recent}
          isLoading={isLoading}
          skeletonRows={6}
          caption="התנועות האחרונות במלאי"
          onRowClick={(m) => openProduct(m.product_id, "history")}
          empty={
            <EmptyState title="אין תנועות" hint="קליטה או הוצאה ראשונה תופיע כאן">
              <Button variant="secondary" onClick={() => openAction("receive")}>
                קליטת סחורה
              </Button>
            </EmptyState>
          }
          footer={
            recent.length > 0 ? (
              <>
                <Showing shown={recent.length} total={state.movements.length} />
                <Link href="/movements?period=all" className="sa-btn sa-btn-link sa-btn-sm">
                  כל התנועות
                </Link>
              </>
            ) : undefined
          }
        />
      </Card>
    </div>
  );
}
