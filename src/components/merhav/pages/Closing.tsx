"use client";

/**
 * סגירת יום as a statement: the day's answers set like the face of a note, one ledger under them on one strict grid, and
 * a rule of days to move along. A closed day is engraved: its figures stand still, its totals are ruled off twice, and
 * the band across its face is cut from the stored record, so the same day always draws the same lines. Today is still
 * ink: its wheels turn and the band is cut only as far as the hour. The reads and the sums are the shared page's.
 */

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, cx, MovementQty, Notice } from "@/components/ui";
import { fmtClosingDay, isDay, israelToday, shiftDay, useDaySummary, useFirstClosedDay, type DayAction, type DayStock, type DaySummary, type MovedLine } from "@/lib/day-closing";
import { fmtName, fmtPrice, fmtQty, fmtTime } from "@/lib/format";
import { useData } from "@/lib/store";
import { supabase } from "@/lib/supabase/client";
import { Figure } from "../Figure";

const ACTION_LABEL: Record<DayAction["kind"], string> = {
  request_approved: "שורה אושרה",
  request_rejected: "שורה נדחתה",
  name_approved: "שם ספק אושר",
  count: "תיקון ספירה",
  no_receipt: "הוצאה בלי קבלה",
  fault_resolved: "תקלה טופלה",
  order_delivered: "סומנה כנמסרה",
};

