"use client";

/**
 * תנועות as a journal one can really search: when, what was done, to which product, how much, by whom, from or to whom.
 * It opens on today, because the first question is what was done today; the other periods are one press away.
 * Time leads because this is the one list read as a record. The filters stand fixed over it and wait for החל, as on
 * the shared page; two questions a manager asks of a journal have a figure of their own that is also a filter: what
 * left with no receipt, and what was corrected by hand. An exit with no receipt says in its own row to whom it went,
 * why, and that a manager approved it, so it never reads as goods that left with no record.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { readNote } from "@/components/app/MovementPanel";
import { useUi } from "@/components/app/ui-state";
import { DateRangeFilter, dayValue, HoursFilter } from "@/components/app/WhenFilters";
import { Button, cx, EmptyState, Icon, Movement, MovementQty, Notice, Select, Showing, Table, Tabs, Toolbar, type SelectOption, type TableColumn } from "@/components/ui";
import { fmtCompact, fmtDayWord, fmtTime, fmtUnit, MOVEMENT_LABEL, orderRef } from "@/lib/format";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { useData, type Movement as MovementRow, type MovementType } from "@/lib/store";
import { ProductCell } from "../cells";
import { Page, Word, type Metric } from "../parts";

type Period = "today" | "yesterday" | "week" | "month" | "all" | "custom";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "היום" },
  { value: "yesterday", label: "אתמול" },
  { value: "week", label: "7 ימים" },
  { value: "month", label: "30 ימים" },
  { value: "all", label: "הכל" },
  { value: "custom", label: "טווח תאריכים" },
];
/** The journal opens on what was done today. */
const DEFAULT_PERIOD: Period = "today";
const MOVEMENT_TYPES: MovementType[] = ["in", "out", "fault", "adjust"];
/** A reading of the journal that is not a kind of movement: an exit a manager let out with no receipt. */
const NO_RECEIPT = "no-receipt";
const NO_WORKER = "none";
const PAGE_SIZE = 100;

const NO_FILTERS = { fromTime: "", toTime: "", workerId: "", kind: "", supplierId: "", category: "" };
type Filters = typeof NO_FILTERS & { fromDay: string; toDay: string };

const REFRESH_MS = 640;
const REFRESH_CAP_MS = 3000;
const UPDATED_MS = 2600;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const differs = (a: Filters, b: Filters) => (Object.keys(a) as (keyof Filters)[]).some((key) => a[key] !== b[key]);
const periodOf = (v: string | null): Period => PERIODS.find((p) => p.value === v)?.value ?? DEFAULT_PERIOD;

function rangeOf(period: Period, fromDay: string, toDay: string): { from: number | null; to: number | null } {
  switch (period) {
    case "today": return { from: midnight(), to: null };
    case "yesterday": return { from: midnight(-1), to: midnight() };
    case "week": return { from: midnight(-6), to: null };
    case "month": return { from: midnight(-29), to: null };
    case "all": return { from: null, to: null };
    case "custom": return { from: midnight(0, new Date(`${fromDay}T00:00`)), to: midnight(1, new Date(`${toDay}T00:00`)) };
  }
}

/** Hours apply to each day of the period; 22:00 to 06:00 runs across midnight. */
function inHours(iso: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const t = fmtTime(iso);
  if (from && to && from > to) return t >= from || t <= to;
  return (!from || t >= from) && (!to || t <= to);
}

function matchesKind(m: MovementRow, kind: string): boolean {
  if (!kind) return true;
  if (kind === NO_RECEIPT) return Boolean(m.exit_pass);
  return m.type === kind;
}

export function Movements(): ReactElement {
  return (
    <Suspense fallback={null}>
      <MovementsInner />
    </Suspense>
  );
}

