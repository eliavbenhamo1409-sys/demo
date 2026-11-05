"use client";

/**
 * תנועות as an operational ledger. The title and one summary line; the period as text tabs with the search beside them;
 * the filters on one row that wait for החל; a timeline of the range where every bar is a count you can read; then the
 * rows by day under a sticky day head, each answering when, which product, how much, from where to where, who, and
 * which paper. A row opens the shared drawer and pointing at it lights the product's shelf. The ?period=, the filters,
 * the reads past the store's cap and the empty states are the shared page's, word for word.
 */

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { DateRangeFilter, dayValue, HoursFilter } from "@/components/app/WhenFilters";
import { useTwin } from "@/components/merhav/twin/Twin";
import { Button, cx, EmptyState, Icon, Notice, SearchBar, Select, Tabs, type SelectOption } from "@/components/ui";
import { daysAgo, fmtDate, fmtName, fmtQty, fmtSigned, fmtTime, fmtUnit, MOVEMENT_LABEL, orderRef } from "@/lib/format";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { useData, type DocumentRecord, type Movement, type MovementType, type Product } from "@/lib/store";
import { Head, Summary, type SumItem } from "../parts";

/* ───────── the period and the filters, as the shared page keeps them ───────── */

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
/** What the timeline is called, by the period. A custom range is called by its dates. */
const PERIOD_TITLE: Record<Period, string> = { today: "היום", yesterday: "אתמול", week: "7 הימים האחרונים", month: "30 הימים האחרונים", all: "כל התנועות", custom: "טווח תאריכים" };
const MOVEMENT_TYPES: MovementType[] = ["in", "out", "fault", "adjust"];
const NO_WORKER = "none";
/** A very long range shows this many rows at a time. */
const PAGE_SIZE = 300;

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

/* ───────── words ───────── */

const COUNT_WORDS: Record<MovementType, readonly [string, string]> = {
  in: ["קליטה", "קליטות"],
  out: ["הוצאה", "הוצאות"],
  fault: ["תקלה", "תקלות"],
  adjust: ["תיקון ספירה", "תיקוני ספירה"],
};
/** "קליטה אחת": one is said in words, as Hebrew does. */
const ONE: Record<MovementType, string> = { in: "קליטה אחת", out: "הוצאה אחת", fault: "תקלה אחת", adjust: "תיקון ספירה אחד" };
const countWord = (type: MovementType, n: number) => COUNT_WORDS[type][n === 1 ? 0 : 1];
const countPhrase = (type: MovementType, n: number) => (n === 1 ? ONE[type] : `${fmtQty(n)} ${COUNT_WORDS[type][1]}`);
const movesPhrase = (n: number) => (n === 1 ? "תנועה אחת" : `${fmtQty(n)} תנועות`);

type Counts = Record<MovementType, number>;
const noCounts = (): Counts => ({ in: 0, out: 0, fault: 0, adjust: 0 });

const iso = (t: number) => new Date(t).toISOString();
const isTodayAt = (t: number) => dayValue(t) === dayValue(Date.now());
const dayFmt = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" });
const dayYearFmt = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** "יום שלישי, 4 בנובמבר", with the year once it isn't this one. */
function dayWords(t: number): string {
  const d = new Date(t);
  return (d.getFullYear() === new Date().getFullYear() ? dayFmt : dayYearFmt).format(d);
}

/** "היום · יום שלישי, 4 בנובמבר": a day's head says where in the week it is, and whether it is now. */
function dayHead(at: string): string {
  const ago = daysAgo(at, Date.now());
  const lead = ago === 0 ? "היום · " : ago === 1 ? "אתמול · " : "";
  return `${lead}${dayWords(Date.parse(at))}`;
}

