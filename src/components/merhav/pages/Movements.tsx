"use client";

/**
 * תנועות: the warehouse's memory. A timeline by day where the signed quantity leads every row, and over it a wave of the
 * whole period, in above the line and out below it, that is also the way through it: press a day and the list is there.
 * Every row replays on the model: the line goes where the goods went and the shelf answers. The filters are the shared
 * page's, word for word: the same ?period=, the same wait for החל, the same reads past the store's cap.
 */

import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement, type RefObject } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { DateRangeFilter, dayValue, HoursFilter } from "@/components/app/WhenFilters";
import { Button, cx, EmptyState, Icon, Notice, Select, Tabs, Toolbar, type SelectOption } from "@/components/ui";
import { fmtDate, fmtDayWord, fmtName, fmtQty, fmtSigned, fmtTime, MOVEMENT_LABEL } from "@/lib/format";
import { DISPATCH_ZONE, RECEIVING_ZONE, shelfAnchor, sideX } from "@/lib/map3d/layout";
import { resolvePlace } from "@/lib/map3d/place";
import { routeBetween } from "@/lib/map3d/route";
import type { MapObject, MapPoint, MapRoute, ShelfSide } from "@/lib/map3d/types";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { useData, type Movement as MovementRow, type MovementType, type Product } from "@/lib/store";
import { Figure } from "../Figure";
import { useTwin } from "../twin/Twin";

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

const COUNT_WORDS: Record<MovementType, readonly [string, string]> = {
  in: ["קליטה", "קליטות"],
  out: ["הוצאה", "הוצאות"],
  fault: ["תקלה", "תקלות"],
  adjust: ["תיקון ספירה", "תיקוני ספירה"],
};

const countWord = (type: MovementType, n: number) => COUNT_WORDS[type][n === 1 ? 0 : 1];

const TONE: Partial<Record<MovementType, string>> = { in: "mh-tone-in", out: "mh-tone-out" };

type Counts = Record<MovementType, number>;

const noCounts = (): Counts => ({ in: 0, out: 0, fault: 0, adjust: 0 });

/* ───────── the list as heights ───────── */

/** Every row and every day has one fixed height, so the place of anything in thousands of rows is a sum, not a measurement. */
const ROW = 66;
const HEAD = 54;
/** The air between one day and the next. */
const BREAK = 30;
/** Fewer rows a day than this and a head would cost more than the rows it names: found rows lie in one list, each with its date. */
const FEW_A_DAY = 1.6;
/** Scrolling re-renders only when a step is crossed. */
const STEP = 320;
/** Steps kept ready past each edge of the screen. */
const SPARE = 2;

interface DayBlock {
  key: string;
  /** The day's newest row stands for its date. */
  at: string;
  rows: MovementRow[];
  /** Index of its first row in the whole list. */
  start: number;
  top: number;
  /** Zero: no head, and the rows carry their own dates. */
  head: number;
  height: number;
  counts: Counts;
}

function layOut(rows: readonly MovementRow[]): { days: DayBlock[]; height: number } {
  const days: DayBlock[] = [];
  rows.forEach((m, i) => {
    const key = dayValue(Date.parse(m.created_at));
    let day = days[days.length - 1];
    if (day?.key !== key) {
      const top = day ? day.top + day.height + BREAK : 0;
      day = { key, at: m.created_at, rows: [], start: i, top, head: HEAD, height: HEAD, counts: noCounts() };
      days.push(day);
    }
    day.rows.push(m);
    day.height += ROW;
    day.counts[m.type] += 1;
  });
  if (rows.length > 0 && rows.length < days.length * FEW_A_DAY) {
    return { days: [{ ...days[0], rows: [...rows], head: 0, height: rows.length * ROW }], height: rows.length * ROW };
  }
  const last = days[days.length - 1];
  return { days, height: last ? last.top + last.height : 0 };
}

/** The last item whose start is at or before the value. */
function lastAtOrBefore<T>(items: readonly T[], value: number, start: (item: T) => number): number {
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (start(items[middle]) <= value) low = middle;
    else high = middle - 1;
  }
  return low;
}

const rowTop = (days: readonly DayBlock[], index: number): number => {
  const day = days[lastAtOrBefore(days, index, (d) => d.start)];
  return day ? day.top + day.head + (index - day.start) * ROW : 0;
};

/** Where to land for a row: the first of a day brings its head with it. */
const landing = (days: readonly DayBlock[], index: number): number => {
  const day = days[lastAtOrBefore(days, index, (d) => d.start)];
  return day?.start === index ? day.top : rowTop(days, index);
};

const rowAt = (days: readonly DayBlock[], y: number): number => {
  const day = days[lastAtOrBefore(days, y, (d) => d.top)];
  if (!day) return 0;
  return day.start + Math.min(Math.max(Math.floor((y - day.top - day.head) / ROW), 0), day.rows.length - 1);
};

