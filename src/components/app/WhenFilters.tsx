"use client";

/**
 * The "when" filters of a list: a calendar for days and a board for hours. Each is a word in the filter row that opens
 * one floating sheet, where a range is drawn by pointing at its two ends. Nothing counts until החל.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import { Button, cx, Icon, type IconName } from "@/components/ui";
import "./when-filters.css";

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

/** Two months need this much window; below it one month shows at a time. */
const TWO_MONTHS = "(min-width: 1180px)";

/** Arrow keys walk the days in the order they are drawn, right to left. */
const DAY_KEYS: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 };

/* ───────── days ───────── */

/** A day is its yyyy-mm-dd: it sorts as text and carries no time zone. */
export function dayValue(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const toDate = (day: string) => new Date(`${day}T00:00`);

function shiftDay(day: string, days: number): string {
  const d = toDate(day);
  d.setDate(d.getDate() + days);
  return dayValue(d.getTime());
}

/** Months are counted from year zero, so the one before January needs no special case. */
const monthOf = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
const firstOf = (month: number) => dayValue(new Date(Math.floor(month / 12), month % 12, 1).getTime());
const lastOf = (month: number) => dayValue(new Date(Math.floor(month / 12), month % 12 + 1, 0).getTime());

function dayWords(day: string, withYear = false): string {
  const d = toDate(day);
  return `${d.getDate()} ב${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;
}

/** "5–12 בנובמבר", "25 באוקטובר – 2 בנובמבר"; a year only when it isn't this one. */
function rangeWords(from: string, to: string): string {
  const [fromYear, toYear] = [from.slice(0, 4), to.slice(0, 4)];
  const otherYear = toYear !== String(new Date().getFullYear());
  if (from === to) return dayWords(to, otherYear);
  if (monthOf(from) === monthOf(to)) return `${Number(from.slice(8))}–${dayWords(to, otherYear)}`;
  return `${dayWords(from, fromYear !== toYear)} – ${dayWords(to, otherYear || fromYear !== toYear)}`;
}

function dayCount(from: string, to: string): string {
  const days = Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;
  if (days === 1) return "יום אחד";
  if (days === 2) return "יומיים";
  return `${days} ימים`;
}

/** Calendar spans, which the list's tabs can't give: those count back from today. A week starts on Sunday. */
function presets(today: string) {
  const sunday = shiftDay(today, -toDate(today).getDay());
  const month = monthOf(today);
  return [
    { label: "השבוע", from: sunday, to: today },
    { label: "השבוע שעבר", from: shiftDay(sunday, -7), to: shiftDay(sunday, -1) },
    { label: "החודש", from: firstOf(month), to: today },
    { label: "החודש שעבר", from: firstOf(month - 1), to: lastOf(month - 1) },
    { label: "3 חודשים", from: firstOf(month - 2), to: today },
    { label: "השנה", from: firstOf(month - month % 12), to: today },
  ];
}

/* ───────── the filter itself ───────── */

/** The way out of a sheet, which hands the keyboard back to the word that opened it. */
function useCloseSheet(onOpenChange: (open: boolean) => void) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    onOpenChange(false);
    triggerRef.current?.focus();
  }, [onOpenChange]);
  return { triggerRef, close };
}

/** A word in the row, the shape of the menus beside it, and the sheet it opens. */
function WhenFilter({ icon, title, value, placeholder, className, open, onOpenChange, triggerRef, close, children }: {
  icon: IconName;
  title: string;
  value: string | null;
  placeholder?: string;
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  close: () => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    // A short window would leave החל below the fold.
    sheetRef.current?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open, onOpenChange]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (open && e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div ref={rootRef} className={cx("sa-select app-when", className)} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cx("sa-select-trigger", open && "is-open")}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name={icon} size={15} strokeWidth={1.75} />
        <span className={cx("sa-select-value", !value && "is-placeholder")}>{value ?? placeholder}</span>
        <Icon name="chevron-down" size={14} className="sa-select-chevron" />
      </button>
      {open ? (
        <div ref={sheetRef} className="sa-menu app-when-sheet" role="dialog" aria-label={title}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ───────── days ───────── */

export function DateRangeFilter({ from, to, open, onOpenChange, onApply }: {
  from: string;
  to: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (from: string, to: string) => void;
}): ReactElement {
  const { triggerRef, close } = useCloseSheet(onOpenChange);
  return (
    <WhenFilter
      icon="calendar"
      title="בחירת תאריכים"
      value={rangeWords(from, to)}
      className="app-when-dates"
      open={open}
      onOpenChange={onOpenChange}
      triggerRef={triggerRef}
      close={close}
    >
      <Calendar
        from={from}
        to={to}
        onCancel={close}
        onApply={(first, last) => {
          close();
          onApply(first, last);
        }}
      />
    </WhenFilter>
  );
}

function Calendar({ from, to, onCancel, onApply }: {
  from: string;
  to: string;
  onCancel: () => void;
  onApply: (from: string, to: string) => void;
}) {
  const [today] = useState(() => dayValue(Date.now()));
  const [twoMonths] = useState(() => window.matchMedia(TWO_MONTHS).matches);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to); // empty while the second end is still to come
  const [hover, setHover] = useState("");
  const [latest, setLatest] = useState(() => monthOf(to)); // the last month on show
  const [focused, setFocused] = useState(to);
  const daysRef = useRef<HTMLDivElement>(null);

  // The arrow keys move a roving focus, and it can land in a month that has only just come on show.
  useEffect(() => {
    daysRef.current?.querySelector<HTMLElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused]);

  const months = twoMonths ? [latest - 1, latest] : [latest];
  const list = presets(today);

  const other = end || hover;
  const [low, high] = other && other < start ? [other, start] : [start, other || start];

  const show = (day: string) => {
    const month = monthOf(day);
    if (!months.includes(month)) setLatest(month);
  };

  const pick = (day: string) => {
    setFocused(day);
    setHover("");
    if (end) {
      setStart(day);
      setEnd("");
    } else if (day < start) {
      setStart(day);
      setEnd(start);
    } else {
      setEnd(day);
    }
  };

  const onDayKey = (e: KeyboardEvent<HTMLButtonElement>, day: string) => {
    const step = DAY_KEYS[e.key];
    if (!step) return;
    e.preventDefault();
    const next = shiftDay(day, step);
    if (next > today) return;
    show(next);
    setFocused(next);
  };

  return (
    <div className="app-when-calendar">
      <div className="app-when-presets">
        {list.map((p) => (
          <button
            key={p.label}
            type="button"
            className={cx("app-when-preset", p.from === start && p.to === end && "is-on")}
            onClick={() => {
              setStart(p.from);
              setEnd(p.to);
              setHover("");
              setLatest(monthOf(p.to));
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="app-when-months" ref={daysRef} onMouseLeave={() => setHover("")}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="chevron-right"
          title="החודש הקודם"
          className="app-when-prev"
          onClick={() => setLatest((m) => m - 1)}
        />
        {latest < monthOf(today) ? (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="chevron-left"
            title="החודש הבא"
            className="app-when-next"
            onClick={() => setLatest((m) => m + 1)}
          />
        ) : null}
        {months.map((month) => (
          <Month
            key={month}
            month={month}
            today={today}
            low={low}
            high={high}
            focused={months.includes(monthOf(focused)) ? focused : firstOf(months[0])}
            onPick={pick}
            onHover={end ? undefined : setHover}
            onKey={onDayKey}
          />
        ))}
      </div>

      <div className="app-when-foot">
        <span className="app-when-sum">
          {other ? (
            <>
              {rangeWords(low, high)}
              <small>{dayCount(low, high)}</small>
            </>
          ) : (
            <>
              {dayWords(start)}
              <small>עד איזה יום?</small>
            </>
          )}
        </span>
        <Button variant="secondary" onClick={onCancel}>ביטול</Button>
        <Button onClick={() => onApply(start, end || start)}>החל</Button>
      </div>
    </div>
  );
}

function Month({ month, today, low, high, focused, onPick, onHover, onKey }: {
  month: number;
  today: string;
  low: string;
  high: string;
  focused: string;
  onPick: (day: string) => void;
  onHover?: (day: string) => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, day: string) => void;
}) {
  const first = firstOf(month);
  const last = lastOf(month);
  const lead = toDate(first).getDay();
  const count = Number(last.slice(8));

  return (
    <div className="app-when-month">
      <div className="app-when-caption">{MONTHS[month % 12]} {Math.floor(month / 12)}</div>
      <div className="app-when-week" aria-hidden="true">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="app-when-days">
        {Array.from({ length: lead }, (_, i) => <span key={i} />)}
        {Array.from({ length: count }, (_, i) => {
          const day = shiftDay(first, i);
          const isEnd = day === low || day === high;
          return (
            <span
              key={day}
              className={cx(
                "app-when-cell",
                day === low && "is-first",
                day === high && "is-last",
                day > low && day < high && "is-between",
                day === first && "is-month-first",
                day === last && "is-month-last",
              )}
            >
              <button
                type="button"
                data-day={day}
                disabled={day > today}
                tabIndex={day === focused ? 0 : -1}
                aria-pressed={isEnd}
                aria-label={dayWords(day, true)}
                className={cx("app-when-pick", isEnd && "is-end", day === today && "is-today")}
                onClick={() => onPick(day)}
                onMouseEnter={() => onHover?.(day)}
                onKeyDown={(e) => onKey(e, day)}
              >
                {i + 1}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── hours ───────── */

function hoursWords(from: string, to: string): string | null {
  if (from && to) return `${from} – ${to}`;
  if (from) return `מ־${from}`;
  if (to) return `עד ${to}`;
  return null;
}

/** Hours apply to each day of the period, and a range may run across midnight: 22:00 to 06:00 keeps its order. */
export function HoursFilter({ from, to, onApply }: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { triggerRef, close } = useCloseSheet(setOpen);
  return (
    <WhenFilter
      icon="clock"
      title="בחירת שעות"
      value={hoursWords(from, to)}
      placeholder="שעה"
      open={open}
      onOpenChange={setOpen}
      triggerRef={triggerRef}
      close={close}
    >
      <HoursBoard
        from={from}
        to={to}
        onCancel={close}
        onApply={(first, last) => {
          close();
          onApply(first, last);
        }}
      />
    </WhenFilter>
  );
}

function HoursBoard({ from, to, onCancel, onApply }: {
  from: string;
  to: string;
  onCancel: () => void;
  onApply: (from: string, to: string) => void;
}) {
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [hover, setHover] = useState("");

  const last = end || hover;

  const pick = (hour: string) => {
    setHover("");
    if (start && end) {
      setStart(hour);
      setEnd("");
    } else if (!start) {
      setStart(hour);
    } else if (hour === start) {
      setStart("");
    } else {
      setEnd(hour);
    }
  };

  const between = (hour: string) => {
    if (!start || !last || start === last) return false;
    return start < last ? hour > start && hour < last : hour > start || hour < last;
  };

  return (
    <div className="app-when-hoursSheet">
      {/* The board covers whole hours; a shift that starts at 06:30 is typed here. */}
      <div className="app-when-times">
        <label>
          <span>משעה</span>
          <input className={cx("sa-input", start && "is-set")} type="time" dir="ltr" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span>עד שעה</span>
          <input className={cx("sa-input", end && "is-set")} type="time" dir="ltr" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      <div className="app-when-hours" onMouseLeave={() => setHover("")}>
        {HOURS.map((hour) => {
          const isEnd = hour === start || hour === last;
          return (
            <span
              key={hour}
              className={cx(
                "app-when-cell",
                hour === start && last && "is-first",
                hour === last && start && "is-last",
                between(hour) && "is-between",
              )}
            >
              <button
                type="button"
                aria-pressed={isEnd}
                className={cx("app-when-pick", isEnd && "is-end")}
                onClick={() => pick(hour)}
                onMouseEnter={() => {
                  if (start && !end) setHover(hour);
                }}
              >
                {hour}
              </button>
            </span>
          );
        })}
      </div>

      <div className="app-when-foot">
        <span className="app-when-sum">
          {start || end ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStart("");
                setEnd("");
              }}
            >
              כל היום
            </Button>
          ) : (
            "כל היום"
          )}
        </span>
        <Button variant="secondary" onClick={onCancel}>ביטול</Button>
        <Button onClick={() => onApply(start, end)}>החל</Button>
      </div>
    </div>
  );
}