function MovementsInner(): ReactElement {
  const { state, product, supplier, worker, reload } = useData();
  const { openAction } = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const period = periodOf(params.get("period"));
  const setPeriod = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(params.toString());
      if (next === DEFAULT_PERIOD) sp.delete("period");
      else sp.set("period", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // The row shows what is chosen, the list what was applied: only החל moves one to the other.
  const [chosen, setChosen] = useState<Filters>(() => ({ ...NO_FILTERS, fromDay: dayValue(midnight(-6)), toDay: dayValue(midnight()) }));
  const [applied, setApplied] = useState(chosen);
  const [query, setQuery] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);

  const { from, to } = rangeOf(period, applied.fromDay, applied.toDay);
  const { rows, isLoading, failed, retry } = useMovementsInRange(from, to);

  const pending = differs(chosen, applied);
  const choose = (patch: Partial<Filters>) => setChosen((current) => ({ ...current, ...patch }));

  /* ───────── refreshing ───────── */
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [settled, setSettled] = useState(0);
  const lastRun = useRef(0);

  // החל always reads the database again, so it does something even with nothing new chosen.
  const refresh = async (next: Filters) => {
    const run = ++lastRun.current;
    setChosen(next);
    setRefreshing(true);
    setUpdated(false);
    retry();
    await Promise.race([Promise.all([reload().catch(() => {}), wait(REFRESH_MS)]), wait(REFRESH_CAP_MS)]);
    if (run !== lastRun.current) return;
    setApplied(next);
    setRefreshing(false);
    setUpdated(true);
    setSettled((n) => n + 1);
  };

  useEffect(() => {
    if (!updated) return;
    const timer = setTimeout(() => setUpdated(false), UPDATED_MS);
    return () => clearTimeout(timer);
  }, [updated]);

  /** A tab, a figure and ניקוי סינון are a choice and its press in one: the list answers at once. */
  const applyNow = (filters: Filters, nextPeriod: string) => {
    lastRun.current += 1;
    setChosen(filters);
    setApplied(filters);
    setPeriod(nextPeriod);
    setRefreshing(false);
    setSettled((n) => n + 1);
  };

  const choosePeriod = (next: string) => {
    if (next !== "custom") return applyNow(chosen, next);
    // The calendar opens on what the list already shows, so nothing changes under it until החל.
    setCalendarOpen(true);
    applyNow(from === null ? chosen : { ...chosen, fromDay: dayValue(from), toDay: dayValue(to === null ? Date.now() : to - 1) }, next);
  };

  /* ───────── options ───────── */
  const workerOptions = useMemo<SelectOption[]>(() => [...state.workers.map((w) => ({ value: w.id, label: w.name })), { value: NO_WORKER, label: "ללא עובד" }], [state.workers]);
  const kindOptions = useMemo<SelectOption[]>(
    () => [...MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_LABEL[t] })), { value: NO_RECEIPT, label: "הוצאה בלי קבלה" }],
    [],
  );
  const supplierOptions = useMemo<SelectOption[]>(() => state.suppliers.map((s) => ({ value: s.id, label: s.name })), [state.suppliers]);
  const categories = useMemo(() => [...new Set(state.products.map((p) => p.category).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, "he")), [state.products]);

  /* ───────── the rows ───────── */
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      rows.filter((m) => {
        if (!matchesKind(m, applied.kind)) return false;
        if (applied.workerId === NO_WORKER ? m.worker_id : applied.workerId && m.worker_id !== applied.workerId) return false;
        if (applied.supplierId && m.supplier_id !== applied.supplierId) return false;
        if (!inHours(m.created_at, applied.fromTime, applied.toTime)) return false;
        const p = product(m.product_id);
        if (applied.category && p?.category !== applied.category) return false;
        if (!q) return true;
        return [p?.name, p?.sku, p?.barcode, m.external_name, m.reference, m.note, worker(m.worker_id)?.name, supplier(m.supplier_id)?.name].filter(Boolean).join(" ").toLowerCase().includes(q);
      }),
    [rows, applied, q, product, worker, supplier],
  );

  /* ───────── the head: the whole period, whatever the list is narrowed to ───────── */
  const sums = useMemo(() => {
    const s = { inWorth: 0, outWorth: 0, noReceipt: 0, adjusted: 0 };
    for (const m of rows) {
      const worth = m.qty * (product(m.product_id)?.price ?? 0);
      if (m.type === "in") s.inWorth += worth;
      if (m.type === "out") s.outWorth += worth;
      if (m.exit_pass) s.noReceipt += 1;
      if (m.type === "adjust") s.adjusted += 1;
    }
    return s;
  }, [rows, product]);
  const hasFilters = period !== DEFAULT_PERIOD || q !== "" || differs(chosen, { ...chosen, ...NO_FILTERS });
  const clear = () => {
    setQuery("");
    applyNow({ ...chosen, ...NO_FILTERS }, DEFAULT_PERIOD);
  };
  /** A figure that is also a filter: pressed, the journal shows only that; pressed again, everything. */
  const toggleKind = (kind: string) => applyNow({ ...chosen, ...NO_FILTERS, kind: applied.kind === kind ? "" : kind }, period);

  // In is green and out is red wherever goods move; the sums themselves stay ink, so only what needs a look is coloured.
  const metrics: Metric[] = [
    { key: "in", label: "נכנס", icon: "arrow-down-to-line", iconTone: "ok", value: <span className="ltr">{isLoading ? "…" : fmtCompact(sums.inWorth)}</span> },
    { key: "out", label: "יצא", icon: "arrow-up-from-line", iconTone: "bad", value: <span className="ltr">{isLoading ? "…" : fmtCompact(sums.outWorth)}</span> },
    {
      key: "no-receipt", label: "יצא בלי קבלה", icon: "file-text", value: isLoading ? "…" : sums.noReceipt, tone: sums.noReceipt > 0 ? "warn" : "ok",
      onClick: sums.noReceipt > 0 || applied.kind === NO_RECEIPT ? () => toggleKind(NO_RECEIPT) : undefined, current: applied.kind === NO_RECEIPT,
    },
    {
      key: "adjust", label: "תיקוני ספירה", icon: "clipboard-check", value: isLoading ? "…" : sums.adjusted,
      onClick: sums.adjusted > 0 || applied.kind === "adjust" ? () => toggleKind("adjust") : undefined, current: applied.kind === "adjust",
    },
  ];

  const empty =
    state.movements.length === 0 ? (
      <EmptyState title="אין תנועות" hint="קליטה או הוצאה ראשונה תופיע כאן">
        <Button variant="secondary" onClick={() => openAction("receive")}>קליטת סחורה</Button>
      </EmptyState>
    ) : hasFilters ? (
      <EmptyState title="לא נמצאו תנועות" hint={q ? <>עבור „<bdi>{query.trim()}</bdi>”</> : undefined}>
        <Button variant="secondary" onClick={clear}>ניקוי סינון</Button>
      </EmptyState>
    ) : (
      <EmptyState title="עוד אין תנועות היום">
        <Button variant="secondary" onClick={() => choosePeriod("yesterday")}>אתמול</Button>
        <Button variant="secondary" onClick={() => choosePeriod("week")}>7 ימים</Button>
      </EmptyState>
    );

  return (
    <Page
      title="תנועות"
      metrics={metrics}
      toolbar={<Toolbar tabs={<Tabs tabs={PERIODS} value={period} onChange={choosePeriod} />} query={query} onQuery={setQuery} placeholder='חיפוש מוצר, מק"ט, עובד, ספק או לקוח' />}
    >
      {failed ? (
        <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retry}>
          מוצגות רק התנועות האחרונות
        </Notice>
      ) : null}

      <div className={cx("sa-moves", refreshing && "is-refreshing")} data-settle={settled ? settled % 2 : undefined}>
        <div className="app-filters">
          {period === "custom" ? (
            <DateRangeFilter from={chosen.fromDay} to={chosen.toDay} open={calendarOpen} onOpenChange={setCalendarOpen} onApply={(fromDay, toDay) => void refresh({ ...chosen, fromDay, toDay })} />
          ) : null}
          <HoursFilter from={chosen.fromTime} to={chosen.toTime} onApply={(fromTime, toTime) => void refresh({ ...chosen, fromTime, toTime })} />
          <Select options={kindOptions} value={chosen.kind} onChange={(kind) => choose({ kind })} allLabel="כל הפעולות" placeholder="פעולה" searchable={false} />
          <Select options={workerOptions} value={chosen.workerId} onChange={(workerId) => choose({ workerId })} allLabel="כל העובדים" placeholder="עובד" />
          <Select options={supplierOptions} value={chosen.supplierId} onChange={(supplierId) => choose({ supplierId })} allLabel="כל הספקים" placeholder="ספק" />
          <Select options={categories} value={chosen.category} onChange={(category) => choose({ category })} allLabel="כל הקטגוריות" placeholder="קטגוריה" />
          <div className="app-filters-end">
            {hasFilters ? <Button variant="ghost" onClick={clear}>ניקוי סינון</Button> : null}
            <Button variant={pending ? "primary" : "secondary"} className={cx("app-apply", updated && !pending && "is-done")} onClick={() => void refresh(chosen)}>
              <span className={cx(updated && !pending && "is-off")}>החל</span>
              <span className={cx(!(updated && !pending) && "is-off")}><Icon name="check" size={14} strokeWidth={2.5} />עודכן</span>
            </Button>
          </div>
          <span className="app-refresh-line" aria-hidden="true" />
          <span className="sr-only" role="status">{updated ? "הרשימה עודכנה" : ""}</span>
        </div>

        <Journal key={`${from}|${to}|${applied.fromTime}|${applied.toTime}|${applied.workerId}|${applied.kind}|${applied.supplierId}|${applied.category}|${q}`} rows={visible} total={rows.length} isLoading={isLoading} empty={empty} />
      </div>
    </Page>
  );
}