const STOCK_WORD: Record<DayStock["state"], string> = { short: "חסר", out: "אזל", low: "מינימום" };

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${fmtQty(n)} ${many}`);

const joined = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

const worthOf = (lines: MovedLine[]) => Math.round(lines.reduce((sum, l) => sum + (l.worth ?? 0), 0));

function movedNote(lines: MovedLine[], partyOne: string, partyMany: string): string {
  const products = new Set(lines.map((l) => l.product_id)).size;
  const parties = new Set(lines.map((l) => l.party).filter(Boolean)).size;
  return joined("במחירון", count(products, "מוצר אחד", "מוצרים"), parties > 0 && count(parties, partyOne, partyMany));
}

function stockLine(s: DayStock): string {
  const free = s.qty - s.reserved;
  if (s.state === "short") return `חסרים ${fmtQty(-free)} ${s.unit} להזמנות`;
  if (s.state === "low") return `חסרים ${fmtQty(s.min_qty - free)} ${s.unit}`;
  return `מינימום ${fmtQty(s.min_qty)} ${s.unit}`;
}

/* ───────── the band: the day's own engraving ───────── */

const BAND_W = 1600;
const BAND_H = 32;
const STRANDS = 9;

/** FNV-1a: the same stored day gives the same number, and so the same lines, every time it is opened. */
function fingerprint(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Strands of one rope, each a little behind the last, the way a note's border is cut. The record sets its pitch and breath. */
function engraving(seed: number): string {
  const wave = 15 + (seed % 7);
  const breath = 2 + ((seed >>> 6) % 4);
  const phase = ((seed >>> 12) % 628) / 100;
  const samples = wave * 24;
  let path = "";
  for (let strand = 0; strand < STRANDS; strand++) {
    const shift = (strand / STRANDS) * Math.PI * 2;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const swell = 0.66 + 0.34 * Math.sin(2 * Math.PI * breath * t + phase);
      const y = BAND_H / 2 + (BAND_H / 2 - 1) * swell * Math.sin(2 * Math.PI * wave * t + shift);
      path += `${i === 0 ? "M" : "L"}${(t * BAND_W).toFixed(1)} ${y.toFixed(2)}`;
    }
  }
  return path;
}

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** How much of the Israeli day has passed, 0 to 1. */
function dayPassed(): number {
  const [hour, minute] = clock.format(new Date()).split(":").map(Number);
  return (hour * 60 + minute) / 1440;
}

function Band({ summary, live }: { summary: DaySummary; live: boolean }): ReactElement {
  const seed = fingerprint(live ? summary.day : JSON.stringify(summary));
  const path = useMemo(() => engraving(seed), [seed]);
  const [passed] = useState(dayPassed);
  return (
    <div className="mh-dc-band" dir="ltr" aria-hidden="true">
      <svg key={seed} viewBox={`0 0 ${BAND_W} ${BAND_H}`} preserveAspectRatio="none" style={{ "--cut": live ? `${(1 - passed) * 100}%` : "0%" } as CSSProperties}>
        <path d={path} />
      </svg>
    </div>
  );
}

/* ───────── the rule of days ───────── */

const PITCH_MIN = 14;
const PITCH_MAX = 64;
/** From this wide every day can carry its number. */
const PITCH_NUMBERS = 26;
/** How far back the rule goes before it knows the first closed day, or for a person who can't read closings. */
const SPAN_UNKNOWN = 30;
/** Days whose figures the rule reads. */
const SPAN_MARKED = 120;

interface DayMark {
  in: number;
  out: number;
}

const monthWord = new Intl.DateTimeFormat("he-IL", { month: "long", timeZone: "UTC" });
const noonOf = (day: string) => Date.parse(`${day}T12:00:00Z`);

function markOf(lines: MovedLine[]): DayMark {
  return { in: worthOf(lines.filter((l) => l.type === "in")), out: worthOf(lines.filter((l) => l.type === "out")) };
}

/** Each closed day's two sums, read from the closings themselves, so the rule can't tell another story than the statement. */
function useDayMarks(today: string): ReadonlyMap<string, DayMark> {
  const [marks, setMarks] = useState<ReadonlyMap<string, DayMark>>(new Map());
  useEffect(() => {
    let current = true;
    void supabase()
      .from("day_closings")
      .select("day, moved:summary->moved")
      .gte("day", shiftDay(today, -SPAN_MARKED))
      .then(({ data }) => {
        if (!current || !data) return;
        setMarks(new Map(data.map((row) => [row.day, markOf(row.moved as unknown as MovedLine[])])));
      });
    return () => {
      current = false;
    };
  }, [today]);
  return marks;
}

interface RuleProps {
  day: string;
  today: string;
  first: string | null;
  live: DayMark | null;
  onGo: (day: string) => void;
}

/** Time runs left to right. One tick a day, what came in above the line and what went out below it, and one carriage. */
function DayRule({ day, today, first, live, onGo }: RuleProps): ReactElement {
  const stored = useDayMarks(today);
  const track = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<string | null>(null);
  const [peek, setPeek] = useState<{ day: string; x: number } | null>(null);

  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const measure = new ResizeObserver(() => setWidth(node.clientWidth));
    measure.observe(node);
    return () => measure.disconnect();
  }, []);

  const days = useMemo(() => {
    const known = first ?? shiftDay(today, -SPAN_UNKNOWN);
    const start = day < known ? day : known;
    const list: string[] = [];
    for (let at = start; at <= today; at = shiftDay(at, 1)) list.push(at);
    return list;
  }, [first, today, day]);

  const marks = useMemo(() => {
    const all = new Map(stored);
    if (live) all.set(today, live);
    return all;
  }, [stored, live, today]);

  const top = useMemo(() => Math.max(1, ...[...marks.values()].flatMap((m) => [m.in, m.out])), [marks]);
  const height = (n: number) => (n > 0 ? Math.log1p(n) / Math.log1p(top) : 0);

  const pitch = Math.min(Math.max(width / days.length, PITCH_MIN), PITCH_MAX);
  const shown = scrub ?? day;
  const index = days.indexOf(shown);

  // The tape keeps the day you are on in view; a rule that fits the plate has nowhere to go.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const node = track.current;
    if (!node || width === 0 || scrub) return;
    node.scrollTo({ left: (index + 0.5) * pitch - width / 2, behavior: placed.current ? "smooth" : "instant" });
    placed.current = true;
  }, [index, pitch, width, scrub]);

  const dayAt = (x: number) => {
    const box = strip.current?.getBoundingClientRect();
    const i = box ? Math.floor((x - box.left) / pitch) : index;
    return days[Math.min(Math.max(i, 0), days.length - 1)];
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(dayAt(e.clientX));
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = dayAt(e.clientX);
    if (scrub) setScrub(at);
    setPeek({ day: at, x: e.clientX - box.left });
  };

  const onUp = () => {
    if (!scrub) return;
    setScrub(null);
    if (scrub !== day) onGo(scrub);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7, Home: -days.length, End: days.length };
    const by = step[e.key];
    if (by === undefined) return;
    e.preventDefault();
    onGo(days[Math.min(Math.max(index + by, 0), days.length - 1)]);
  };

  const peeked = peek ? marks.get(peek.day) : undefined;
  const farFromToday = (at: string) => (noonOf(today) - noonOf(at)) / 86_400_000 > 56 / pitch;

  return (
    <div className="mh-dr">
      <div className="mh-dr-axis" aria-hidden="true">
        <span>נקלט</span>
        <span>נמסר</span>
      </div>
      <div
        ref={track}
        className="mh-dr-track"
        dir="ltr"
        role="slider"
        tabIndex={0}
        aria-label="בחירת יום"
        aria-valuemin={0}
        aria-valuemax={days.length - 1}
        aria-valuenow={index}
        aria-valuetext={fmtClosingDay(shown)}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setScrub(null)}
        onPointerLeave={() => setPeek(null)}
      >
        <div ref={strip} className="mh-dr-strip" style={{ width: pitch * days.length, "--pitch": `${pitch}px` } as CSSProperties}>
          {days.map((at) => {
            const mark = marks.get(at);
            const date = new Date(noonOf(at));
            const weekStart = date.getUTCDay() === 0;
            const monthStart = date.getUTCDate() === 1;
            return (
              <span
                key={at}
                className={cx("mh-dr-day", weekStart && "is-week", at === today && "is-today", at === shown && "is-on")}
                style={{ "--in": height(mark?.in ?? 0), "--out": height(mark?.out ?? 0) } as CSSProperties}
              >
                {at === today ? <b>היום</b> : monthStart && farFromToday(at) ? <b>{monthWord.format(date)}</b> : pitch >= PITCH_NUMBERS ? <em>{date.getUTCDate()}</em> : null}
              </span>
            );
          })}
          <i className="mh-dr-carriage" style={{ transform: `translateX(${(index + 0.5) * pitch}px)` }} />
        </div>
      </div>
      {peek ? (
        <span className="mh-dr-tip" style={{ "--x": `${peek.x}px` } as CSSProperties}>
          {fmtClosingDay(peek.day)}
          {peeked ? <span className="mh-tone-quiet"> · נקלט <span className="ltr">₪{fmtQty(peeked.in)}</span> · נמסר <span className="ltr">₪{fmtQty(peeked.out)}</span></span> : null}
        </span>
      ) : null}
    </div>
  );
}

/* ───────── the ledger ───────── */

/** One line of a section: what it is, then its figure with a word beside it. */
function Line({ lead, title, meta, figure, word, tone, onOpen }: {
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  figure?: ReactNode;
  word?: ReactNode;
  tone?: DayStock["state"];
  onOpen?: () => void;
}): ReactElement {
  const body = (
    <>
      <span className="mh-dc-lead">{lead}</span>
      <span className="mh-dc-title">{title}</span>
      <span className="mh-dc-meta">{meta}</span>
      <span className="mh-dc-fig">{figure}</span>
      <span className={cx("mh-dc-word", tone && `is-${tone}`)}>{word}</span>
    </>
  );
  return (
    <li>
      {onOpen ? <button type="button" className="mh-dc-line" onClick={onOpen}>{body}</button> : <div className="mh-dc-line">{body}</div>}
    </li>
  );
}

function Section({ id, title, size, empty, note, total, children }: {
  id: string;
  title: string;
  size: number;
  empty: string;
  note?: string;
  total?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="mh-dc-sec">
      <header className="mh-dc-sec-head">
        <h2>{title}</h2>
        {size > 0 ? <span className="mh-dc-size ltr">{fmtQty(size)}</span> : null}
      </header>
      <div className="mh-dc-sec-body">
        {size === 0 ? <p className="mh-dc-none">{empty}</p> : <ul className="mh-dc-lines">{children}</ul>}
        {total && size > 0 ? <p className="mh-dc-total"><span>סך הכל במחירון</span>{total}</p> : null}
        {note ? <p className="mh-dc-note">{note}</p> : null}
      </div>
    </section>
  );
}

function Moved({ id, title, empty, lines }: { id: string; title: string; empty: string; lines: MovedLine[] }): ReactElement {
  const { product } = useData();
  const { openProduct } = useUi();
  return (
    <Section id={id} title={title} size={lines.length} empty={empty} total={<span className="ltr">{fmtPrice(worthOf(lines))}</span>}>
      {lines.map((l) => (
        <Line
          key={`${l.product_id}|${l.party}`}
          lead={<ProductThumb product={product(l.product_id)} />}
          title={fmtName(l.name)}
          meta={
            <>
              {l.party ? <span className="sa-truncate">{l.party}</span> : null}
              {l.no_receipt > 0 ? <span className="mh-tone-warn"> בלי קבלה</span> : null}
            </>
          }
          figure={<><span className="ltr"><MovementQty qty={l.qty} type={l.type} /></span><small>{l.unit}</small></>}
          word={l.worth === null ? undefined : <span className="ltr">{fmtPrice(Math.round(l.worth))}</span>}
          onOpen={() => openProduct(l.product_id, "history")}
        />
      ))}
    </Section>
  );
}

function OpenDocuments({ summary }: { summary: DaySummary }): ReactElement {
  const { openOrder, openAction } = useUi();
  return (
    <Section id="closing-open" title="תעודות פתוחות" size={summary.orders.length + summary.requests.length} empty="אין תעודות פתוחות">
      {summary.orders.map((o) => {
        const late = !!o.promised_on && o.promised_on < summary.day;
        return (
          <Line
            key={o.id}
            title={`הזמנה ${o.number} · ${o.customer}`}
            meta={joined(count(o.lines, "שורה אחת", "שורות"), o.agent)}
            word={late ? <span className="mh-tone-warn">באיחור</span> : "פתוחה"}
            onOpen={() => openOrder(o.id)}
          />
        );
      })}
      {summary.requests.map((r) => (
        <Line
          key={r.id}
          title={`${fmtName(r.name)} × ${fmtQty(r.qty)}`}
          meta={joined(r.customer && `ללקוח ${r.customer}`, r.worker && `נשלח ע"י ${r.worker}`)}
          word="ממתין"
          onOpen={() => openAction("review-item-request", { requestId: r.id })}
        />
      ))}
    </Section>
  );
}