function onScrolled(change: () => void): () => void {
  window.addEventListener("scroll", change, { passive: true });
  window.addEventListener("resize", change);
  return () => {
    window.removeEventListener("scroll", change);
    window.removeEventListener("resize", change);
  };
}

/* ───────── the wave ───────── */

const DAY_MS = 86_400_000;
/** More days than this read as weeks. */
const MOST_DAYS = 120;

type BarUnit = "hour" | "day" | "week";

interface Bar {
  /** When it starts, epoch ms. */
  start: number;
  in: number;
  out: number;
  other: number;
  /** The newest row at or before this bar, where pressing it lands. */
  row: number;
}

interface WaveData {
  bars: Bar[];
  unit: BarUnit;
  /** The bar of each row. */
  barOf: Int32Array;
  /** What fills one side of the line. */
  top: number;
}

/** Time runs left to right. One day reads by the hour, a season by the day, and anything longer by the week. */
function waveOf(rows: readonly MovementRow[], from: number | null, to: number | null): WaveData {
  const oldest = from ?? Date.parse(rows[rows.length - 1]?.created_at ?? new Date().toISOString());
  const newest = to === null ? Date.now() : to - 1;
  const firstDay = midnight(0, new Date(oldest));
  const days = Math.round((midnight(0, new Date(newest)) - firstDay) / DAY_MS) + 1;
  const unit: BarUnit = days === 1 ? "hour" : days <= MOST_DAYS ? "day" : "week";
  const size = unit === "week" ? 7 : 1;
  const count = unit === "hour" ? 24 : Math.ceil(days / size);
  const bars: Bar[] = Array.from({ length: count }, (_, i) => ({
    start: unit === "hour" ? firstDay + i * 3_600_000 : midnight(i * size, new Date(firstDay)),
    in: 0,
    out: 0,
    other: 0,
    row: -1,
  }));
  const barOf = new Int32Array(rows.length);
  rows.forEach((m, i) => {
    const t = new Date(m.created_at);
    const at = unit === "hour" ? t.getHours() : Math.floor(Math.round((midnight(0, t) - firstDay) / DAY_MS) / size);
    const index = Math.min(Math.max(at, 0), count - 1);
    const bar = bars[index];
    barOf[i] = index;
    if (bar.row < 0) bar.row = i;
    if (m.type === "in") bar.in += 1;
    else if (m.type === "out") bar.out += 1;
    else bar.other += 1;
  });
  // An empty bar lands on the first thing older than it.
  let seen = rows.length - 1;
  for (const bar of bars) {
    if (bar.row < 0) bar.row = seen;
    else seen = bar.row;
  }
  // A stocktake can hold a day's two hundred corrections, and it must not flatten the months around it.
  const flow = bars.reduce((most, bar) => Math.max(most, bar.in, bar.out), 0);
  const top = flow > 0 ? flow : bars.reduce((most, bar) => Math.max(most, bar.other), 1);
  return { bars, unit, barOf, top };
}

/** How far a bar reaches from the line. A single movement still shows. */
const reach = (n: number, top: number) => (n > 0 ? Math.min(Math.max(n / top, 0.09), 1) : 0);

function barWhen(bar: Bar, unit: BarUnit): string {
  const iso = new Date(bar.start).toISOString();
  if (unit === "hour") return fmtTime(iso);
  if (unit === "day") return fmtDayWord(iso);
  return `${fmtDate(iso)} – ${fmtDate(new Date(midnight(6, new Date(bar.start))).toISOString())}`;
}

function axisOf(wave: WaveData): { at: number; word: string }[] {
  const count = wave.bars.length;
  if (wave.unit === "hour") return [0, 6, 12, 18, 24].map((h) => ({ at: h / 24, word: String(h).padStart(2, "0") }));
  return [0, 0.25, 0.5, 0.75, 1].map((at) => ({ at, word: fmtDayWord(new Date(wave.bars[Math.round(at * (count - 1))].start).toISOString()) }));
}

