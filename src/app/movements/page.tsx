"use client";

/**
 * תנועות — every stock movement, narrowed by date, hours, who did it and the rest.
 * The store keeps only the latest rows, so a period that reaches past them is read from the database.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useData, type Movement as MovementRow, type MovementType } from "@/lib/store";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { DateRangeFilter, dayValue, HoursFilter } from "@/components/app/WhenFilters";
import {
  Button,
  Count,
  cx,
  EmptyState,
  Icon,
  Movement,
  MovementQty,
  Notice,
  PageHead,
  Select,
  Showing,
  Table,
  Tabs,
  Toolbar,
  type SelectOption,
  type TableColumn,
} from "@/components/ui";
import { fmtDay, fmtDayWord, fmtName, fmtTime, MOVEMENT_LABEL, orderRef } from "@/lib/format";

type Period = "today" | "yesterday" | "week" | "month" | "all" | "custom";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "היום" },
  { value: "yesterday", label: "אתמול" },
  { value: "week", label: "7 ימים" },
  { value: "month", label: "30 ימים" },
  { value: "all", label: "הכל" },
  { value: "custom", label: "טווח תאריכים" },
];
const DEFAULT_PERIOD: Period = "month";
/** What a period's tab says when it holds nothing; a range of days reads the same whichever it is. */
const NOTHING_IN: Partial<Record<Period, string>> = { today: "אין תנועות היום", yesterday: "אין תנועות אתמול" };
const MOVEMENT_TYPES: MovementType[] = ["in", "out", "fault", "adjust"];
const NO_WORKER = "none";
const PAGE_SIZE = 100;

const NO_FILTERS = { fromTime: "", toTime: "", workerId: "", moveType: "", supplierId: "", category: "" };
type Filters = typeof NO_FILTERS & { fromDay: string; toDay: string };

/** The refresh stays on screen this long, however fast the read; it has to be seen. */
const REFRESH_MS = 640;
/** The list stops waiting for a slow network here: its filters need no server. */
const REFRESH_CAP_MS = 3000;
/** How long the button says it is done. */
const UPDATED_MS = 2600;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function differs(a: Filters, b: Filters): boolean {
  return (Object.keys(a) as (keyof Filters)[]).some((key) => a[key] !== b[key]);
}

/** Phones keep product and quantity only; the rest moves under the product. The empty state sits in the first cell, so it stays. */
const PHONE_MOVEMENTS = "max-[600px]:[&_:is(td,th):not(:nth-child(1),:nth-child(2),.sa-table-empty)]:hidden";

/** A tablet moves the worker under the product, so the name keeps its room. */
const TABLET_MOVEMENTS = "min-[601px]:max-[1099px]:[&_:is(td,th):nth-child(4)]:hidden";

/** The product takes what the other columns leave, so a long name truncates and no column is ever cut. */
const MAIN_CELL = "w-full max-w-0";

function periodFromParams(params: URLSearchParams): Period {
  const value = params.get("period");
  return PERIODS.find((p) => p.value === value)?.value ?? DEFAULT_PERIOD;
}

function periodRange(period: Period, fromDay: string, toDay: string): { from: number | null; to: number | null } {
  switch (period) {
    case "today":
      return { from: midnight(), to: null };
    case "yesterday":
      return { from: midnight(-1), to: midnight() };
    case "week":
      return { from: midnight(-6), to: null };
    case "month":
      return { from: midnight(-29), to: null };
    case "all":
      return { from: null, to: null };
    case "custom":
      return { from: midnight(0, new Date(`${fromDay}T00:00`)), to: midnight(1, new Date(`${toDay}T00:00`)) };
  }
}

/** Hours apply to each day of the period; 22:00 to 06:00 runs across midnight. */
function inHours(iso: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const t = fmtTime(iso);
  if (from && to && from > to) return t >= from || t <= to;
  return (!from || t >= from) && (!to || t <= to);
}

export default function MovementsPage() {
  return (
    <Suspense fallback={null}>
      <MovementsInner />
    </Suspense>
  );
}

