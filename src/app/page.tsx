"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { available, useData, type AttentionEntry, type AttentionKind, type Movement as MovementRow } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { AttentionGroups, type GroupedItem } from "@/components/app/AttentionGroups";
import { OpenOrders, RunningOut, Shekels, ShelfPicture, type Check, type CheckTone } from "@/components/app/Snapshot";
import { CountUp, ProductThumb } from "@/components/app/Viz";
import {
  Button,
  Card,
  EmptyState,
  Movement,
  MovementQty,
  Notice,
  PageHead,
  Showing,
  Stat,
  Table,
  type TableColumn,
} from "@/components/ui";
import { daysUntil, fmtName, fmtPrice, fmtQty, fmtRelative, fmtToday, fmtWhen } from "@/lib/format";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { useDismissedAlerts } from "@/lib/dismissed-alerts";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { movedWorth, PACE_DAYS, runway, shelfWorth, type Runway } from "@/lib/snapshot";
import { splitTheme, useTheme } from "@/lib/theme";
import { ControlRoom } from "@/components/app/dashboard/ControlRoom";

const RECENT = 6;

/** The open orders listed here, one row for each of the list beside them; the orders page has the rest. */
const OPEN_ORDERS = 5;

/** The products closest to running out; the inventory page has the rest. */
const RUNNING_OUT = 5;

/** Phones keep the product and its quantity, with the action a word under the figure; the name gets the room. A tablet gives up the worker for it. */
const PHONE_RECENT = "max-[600px]:[&_:is(td,th):is(:nth-child(2),:nth-child(4),:nth-child(5))]:hidden min-[601px]:max-[1099px]:[&_:is(td,th):nth-child(4)]:hidden";

/** On phones this cell takes what the other two leave, so a long name truncates instead of scrolling the table sideways. */
const PHONE_MAIN_CELL = "max-[600px]:w-full max-[600px]:max-w-0";

/** From 1100px a table clips instead of scrolling (minimal.css), so a long name truncates and the columns after it keep their width. */
const WIDE_NAME_CELL = "min-[1100px]:max-[1499px]:w-full min-[1100px]:max-[1499px]:max-w-0";

const count = (n: number, one: string, many: string) => `${fmtQty(n)} ${n === 1 ? one : many}`;

const answer = ([text, tone]: [string, CheckTone]) => ({ answer: text, tone });

/** Stock has its own list on this screen, with the days each product has left. */
const isStock = (a: { kind: AttentionKind }) => a.kind === "out" || a.kind === "low";

