"use client";

import { useCallback, useMemo } from "react";
import { available, useData, type AttentionEntry } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { Activity, AttentionBoard, FigureLine, OpenOrders, RunningOut, runwayFigure, runwayMeta, type CheckTone, type Figure, type Lane, type LaneRow } from "@/components/app/Snapshot";
import { Notice, PageHead } from "@/components/ui";
import { daysUntil, fmtAge, fmtCompact, fmtName, fmtQty, fmtToday } from "@/lib/format";
import { useDismissedAlerts } from "@/lib/dismissed-alerts";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { movedWorth, PACE_DAYS, runway, shelfWorth, type Runway } from "@/lib/snapshot";
import { splitTheme, useTheme } from "@/lib/theme";
import { ControlRoom } from "@/components/app/dashboard/ControlRoom";

const RECENT = 6;

/** The open orders listed here, one row for each of the list beside them; the orders page has the rest. */
const OPEN_ORDERS = 6;

/** The healthy products closest to running out; what is already short stands in the card on top. */
const RUNNING_OUT = 5;

const count = (n: number, one: string, many: string) => `${fmtQty(n)} ${n === 1 ? one : many}`;

function OwnerOverview() {
  const { state, stats, attention, product, linesOf } = useData();
  const { openAction, openFault, openProduct } = useUi();
  const { dismissed, dismiss } = useDismissedAlerts();
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

  /* ───────── what runs out first ───────── */
  const soon = useMemo(() => {
    // A removed stock alert remembers what was available, so a new reservation brings it back.
    const removed = (r: Runway) => (r.state === "out" || r.state === "low") && dismissed[`${r.state}:${r.product.id}`] === r.free;
    return runway(state.products, month).filter((r) => (r.days !== null || r.state !== "ok") && !removed(r));
  }, [state.products, month, dismissed]);

  const onRemoveAlert = useCallback((r: Runway) => dismiss(`${r.state}:${r.product.id}`, r.free), [dismiss]);

  /* ───────── what waits on a person ───────── */
  const lanes = useMemo<Lane[]>(() => {
    // The fault that has waited longest leads (state.faults is newest first).
    const faults = state.faults.filter((f) => f.status === "open").reverse();
    const pending = attention.filter((a) => a.kind === "request" || a.kind === "mapping");
    const stock = soon.filter((r) => r.state !== "ok");

    const openPending = (a: AttentionEntry) => (a.kind === "request" ? openAction("review-item-request", { requestId: a.requestId }) : openAction("map-supplier-item", { supplierItemId: a.supplierItemId }));

    const stockRow = (r: Runway): LaneRow => {
      const { figure, tone } = runwayFigure(r);
      return {
        key: r.product.id,
        title: fmtName(r.product.name),
        meta: runwayMeta(r),
        word: figure,
        tone,
        onOpen: () => openProduct(r.product.id),
        onDismiss: r.state === "out" || r.state === "low" ? () => onRemoveAlert(r) : undefined,
      };
    };

    const stockTone: CheckTone = stock.some((r) => r.state === "short") ? "short" : stock.some((r) => r.state === "out") ? "bad" : "warn";

    return [
      {
        key: "faults",
        label: faults.length === 1 ? "תקלה" : "תקלות",
        count: faults.length,
        tone: "bad",
        calm: "אין תקלות פתוחות",
        href: "/faults",
        more: "כל התקלות",
        rows: faults.map((f) => {
          const p = product(f.product_id);
          const what = p ? fmtName(p.name) : DEFAULT_OBJECTS.find((o) => o.id === f.asset)?.name ?? f.asset;
          return {
            key: f.id,
            title: f.description,
            meta: [fmtAge(f.created_at), what].filter(Boolean).join(" · "),
            onOpen: () => openFault(f.id),
          };
        }),
      },
      {
        key: "approvals",
        label: pending.length === 1 ? "אישור" : "אישורים",
        count: pending.length,
        tone: "warn",
        calm: "אין מה לאשר",
        more: `עוד ${fmtQty(pending.length - 3)}`,
        rows: pending.map((a) => ({ key: a.id, title: a.title, meta: a.meta.join(" · "), word: a.kind === "mapping" ? "שם ספק" : a.label, onOpen: () => openPending(a) })),
      },
      {
        key: "stock",
        label: stock.length === 1 ? "חוסר" : "חוסרים",
        count: stock.length,
        tone: stockTone,
        calm: "המלאי מעל המינימום",
        href: stats.low > 0 ? "/inventory?filter=low" : "/inventory?filter=out",
        more: "כל החוסרים",
        rows: stock.map(stockRow),
      },
    ];
  }, [state.faults, attention, soon, stats.low, product, openAction, openFault, openProduct, onRemoveAlert]);

  /* ───────── the figures ───────── */
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

  const figures: Figure[] = [
    {
      key: "worth",
      label: "שווי מלאי",
      value: <span className="ltr">{fmtCompact(worth.total)}</span>,
      note: `במחירון · ${worth.unpriced > 0 ? count(worth.unpriced, "מוצר ללא מחיר", "מוצרים ללא מחיר") : count(stats.products, "מוצר", "מוצרים")}`,
      href: "/inventory",
    },
    {
      key: "orders",
      label: "הזמנות פתוחות",
      value: fmtQty(promises.open),
      note:
        promises.open === 0 ? "אין הזמנות פתוחות" : (
          <>
            {promises.late > 0 ? <span className="is-warn">{promises.late === 1 ? "אחת באיחור" : `${fmtQty(promises.late)} באיחור`}</span> : null}
            {promises.late > 0 ? ", " : null}
            {promises.uncovered > 0 ? <span className="is-short">{fmtQty(promises.uncovered)} חסר במלאי</span> : <span className="is-ok">הכל על המדף</span>}
          </>
        ),
      href: "/orders",
    },
    {
      key: "out",
      label: "יצא השבוע",
      value: <span className="ltr">{fmtCompact(flow.outWeek)}</span>,
      note: <>שבוע קודם <span className="ltr">{fmtCompact(flow.outWeekBefore)}</span></>,
      href: "/movements?period=week",
    },
    {
      key: "in",
      label: "נכנס השבוע",
      value: <span className="ltr">{fmtCompact(flow.inWeek)}</span>,
      note: <>שבוע קודם <span className="ltr">{fmtCompact(flow.inWeekBefore)}</span></>,
      href: "/movements?period=week",
    },
  ];

  return (
    <div className="sa-page ov-page">
      <PageHead title="סקירה" sub={fmtToday()} />

      <AttentionBoard lanes={lanes} />

      <FigureLine figures={figures} />

      {monthFailed ? (
        <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retryMonth}>
          הסכומים מחושבים רק לפי מה שנטען
        </Notice>
      ) : null}

      <div className="ov-split">
        <Activity rows={state.movements.slice(0, RECENT)} today={stats.movementsToday} isLoading={isLoading} />
        <OpenOrders shown={OPEN_ORDERS} isLoading={isLoading} />
      </div>

      <RunningOut rows={soon.filter((r) => r.state === "ok")} shown={RUNNING_OUT} isLoading={isLoading || monthLoading} />
    </div>
  );
}

/** The same page in every style; the bokeh style answers with the control room. */
export default function OverviewPage() {
  const { theme } = useTheme();
  return splitTheme(theme).style === "bokeh" ? <ControlRoom /> : <OwnerOverview />;
}
