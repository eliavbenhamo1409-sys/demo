"use client";

import { Suspense, useCallback, useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { available, useData } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { FaultWalk, walkOrder } from "@/components/app/FaultWalk";
import { Activity, AttentionBoard, FigureLine, OpenOrders, PieSheet, RunningOut, runwayFigure, runwayMeta, Section, type CheckTone, type Figure, type Lane, type LaneRow, type Pie } from "@/components/app/Snapshot";
import { Notice, PageHead } from "@/components/ui";
import { daysUntil, fmtAge, fmtCompact, fmtName, fmtQty, fmtToday } from "@/lib/format";
import { useDismissedAlerts } from "@/lib/dismissed-alerts";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { inBySupplier, movedWorth, PACE_DAYS, pctChange, runway, salesByCustomer, shelfWorth, sumShares, topShares, worthByCategory, type Runway } from "@/lib/snapshot";
import { splitTheme, useTheme } from "@/lib/theme";
import { ControlRoom } from "@/components/app/dashboard/ControlRoom";

const RECENT = 6;

/** The open orders listed here, one row for each of the list beside them; the orders page has the rest. */
const OPEN_ORDERS = 6;

/** The healthy products closest to running out; what is already short stands in the card on top. */
const RUNNING_OUT = 5;

const count = (n: number, one: string, many: string) => `${fmtQty(n)} ${n === 1 ? one : many}`;

/** A week's figure against the week before, as a signed percent in its colour; with no week before to measure against, that week's sum. */
function weekNote(now: number, before: number): ReactNode {
  const change = pctChange(now, before);
  if (change === null) return <>שבוע קודם <span className="ltr">{fmtCompact(before)}</span></>;
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return (
    <>
      <span className={`ltr ${change > 0 ? "is-up" : change < 0 ? "is-down" : ""}`}>{`${sign}${fmtQty(Math.abs(change))}%`}</span> משבוע קודם
    </>
  );
}

function OwnerOverview() {
  const { state, stats, product, supplier, worker, linesOf } = useData();
  const { openProduct } = useUi();
  const { dismissed, dismiss } = useDismissedAlerts();
  const isLoading = state.status === "loading";

  // The walk through the faults lives in the address, so סגירת יום can send the manager straight into it.
  const router = useRouter();
  const params = useSearchParams();
  const walking = params.get("faults") === "walk";
  const walkFrom = params.get("from");
  const openWalk = useCallback((from?: string) => router.replace(from ? `/?faults=walk&from=${encodeURIComponent(from)}` : "/?faults=walk", { scroll: false }), [router]);
  const endWalk = useCallback(() => router.replace("/", { scroll: false }), [router]);

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
  // Faults and shortages only, as the owner asked: approvals are decided on סגירת יום and ספקים, not here.
  const lanes = useMemo<Lane[]>(() => {
    // What still needs a decision leads, the longest waiting first; what already waits on a worker follows, in the walk's order.
    const faults = walkOrder(state.faults);
    const stock = soon.filter((r) => r.state !== "ok");

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
        ask: "לשייך לעובד או לסגור עם תיעוד",
        more: `עוד ${fmtQty(faults.length - 3)}`,
        action: { label: "מעבר על התקלות", onClick: () => openWalk() },
        rows: faults.map((f) => {
          const p = product(f.product_id);
          const what = p ? fmtName(p.name) : DEFAULT_OBJECTS.find((o) => o.id === f.asset)?.name ?? f.asset;
          const holder = worker(f.assigned_to)?.name;
          return {
            key: f.id,
            title: f.description,
            meta: [fmtAge(f.created_at), what].filter(Boolean).join(" · "),
            word: holder ? `אצל ${holder}` : undefined,
            // A row opens the walk at itself, so the decision is made where the owner stands.
            onOpen: () => openWalk(f.id),
          };
        }),
      },
      {
        key: "stock",
        label: stock.length === 1 ? "חוסר" : "חוסרים",
        count: stock.length,
        tone: stockTone,
        calm: "המלאי מעל המינימום",
        ask: "להזמין מהספק",
        href: stats.low > 0 ? "/inventory?filter=low" : "/inventory?filter=out",
        more: "כל החוסרים",
        rows: stock.map(stockRow),
      },
    ];
  }, [state.faults, soon, stats.low, product, worker, openWalk, openProduct, onRemoveAlert]);

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
      note: weekNote(flow.outWeek, flow.outWeekBefore),
      href: "/movements?period=week",
    },
    {
      key: "in",
      label: "נכנס השבוע",
      value: <span className="ltr">{fmtCompact(flow.inWeek)}</span>,
      note: weekNote(flow.inWeek, flow.inWeekBefore),
      href: "/movements?period=week",
      tone: "ok",
    },
  ];

  /* ───────── the rings: a whole and its parts ───────── */
  const pies = useMemo<Pie[]>(() => {
    const stock = topShares(worthByCategory(state.products));
    const sales = topShares(salesByCustomer(state.orders, linesOf, since));
    const bought = topShares(inBySupplier(month, since, product, supplier));
    const categories = new Set(state.products.filter((p) => p.price !== null && p.qty > 0).map((p) => p.category?.trim() || "")).size;
    const delivered = state.orders.filter((o) => o.status === "delivered" && o.closed_at && Date.parse(o.closed_at) >= since).length;
    const suppliers = new Set(month.filter((m) => m.type === "in" && Date.parse(m.created_at) >= since).map((m) => m.supplier_id ?? "")).size;
    return [
      { key: "stock", label: "שווי המלאי", sub: "לפי קטגוריה · במחירון", slices: stock, total: sumShares(stock), caption: count(categories, "קטגוריה", "קטגוריות"), href: "/inventory", empty: "אין מלאי עם מחיר", loading: isLoading },
      { key: "sales", label: "מכירות", sub: "לפי לקוח · בחודש האחרון", slices: sales, total: sumShares(sales), caption: count(delivered, "הזמנה נמסרה", "הזמנות נמסרו"), href: "/orders?status=delivered", empty: "לא נמסרו הזמנות בחודש האחרון", loading: isLoading },
      { key: "bought", label: "נכנס מספקים", sub: "לפי ספק · בחודש האחרון · במחירון", slices: bought, total: sumShares(bought), caption: count(suppliers, "ספק", "ספקים"), href: "/suppliers", empty: "לא נקלטה סחורה בחודש האחרון", loading: isLoading || monthLoading },
    ];
  }, [state.products, state.orders, month, since, linesOf, product, supplier, isLoading, monthLoading]);

  const quiet = lanes.every((l) => l.count === 0);

  return (
    <div className="sa-page ov-page">
      <PageHead title="סקירה" sub={fmtToday()} />

      <Section label={quiet ? "הכל תקין" : "מחכה לך"} ask={quiet ? "אין מה לטפל עכשיו" : "כל שורה נפתחת בלחיצה, ומה שטופל יורד מכאן"}>
        <AttentionBoard lanes={lanes} walk={walking ? <FaultWalk from={walkFrom} onEnd={endWalk} /> : undefined} />
      </Section>

      <Section label="המספרים" ask="רק לדעת · כל מספר פותח את הפירוט שלו">
        <FigureLine figures={figures} />
        <PieSheet pies={pies} />
        {monthFailed ? (
          <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retryMonth}>
            הסכומים מחושבים רק לפי מה שנטען
          </Notice>
        ) : null}
      </Section>

      <Section label="מה קורה במחסן" ask="לעקוב, לא לטפל · מה שדורש אותך כבר למעלה">
        <div className="ov-split">
          <Activity rows={state.movements.slice(0, RECENT)} today={stats.movementsToday} isLoading={isLoading} />
          <OpenOrders shown={OPEN_ORDERS} isLoading={isLoading} />
        </div>
        <RunningOut rows={soon.filter((r) => r.state === "ok")} shown={RUNNING_OUT} isLoading={isLoading || monthLoading} />
      </Section>
    </div>
  );
}

/** The same page in every style; the bokeh style answers with the control room. The overview reads its address, so it waits inside Suspense. */
export default function OverviewPage() {
  const { theme } = useTheme();
  return splitTheme(theme).style === "bokeh" ? (
    <ControlRoom />
  ) : (
    <Suspense fallback={null}>
      <OwnerOverview />
    </Suspense>
  );
}