function MovementsInner() {
  const { state, product, supplier, worker, reload } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The period lives in the URL (?period=today), so the overview can link straight to it.
  const period = periodFromParams(params);
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

  const { from, to } = periodRange(period, applied.fromDay, applied.toDay);
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

  /** Tabs and ניקוי סינון are a choice and its press in one: the list answers at once, overtaking a refresh on its way. */
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
  const workerOptions = useMemo<SelectOption[]>(
    () => [...state.workers.map((w) => ({ value: w.id, label: w.name })), { value: NO_WORKER, label: "ללא עובד" }],
    [state.workers],
  );

  const typeOptions = useMemo<SelectOption[]>(
    () => MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_LABEL[t] })),
    [],
  );

  const supplierOptions = useMemo<SelectOption[]>(
    () => state.suppliers.map((s) => ({ value: s.id, label: s.name })),
    [state.suppliers],
  );

  const categories = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const p of state.products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [state.products]);

  /* ───────── filtering ───────── */
  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    return rows.filter((m) => {
      if (applied.moveType && m.type !== applied.moveType) return false;
      if (applied.workerId === NO_WORKER ? m.worker_id : applied.workerId && m.worker_id !== applied.workerId) return false;
      if (applied.supplierId && m.supplier_id !== applied.supplierId) return false;
      if (!inHours(m.created_at, applied.fromTime, applied.toTime)) return false;
      const p = product(m.product_id);
      if (applied.category && p?.category !== applied.category) return false;
      if (q) {
        const hay = [p?.name, p?.sku, p?.barcode, m.external_name, m.reference, m.note, worker(m.worker_id)?.name, supplier(m.supplier_id)?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, applied, q, product, worker, supplier]);

  const hasFilters = period !== DEFAULT_PERIOD || q !== "" || differs(chosen, { ...chosen, ...NO_FILTERS });

  const clearFilters = () => {
    setQuery("");
    applyNow({ ...chosen, ...NO_FILTERS }, DEFAULT_PERIOD);
  };

  const empty =
    state.movements.length === 0 ? (
      <EmptyState title="אין תנועות" hint="קליטה או הוצאה ראשונה תופיע כאן">
        <Button variant="secondary" onClick={() => ui.openAction("receive")}>קליטת סחורה</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState title="לא נמצאו תנועות" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
        <Button variant="secondary" onClick={clearFilters}>ניקוי סינון</Button>
      </EmptyState>
    ) : period !== DEFAULT_PERIOD && !differs(applied, { ...applied, ...NO_FILTERS }) ? (
      // A tab is not a filter: nothing was narrowed down, the period is simply empty.
      <EmptyState title={NOTHING_IN[period] ?? "אין תנועות בטווח הזה"} hint="אפשר לראות תנועות ישנות יותר">
        <Button variant="secondary" onClick={() => choosePeriod("all")}>כל התנועות</Button>
      </EmptyState>
    ) : hasFilters ? (
      <EmptyState title="לא נמצאו תנועות" hint="אפשר להסיר את הסינון">
        <Button variant="secondary" onClick={clearFilters}>ניקוי סינון</Button>
      </EmptyState>
    ) : (
      <EmptyState title="אין תנועות ב-30 הימים האחרונים" hint="אפשר לראות תנועות ישנות יותר">
        <Button variant="secondary" onClick={() => choosePeriod("all")}>כל התנועות</Button>
      </EmptyState>
    );

  return (
    <div className="sa-page">
      <PageHead title="תנועות" sub={isLoading ? undefined : <Count n={visible.length} one="תנועה" many="תנועות" />} />

      <Toolbar
        tabs={<Tabs tabs={PERIODS} value={period} onChange={choosePeriod} />}
        query={query}
        onQuery={setQuery}
        placeholder='חיפוש לפי מוצר או מק"ט'
      />

      {failed ? (
        <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retry}>
          מוצגות רק התנועות האחרונות
        </Notice>
      ) : null}

      <div className={cx("sa-moves", refreshing && "is-refreshing")} data-settle={settled ? settled % 2 : undefined}>
        <div className="app-filters">
          {period === "custom" ? (
            <DateRangeFilter
              from={chosen.fromDay}
              to={chosen.toDay}
              open={calendarOpen}
              onOpenChange={setCalendarOpen}
              onApply={(fromDay, toDay) => void refresh({ ...chosen, fromDay, toDay })}
            />
          ) : null}
          <HoursFilter from={chosen.fromTime} to={chosen.toTime} onApply={(fromTime, toTime) => void refresh({ ...chosen, fromTime, toTime })} />
          <Select options={workerOptions} value={chosen.workerId} onChange={(workerId) => choose({ workerId })} allLabel="כל העובדים" placeholder="עובד" />
          <Select options={typeOptions} value={chosen.moveType} onChange={(moveType) => choose({ moveType })} allLabel="כל הפעולות" placeholder="פעולה" searchable={false} />
          <Select options={supplierOptions} value={chosen.supplierId} onChange={(supplierId) => choose({ supplierId })} allLabel="כל הספקים" placeholder="ספק" />
          <Select options={categories} value={chosen.category} onChange={(category) => choose({ category })} allLabel="כל הקטגוריות" placeholder="קטגוריה" />
          <div className="app-filters-end">
            {hasFilters ? <Button variant="ghost" onClick={clearFilters}>ניקוי סינון</Button> : null}
            <Button
              variant={pending ? "primary" : "secondary"}
              className={cx("app-apply", updated && !pending && "is-done")}
              onClick={() => void refresh(chosen)}
            >
              <span className={cx(updated && !pending && "is-off")}>החל</span>
              <span className={cx(!(updated && !pending) && "is-off")}><Icon name="check" size={14} strokeWidth={2.5} />עודכן</span>
            </Button>
          </div>
          <span className="app-refresh-line" aria-hidden="true" />
          <span className="sr-only" role="status">{updated ? "הרשימה עודכנה" : ""}</span>
        </div>

        <MovementsTable
          key={`${from}|${to}|${applied.fromTime}|${applied.toTime}|${applied.workerId}|${applied.moveType}|${applied.supplierId}|${applied.category}|${q}`}
          rows={visible}
          isLoading={isLoading}
          empty={empty}
        />
      </div>
    </div>
  );
}