/** The database folds the customer and the agent into an issue's note, "ללקוח: … · סוכן: …", before what a person wrote. */
function readNote(note: string | null): { customer?: string; rest: string } {
  const rest: string[] = [];
  let customer: string | undefined;
  for (const part of (note ?? "").split(" · ")) {
    if (part.startsWith("ללקוח: ")) customer = part.slice("ללקוח: ".length);
    // Why stock left with no receipt is the drawer's to tell.
    else if (part.startsWith("בלי קבלה: ")) break;
    else if (part && !part.startsWith("סוכן: ")) rest.push(part);
  }
  return { customer, rest: rest.join(" · ") };
}

/* ───────── the timeline: one bar for every day of the range ───────── */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A range of more days than this reads by the week. */
const MOST_DAYS = 62;
/** How far the fullest bar reaches above the axis, and below it. */
const UP = 48;
const DOWN = 40;

type Unit = "hour" | "day" | "week";
const UNIT_WORD: Record<Unit, string> = { hour: "לפי שעה", day: "לפי יום", week: "לפי שבוע" };

interface Bar extends Counts {
  /** When it starts, epoch ms. */
  start: number;
  /** The newest row inside it, as an index in the list; below zero when it holds none. */
  row: number;
}

interface Line {
  bars: Bar[];
  unit: Unit;
  /** The fullest side of the axis: every bar is read against it. */
  top: number;
}

/** A single day reads by the hour, a season by the day, and anything longer by the week. Time runs left to right. */
function lineOf(rows: readonly Movement[], oldest: number | null, from: number | null, to: number | null): Line {
  const lastDay = midnight(0, new Date(to === null ? Date.now() : to - 1));
  const firstDay = midnight(0, new Date(from ?? oldest ?? lastDay));
  const days = Math.max(Math.round((lastDay - firstDay) / DAY_MS) + 1, 1);
  const unit: Unit = days === 1 ? "hour" : days <= MOST_DAYS ? "day" : "week";
  const size = unit === "week" ? 7 : 1;
  const count = unit === "hour" ? 24 : Math.ceil(days / size);
  const bars: Bar[] = Array.from({ length: count }, (_, i) => ({
    ...noCounts(),
    start: unit === "hour" ? firstDay + i * HOUR_MS : midnight(i * size, new Date(firstDay)),
    row: -1,
  }));
  rows.forEach((m, i) => {
    const t = new Date(m.created_at);
    const at = unit === "hour" ? t.getHours() : Math.floor(Math.round((midnight(0, t) - firstDay) / DAY_MS) / size);
    const bar = bars[Math.min(Math.max(at, 0), count - 1)];
    // Rows come newest first, so the first one seen is the bar's newest.
    if (bar.row < 0) bar.row = i;
    bar[m.type] += 1;
  });
  const top = bars.reduce((most, bar) => Math.max(most, bar.in, bar.out), 0);
  return { bars, unit, top: Math.max(top, 1) };
}

/** Pixels from the axis. A single movement still shows. */
const reach = (n: number, top: number, most: number) => (n > 0 ? Math.max(Math.round((n / top) * most), 3) : 0);

const hourWord = (t: number) => `${String(new Date(t).getHours()).padStart(2, "0")}:00`;

function barWhen(bar: Bar, unit: Unit): string {
  if (unit === "hour") return `${hourWord(bar.start)}–${hourWord(bar.start + HOUR_MS)}`;
  if (unit === "day") return dayWords(bar.start);
  return `${fmtDate(iso(bar.start))} – ${fmtDate(iso(midnight(6, new Date(bar.start))))}`;
}

function barWords(bar: Bar): string {
  const said = MOVEMENT_TYPES.filter((type) => bar[type] > 0).map((type) => countPhrase(type, bar[type]));
  return said.length > 0 ? said.join(" · ") : "אין תנועות";
}

/** The dates under the bars: a few, evenly spaced, and always the last; today by its name. */
function labelsOf(line: Line): (string | null)[] {
  const n = line.bars.length;
  if (line.unit === "hour") return line.bars.map((bar, i) => (i % 6 === 0 ? hourWord(bar.start).slice(0, 2) : null));
  const step = Math.max(1, Math.ceil(n / 8));
  return line.bars.map((bar, i) => ((n - 1 - i) % step !== 0 ? null : line.unit === "day" && isTodayAt(bar.start) ? "היום" : fmtDate(iso(bar.start))));
}