function Exceptions({ summary }: { summary: DaySummary }): ReactElement {
  const router = useRouter();
  const { product } = useData();
  const { openProduct, openAction } = useUi();
  const stock = summary.stock ?? [];
  return (
    <Section
      id="closing-exceptions"
      title="חריגות שלא טופלו"
      size={summary.faults.length + stock.length + summary.names.length}
      empty="אין חריגות פתוחות"
      note={summary.stock ? undefined : "המלאי של יום זה לא נשמר"}
    >
      {summary.faults.map((f) => (
        <Line
          key={f.id}
          title={f.description}
          meta={joined(f.product && fmtName(f.product), f.worker && `דווח ע"י ${f.worker}`)}
          word="תקלה"
          onOpen={() => router.push("/faults")}
        />
      ))}
      {stock.map((s) => (
        <Line
          key={s.product_id}
          lead={<ProductThumb product={product(s.product_id)} />}
          title={fmtName(s.name)}
          meta={stockLine(s)}
          word={STOCK_WORD[s.state]}
          tone={s.state}
          onOpen={() => openProduct(s.product_id)}
        />
      ))}
      {summary.names.map((n) => (
        <Line key={n.id} title={n.name} meta={n.supplier} word="ממתין" onOpen={() => openAction("map-supplier-item", { supplierItemId: n.id })} />
      ))}
    </Section>
  );
}

