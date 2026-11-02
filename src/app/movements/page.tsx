"use client";

/**
 * תנועות — every stock movement, narrowed by date, hours, who did it and the rest.
 * The store keeps only the latest rows, so a period that reaches past them is read from the database.
 */
import { Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useData, type Movement as MovementRow, type MovementType } from "@/lib/store";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import {
  Button,
  Count,
  EmptyState,
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
import { fmtDay, fmtDayWord, fmtName, fmtTime, MOVEMENT_LABEL } from "@/lib/format";

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
const MOVEMENT_TYPES: MovementType[] = ["in", "out", "fault", "adjust"];
const NO_WORKER = "none";
const PAGE_SIZE = 100;

/** Phones keep product and quantity only; the rest moves under the product. The empty state sits in the first cell, so it stays. */
const PHONE_MOVEMENTS = "max-[600px]:[&_:is(td,th):not(:nth-child(1),:nth-child(2),.sa-table-empty)]:hidden";

/** The product takes what the other columns leave, so a long name truncates and no column is ever cut. */
const MAIN_CELL = "w-full max-w-0";

function periodFromParams(params: URLSearchParams): Period {
  const value = params.get("period");
  return PERIODS.find((p) => p.value === value)?.value ?? DEFAULT_PERIOD;
}

/** The yyyy-mm-dd a date input holds. */
function dayValue(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
    case "custom": {
      // Dates entered the wrong way round still mean the days between them.
      const [first, last] = fromDay && toDay && fromDay > toDay ? [toDay, fromDay] : [fromDay, toDay];
      return {
        from: first ? midnight(0, new Date(`${first}T00:00`)) : null,
        to: last ? midnight(1, new Date(`${last}T00:00`)) : null,
      };
    }
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
  const { state, product, supplier, worker } = useData();
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

  const [fromDay, setFromDay] = useState(() => dayValue(midnight(-6)));
  const [toDay, setToDay] = useState(() => dayValue(midnight()));
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [moveType, setMoveType] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");

  const { from, to } = periodRange(period, fromDay, toDay);
  const { rows, isLoading, failed, retry } = useMovementsInRange(from, to);

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
      if (moveType && m.type !== moveType) return false;
      if (workerId === NO_WORKER ? m.worker_id : workerId && m.worker_id !== workerId) return false;
      if (supplierId && m.supplier_id !== supplierId) return false;
      if (!inHours(m.created_at, fromTime, toTime)) return false;
      const p = product(m.product_id);
      if (category && p?.category !== category) return false;
      if (q) {
        const hay = [p?.name, p?.sku, p?.barcode, m.external_name, m.reference, m.note, worker(m.worker_id)?.name, supplier(m.supplier_id)?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, moveType, workerId, supplierId, fromTime, toTime, category, q, product, worker, supplier]);

  const hasFilters = Boolean(period !== DEFAULT_PERIOD || fromTime || toTime || workerId || moveType || supplierId || category || q);

  const clearFilters = () => {
    setPeriod(DEFAULT_PERIOD);
    setFromTime("");
    setToTime("");
    setWorkerId("");
    setMoveType("");
    setSupplierId("");
    setCategory("");
    setQuery("");
  };

  const empty =
    state.movements.length === 0 ? (
      <EmptyState title="אין תנועות" hint="קליטה או הוצאה ראשונה תופיע כאן">
        <Button variant="secondary" onClick={() => ui.openAction("receive")}>קליטת סחורה</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState title="לא נמצאו תנועות" hint={<>עבור <span className="sa-mono ltr">„{query.trim()}”</span></>} />
    ) : (
      <EmptyState title="לא נמצאו תנועות" hint="אפשר להסיר את הסינון" />
    );

  return (
    <div className="sa-page">
      <PageHead title="תנועות" sub={isLoading ? undefined : <Count n={visible.length} one="תנועה" many="תנועות" />} />

      <Toolbar
        tabs={<Tabs tabs={PERIODS} value={period} onChange={setPeriod} />}
        query={query}
        onQuery={setQuery}
        placeholder='חיפוש לפי מוצר, מק"ט או מספר תעודה'
      />

      {failed ? (
        <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retry}>
          מוצגות רק התנועות האחרונות
        </Notice>
      ) : null}

      <div className="sa-moves">
        <div className="app-filters">
          {period === "custom" ? <RangeField label="תאריך" type="date" from={fromDay} to={toDay} onFrom={setFromDay} onTo={setToDay} /> : null}
          <Select options={workerOptions} value={workerId} onChange={setWorkerId} allLabel="כל העובדים" placeholder="עובד" />
          <Select options={typeOptions} value={moveType} onChange={setMoveType} allLabel="כל הפעולות" placeholder="פעולה" searchable={false} />
          <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} allLabel="כל הספקים" placeholder="ספק" />
          <Select options={categories} value={category} onChange={setCategory} allLabel="כל הקטגוריות" placeholder="קטגוריה" />
          <RangeField label="שעה" type="time" from={fromTime} to={toTime} onFrom={setFromTime} onTo={setToTime} />
          {hasFilters ? <Button variant="ghost" size="sm" className="app-filters-clear" onClick={clearFilters}>ניקוי סינון</Button> : null}
        </div>

        <MovementsTable
          key={`${from}|${to}|${fromTime}|${toTime}|${workerId}|${moveType}|${supplierId}|${category}|${q}`}
          rows={visible}
          isLoading={isLoading}
          empty={empty}
        />
      </div>
    </div>
  );
}

function RangeField({ label, type, from, to, onFrom, onTo }: {
  label: string;
  type: "date" | "time";
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <div className={from || to ? "app-range is-set" : "app-range"} role="group" aria-label={label}>
      <span>{label}</span>
      <input type={type} dir="ltr" value={from} onChange={(e) => onFrom(e.target.value)} aria-label={`${label}, מ`} />
      <span>עד</span>
      <input type={type} dir="ltr" value={to} onChange={(e) => onTo(e.target.value)} aria-label={`${label}, עד`} />
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
                    <span className="min-[601px]:hidden">{phoneLine(m)}</span>
                    <span className="max-[600px]:hidden">
                      <span className="sa-mono ltr">{p.sku}</span>
                      {m.external_name ? <> · בתעודה: &quot;<bdi>{m.external_name}</bdi>&quot;</> : null}
                    </span>
                  </span>
                </span>
              ) : (
                <span className="block min-w-0">
                  <span className="sa-muted">מוצר שנמחק</span>
                  <span className="sa-cell-sub sa-truncate min-[601px]:hidden!">{phoneLine(m)}</span>
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
        title: "ספק ותעודה",
        render: (m) => {
          const name = supplier(m.supplier_id)?.name;
          if (!name && !m.reference) return <span className="text-ink-3">—</span>;
          return (
            <span className="sa-mv-source block">
              {name ? <span className="sa-truncate block" title={name}>{name}</span> : null}
              {m.reference ? <span className="sa-cell-sub sa-truncate" title={m.reference}><bdi>{m.reference}</bdi></span> : null}
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
      className={PHONE_MOVEMENTS}
      columns={columns}
      data={page}
      isLoading={isLoading}
      skeletonRows={8}
      empty={empty}
      onRowClick={(m) => ui.openProduct(m.product_id, "history")}
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