function MovementsTable({ rows, isLoading, empty }: { rows: MovementRow[]; isLoading: boolean; empty: ReactNode }) {
  const { product, supplier, worker } = useData();
  const ui = useUi();
  const [shown, setShown] = useState(PAGE_SIZE);

  const columns = useMemo<TableColumn<MovementRow>[]>(() => {
    const phoneLine = (m: MovementRow) => [fmtDay(m.created_at), worker(m.worker_id)?.name].filter(Boolean).join(" · ");
    return [
      {
        key: "product",
        title: "מוצר",
        className: MAIN_CELL,
        render: (m) => {
          const p = product(m.product_id);
          return (
            <span className="sa-thumbed">
              <ProductThumb product={p} />
              {p ? (
                <span className="block min-w-0">
                  <span className="sa-cell-primary sa-truncate block">{fmtName(p.name)}</span>
                  <span className="sa-cell-sub sa-truncate">
                    <span className="min-[600px]:hidden">{phoneLine(m)}</span>
                    <span className="max-[600px]:hidden">
                      <span className="hidden min-[601px]:max-[1099px]:inline">{worker(m.worker_id)?.name ? `${worker(m.worker_id)?.name} · ` : null}</span>
                      <span className="sa-mono ltr">{p.sku}</span>
                      {m.external_name ? <> · בתעודה: &quot;<bdi>{m.external_name}</bdi>&quot;</> : null}
                    </span>
                  </span>
                </span>
              ) : (
                <span className="block min-w-0">
                  <span className="sa-muted">מוצר שנמחק</span>
                  <span className="sa-cell-sub sa-truncate min-[600px]:hidden!">{phoneLine(m)}</span>
                </span>
              )}
            </span>
          );
        },
      },
      {
        key: "qty",
        title: "כמות",
        mono: true,
        render: (m) => (
          <span className="sa-mv-qty">
            <span className="ltr"><MovementQty qty={m.qty} type={m.type} /></span>
            <Movement type={m.type} />
          </span>
        ),
      },
      {
        key: "created_at",
        title: "מועד",
        mono: true,
        render: (m) => (
          <span className="sa-mv-when">
            <span>{fmtDayWord(m.created_at)}</span>
            <span>{fmtTime(m.created_at)}</span>
          </span>
        ),
      },
      {
        key: "worker",
        title: "עובד",
        render: (m) => {
          const name = worker(m.worker_id)?.name;
          return name ? <span className="sa-mv-who sa-truncate block" title={name}>{name}</span> : <span className="text-ink-3">—</span>;
        },
      },
      {
        key: "supplier",
        title: "מקור",
        render: (m) => {
          const name = supplier(m.supplier_id)?.name;
          const order = orderRef(m.reference);
          if (!name && !order && !m.exit_pass) return <span className="text-ink-3">—</span>;
          return (
            <span className="sa-mv-source block">
              {name ? <span className="sa-truncate block" title={name}>{name}</span> : null}
              {order ? <span className="sa-cell-sub sa-truncate" title={order}><bdi>{order}</bdi></span> : null}
              {m.exit_pass ? <span className="sa-cell-sub sa-truncate">בלי קבלה</span> : null}
            </span>
          );
        },
      },
    ];
  }, [product, worker, supplier]);

  const page = rows.slice(0, shown);

  return (
    <Table<MovementRow>
      caption="תנועות מלאי"
      className={`${PHONE_MOVEMENTS} ${TABLET_MOVEMENTS}`}
      columns={columns}
      data={page}
      isLoading={isLoading}
      skeletonRows={8}
      empty={empty}
      onRowClick={(m) => ui.openMovement(m)}
      footer={
        page.length < rows.length ? (
          <>
            <Showing shown={page.length} total={rows.length} />
            <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>הצגת עוד</Button>
          </>
        ) : undefined
      }
    />
  );
}