function Wave({ wave, days, list, band, onJump, onSpot }: {
  wave: WaveData;
  days: readonly DayBlock[];
  list: RefObject<HTMLDivElement | null>;
  band: RefObject<HTMLDivElement | null>;
  onJump: (row: number) => void;
  onSpot: (bar: number | null) => void;
}): ReactElement {
  const strip = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState<number | null>(null);
  const count = wave.bars.length;

  // The carriage rides to the day at the top of the list.
  const current = useSyncExternalStore(
    onScrolled,
    () => {
      const top = list.current?.getBoundingClientRect().top ?? 0;
      const y = (band.current?.offsetHeight ?? 0) - top;
      return wave.barOf[rowAt(days, y)] ?? count - 1;
    },
    () => count - 1,
  );

  const barAt = (x: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return Math.min(Math.max(Math.floor(((x - box.left) / box.width) * count), 0), count - 1);
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const bar = barAt(e.clientX);
    if (bar !== peek) {
      setPeek(bar);
      onSpot(bar);
    }
    if (e.buttons === 1) onJump(wave.bars[bar].row);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onJump(wave.bars[barAt(e.clientX)].row);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (step) {
      let next = current + step;
      while (next > 0 && next < count - 1 && wave.bars[next].in + wave.bars[next].out + wave.bars[next].other === 0) next += step;
      onJump(wave.bars[Math.min(Math.max(next, 0), count - 1)].row);
    } else if (e.key === "Home") onJump(wave.bars[0].row);
    else if (e.key === "End") onJump(wave.bars[count - 1].row);
    else return;
    e.preventDefault();
  };

  const shown = peek === null ? null : wave.bars[peek];
  const shownWhen = (bar: Bar) => {
    const parts = [
      bar.in > 0 ? `${fmtQty(bar.in)} ${countWord("in", bar.in)}` : "",
      bar.out > 0 ? `${fmtQty(bar.out)} ${countWord("out", bar.out)}` : "",
      bar.other > 0 ? `${fmtQty(bar.other)} אחרות` : "",
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "אין תנועות";
  };

  return (
    <div ref={band} className="mh-mv-band">
      <div
        ref={strip}
        className="mh-wave"
        dir="ltr"
        role="slider"
        tabIndex={0}
        aria-label="מעבר לתאריך"
        aria-valuemin={0}
        aria-valuemax={count - 1}
        aria-valuenow={current}
        aria-valuetext={barWhen(wave.bars[current], wave.unit)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerLeave={() => {
          setPeek(null);
          onSpot(null);
        }}
        onKeyDown={onKey}
      >
        {wave.bars.map((bar) => (
          <span key={bar.start} className="mh-wave-bar" style={{ "--in": reach(bar.in + bar.other, wave.top), "--part": bar.in + bar.other > 0 ? bar.in / (bar.in + bar.other) : 1, "--out": reach(bar.out, wave.top) } as CSSProperties}>
            <i />
            <b />
          </span>
        ))}
        {peek === null ? null : <i className="mh-wave-peekline" style={{ "--x": (peek + 0.5) / count } as CSSProperties} aria-hidden="true" />}
        <i className="mh-wave-at" style={{ "--x": current, "--n": count } as CSSProperties} aria-hidden="true" />
      </div>
      <div className="mh-wave-axis" dir="ltr" aria-hidden="true">
        {shown ? (
          <span className="mh-wave-peek" dir="rtl" style={{ "--x": ((peek ?? 0) + 0.5) / count } as CSSProperties}>
            <b>{barWhen(shown, wave.unit)}</b> {shownWhen(shown)}
          </span>
        ) : (
          axisOf(wave).map((mark) => <span key={mark.at} style={{ "--x": mark.at } as CSSProperties}>{mark.word}</span>)
        )}
      </div>
    </div>
  );
}

/* ───────── one row ───────── */

interface RowProps {
  m: MovementRow;
  index: number;
  total: number;
  top: number;
  /** Stands with the row above it: one document at one moment. */
  joined: boolean;
  /** No day head above it, so it says its own day. */
  dated: boolean;
  at: boolean;
  selected: boolean;
  p: Product | undefined;
  who: string | undefined;
  source: string | undefined;
  place: string | null;
  /** The movement recorded this place, rather than the product standing there now. */
  recorded: boolean;
}

const Row = memo(function Row({ m, index, total, top, joined, dated, at, selected, p, who, source, place, recorded }: RowProps): ReactElement {
  const paper = [source, m.reference].filter(Boolean).join(" · ");
  const detail = m.external_name ? `בתעודה: ${m.external_name}` : m.note;
  const line = [paper, detail].filter(Boolean).join(" · ");
  return (
    <div
      id={`mv-${m.id}`}
      role="option"
      aria-selected={selected}
      aria-posinset={index + 1}
      aria-setsize={total}
      data-i={index}
      className={cx("mh-mv-row", joined && "is-joined", at && "is-at", selected && "is-selected")}
      style={{ top }}
    >
      <span className="mh-mv-time">
        {dated ? <span className="mh-mv-date ltr">{fmtDayWord(m.created_at)}</span> : null}
        <span className="ltr">{fmtTime(m.created_at)}</span>
      </span>
      <span className="mh-mv-fig">
        <span className="mh-mv-n">
          <span className={cx("ltr", TONE[m.type])}>{fmtSigned(m.qty, m.type)}</span>
          {p ? <small>{p.unit}</small> : null}
        </span>
        <span className="mh-mv-word">
          <span className={m.type === "fault" ? "mh-tone-out" : undefined}>{MOVEMENT_LABEL[m.type]}</span>
          {m.exit_pass ? <span className="mh-tone-warn"> בלי קבלה</span> : null}
        </span>
      </span>
      <ProductThumb product={p} />
      <span className="mh-row-main">
        <span className="mh-row-title" title={p?.name}>{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
        <span className="mh-row-sub" title={line || undefined}>
          {p ? <span className="ltr">{p.sku}</span> : null}
          <span className="mh-mv-inline">{p && line ? " · " : null}<bdi>{line}</bdi></span>
        </span>
      </span>
      <span className="mh-mv-paper" title={line || undefined}>
        <bdi>{paper}</bdi>
        <bdi>{detail}</bdi>
      </span>
      <span className="mh-mv-where">
        <span title={place && !recorded ? "המיקום הנוכחי של המוצר" : undefined} className={cx(recorded && "is-recorded")}>
          {place ? <span className="ltr">{place}</span> : "ללא מיקום"}
        </span>
        <span title={who} className="mh-mv-who">{who ?? "—"}</span>
      </span>
    </div>
  );
});

/* ───────── one day ───────── */

const weekdayFmt = new Intl.DateTimeFormat("he-IL", { weekday: "long" });

interface DayProps {
  day: DayBlock;
  index: number;
  /** The rows of this day on screen. */
  first: number;
  last: number;
  total: number;
  cursorId: string | null;
  openedId: string | null;
  product: (id: string) => Product | undefined;
  worker: (id: string | null | undefined) => { name: string } | undefined;
  supplier: (id: string | null | undefined) => { name: string } | undefined;
  placeOfRow: (m: MovementRow) => { code: string; recorded: boolean } | null;
}

const sameMoment = (a: MovementRow, b: MovementRow) => a.type === b.type && a.reference !== null && a.reference === b.reference && fmtTime(a.created_at) === fmtTime(b.created_at);

const Day = memo(function Day({ day, index, first, last, total, cursorId, openedId, product, worker, supplier, placeOfRow }: DayProps): ReactElement {
  const word = fmtDayWord(day.at);
  const weekday = weekdayFmt.format(new Date(day.at));
  const headId = `mv-day-${day.key}`;
  const sum = MOVEMENT_TYPES.filter((type) => day.counts[type] > 0);
  const headed = day.head > 0;
  return (
    <section className={cx("mh-mv-day", !headed && "is-flat")} role="group" aria-labelledby={headed ? headId : undefined} aria-label={headed ? undefined : "תנועות שנמצאו"} style={{ top: day.top, height: day.height }}>
      {headed ? (
        <header id={headId} className="mh-mv-dayhead" data-day={index}>
          <h2>{word}</h2>
          <span className="mh-mv-weekday">{weekday}</span>
          <span className="mh-mv-daysum">
            {sum.map((type) => (
              <span key={type}><span className={cx("ltr", TONE[type])}>{fmtQty(day.counts[type])}</span> {countWord(type, day.counts[type])}</span>
            ))}
          </span>
        </header>
      ) : null}
      {day.rows.slice(first, last).map((m, i) => {
        const at = first + i;
        const place = placeOfRow(m);
        const before = day.rows[at - 1];
        return (
          <Row
            key={m.id}
            m={m}
            index={day.start + at}
            total={total}
            top={day.head + at * ROW}
            joined={Boolean(before && sameMoment(before, m))}
            dated={!headed}
            at={m.id === cursorId}
            selected={m.id === openedId}
            p={product(m.product_id)}
            who={worker(m.worker_id)?.name}
            source={supplier(m.supplier_id)?.name}
            place={place?.code ?? null}
            recorded={place?.recorded ?? false}
          />
        );
      })}
    </section>
  );
});

/* ───────── the timeline ───────── */

function Timeline({ rows, days, height, list, band, openedId, placeOfRow, onPoint, onDay, onOpen }: {
  rows: readonly MovementRow[];
  days: readonly DayBlock[];
  height: number;
  list: RefObject<HTMLDivElement | null>;
  band: RefObject<HTMLDivElement | null>;
  openedId: string | null;
  placeOfRow: DayProps["placeOfRow"];
  onPoint: (m: MovementRow | null) => void;
  onDay: (day: DayBlock | null) => void;
  onOpen: (m: MovementRow) => void;
}): ReactElement {
  const { product, worker, supplier } = useData();
  const [cursorId, setCursorId] = useState<string | null>(null);
  const cursor = useMemo(() => (cursorId ? rows.findIndex((m) => m.id === cursorId) : -1), [rows, cursorId]);

  // A movement landing at the top leaves what is being read further down where it was.
  const newest = useRef({ id: rows[0]?.id, top: rowTop(days, 0) });
  useLayoutEffect(() => {
    const before = newest.current;
    newest.current = { id: rows[0]?.id, top: rowTop(days, 0) };
    if (before.id === rows[0]?.id) return;
    const index = rows.findIndex((m) => m.id === before.id);
    const box = list.current?.getBoundingClientRect();
    if (index > 0 && box && box.top < 0) window.scrollBy({ top: rowTop(days, index) - before.top, behavior: "instant" });
  }, [rows, days, list]);

  const span = useSyncExternalStore(
    onScrolled,
    () => {
      const top = list.current?.getBoundingClientRect().top ?? 0;
      return `${Math.floor(-top / STEP)} ${Math.ceil((window.innerHeight - top) / STEP)}`;
    },
    () => "0 4",
  );
  const [firstStep, lastStep] = span.split(" ").map(Number);
  const from = (firstStep - SPARE) * STEP;
  const to = (lastStep + SPARE) * STEP;

  const firstDay = lastAtOrBefore(days, from, (d) => d.top);
  const lastDay = lastAtOrBefore(days, to, (d) => d.top);
  const shown = days.slice(firstDay, lastDay + 1);

  /* ───────── a mouse needs one listener, however long the list ───────── */
  const onPointerOver = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !(e.target instanceof Element)) return;
    const row = e.target.closest<HTMLElement>("[data-i]");
    if (row) {
      onDay(null);
      onPoint(rows[Number(row.dataset.i)] ?? null);
      return;
    }
    const head = e.target.closest<HTMLElement>("[data-day]");
    onPoint(null);
    onDay(head ? (days[Number(head.dataset.day)] ?? null) : null);
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target instanceof Element)) return;
    const row = e.target.closest<HTMLElement>("[data-i]");
    if (!row) return;
    const m = rows[Number(row.dataset.i)];
    setCursorId(m.id);
    onOpen(m);
  };

  /* ───────── the keyboard walks the rows, and the model walks with it ───────── */
  const walk = (next: number) => {
    const index = Math.min(Math.max(next, 0), rows.length - 1);
    setCursorId(rows[index]?.id ?? null);
    onPoint(rows[index] ?? null);
    const box = list.current?.getBoundingClientRect();
    if (!box) return;
    const sticky = (band.current?.offsetHeight ?? 0) + (days[0]?.head ?? 0);
    const y = rowTop(days, index) + box.top;
    if (y < sticky) window.scrollBy({ top: y - sticky, behavior: "instant" });
    else if (y + ROW > window.innerHeight) window.scrollBy({ top: y + ROW - window.innerHeight + 12, behavior: "instant" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const pageRows = Math.max(Math.floor(window.innerHeight / ROW) - 3, 1);
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: pageRows, PageUp: -pageRows };
    if (e.key === "Enter") {
      if (cursor >= 0 && rows[cursor]) onOpen(rows[cursor]);
    } else if (e.key === "Home") walk(0);
    else if (e.key === "End") walk(rows.length - 1);
    else if (moves[e.key]) {
      const box = list.current?.getBoundingClientRect();
      const inView = box ? rowAt(days, (band.current?.offsetHeight ?? 0) + (days[0]?.head ?? 0) - box.top) : 0;
      walk(cursor < 0 ? inView : cursor + moves[e.key]);
    } else return;
    e.preventDefault();
  };

  return (
    <div
      ref={list}
      className="mh-mv-list"
      role="listbox"
      tabIndex={0}
      aria-label="תנועות לפי יום"
      aria-activedescendant={cursor >= 0 && rows[cursor] ? `mv-${rows[cursor].id}` : undefined}
      style={{ height }}
      onPointerOver={onPointerOver}
      onPointerLeave={() => {
        onPoint(null);
        onDay(null);
      }}
      onBlur={() => onPoint(null)}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {shown.map((day, i) => {
        const firstRow = Math.min(Math.max(Math.floor((from - day.top - day.head) / ROW), 0), day.rows.length);
        const lastRow = Math.min(Math.max(Math.ceil((to - day.top - day.head) / ROW), 0), day.rows.length);
        return (
          <Day
            key={day.key}
            day={day}
            index={firstDay + i}
            first={firstRow}
            last={lastRow}
            total={rows.length}
            cursorId={cursorId}
            openedId={openedId}
            product={product}
            worker={worker}
            supplier={supplier}
            placeOfRow={placeOfRow}
          />
        );
      })}
    </div>
  );
}