function Timeline({ line, title, onPick }: { line: Line; title: ReactNode; onPick: (row: number) => void }): ReactElement {
  const chart = useRef<HTMLDivElement>(null);
  const tipEl = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ i: number; x: number } | null>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const n = line.bars.length;
  // The keyboard lands on the newest bar that holds something.
  const last = line.bars.reduce((found, bar, i) => (bar.row >= 0 ? i : found), n - 1);
  const at = focusAt === null ? last : Math.min(focusAt, n - 1);
  const labels = labelsOf(line);

  // A long range opens on its newest end.
  useLayoutEffect(() => {
    const el = chart.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [line]);

  // The tip stands over its bar, and stops at the edges rather than leaving the strip.
  useLayoutEffect(() => {
    const el = tipEl.current;
    const box = chart.current;
    if (!el || !box || !tip) return;
    el.style.left = `${Math.min(Math.max(tip.x - el.offsetWidth / 2, 0), Math.max(box.scrollWidth - el.offsetWidth, 0))}px`;
  }, [tip]);

  const show = (i: number, el: HTMLElement) => setTip({ i, x: el.offsetLeft + el.offsetWidth / 2 });
  const focusBar = (i: number) => {
    setFocusAt(i);
    chart.current?.querySelector<HTMLButtonElement>(`[data-i="${i}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // The strip runs left to right, so the right arrow goes to the later bar whatever the page's direction.
    const next = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    focusBar(Math.min(Math.max(next, 0), n - 1));
  };

  const shown = tip ? line.bars[tip.i] : null;
  const span = line.unit === "hour" ? "24 שעות" : line.unit === "day" ? `${fmtQty(n)} ימים` : `${fmtQty(n)} שבועות`;

  return (
    <section className="at-mv-timeline" aria-label="ציר הזמן" style={{ "--n": n } as CSSProperties}>
      <div className="at-mv-timeline-head">
        <h2>{title}</h2>
        <span className="at-mv-unit">{UNIT_WORD[line.unit]} · {span}</span>
        <span className="at-mv-legend" aria-hidden="true">
          <span className="is-in"><i />קליטות מעל הקו</span>
          <span className="is-out"><i />− הוצאות מתחתיו</span>
          <span className="is-other"><i />תקלות ותיקוני ספירה</span>
          <span className="at-mv-legend-unit">גובה = מספר תנועות</span>
        </span>
      </div>
      <div ref={chart} className="at-mv-chart" dir="ltr">
        {/* The tip leaves with the pointer at the strip's edge, not in the gap between two bars. */}
        <div className="at-mv-bars" role="group" aria-label="תנועות לאורך הטווח" onKeyDown={onKey} onPointerLeave={() => setTip(null)}>
          {line.bars.map((bar, i) => (
            <button
              key={bar.start}
              type="button"
              data-i={i}
              tabIndex={i === at ? 0 : -1}
              className={cx("at-mv-bar", bar.row < 0 && "is-empty")}
              style={{ "--in": `${reach(bar.in, line.top, UP)}px`, "--out": `${reach(bar.out, line.top, DOWN)}px` } as CSSProperties}
              aria-label={`${barWhen(bar, line.unit)}: ${barWords(bar)}`}
              onPointerEnter={(e) => show(i, e.currentTarget)}
              onFocus={(e) => {
                setFocusAt(i);
                show(i, e.currentTarget);
              }}
              onBlur={() => setTip(null)}
              onClick={() => {
                if (bar.row >= 0) onPick(bar.row);
              }}
            >
              <i className="at-mv-bar-in" />
              <i className="at-mv-bar-out" />
              {bar.fault + bar.adjust > 0 ? <i className="at-mv-bar-tick" /> : null}
            </button>
          ))}
        </div>
        <div className="at-mv-axis" aria-hidden="true">
          {line.bars.map((bar, i) => (
            <span key={bar.start} className={labels[i] === "היום" ? "is-today" : undefined}>{labels[i]}</span>
          ))}
        </div>
        {shown ? (
          <span ref={tipEl} className="at-mv-tip" dir="rtl">
            <b>{barWhen(shown, line.unit)}</b> · {barWords(shown)}
          </span>
        ) : null}
      </div>
    </section>
  );
}

/* ───────── one row ───────── */

interface Part {
  text: string;
  /** A place code, kept left to right. */
  code?: boolean;
  /** The product's place today, not one the row recorded. */
  now?: boolean;
}

/** From where to where: a receipt goes from its supplier to a shelf, an issue from a shelf to a customer, the rest stands where it was. */
interface Route {
  start: Part | null;
  end: Part | null;
}

function RouteWords({ route }: { route: Route }): ReactElement {
  if (!route.start && !route.end) return <span className="at-tone-quiet">ללא מיקום</span>;
  const part = (p: Part) =>
    p.code ? (
      <span className="at-place" title={p.now ? "המיקום הנוכחי של המוצר" : undefined}>{p.text}</span>
    ) : (
      <span className="at-mv-route-name" title={p.text}>{p.text}</span>
    );
  return (
    <span className="at-mv-route">
      {route.start ? part(route.start) : null}
      {route.start && route.end ? <Icon name="arrow-left" size={14} /> : null}
      {route.end ? part(route.end) : null}
    </span>
  );
}

interface RowProps {
  m: Movement;
  p: Product | undefined;
  who: string | undefined;
  route: Route;
  /** What the paper called it, or what a person wrote. */
  detail: string;
  doc: DocumentRecord | undefined;
  selected: boolean;
  onOpen: (m: Movement) => void;
  onSpot: (productId: string | null) => void;
}

function Row({ m, p, who, route, detail, doc, selected, onOpen, onSpot }: RowProps): ReactElement {
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onOpen(m);
  };
  const openPaper = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onOpen(m);
  };
  return (
    <tr
      id={`at-mv-${m.id}`}
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      className={cx(selected && "is-selected")}
      onClick={() => onOpen(m)}
      onKeyDown={onKey}
      onPointerEnter={() => onSpot(m.product_id)}
      onPointerLeave={() => onSpot(null)}
      onFocus={() => onSpot(m.product_id)}
      onBlur={() => onSpot(null)}
    >
      <td className="is-when"><span className="ltr at-mv-time">{fmtTime(m.created_at)}</span></td>
      <td className="is-product">
        <span className="at-cell">
          <ProductThumb product={p} />
          <span className="at-cell-text">
            <span className={cx("at-cell-title", !p && "at-tone-quiet")} title={p?.name}>{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
            {/* The pieces a narrow screen folds under the name stand here, hidden until their column goes. */}
            <span className="at-cell-sub at-mv-sub">
              {p ? <span className="ltr">{p.sku}</span> : null}
              {detail ? <span className="at-mv-sub-detail"><bdi>{detail}</bdi></span> : null}
              {who ? <span className="at-mv-sub-who">{who}</span> : null}
              <span className="at-mv-sub-route"><RouteWords route={route} /></span>
              {m.exit_pass ? <span className="at-mv-sub-paper"><span className="at-mv-nopaper">בלי קבלה</span></span> : null}
            </span>
          </span>
        </span>
      </td>
      <td className="is-num is-qty">
        <span className={cx("at-mv-qty", m.type === "in" && "is-in", m.type === "out" && "is-out")}>{fmtSigned(m.qty, m.type)}</span>
        {p ? <small>{fmtUnit(m.qty, p.unit)}</small> : null}
        <span className="at-num-sub">{MOVEMENT_LABEL[m.type]}</span>
      </td>
      <td className="is-route"><RouteWords route={route} /></td>
      <td className="is-who">{who ?? <span className="at-tone-quiet">—</span>}</td>
      <td className="is-paper">
        {doc ? (
          <button type="button" className="at-mv-paper" onClick={openPaper}>קבלה</button>
        ) : m.exit_pass ? (
          <span className="at-mv-nopaper">בלי קבלה</span>
        ) : (
          <span className="at-tone-quiet">—</span>
        )}
      </td>
    </tr>
  );
}

/* ───────── the page ───────── */

interface Day {
  key: string;
  /** The day's newest row stands for its date. */
  at: string;
  rows: Movement[];
}

/** Rows by day, in the order they come: newest first. */
function daysOf(rows: readonly Movement[]): Day[] {
  const days: Day[] = [];
  for (const m of rows) {
    const key = dayValue(Date.parse(m.created_at));
    const last = days[days.length - 1];
    if (last?.key === key) last.rows.push(m);
    else days.push({ key, at: m.created_at, rows: [m] });
  }
  return days;
}

/** Brings a day's head, or a row, to the top of the workspace. False when it isn't on the page. */
function land(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  return true;
}

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

export function Movements(): ReactElement {
  return (
    <Suspense fallback={null}>
      <MovementsInner />
    </Suspense>
  );
}

function MovementsInner(): ReactElement {
  const { state, product, supplier, worker, reload } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { spotProduct, itemsOf } = useTwin();

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
  };

  useEffect(() => {
    if (!updated) return;
    const timer = setTimeout(() => setUpdated(false), UPDATED_MS);
    return () => clearTimeout(timer);
  }, [updated]);

  /** Tabs and ניקוי are a choice and its press in one: the list answers at once, overtaking a refresh on its way. */
  const applyNow = (filters: Filters, nextPeriod: string) => {
    lastRun.current += 1;
    setChosen(filters);
    setApplied(filters);
    setPeriod(nextPeriod);
    setRefreshing(false);
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
  const typeOptions = useMemo<SelectOption[]>(() => MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_LABEL[t] })), []);
  const supplierOptions = useMemo<SelectOption[]>(() => state.suppliers.map((s) => ({ value: s.id, label: s.name })), [state.suppliers]);
  const categories = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const p of state.products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [state.products]);

  /* ───────── what a row needs to know ───────── */
  const docById = useMemo(() => new Map(state.documents.map((d) => [d.id, d])), [state.documents]);

  // An issue under an order knows its customer through the order's line.
  const customerOf = useMemo(() => {
    const customers = new Map(state.orders.map((o) => [o.id, o.customer]));
    const byMovement = new Map<string, string>();
    for (const l of state.orderLines) {
      const customer = customers.get(l.order_id);
      if (l.movement_id && customer) byMovement.set(l.movement_id, customer);
    }
    return byMovement;
  }, [state.orders, state.orderLines]);

  // A receipt says which shelf it went to. Everything else stands where the product stands, the same rule the model moves by.
  const placeOfRow = useCallback(
    (m: Movement): Part | null => {
      if (m.place) return { text: m.place, code: true };
      const home = itemsOf(m.product_id)[0]?.place ?? product(m.product_id)?.location;
      return home ? { text: home, code: true, now: true } : null;
    },
    [itemsOf, product],
  );

  const routeOf = useCallback(
    (m: Movement, doc: DocumentRecord | undefined, customerInNote: string | undefined): Route => {
      const at = placeOfRow(m);
      if (m.type === "in") {
        const vendor = supplier(m.supplier_id ?? doc?.supplier_id)?.name;
        return { start: vendor ? { text: vendor } : null, end: at };
      }
      if (m.type === "out") {
        const customer = customerOf.get(m.id) ?? customerInNote ?? doc?.customer ?? orderRef(m.reference);
        return { start: at, end: customer ? { text: customer } : null };
      }
      return { start: at, end: null };
    },
    [placeOfRow, supplier, customerOf],
  );

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

  /* ───────── the sums, the timeline, the rows on the page ───────── */
  const totals = useMemo(() => {
    const n = noCounts();
    for (const m of visible) n[m.type] += 1;
    return n;
  }, [visible]);

  const summary: SumItem[] = [
    { label: visible.length === 1 ? "תנועה בטווח" : "תנועות בטווח", value: visible.length },
    { label: countWord("in", totals.in), value: totals.in, tone: totals.in > 0 ? "ok" : undefined },
    { label: countWord("out", totals.out), value: totals.out },
    { label: countWord("fault", totals.fault), value: totals.fault, tone: totals.fault > 0 ? "out" : undefined },
    { label: countWord("adjust", totals.adjust), value: totals.adjust },
  ];

  const filterKey = `${from}|${to}|${applied.fromTime}|${applied.toTime}|${applied.workerId}|${applied.moveType}|${applied.supplierId}|${applied.category}|${q}`;
  // How many rows stand on the page under this filter; a new filter starts again from the first page.
  const [shownFor, setShownFor] = useState({ key: filterKey, n: PAGE_SIZE });
  const shown = shownFor.key === filterKey ? shownFor.n : PAGE_SIZE;
  const page = useMemo(() => visible.slice(0, shown), [visible, shown]);
  const days = useMemo(() => daysOf(page), [page]);

  // The range with no start ("הכל") begins at the oldest row read.
  const oldest = rows.length > 0 ? Date.parse(rows[rows.length - 1].created_at) : null;
  const line = useMemo(() => lineOf(visible, oldest, from, to), [visible, oldest, from, to]);
  const title = period === "custom" && from !== null && to !== null ? <span className="ltr">{`${fmtDate(iso(from))}–${fmtDate(iso(to - 1))}`}</span> : PERIOD_TITLE[period];

  /* ───────── a bar lands on its day ───────── */
  const goal = useRef<string | null>(null);
  const pick = useCallback(
    (row: number) => {
      const m = visible[row];
      if (!m) return;
      const id = line.unit === "hour" ? `at-mv-${m.id}` : `at-mv-day-${dayValue(Date.parse(m.created_at))}`;
      if (row < shown && land(id)) return;
      // The row isn't on the page yet: the page grows to it, and the landing waits for the rows.
      goal.current = id;
      setShownFor({ key: filterKey, n: Math.ceil((row + 1) / PAGE_SIZE) * PAGE_SIZE });
    },
    [visible, line.unit, shown, filterKey],
  );

  useEffect(() => {
    if (page.length > 0 && goal.current && land(goal.current)) goal.current = null;
  }, [page]);

  // A list that ends under the pointer never sends its row's leave.
  useEffect(() => () => spotProduct(null), [spotProduct]);

  const selectedId = ui.panel?.type === "movement" ? ui.panel.movement.id : null;
  const open = useCallback((m: Movement) => ui.openMovement(m), [ui]);

  const rest = visible.length - page.length;

  return (
    <div className="at-mv">
      <Head title="תנועות" line={isLoading ? <span className="at-mv-wait-word">טוען תנועות…</span> : <Summary items={summary} />} />

      <div className="at-mv-tools">
        <div className="at-mv-top">
          <Tabs variant="line" tabs={PERIODS} value={period} onChange={choosePeriod} />
          <SearchBar kbd={false} value={query} onChange={setQuery} placeholder='חיפוש לפי מוצר או מק"ט' />
        </div>
        <div className="at-tools at-mv-filters">
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
          <div className="at-mv-keys">
            {hasFilters ? <Button variant="ghost" onClick={clearFilters}>ניקוי</Button> : null}
            <Button variant={pending ? "primary" : "secondary"} className={cx("at-mv-apply", updated && !pending && "is-done")} onClick={() => void refresh(chosen)}>
              <span className={cx(updated && !pending && "is-off")}>החל</span>
              <span className={cx(!(updated && !pending) && "is-off")}><Icon name="check" size={16} />עודכן</span>
            </Button>
          </div>
        </div>
        {refreshing ? <span className="at-mv-refresh" aria-hidden="true" /> : null}
        <span className="sr-only" role="status">{updated ? "הרשימה עודכנה" : ""}</span>
      </div>

      {failed ? (
        <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retry}>
          מוצגות רק התנועות האחרונות
        </Notice>
      ) : null}

      <div className={cx("at-mv-body", refreshing && "is-refreshing")}>
        {!isLoading && visible.length > 0 ? <Timeline line={line} title={title} onPick={pick} /> : null}

        <div className="at-table-wrap at-mv-wrap">
          <table className="at-table at-mv-table">
            <caption className="sr-only">תנועות מלאי לפי יום</caption>
            <thead>
              <tr>
                <th scope="col" className="is-when">שעה</th>
                <th scope="col" className="is-product">מוצר</th>
                <th scope="col" className="is-num is-qty">כמות</th>
                <th scope="col" className="is-route">מאיפה ולאן</th>
                <th scope="col" className="is-who">עובד</th>
                <th scope="col" className="is-paper">מסמך</th>
              </tr>
            </thead>
            {isLoading && page.length === 0 ? (
              <tbody aria-hidden="true">
                {SKELETON_ROWS.map((i) => (
                  <tr key={i} className="at-mv-skel">
                    <td className="is-when"><span className="sa-skeleton" style={{ width: 40 }} /></td>
                    <td className="is-product">
                      <span className="at-cell">
                        <span className="sa-skeleton at-mv-skel-thumb" />
                        <span className="at-cell-text at-mv-skel-text">
                          <span className="sa-skeleton" style={{ width: "56%" }} />
                          <span className="sa-skeleton" style={{ width: "28%" }} />
                        </span>
                      </span>
                    </td>
                    <td className="is-num is-qty"><span className="sa-skeleton" style={{ width: 48 }} /></td>
                    <td className="is-route"><span className="sa-skeleton" style={{ width: 120 }} /></td>
                    <td className="is-who"><span className="sa-skeleton" style={{ width: 72 }} /></td>
                    <td className="is-paper"><span className="sa-skeleton" style={{ width: 40 }} /></td>
                  </tr>
                ))}
              </tbody>
            ) : (
              days.map((day) => (
                <tbody key={day.key}>
                  <tr className="at-mv-dayhead">
                    <th scope="rowgroup" colSpan={6} id={`at-mv-day-${day.key}`}>
                      {dayHead(day.at)}
                      <span className="at-mv-day-n"> · {movesPhrase(day.rows.length)}</span>
                    </th>
                  </tr>
                  {day.rows.map((m) => {
                    const doc = m.document_id ? docById.get(m.document_id) : undefined;
                    const note = readNote(m.note);
                    return (
                      <Row
                        key={m.id}
                        m={m}
                        p={product(m.product_id)}
                        who={worker(m.worker_id)?.name}
                        route={routeOf(m, doc, note.customer)}
                        detail={m.external_name ? `בתעודה: ${m.external_name}` : note.rest}
                        doc={doc}
                        selected={m.id === selectedId}
                        onOpen={open}
                        onSpot={spotProduct}
                      />
                    );
                  })}
                </tbody>
              ))
            )}
          </table>
          {!isLoading && page.length === 0 ? empty : null}
          {page.length > 0 && (rest > 0 || hasFilters || isLoading) ? (
            <div className="at-table-foot">
              <span>{rest > 0 ? `${fmtQty(page.length)} מתוך ${fmtQty(visible.length)} תנועות` : movesPhrase(visible.length)}</span>
              {isLoading ? <span className="at-mv-wait-word">טוען תנועות ישנות יותר…</span> : null}
              {rest > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setShownFor({ key: filterKey, n: shown + PAGE_SIZE })}>
                  עוד {fmtQty(Math.min(PAGE_SIZE, rest))}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