function ManagerActions({ actions }: { actions: DayAction[] }): ReactElement {
  return (
    <Section id="closing-actions" title="פעולות מנהל" size={actions.length} empty="אין פעולות מנהל">
      {actions.map((a) => (
        <Line
          key={`${a.kind}|${a.at}|${a.title}`}
          title={fmtName(a.title)}
          meta={joined(ACTION_LABEL[a.kind], a.detail && fmtName(a.detail))}
          figure={a.qty === null ? undefined : <><span className="ltr">{fmtQty(a.qty)}</span><small>{a.unit}</small></>}
          word={<span className="ltr">{fmtTime(a.at)}</span>}
        />
      ))}
    </Section>
  );
}

/* ───────── the face ───────── */

/** Today turns like a counter. A closed day was cut once and stands still. */
function Amount({ text, sign, live, className, style }: { text: string; sign?: string; live: boolean; className?: string; style?: CSSProperties }): ReactElement {
  if (live) return <Figure text={text} sign={sign} className={className} style={style} />;
  return (
    <span className={cx("mh-figure", className)} style={style}>
      {sign ? <span className="mh-figure-sign" aria-hidden="true">{sign}</span> : null}
      {[...text].map((char, i) => (char === "," ? <span key={i} className="mh-figure-sep is-thin">,</span> : char))}
    </span>
  );
}