function Journal({ rows, total, isLoading, empty }: { rows: MovementRow[]; total: number; isLoading: boolean; empty: ReactNode }): ReactElement {
  const { product, supplier, worker } = useData();
  const { openMovement } = useUi();
  const [shown, setShown] = useState(PAGE_SIZE);

  const columns = useMemo<TableColumn<MovementRow>[]>(
    () => [
      {
        key: "when",
        title: "תאריך ושעה",
        render: (m) => (
          <>
            <span className="mn2-cell-text">{fmtDayWord(m.created_at)}</span>
            <span className="mn2-cell-sub ltr">{fmtTime(m.created_at)}</span>
          </>
        ),
      },
      {
        key: "kind",
        title: "פעולה",
        render: (m) => (
          <>
            <Movement type={m.type} />
            {m.exit_pass ? <span className="mn2-cell-sub"><Word tone="warn">בלי קבלה</Word></span> : null}
          </>
        ),
      },
      {
        key: "product",
        title: "מוצר",
        className: "mn2-cell-main",
        render: (m) => {
          const p = product(m.product_id);
          return (
            <ProductCell
              product={p}
              sub={p ? <><span className="sa-mono ltr">{p.sku}</span>{m.external_name ? <> · בתעודה: „<bdi>{m.external_name}</bdi>”</> : null}</> : undefined}
            />
          );
        },
      },
      {
        key: "qty",
        title: "כמות",
        render: (m) => (
          <span className="mn2-qty">
            <span className="ltr"><MovementQty qty={m.qty} type={m.type} /></span>
            <span className="mn2-qty-unit">{fmtUnit(m.qty, product(m.product_id)?.unit)}</span>
          </span>
        ),
      },
      {
        key: "worker",
        title: "מי",
        // Goods that left on a manager's code have no worker behind them: the code is who did it, and the row says so.
        render: (m) =>
          worker(m.worker_id)?.name ? <span className="mn2-cell-text mn2-nowrap">{worker(m.worker_id)?.name}</span>
          : m.exit_pass ? <span className="mn2-cell-text mn2-nowrap">באישור מנהל</span>
          : <span className="mn2-cell-unset">לא נרשם</span>,
      },
      {
        key: "party",
        title: "ספק / לקוח",
        // From whom it came or to whom it went, then the order it left under, then why it left with no receipt.
        render: (m) => {
          const note = readNote(m.note);
          const name = supplier(m.supplier_id)?.name ?? note.customer;
          const order = orderRef(m.reference);
          const why = m.exit_pass && note.reason ? `סיבה: ${note.reason}` : null;
          if (!name && !order && !why) return <span className="mn2-cell-unset">—</span>;
          return (
            <>
              {name ? <span className="mn2-cell-text"><bdi>{name}</bdi></span> : null}
              {order ? <span className={name ? "mn2-cell-sub" : "mn2-cell-text"}><bdi>{order}</bdi></span> : null}
              {why ? <span className="mn2-cell-sub"><bdi>{why}</bdi></span> : null}
            </>
          );
        },
      },
    ],
    [product, worker, supplier],
  );

  const page = rows.slice(0, shown);
  return (
    <Table<MovementRow>
      caption="יומן תנועות"
      className="mn2-table mn2-moves-table"
      columns={columns}
      data={page}
      isLoading={isLoading}
      skeletonRows={8}
      empty={empty}
      onRowClick={openMovement}
      footer={
        page.length < rows.length || rows.length < total ? (
          <>
            <Showing shown={page.length} total={page.length < rows.length ? rows.length : total} />
            {page.length < rows.length ? <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>הצגת עוד</Button> : null}
          </>
        ) : undefined
      }
    />
  );
}