function OwnerOverview() {
  const { state, stats, attention, product, worker, linesOf, resolveFault } = useData();
  const { openAction, openProduct, notify } = useUi();
  const { dismissed, dismiss } = useDismissedAlerts();
  const [busyFault, setBusyFault] = useState<string | null>(null);
  const isLoading = state.status === "loading";

  // The week's worth and the pace of goods out both need days the store may no longer hold.
  const since = useMemo(() => midnight(1 - PACE_DAYS), []);
  const { rows: month, isLoading: monthLoading, failed: monthFailed, retry: retryMonth } = useMovementsInRange(since, null);

  /* ───────── worth ───────── */
  const worth = useMemo(() => shelfWorth(state.products), [state.products]);

  const flow = useMemo(() => {
    const week = midnight(-6), weekBefore = midnight(-13);
    const moved = (type: "in" | "out", from: number, to = Number.POSITIVE_INFINITY) => movedWorth(month, type, from, to, product);
    return {
      outWeek: moved("out", week),
      outWeekBefore: moved("out", weekBefore, week),
      inWeek: moved("in", week),
      inWeekBefore: moved("in", weekBefore, week),
    };
  }, [month, product]);

  const latest = state.movements[0];

  /* ───────── what runs out first ───────── */
  const soon = useMemo(() => {
    // A removed stock alert remembers what was available, so a new reservation brings it back.
    const removed = (r: Runway) => (r.state === "out" || r.state === "low") && dismissed[`${r.state}:${r.product.id}`] === r.free;
    return runway(state.products, month).filter((r) => (r.days !== null || r.state !== "ok") && !removed(r));
  }, [state.products, month, dismissed]);

  const onRemoveAlert = useCallback((r: Runway) => dismiss(`${r.state}:${r.product.id}`, r.free), [dismiss]);

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

  const workItems = useMemo<GroupedItem[]>(
    () =>
      attention.filter((a) => !isStock(a)).map((a) => {
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
          default:
            return { ...base, onOpen: () => openProduct(a.productId as string) };
        }
      }),
    [attention, openAction, openProduct, onResolve],
  );

  /* ───────── the worries ───────── */
  const promises = useMemo(() => {
    const open = state.orders.filter((o) => o.status === "open");
    const short = (id: string) => {
      const p = product(id);
      return p ? available(p) < 0 : false;
    };
    return {
      open: open.length,
      uncovered: open.filter((o) => linesOf(o.id).some((l) => short(l.product_id))).length,
      late: open.filter((o) => o.promised_on && daysUntil(o.promised_on) < 0).length,
    };
  }, [state.orders, linesOf, product]);

  const pending = stats.pendingRequests + stats.pendingMappings;
  const toRefill = soon.filter((r) => r.state === "out" || r.state === "low").length;

  const checks: Check[] = [
    {
      key: "faults",
      label: "תקלות",
      icon: "alert-circle",
      href: "/faults",
      ...answer(stats.openFaults > 0 ? [count(stats.openFaults, "פתוחה", "פתוחות"), "bad"] : ["אין פתוחות", "ok"]),
    },
    {
      key: "approvals",
      label: "אישורים",
      icon: "clipboard-check",
      href: pending > 0 ? "#ov-work" : "/suppliers",
      ...answer(pending > 0 ? [count(pending, "ממתין", "ממתינים"), "warn"] : ["אין ממתינים", "ok"]),
    },
    {
      key: "stock",
      label: "מלאי",
      icon: "package",
      href: stats.low > 0 ? "/inventory?filter=low" : stats.out > 0 ? "/inventory?filter=out" : "/inventory",
      ...answer(toRefill > 0 ? [`${fmtQty(toRefill)} להשלמה`, "warn"] : ["אין מה להשלים", "ok"]),
    },
  ];

  /* ───────── recent movements ───────── */
  const recent = useMemo(() => state.movements.slice(0, RECENT), [state.movements]);

  const columns = useMemo<TableColumn<MovementRow>[]>(
    () => [
      {
        key: "product_id",
        title: "מוצר",
        className: `${PHONE_MAIN_CELL} ${WIDE_NAME_CELL}`,
        render: (m) => {
          const p = product(m.product_id);
          return (
            <span className="sa-thumbed">
              <ProductThumb product={p} />
              <span className="flex min-w-0 flex-col">
                <span className="sa-cell-primary sa-truncate block">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
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
        render: (m) => (
          <>
            <MovementQty qty={m.qty} type={m.type} />
            <span className="sa-cell-sub min-[601px]:hidden! [&_svg]:hidden"><Movement type={m.type} /></span>
          </>
        ),
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
    <div className="sa-page ov-page">
      <PageHead title="סקירה" sub={fmtToday()} />

      <ShelfPicture worth={worth} products={stats.products} orders={promises} checks={checks} />

      {monthFailed ? (
        <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retryMonth}>
          הסכומים מחושבים רק לפי מה שנטען
        </Notice>
      ) : null}

      <div className="sa-stats ov-stats">
        <Stat
          label="יצא השבוע"
          icon="arrow-up-right"
          href="/movements?period=week"
          value={<Shekels value={flow.outWeek} />}
          note={`במחירון · שבוע קודם ${fmtPrice(Math.round(flow.outWeekBefore))}`}
        />
        <Stat
          label="נכנס השבוע"
          icon="arrow-down-left"
          href="/movements?period=week"
          value={<Shekels value={flow.inWeek} />}
          note={`במחירון · שבוע קודם ${fmtPrice(Math.round(flow.inWeekBefore))}`}
        />
        <Stat
          label="היום במחסן"
          icon="activity"
          href="/movements?period=today"
          value={<CountUp value={stats.movementsToday} />}
          unit={stats.movementsToday === 1 ? "תנועה" : "תנועות"}
          note={latest ? `אחרונה ${fmtRelative(latest.created_at)}` : undefined}
        />
      </div>

      {workItems.length > 0 ? (
        <div id="ov-work" className="min-w-0">
          <Card title="דורש טיפול" count={workItems.length} flush>
            <AttentionGroups items={workItems} />
          </Card>
        </div>
      ) : null}

      <div className="ov-split">
        <RunningOut rows={soon} shown={RUNNING_OUT} isLoading={isLoading || monthLoading} onDismiss={onRemoveAlert} />
        <OpenOrders shown={OPEN_ORDERS} isLoading={isLoading} />
      </div>

      <Card title="תנועות אחרונות" flush>
        <Table<MovementRow>
          className={`ov-recent ${PHONE_RECENT}`}
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

/** The same page in every style; the bokeh style answers with the control room. */
export default function OverviewPage() {
  const { theme } = useTheme();
  return splitTheme(theme).style === "bokeh" ? <ControlRoom /> : <OwnerOverview />;
}