/* ───────── the movement on the model ───────── */

/** The aisle a forklift works a rack from. */
const AISLE = 1.2;
/** How the engine writes where an anchor stands. */
const PLACED = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/;

interface Replayed {
  id: string;
  /** Where the goods stood, on the front of their shelf. */
  shelf: { x: number; y: number; z: number };
  /** Along the floor, in the direction the goods went. Null when they went nowhere. */
  route: MapRoute | null;
  /** A movement, or a whole rack under the pointer. */
  kind: MovementType | "rack";
  place: string;
  figure: string;
}

const routes = new WeakMap<readonly MapObject[], Map<string, MapRoute | null>>();

/** Along the aisles between a zone and the front of a place. Worked out once for each, because a route is a search of the floor. */
function routeOf(objects: readonly MapObject[], type: MovementType, object: MapObject, side: ShelfSide | null): MapRoute | null {
  if (type !== "in" && type !== "out") return null;
  const known = routes.get(objects) ?? new Map<string, MapRoute | null>();
  routes.set(objects, known);
  const key = `${type} ${object.id} ${side}`;
  const route = known.get(key);
  if (route !== undefined) return route;
  const aisle: MapPoint = [sideX(object, side), object.z + object.d / 2 + AISLE];
  const points = type === "in" ? routeBetween(objects, RECEIVING_ZONE, aisle) : routeBetween(objects, aisle, DISPATCH_ZONE);
  const next = points.length > 1 ? { points, tone: type } : null;
  known.set(key, next);
  return next;
}