function Face({ summary, live }: { summary: DaySummary; live: boolean }): ReactElement {
  const received = summary.moved.filter((l) => l.type === "in");
  const delivered = summary.moved.filter((l) => l.type === "out");
  const noReceipt = delivered.reduce((sum, l) => sum + l.no_receipt, 0);
  const open = summary.orders.length + summary.requests.length;
  const stock = summary.stock?.length ?? 0;
  const exceptions = summary.faults.length + stock + summary.names.length;
  const last = summary.actions[0];
  const inText = fmtQty(worthOf(received));
  const outText = fmtQty(worthOf(delivered));
  const size = { "--len": Math.max(inText.length, outText.length) } as CSSProperties;

  return (
    <section className="mh-dc-face" aria-label="חמש התשובות של היום">
      <div className="mh-dc-money">
        <Link href="#closing-in" className="mh-dc-hero">
          <span className="mh-label">נקלט</span>
          <Amount className="mh-dc-n" text={inText} sign="₪" live={live} style={size} />
          <span className="mh-dc-sub">{received.length > 0 ? movedNote(received, "ספק אחד", "ספקים") : "לא נקלטה סחורה"}</span>
        </Link>
        <Link href="#closing-out" className="mh-dc-hero">
          <span className="mh-label">נמסר</span>
          <Amount className="mh-dc-n" text={outText} sign="₪" live={live} style={size} />
          <span className="mh-dc-sub">
            {delivered.length > 0 ? (
              <>
                {movedNote(delivered, "לקוח אחד", "לקוחות")}
                {noReceipt > 0 ? <span className="mh-tone-warn"> · {count(noReceipt, "שורה אחת", "שורות")} בלי קבלה</span> : null}
              </>
            ) : "לא נמסרה סחורה"}
          </span>
        </Link>
      </div>

      <Band summary={summary} live={live} />

      <div className="mh-dc-counts">
        <Link href="#closing-open" className="mh-dc-count">
          <span className="mh-label">תעודות פתוחות</span>
          <Amount className="mh-dc-c" text={fmtQty(open)} live={live} />
          <span className="mh-dc-sub">
            {open > 0 ? joined(summary.orders.length > 0 && count(summary.orders.length, "הזמנה אחת", "הזמנות"), summary.requests.length > 0 && `${fmtQty(summary.requests.length)} אצל המנהל`) : <span className="mh-tone-ok">הכל סגור</span>}
          </span>
        </Link>
        <Link href="#closing-exceptions" className="mh-dc-count">
          <span className="mh-label">חריגות שלא טופלו</span>
          <Amount className="mh-dc-c" text={fmtQty(exceptions)} live={live} />
          <span className="mh-dc-sub">
            {exceptions > 0 ? joined(summary.faults.length > 0 && count(summary.faults.length, "תקלה אחת", "תקלות"), stock > 0 && `${fmtQty(stock)} במלאי`, summary.names.length > 0 && `${fmtQty(summary.names.length)} שמות ספק`) : <span className="mh-tone-ok">{summary.stock ? "הכל טופל" : "אין תקלות פתוחות"}</span>}
          </span>
        </Link>
        <Link href="#closing-actions" className="mh-dc-count">
          <span className="mh-label">פעולות מנהל</span>
          <Amount className="mh-dc-c" text={fmtQty(summary.actions.length)} live={live} />
          <span className="mh-dc-sub">{last ? <>אחרונה <span className="ltr">{fmtTime(last.at)}</span></> : "אין פעולות"}</span>
        </Link>
        <div className="mh-dc-count">
          <span className="mh-label">סגירה</span>
          <span className="mh-dc-c mh-dc-state">{live ? "עד עכשיו" : "נסגר"}</span>
          <span className="mh-dc-sub">{live ? "נסגר בחצות" : <span className="ltr">{summary.day.split("-").reverse().join(".")}</span>}</span>
        </div>
      </div>
    </section>
  );
}