/** Where a shelf is reached from, or the top of what has no shelf. */
function shelfOf(object: MapObject, level: number | null, side: ShelfSide | null): Replayed["shelf"] {
  return level === null ? { x: object.x, y: object.h, z: object.z + object.d / 2 } : shelfAnchor(object, level, side);
}

/**
 * The line of one movement, over the model and under the door. A floor line is hidden wherever a rack stands before it,
 * so this one runs through the same corners and on up to the shelf: faint over the floor line, where that shows, and
 * the only trace of it behind a rack. The corners are anchors the engine keeps glued to the floor, and a node with no
 * place in the page is enough for that: the engine only writes its transform.
 */
function ReplayLine({ shown }: { shown: Replayed | null }): ReactElement | null {
  const { world, setAnchors } = useTwin();
  const line = useRef<SVGPathElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const tag = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shown) return;
    const points = shown.route?.points ?? [];
    const floor = points.map(([x, z]) => ({ el: document.createElement("i"), x, y: 0, z }));
    const end = { el: document.createElement("i"), ...shown.shelf };
    // Goods come in along the floor and climb to the shelf, or leave it and go along the floor.
    const corners = shown.kind === "out" ? [end, ...floor] : [...floor, end];
    const draw = () => {
      const placed = corners.map(({ el }) => PLACED.exec(el.style.transform));
      if (placed.some((at) => !at)) return;
      if (floor.length > 0) line.current?.setAttribute("d", `M${placed.map((at) => `${at?.[1]} ${at?.[2]}`).join(" L")}`);
      const shelf = PLACED.exec(end.el.style.transform);
      ring.current?.setAttribute("cx", shelf?.[1] ?? "0");
      ring.current?.setAttribute("cy", shelf?.[2] ?? "0");
    };
    const watcher = new MutationObserver(draw);
    watcher.observe(end.el, { attributes: true, attributeFilter: ["style"] });
    setAnchors([...corners, ...(tag.current ? [{ el: tag.current, ...shown.shelf }] : [])]);
    draw();
    return () => {
      watcher.disconnect();
      setAnchors([]);
    };
  }, [shown, setAnchors]);

  if (!world || !shown) return null;
  return createPortal(
    <div key={shown.id} className={cx("mh-replay", `is-${shown.kind}`)} aria-hidden="true">
      <svg>
        {shown.route ? <path ref={line} pathLength={1} /> : null}
        {shown.kind === "rack" ? null : <circle ref={ring} r={3.5} />}
      </svg>
      <div ref={tag} className="mh-tag">
        <span className="mh-tag-body">
          <span className="mh-tag-code ltr">{shown.place}</span>
          <span className={shown.kind === "rack" ? undefined : cx("ltr", TONE[shown.kind])}>{shown.figure}</span>
        </span>
      </div>
    </div>,
    world,
  );
}