/* ───────── the page ───────── */

function ClosingInner(): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const first = useFirstClosedDay();

  // The day lives in the URL, so a closed day can be opened from a link.
  const today = israelToday();
  const asked = params.get("day");
  const day = asked && isDay(asked) && asked < today ? asked : today;
  const isToday = day === today;
  const { summary, failed, retry } = useDaySummary(day);

  const go = useCallback(
    (next: string) => router.replace(next === israelToday() ? pathname : `${pathname}?day=${next}`, { scroll: false }),
    [pathname, router],
  );

  // A closed day can't change, so once read it stays at hand, and the day before is read ahead: stepping back never waits.
  const atStart = first !== null && day <= first;
  const before = useDaySummary(atStart ? day : shiftDay(day, -1)).summary;
  const [book, setBook] = useState<ReadonlyMap<string, DaySummary>>(new Map());
  for (const read of [summary, before]) {
    if (read && read.day !== today && !book.has(read.day)) setBook(new Map(book).set(read.day, read));
  }
  const ready = summary ?? book.get(day) ?? null;

  // The last day stands until the next one is read, so moving along the rule never blanks the page.
  const [held, setHeld] = useState<DaySummary | null>(null);
  if (ready && ready !== held) setHeld(ready);
  const shown = ready ?? held;
  const live = useMemo(() => (summary && isToday ? markOf(summary.moved) : null), [summary, isToday]);

  return (
    <div className={cx("mh-dc", isToday ? "is-open" : "is-closed", !ready && "is-reading")}>
      <header className="mh-dc-head">
        <div>
          <h1 className="sa-page-title">סגירת יום</h1>
          <p className="mh-dc-date">{fmtClosingDay(day)}{shown ? null : <span className="mh-tone-quiet"> · {isToday ? "עד עכשיו, נסגר בחצות" : "נסגר"}</span>}</p>
        </div>
        <div className="mh-dc-keys">
          {isToday ? null : <Button variant="ghost" onClick={() => go(today)}>היום</Button>}
          <Button variant="secondary" icon="chevron-right" disabled={isToday} onClick={() => go(shiftDay(day, 1))}>יום הבא</Button>
          <Button variant="secondary" iconEnd="chevron-left" disabled={atStart} onClick={() => go(shiftDay(day, -1))}>יום קודם</Button>
        </div>
      </header>

      <DayRule day={day} today={today} first={first} live={live} onGo={go} />

      {failed ? (
        <Notice className="mh-dc-failed" tone="danger" title="הסיכום לא נטען" action="ניסיון נוסף" onAction={retry} />
      ) : shown ? (
        <>
          <Face summary={shown} live={isToday && shown.day === today} />
          <div className="mh-dc-ledger">
            <Moved id="closing-in" title="נקלט" empty="אין קליטות" lines={shown.moved.filter((l) => l.type === "in")} />
            <Moved id="closing-out" title="נמסר" empty="אין הוצאות" lines={shown.moved.filter((l) => l.type === "out")} />
            <OpenDocuments summary={shown} />
            <Exceptions summary={shown} />
            <ManagerActions actions={shown.actions} />
          </div>
        </>
      ) : (
        <div className="mh-dc-wait" aria-busy="true"><span className="sa-skeleton" /></div>
      )}
    </div>
  );
}

export function Closing(): ReactElement {
  return (
    <Suspense fallback={null}>
      <ClosingInner />
    </Suspense>
  );
}