/* ───────── the page ───────── */


/** Stopping on a row draws it; passing over rows only lights their shelves. */
const DWELL_MS = 130;
/** How long the engine takes to draw a line along the floor. */
const DRAWN_MS = 640;

const NO_ROUTES: readonly MapRoute[] = [];

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
  const { engine, objects, itemsOf, placeOf, spotObjects, setPageRoutes, listen } = useTwin();

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

  const typeOptions = useMemo<SelectOption[]>(() => MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_LABEL[t] })), []);

  const supplierOptions = useMemo<SelectOption[]>(() => state.suppliers.map((s) => ({ value: s.id, label: s.name })), [state.suppliers]);

  const categories = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const p of state.products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [state.products]);

  /* ───────── where a movement happened ───────── */
  // A receipt says which shelf it went to. Everything else stands where the product stands, the same rule the model moves by.
  const placeOfRow = useCallback(
    (m: MovementRow) => {
      if (m.place) return { code: m.place, recorded: true };
      const item = itemsOf(m.product_id)[0];
      const home = item?.place ?? product(m.product_id)?.location;
      return home ? { code: home, recorded: false } : null;
    },
    [itemsOf, product],
  );

  const objectOf = useCallback((m: MovementRow) => resolvePlace(m.place, objects)?.objectId ?? placeOf(m.product_id), [objects, placeOf]);

  /* ───────── filtering ───────── */
  const q = query.trim().toLowerCase();

  const listed = useMemo(() => {
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

  // The model is a filter too: pressing a rack keeps what happened there, at once, like a tab.
  const [rack, setRack] = useState<string | null>(null);
  const visible = useMemo(() => (rack ? listed.filter((m) => objectOf(m) === rack) : listed), [listed, rack, objectOf]);

  const moved = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of listed) {
      const objectId = objectOf(m);
      if (objectId) counts.set(objectId, (counts.get(objectId) ?? 0) + 1);
    }
    return counts;
  }, [listed, objectOf]);

  const hasFilters = period !== DEFAULT_PERIOD || q !== "" || rack !== null || differs(chosen, { ...chosen, ...NO_FILTERS });
  const narrowed = q !== "" || differs(applied, { ...applied, ...NO_FILTERS }) || (period !== DEFAULT_PERIOD && period !== "all");

  const clearFilters = () => {
    setQuery("");
    setRack(null);
    applyNow({ ...chosen, ...NO_FILTERS }, DEFAULT_PERIOD);
  };

  const empty =
    state.movements.length === 0 ? (
      <EmptyState title="אין תנועות" hint="קליטה או הוצאה ראשונה תופיע כאן">
        <Button variant="secondary" onClick={() => ui.openAction("receive")}>קליטת סחורה</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState title="לא נמצאו תנועות" hint={<>עבור <span className="ltr">„{query.trim()}”</span></>} />
    ) : (
      <EmptyState title="לא נמצאו תנועות" hint="אפשר להסיר את הסינון" />
    );

  /* ───────── the list ───────── */
  const list = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const { days, height } = useMemo(() => layOut(visible), [visible]);
  const wave = useMemo(() => waveOf(visible, from, to), [visible, from, to]);
  const totals = useMemo(() => {
    const counts = noCounts();
    for (const m of visible) counts[m.type] += 1;
    return counts;
  }, [visible]);

  const jump = useCallback(
    (row: number) => {
      const box = list.current?.getBoundingClientRect();
      if (!box) return;
      window.scrollTo({ top: box.top + window.scrollY + landing(days, row) - (band.current?.offsetHeight ?? 0) + 1, behavior: "instant" });
    },
    [days],
  );

  /* ───────── a row replays on the model ───────── */
  const [replayed, setReplayed] = useState<Replayed | null>(null);

  const panelOpen = useRef(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const drawn = useRef(false);
  const pointed = useRef<string | null>(null);

  /** What the model holds when nothing is pointed at: the pressed rack, or all of it. */
  const spotRack = useCallback(() => {
    if (rack) spotObjects([rack], { objectId: rack, level: null });
    else spotObjects(null);
  }, [rack, spotObjects]);

  // While a drawer stands open the shelf is its own, and it comes back with the drawer closed.
  useEffect(() => {
    panelOpen.current = ui.panel !== null;
    if (!ui.panel) spotRack();
  }, [ui.panel, spotRack]);

  const replay = useCallback(
    (m: MovementRow | null) => {
      if ((m?.id ?? null) === pointed.current) return;
      pointed.current = m?.id ?? null;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
      if (panelOpen.current) return;
      setReplayed(null);
      if (drawn.current) {
        drawn.current = false;
        setPageRoutes(NO_ROUTES);
      }
      const item = m ? itemsOf(m.product_id)[0] : undefined;
      const at = m ? (resolvePlace(m.place, objects) ?? item) : undefined;
      const object = at ? objects.find((o) => o.id === at.objectId) : undefined;
      if (!m || !at || !object) {
        spotRack();
        return;
      }
      // One row, one place: passing over it lights the shelf at once, and the line waits for a stop.
      spotObjects([at.objectId], { objectId: at.objectId, level: at.level, side: at.side });
      const route = routeOf(objects, m.type, object, at.side);
      timers.current.push(
        setTimeout(() => {
          setReplayed({ id: m.id, shelf: shelfOf(object, at.level, at.side), route, kind: m.type, place: m.place ?? item?.place ?? object.id, figure: fmtSigned(m.qty, m.type) });
          if (route) engine?.trace(route);
        }, DWELL_MS),
      );
      if (route) {
        timers.current.push(
          setTimeout(() => {
            drawn.current = true;
            setPageRoutes([route]);
          }, DWELL_MS + DRAWN_MS),
        );
      }
    },
    [engine, itemsOf, objects, setPageRoutes, spotObjects, spotRack],
  );

  const spotRows = useCallback(
    (part: readonly MovementRow[] | null) => {
      if (panelOpen.current) return;
      const ids = part?.flatMap((m) => objectOf(m) ?? []) ?? [];
      if (ids.length > 0) spotObjects([...new Set(ids)]);
      else spotRack();
    },
    [objectOf, spotObjects, spotRack],
  );

  const onSpotDay = useCallback((day: DayBlock | null) => spotRows(day?.rows ?? null), [spotRows]);

  const onSpotBar = useCallback(
    (bar: number | null) => {
      if (bar === null) return spotRows(null);
      spotRows(visible.filter((_, i) => wave.barOf[i] === bar));
    },
    [spotRows, visible, wave],
  );

  const [openedId, setOpenedId] = useState<string | null>(null);
  const open = useCallback(
    (m: MovementRow) => {
      replay(null);
      setOpenedId(m.id);
      ui.openProduct(m.product_id, "history");
    },
    [replay, ui],
  );

  // The floor belongs to the past here: today's worries step off it, and only the movement in hand is drawn.
  useEffect(() => {
    setPageRoutes(NO_ROUTES);
    return () => setPageRoutes(null);
  }, [setPageRoutes]);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      spotObjects(null);
    },
    [spotObjects],
  );

  // A narrowed list lights the floor under where it happened. The whole month, on every rack, would say nothing.
  useEffect(() => {
    if (!engine) return;
    const most = Math.max(...moved.values(), 1);
    engine.setFootprints(narrowed && moved.size > 0 ? [...moved].map(([objectId, n]) => ({ objectId, strength: Math.sqrt(n / most) })) : null);
  }, [engine, moved, narrowed]);

  useEffect(() => () => engine?.setFootprints(null), [engine]);

  // The model takes part: a rack under the pointer says what the list holds there, and pressing it keeps only that.
  useEffect(
    () =>
      listen({
        onPick: (hit) => {
          const stock = objects.find((o) => o.id === hit?.objectId && (o.kind === "rack" || o.kind === "floor"));
          setRack((current) => (stock && stock.id !== current ? stock.id : null));
        },
        onHover: (hit) => {
          const object = objects.find((o) => o.id === hit?.objectId && (o.kind === "rack" || o.kind === "floor"));
          if (pointed.current || panelOpen.current) return;
          const n = object ? (moved.get(object.id) ?? 0) : 0;
          setReplayed(object ? { id: `rack ${object.id}`, shelf: { x: object.x, y: object.h, z: object.z }, route: null, kind: "rack", place: object.id, figure: `${fmtQty(n)} ${n === 1 ? "תנועה" : "תנועות"}` } : null);
        },
      }),
    [listen, objects, moved],
  );

  const showing = visible.length > 0;
  const sums = MOVEMENT_TYPES.filter((type) => totals[type] > 0);

  return (
    <div className="mh-mv">
      <header className="mh-mv-head">
        <h1 className="sa-page-title">תנועות</h1>
        {isLoading ? null : <Figure className="mh-mv-count" text={fmtQty(visible.length)} label={`${fmtQty(visible.length)} תנועות`} />}
        <dl className="mh-mv-sums">
          {isLoading
            ? null
            : sums.map((type) => (
                <div key={type}>
                  <dd className={cx("ltr", TONE[type])}>{fmtQty(totals[type])}</dd>
                  <dt>{countWord(type, totals[type])}</dt>
                </div>
              ))}
        </dl>
      </header>

      <Toolbar
        tabs={<Tabs tabs={PERIODS} value={period} onChange={choosePeriod} />}
        query={query}
        onQuery={setQuery}
        placeholder='חיפוש לפי מוצר, מק"ט או תעודה'
      />

      {failed ? (
        <Notice tone="danger" title="התנועות הישנות לא נטענו" action="ניסיון נוסף" onAction={retry}>
          מוצגות רק התנועות האחרונות
        </Notice>
      ) : null}

      <div className={cx("sa-moves", refreshing && "is-refreshing")} data-settle={settled ? settled % 2 : undefined}>
        <div className="app-filters">
          {rack ? (
            <button type="button" className="mh-mv-rack" title="הסרת הסינון לפי מיקום" onClick={() => setRack(null)}>
              <span className="ltr">{rack}</span>
              <Icon name="x" size={13} />
            </button>
          ) : null}
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

        {showing ? <Wave wave={wave} days={days} list={list} band={band} onJump={jump} onSpot={onSpotBar} /> : null}

        {showing ? (
          <Timeline
            key={`${from}|${to}|${applied.fromTime}|${applied.toTime}|${applied.workerId}|${applied.moveType}|${applied.supplierId}|${applied.category}|${q}|${rack}`}
            rows={visible}
            days={days}
            height={height}
            list={list}
            band={band}
            openedId={ui.panel ? openedId : null}
            placeOfRow={placeOfRow}
            onPoint={replay}
            onDay={onSpotDay}
            onOpen={open}
          />
        ) : isLoading ? (
          <div className="mh-mv-wait"><span className="sa-skeleton" /></div>
        ) : (
          empty
        )}
        {showing && isLoading ? <div className="mh-mv-wait"><span className="sa-skeleton" /></div> : null}
      </div>

      <ReplayLine shown={replayed} />
    </div>
  );
}
