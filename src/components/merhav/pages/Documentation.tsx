"use client";

/**
 * תיעוד as a kept archive: every receipt and fault report is a sheet lying under its day, the photograph is the content
 * and one quiet line names it. A ruled scale runs the length of the archive, one tick for every day that holds a sheet, and
 * it answers whatever the list is narrowed to. A sheet lifts off the plate into a reader that stands beside its record,
 * where the archive can be walked sheet by sheet and a record corrected or deleted. Same data, same ?tab= and the same
 * signed URLs as the shared page.
 */

import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormPanel } from "@/components/app/forms/FormPanel";
import { productOptions, supplierOptions } from "@/components/app/forms/options";
import { REQUIRED, useForm } from "@/components/app/forms/useForm";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, cx, EmptyState, Fields, Input, Modal, SearchBar, Select, Showing, SidePanel, type FieldItem, type SelectOption } from "@/components/ui";
import { documentDownloadUrl, useDocumentUrls } from "@/lib/documents";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { daysAgo, fmtFull, fmtName, fmtQty, fmtSigned, fmtTime, orderRef } from "@/lib/format";
import { dayKey, normalizeName, useData, type DocumentRecord, type Fault, type Movement } from "@/lib/store";

type Kind = "in" | "out" | "fault";
type Tab = "all" | Kind;

/** One sheet: a receipt (`doc`) or a fault report (`fault`). */
type Entry = {
  key: string;
  kind: Kind;
  at: string;
  title: string;
  workerId: string | null;
  doc?: DocumentRecord;
  fault?: Fault;
};

const KIND_LABEL: Record<Kind, string> = { in: "קבלת הכנסה", out: "קבלת הוצאה", fault: "תקלה" };
/** What a sheet's one line has room for. */
const KIND_WORD: Record<Kind, string> = { in: "הכנסה", out: "הוצאה", fault: "תקלה" };
const KIND_TONE: Record<Kind, string | undefined> = { in: "mh-tone-in", out: "mh-tone-out", fault: undefined };
const REQUEST_STATUS = {
  pending: { label: "ממתין", tone: "mh-tone-warn" },
  approved: { label: "אושר", tone: "mh-tone-ok" },
  rejected: { label: "נדחה", tone: "mh-tone-out" },
} as const;
const PAGE_SIZE = 48;
/** Fewer days than this and the page itself is the scale. */
const SCALE_MIN_DAYS = 8;
/** The door leaves a little faster than it arrived, and the sheet lands with it. */
const LAND_MS = 320;

function tabFromParams(params: URLSearchParams): Tab {
  const t = params.get("tab");
  return t === "in" || t === "out" || t === "fault" ? t : "all";
}

function downloadName(entry: Entry, path: string): string {
  const d = new Date(entry.at);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const ext = path.split(".").pop() ?? "jpg";
  return `${KIND_LABEL[entry.kind]} ${entry.title} ${day}.${ext}`;
}

const weekdayFmt = new Intl.DateTimeFormat("he-IL", { weekday: "long" });
const monthFmt = new Intl.DateTimeFormat("he-IL", { month: "long" });

interface Day {
  key: string;
  at: string;
  entries: Entry[];
  /** Where it starts in the whole list. */
  first: number;
}

/** Entries come newest first, so a day is a run of them. */
function byDay(entries: Entry[]): Day[] {
  const days: Day[] = [];
  entries.forEach((entry, i) => {
    const key = dayKey(entry.at);
    const last = days[days.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else days.push({ key, at: entry.at, entries: [entry], first: i });
  });
  return days;
}

export function Documentation(): ReactElement {
  return (
    <Suspense fallback={null}>
      <DocumentationInner />
    </Suspense>
  );
}

function DocumentationInner(): ReactElement {
  const { state, product, supplier, worker } = useData();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab = tabFromParams(params);
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "all") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
  const [workerId, setWorkerId] = useState("");

  const entries = useMemo<Entry[]>(() => {
    const docs: Entry[] = state.documents.map((d) => ({
      key: `doc:${d.id}`,
      kind: d.kind,
      at: d.created_at,
      workerId: d.worker_id,
      doc: d,
      title: d.kind === "in" ? supplier(d.supplier_id)?.name ?? "ספק שנמחק" : d.customer ?? "לקוח לא צוין",
    }));
    // Faults have their own page, with their photos; the archive keeps the receipts.
    return docs.sort((a, b) => b.at.localeCompare(a.at));
  }, [state.documents, supplier]);

  const counts = useMemo(() => {
    const out: Record<Kind, number> = { in: 0, out: 0, fault: 0 };
    for (const e of entries) out[e.kind]++;
    return out;
  }, [entries]);

  const workerOptions = useMemo<SelectOption[]>(() => {
    const ids = new Set(entries.map((e) => e.workerId).filter((id): id is string => Boolean(id)));
    return state.workers.filter((w) => ids.has(w.id)).map((w) => ({ value: w.id, label: w.name }));
  }, [entries, state.workers]);

  const q = normalizeName(query);
  const visible = useMemo(
    () =>
      entries.filter((e) => {
        if (tab !== "all" && e.kind !== tab) return false;
        if (workerId && e.workerId !== workerId) return false;
        if (!q) return true;
        const p = product(e.fault?.product_id);
        const hay = normalizeName([e.title, e.doc?.reference, worker(e.workerId)?.name, p?.name, p?.sku].filter(Boolean).join(" "));
        return hay.includes(q);
      }),
    [entries, tab, workerId, q, product, worker],
  );

  const lens: { key: Tab; word: string; count: number }[] = [
    { key: "all", word: entries.length === 1 ? "רשומה" : "רשומות", count: entries.length },
    { key: "in", word: "קבלות הכנסה", count: counts.in },
    { key: "out", word: "קבלות הוצאה", count: counts.out },
  ];

  let empty: ReactNode = null;
  if (q || workerId) empty = <EmptyState title="לא נמצא תיעוד" hint="אפשר להסיר את הסינון" />;
  else if (tab === "in") empty = <EmptyState title="אין קבלות הכנסה" hint="קבלה שעובד מצלם בקליטה תופיע כאן" />;
  else if (tab === "out") empty = <EmptyState title="אין קבלות הוצאה" hint="קבלה שעובד מצלם בהוצאה תופיע כאן" />;
  else empty = <EmptyState title="אין תיעוד" hint="קבלות מהטלפון יופיעו כאן" />;

  return (
    <div className="mh-docs">
      <h1 className="sa-page-title">תיעוד</h1>

      <div className="mh-docs-bar">
        <div className="mh-lens" role="group" aria-label="סוג רשומה">
          {lens.map((item) => (
            <button key={item.key} type="button" aria-pressed={tab === item.key} className={cx("mh-lens-item", tab === item.key && "is-on")} onClick={() => setTab(item.key)}>
              <span className="mh-lens-n ltr">{fmtQty(item.count)}</span>
              <span className="mh-lens-word">{item.word}</span>
            </button>
          ))}
        </div>
        <div className="mh-docs-tools">
          {workerOptions.length > 0 ? <Select options={workerOptions} value={workerId} onChange={setWorkerId} allLabel="כל העובדים" placeholder="עובד" /> : null}
          <div className="mh-docs-search">
            <SearchBar kbd={false} value={query} onChange={setQuery} placeholder="חיפוש לפי שם או עובד" />
            {q || workerId ? <span className="mh-docs-found" role="status"><span className="ltr">{fmtQty(visible.length)}</span> {visible.length === 1 ? "רשומה" : "רשומות"}</span> : null}
          </div>
        </div>
      </div>

      <Archive entries={visible} filter={`${tab}|${q}|${workerId}`} showKind={tab === "all"} empty={empty} />
    </div>
  );
}

/* ───────── the plate of sheets ───────── */

function Archive({ entries, filter, showKind, empty }: { entries: Entry[]; filter: string; showKind: boolean; empty: ReactNode }): ReactElement {
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [now] = useState(() => Date.now());
  const [liftedFrom, setLiftedFrom] = useState<DOMRect | null>(null);
  const wall = useRef<HTMLDivElement>(null);
  const goal = useRef<string | null>(null);

  // A new filter starts from the newest sheet. The signed URLs stay, so narrowing never blanks a photo.
  const [lastFilter, setLastFilter] = useState(filter);
  if (filter !== lastFilter) {
    setLastFilter(filter);
    setShown(PAGE_SIZE);
  }
  useEffect(() => {
    const top = wall.current?.getBoundingClientRect().top;
    const bar = document.querySelector(".mh-docs-bar")?.getBoundingClientRect().height ?? 0;
    if (top !== undefined && top < bar) window.scrollBy({ top: top - bar });
  }, [filter]);

  const days = useMemo(() => byDay(entries), [entries]);

  // A page ends where a day ends, so a day on screen is always the whole day.
  const reached = useMemo(() => {
    const at = days.findIndex((d) => d.first + d.entries.length >= shown);
    return at < 0 ? days.length : at + 1;
  }, [days, shown]);
  const onPage = days.slice(0, reached);
  const last = onPage[onPage.length - 1];
  const count = last ? last.first + last.entries.length : 0;

  const paths = useMemo(() => entries.slice(0, count).flatMap((e) => (e.doc ? [e.doc.storage_path] : [])), [entries, count]);
  const urls = useDocumentUrls(paths);
  const photo = useCallback((e: Entry): string | null => (e.doc ? urls[e.doc.storage_path] ?? null : faultPhotoUrl(e.fault?.photo_path)), [urls]);

  const at = entries.findIndex((e) => e.key === openKey);
  const open = entries[at];

  const leafOf = useCallback((key: string) => wall.current?.querySelector<HTMLElement>(`[data-leaf="${CSS.escape(key)}"]`) ?? null, []);

  const pickUp = useCallback((key: string, leaf: HTMLElement) => {
    setLiftedFrom(leaf.querySelector(".mh-docs-paper")?.getBoundingClientRect() ?? null);
    setOpenKey(key);
  }, []);

  const walk = useCallback(
    (key: string) => {
      setOpenKey(key);
      const i = entries.findIndex((e) => e.key === key);
      setShown((n) => Math.max(n, i + 1));
      // The plate follows behind the reader, so closing lands on the sheet in hand.
      leafOf(key)?.scrollIntoView({ block: "center" });
    },
    [entries, leafOf],
  );

  const close = useCallback(() => {
    if (!openKey) return;
    leafOf(openKey)?.scrollIntoView({ block: "nearest" });
    setClosing(true);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => {
      leafOf(openKey)?.focus({ preventScroll: true });
      setOpenKey(null);
      setClosing(false);
    }, still ? 0 : LAND_MS);
  }, [openKey, leafOf]);

  /* ───────── going to a day ───────── */
  const seek = useCallback((key: string) => {
    const day = wall.current?.querySelector(`[data-day="${key}"]`);
    day?.scrollIntoView({ block: "start" });
    // Days on the way have only estimated their height until they are drawn, so the landing is checked once.
    requestAnimationFrame(() => day?.scrollIntoView({ block: "start" }));
  }, []);

  const go = useCallback(
    (day: Day) => {
      if (day.first < count) seek(day.key);
      else {
        goal.current = day.key;
        setShown(day.first + day.entries.length);
      }
    },
    [count, seek],
  );

  useLayoutEffect(() => {
    if (!goal.current) return;
    seek(goal.current);
    goal.current = null;
  }, [count, seek]);

  // The foot of the plate brings the next sheets before it is reached; the button stays for a keyboard.
  const foot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = foot.current;
    if (!el) return;
    const watcher = new IntersectionObserver(([hit]) => {
      if (hit?.isIntersecting) setShown(count + PAGE_SIZE);
    }, { rootMargin: "900px" });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [count]);

  // When days hold a sheet or so each, as most searches do, they stand side by side and the plate stays full.
  const sparse = entries.length < days.length * 2;

  if (entries.length === 0) return <div className="mh-docs-empty">{empty}</div>;

  return (
    <div className={cx("mh-docs-body", days.length >= SCALE_MIN_DAYS && "has-scale")}>
      {/* Before the wall for the keyboard, beside it for the eye: the way through the archive can't wait behind every sheet in it. */}
      {days.length >= SCALE_MIN_DAYS ? <Scale days={days} onGo={go} /> : null}

      <div ref={wall} className={cx("mh-docs-wall", sparse && "is-sparse")}>
        {onPage.map((day) => {
          const ago = daysAgo(day.at, now);
          const date = new Date(day.at);
          const year = date.getFullYear();
          return (
            <section key={day.key} className={cx("mh-docs-day", sparse && day.entries.length > 1 && "is-wide")} data-day={day.key} aria-label={`${date.getDate()} ${monthFmt.format(date)}`}>
              <h2 className="mh-docs-date">
                <span className="mh-docs-dayword">{ago === 0 ? "היום" : ago === 1 ? "אתמול" : weekdayFmt.format(date)}</span>
                <span className="mh-docs-daynum ltr">{date.getDate()}</span>
                <span className="mh-docs-month">{monthFmt.format(date)}{year === new Date(now).getFullYear() ? "" : ` ${year}`}</span>
              </h2>
              <ul className="mh-docs-leaves">
                {day.entries.map((e) => {
                  const src = photo(e);
                  return <Leaf key={e.key} entry={e} src={src} showKind={showKind} lifted={e.key === openKey && Boolean(src)} onPick={pickUp} />;
                })}
              </ul>
            </section>
          );
        })}

        {count < entries.length ? (
          <div ref={foot} className="mh-docs-more">
            <Showing shown={count} total={entries.length} />
            <Button variant="secondary" size="sm" onClick={() => setShown(count + PAGE_SIZE)}>הצגת עוד</Button>
          </div>
        ) : null}
      </div>

      {open ? (
        <Reader
          entry={open}
          src={photo(open)}
          from={liftedFrom}
          closing={closing}
          leafOf={leafOf}
          onClose={close}
          onWalk={walk}
          prev={entries[at - 1]?.key}
          next={entries[at + 1]?.key}
          place={at + 1}
          total={entries.length}
        />
      ) : null}
    </div>
  );
}

interface LeafProps {
  entry: Entry;
  src: string | null;
  showKind: boolean;
  lifted: boolean;
  onPick: (key: string, leaf: HTMLElement) => void;
}

const Leaf = memo(function Leaf({ entry, src, showKind, lifted, onPick }: LeafProps): ReactElement {
  const { product } = useData();
  const { doc, fault } = entry;
  // With no photo the report's own words are the picture, and the product takes their place under it.
  const note = fault && !src ? entry.title : null;
  const item = product(fault?.product_id);
  const heading = note ? item?.name ?? KIND_LABEL[entry.kind] : entry.title;
  const order = orderRef(doc?.reference);
  return (
    <li>
      <button type="button" className={cx("mh-docs-leaf", lifted && "is-lifted")} data-leaf={entry.key} onClick={(e) => onPick(entry.key, e.currentTarget)}>
        <span className={cx("mh-docs-paper", note && "is-note")}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" loading="lazy" decoding="async" />
          ) : note ? (
            <>
              <span className="mh-docs-words">{note}</span>
              {item?.image_path ? <ProductThumb product={item} /> : null}
            </>
          ) : null}
        </span>
        <span className="mh-docs-name" title={heading}>{fmtName(heading)}</span>
        <span className="mh-docs-line">
          {showKind && heading !== KIND_LABEL[entry.kind] ? <><span className={KIND_TONE[entry.kind]}>{KIND_WORD[entry.kind]}</span> · </> : null}
          {order ? <><bdi>{order}</bdi> · </> : null}
          {fault ? <><span className={fault.status === "resolved" ? "mh-tone-ok" : "mh-tone-warn"}>{fault.status === "resolved" ? "טופלה" : "פתוחה"}</span> · </> : null}
          <span className="ltr">{fmtTime(entry.at)}</span>
        </span>
      </button>
    </li>
  );
});

/* ───────── the scale: the archive's length, one tick a day ───────── */

function Scale({ days, onGo }: { days: Day[]; onGo: (day: Day) => void }): ReactElement {
  const rule = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [current, setCurrent] = useState(0);
  const [peek, setPeek] = useState<number | null>(null);

  const marks = useMemo(() => {
    const newest = Date.parse(days[0].at);
    const span = Math.max(daysAgo(days[days.length - 1].at, newest), 1);
    const most = Math.max(...days.map((d) => d.entries.length));
    return days.map((day) => ({ day, y: daysAgo(day.at, newest) / span, reach: Math.log1p(day.entries.length) / Math.log1p(most) }));
  }, [days]);

  const ticks = useMemo(() => marks.map(({ day, y, reach }) => <i key={day.key} className="mh-docs-tick" style={{ top: `${y * 100}%`, "--reach": reach } as CSSProperties} />), [marks]);

  // A month's word stands at the middle of its days, so a month that has barely begun can't take the place of the one before it.
  const months = useMemo(() => {
    const spans = new Map<string, { first: number; last: number; at: string }>();
    for (const { day, y } of marks) {
      const key = day.key.slice(0, 7);
      const span = spans.get(key);
      if (span) span.last = y;
      else spans.set(key, { first: y, last: y, at: day.at });
    }
    const year = new Date(days[0].at).getFullYear();
    const words: { key: string; word: string; y: number }[] = [];
    for (const [key, { first, last, at }] of spans) {
      const y = (first + last) / 2;
      const held = words[words.length - 1];
      if (held && y - held.y < 0.036) continue;
      const date = new Date(at);
      words.push({ key, word: `${monthFmt.format(date)}${date.getFullYear() === year ? "" : ` ${date.getFullYear()}`}`, y });
    }
    return words;
  }, [days, marks]);

  // The carriage stands at the day under the bar.
  useEffect(() => {
    let frame = 0;
    const read = () => {
      const sections = document.querySelectorAll<HTMLElement>(".mh-docs-day");
      const edge = (document.querySelector(".mh-docs-bar")?.getBoundingClientRect().bottom ?? 0) + 1;
      let low = 0;
      let high = sections.length - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (sections[mid].getBoundingClientRect().bottom > edge) high = mid;
        else low = mid + 1;
      }
      const key = sections[low]?.dataset.day;
      const index = days.findIndex((d) => d.key === key);
      if (index >= 0) setCurrent(index);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [days]);

  const nearest = (e: PointerEvent<HTMLElement>): number => {
    const box = rule.current?.getBoundingClientRect();
    if (!box) return 0;
    const y = (e.clientY - box.top) / box.height;
    let best = 0;
    marks.forEach((mark, i) => {
      if (Math.abs(mark.y - y) < Math.abs(marks[best].y - y)) best = i;
    });
    return best;
  };

  const here = Math.min(current, days.length - 1);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const month = (step: number) => {
      const key = days[here].key.slice(0, 7);
      let i = here;
      while (days[i + step]?.key.startsWith(key)) i += step;
      return i + step;
    };
    const steps: Record<string, () => number> = { ArrowDown: () => here + 1, ArrowUp: () => here - 1, PageDown: () => month(1), PageUp: () => month(-1), Home: () => 0, End: () => days.length - 1 };
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    onGo(days[Math.max(0, Math.min(days.length - 1, step()))]);
  };

  const peeking = peek === null ? null : marks[peek];

  return (
    <div
      className="mh-docs-scale"
      role="slider"
      tabIndex={0}
      aria-label="ציר הזמן"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={days.length - 1}
      aria-valuenow={here}
      aria-valuetext={dateWord(days[here].at)}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        onGo(days[nearest(e)]);
      }}
      onPointerMove={(e) => {
        const i = nearest(e);
        setPeek(i);
        if (dragging.current) onGo(days[i]);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerLeave={() => setPeek(null)}
    >
      <div ref={rule} className="mh-docs-rule" aria-hidden="true">
        {ticks}
        {months.map((m) => <span key={m.key} className="mh-docs-monthmark" style={{ top: `${m.y * 100}%` }}>{m.word}</span>)}
        {peeking ? <i className="mh-carriage is-ghost mh-docs-carriage" style={{ top: `${peeking.y * 100}%` }} /> : null}
        <i className="mh-carriage mh-docs-carriage" style={{ top: `${marks[here].y * 100}%` }} />
        {peeking ? (
          <span className="mh-docs-peek" style={{ top: `${peeking.y * 100}%` }}>
            {dateWord(peeking.day.at)} · <span className="ltr">{fmtQty(peeking.day.entries.length)}</span> {peeking.day.entries.length === 1 ? "רשומה" : "רשומות"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const dateWord = (iso: string) => {
  const date = new Date(iso);
  return `${date.getDate()} ב${monthFmt.format(date)}`;
};

/* ───────── the reader: the sheet in hand beside its record ───────── */

interface ReaderProps {
  entry: Entry;
  src: string | null;
  /** Where the sheet lay on the plate. */
  from: DOMRect | null;
  closing: boolean;
  leafOf: (key: string) => HTMLElement | null;
  onClose: () => void;
  onWalk: (key: string) => void;
  prev?: string;
  next?: string;
  place: number;
  total: number;
}

function Reader({ entry, src, from, closing, leafOf, onClose, onWalk, prev, next, place, total }: ReaderProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const held = useRef<HTMLAnchorElement>(null);

  // A step through the archive moves the sheet the way it went.
  const [turn, setTurn] = useState({ place, way: "" });
  if (turn.place !== place) setTurn({ place, way: place > turn.place ? "is-next" : "is-prev" });

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    host.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // The sheet leaves the plate from where it lay.
  useLayoutEffect(() => {
    const sheet = held.current;
    if (!sheet || !from) return;
    aim(sheet, from);
    sheet.classList.add("is-lifting");
  }, [from]);

  // And goes back to where it lies, wherever the walk ended.
  useLayoutEffect(() => {
    const sheet = held.current;
    if (!closing || !sheet) return;
    sheet.classList.remove("is-lifting");
    const home = leafOf(entry.key)?.querySelector(".mh-docs-paper")?.getBoundingClientRect();
    if (home && home.bottom > 0 && home.top < window.innerHeight) {
      aim(sheet, home);
      sheet.classList.add("is-landing");
    }
  }, [closing, entry.key, leafOf]);

  // A dialog keeps the keyboard: Tab goes round its own controls.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const nodes = [...e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])")];
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const label = `${KIND_LABEL[entry.kind]}: ${entry.title}`;
  // A report with no photo has nothing to stand beside it, so the door stops at the record.
  const bare = Boolean(entry.fault) && !src;

  return createPortal(
    <>
      <div className="sa-scrim app-scrim" data-closing={closing || undefined} onClick={onClose} aria-hidden />
      <div ref={host} className={cx("app-panelHost mh-docs-reader", bare && "is-bare")} data-closing={closing || undefined} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="mh-docs-side">
          <Details key={entry.key} entry={entry} onClose={onClose} onWalk={onWalk} prev={prev} next={next} place={place} total={total} />
        </div>
        {bare ? null : (
          <div className="mh-docs-stage">
            {src ? (
              // Safari's Tab passes over a plain link, and this is the stop that closes the dialog's round.
              <a ref={held} key={src} className={cx("mh-docs-held", turn.way)} href={src} target="_blank" rel="noreferrer" tabIndex={0} aria-label="פתיחת התמונה בגודל מלא">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={label} decoding="sync" />
              </a>
            ) : (
              <span className="sa-skeleton mh-docs-wait" role="status" aria-label="טוען תמונה" />
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

/** Sets the offset that puts a sheet, drawn in its place in the reader, over a rectangle on the plate. */
function aim(sheet: HTMLElement, target: DOMRect): void {
  const here = sheet.getBoundingClientRect();
  if (here.width === 0) return;
  sheet.style.setProperty("--lift-x", `${target.left - here.left}px`);
  sheet.style.setProperty("--lift-y", `${target.top - here.top}px`);
  sheet.style.setProperty("--lift-s", String(target.width / here.width));
}

interface DetailsProps {
  entry: Entry;
  onClose: () => void;
  onWalk: (key: string) => void;
  prev?: string;
  next?: string;
  place: number;
  total: number;
}

function Details({ entry, onClose, onWalk, prev, next, place, total }: DetailsProps): ReactElement {
  const { state, product, worker, fetchDocumentMovements, deleteDocument, deleteFault } = useData();
  const { notify } = useUi();
  const router = useRouter();
  const { doc, fault } = entry;
  const docId = doc?.id;

  const [moved, setMoved] = useState<Movement[] | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!docId) return;
    fetchDocumentMovements(docId).then(setMoved, () => setMoved([]));
  }, [docId, fetchDocumentMovements]);

  // The receipt behind goods that left stays: without it the exit would be undocumented.
  const kept = doc?.kind === "out" && (moved === null || moved.some((m) => m.type === "out"));

  // The arrows turn the sheets the way they lie on the plate, right to left. Not while typing or deciding.
  useEffect(() => {
    if (editing || confirmDelete) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const to = e.key === "ArrowLeft" ? next : e.key === "ArrowRight" ? prev : undefined;
      if (!to) return;
      e.preventDefault();
      onWalk(to);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, confirmDelete, prev, next, onWalk]);

  const download = async () => {
    if (!doc) return;
    setDownloading(true);
    try {
      window.location.assign(await documentDownloadUrl(doc.storage_path, downloadName(entry, doc.storage_path)));
    } catch (e) {
      notify({ tone: "danger", title: "הורדת התמונה נכשלה", text: e instanceof Error ? e.message : undefined });
    } finally {
      setDownloading(false);
    }
  };

  const remove = async () => {
    // The dialog leaves first: unmounted together with this panel, it would put back the scroll lock.
    setConfirmDelete(false);
    setDeleting(true);
    try {
      if (doc) await deleteDocument(doc);
      else if (fault) await deleteFault(fault);
      notify({ tone: "success", title: `${KIND_LABEL[entry.kind]} נמחקה` });
    } catch (e) {
      setDeleting(false);
      notify({ tone: "danger", title: "המחיקה נכשלה", text: e instanceof Error ? e.message : undefined });
    }
  };

  const reporter = worker(entry.workerId)?.name;
  const faultProduct = product(fault?.product_id);
  const order = orderRef(doc?.reference);
  // The supplier or customer is the title over these. An order's name holds a word ("הזמנה 1001"), so it keeps its own direction.
  const fields: FieldItem[] = doc
    ? [
        { label: "עובד", value: reporter },
        ...(order ? [{ label: "מקור", value: <bdi>{order}</bdi> }] : []),
      ]
    : [
        { label: "מוצר", value: faultProduct?.name ?? (fault?.product_id ? "מוצר שנמחק" : "ללא מוצר") },
        { label: "דווח ע\"י", value: reporter },
        { label: "מצב", value: fault?.status === "resolved" ? <span className="mh-tone-ok">טופלה</span> : <span className="mh-tone-warn">פתוחה</span> },
        ...(fault?.resolved_at ? [{ label: "טופלה בתאריך", value: fmtFull(fault.resolved_at) }] : []),
      ];

  const requests = docId ? state.itemRequests.filter((r) => r.document_id === docId) : [];
  const lines = [
    ...(moved ?? []).map((m) => {
      const p = product(m.product_id);
      return { key: m.id, product: p, name: p?.name ?? m.external_name ?? "מוצר שנמחק", qty: fmtSigned(m.qty, m.type), tone: m.type === "in" ? "mh-tone-in" : m.type === "out" ? "mh-tone-out" : undefined, unit: p?.unit, status: undefined as (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS] | undefined };
    }),
    ...requests.map((r) => ({ key: r.id, product: undefined, name: r.proposed_name?.trim() || r.external_name, qty: fmtQty(r.qty), tone: undefined, unit: undefined, status: REQUEST_STATUS[r.status] })),
  ];

  if (editing) return <EntryForm entry={entry} onClose={() => setEditing(false)} />;

  return (
    <>
      <SidePanel
        className="mh-docs-record"
        eyebrow={<span className={KIND_TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</span>}
        title={fmtName(entry.title)}
        subtitle={<span className="ltr">{fmtFull(entry.at)}</span>}
        onClose={onClose}
        headActions={
          total > 1 ? (
            <span className="mh-docs-walk">
              <Button variant="ghost" size="sm" iconOnly icon="chevron-right" title="הרשומה הקודמת" disabled={!prev} onClick={() => prev && onWalk(prev)} />
              <Button variant="ghost" size="sm" iconOnly icon="chevron-left" title="הרשומה הבאה" disabled={!next} onClick={() => next && onWalk(next)} />
              <span className="mh-docs-place"><span className="ltr">{fmtQty(place)}</span> מתוך <span className="ltr">{fmtQty(total)}</span></span>
            </span>
          ) : null
        }
        footer={
          <>
            <div>
              {!kept ? <Button variant="danger" isLoading={deleting} onClick={() => setConfirmDelete(true)}>מחיקה</Button> : moved ? <p className="mh-docs-kept">קבלה של סחורה שיצאה נשמרת</p> : null}
            </div>
            <div>
              <Button variant="secondary" disabled={deleting} onClick={() => setEditing(true)}>עריכה</Button>
              {doc ? (
                <Button variant="secondary" icon="download" isLoading={downloading} onClick={() => void download()}>הורדת תמונה</Button>
              ) : (
                <Button variant="secondary" onClick={() => router.push(fault?.status === "resolved" ? "/faults?tab=resolved" : "/faults")}>מעבר לתקלות</Button>
              )}
            </div>
          </>
        }
      >
        <Fields items={fields} />

        {docId && moved === null ? (
          <span className="sa-skeleton" style={{ width: 200 }} />
        ) : lines.length > 0 ? (
          <section className="mh-docs-lines" aria-labelledby="mh-docs-lines-title">
            <h3 id="mh-docs-lines-title">שורות</h3>
            <ul className="mh-rows">
              {lines.map((l) => (
                <li key={l.key}>
                  <ProductThumb product={l.product} />
                  <span className="mh-row-main">
                    <span className="mh-row-title" title={l.name}>{fmtName(l.name)}</span>
                    {l.status ? <span className={cx("mh-row-sub", l.status.tone)}>{l.status.label}</span> : null}
                  </span>
                  <span className="mh-docs-qty">
                    <span className={cx("ltr", l.tone)}>{l.qty}</span>
                    {l.unit ? <small>{l.unit}</small> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </SidePanel>

      {confirmDelete ? (
        <Modal title="למחוק את הרשומה?" tone="danger" confirmLabel="מחיקה" onConfirm={() => void remove()} onClose={() => setConfirmDelete(false)}>
          <p className="m-0">{doc || fault?.photo_path ? "הרשומה והתמונה יימחקו לצמיתות." : "הרשומה תימחק לצמיתות."} המלאי לא ישתנה.</p>
        </Modal>
      ) : null}
    </>
  );
}

/** Corrects what was typed on a record; the photo, the time and who reported it stay as they were. */
function EntryForm({ entry, onClose }: { entry: Entry; onClose: () => void }): ReactElement {
  const { state, updateDocument, updateFault } = useData();
  const { notify } = useUi();
  const form = useForm<"description">();
  const { doc, fault } = entry;

  const [supplierId, setSupplierId] = useState(doc?.supplier_id ?? "");
  const [customer, setCustomer] = useState(doc?.customer ?? "");
  const [description, setDescription] = useState(fault?.description ?? "");
  const [productId, setProductId] = useState(fault?.product_id ?? "");

  const submit = () => {
    if (fault && !description.trim()) {
      form.setErrors({ description: REQUIRED });
      return;
    }
    void form.run(async () => {
      if (doc) {
        await updateDocument(doc.id, doc.kind === "in" ? { supplier_id: supplierId || null } : { customer: customer.trim() || null });
      } else if (fault) {
        await updateFault(fault, { description: description.trim(), product_id: productId || null });
      }
      notify({ tone: "success", title: "השינויים נשמרו" });
      onClose();
    });
  };

  return (
    <FormPanel
      title={`עריכת ${KIND_LABEL[entry.kind]}`}
      subtitle={<span className="ltr">{fmtFull(entry.at)}</span>}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="שמירה"
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      {fault ? (
        <>
          <Input
            label="תיאור"
            required
            multiline
            value={description}
            onChange={(e) => { setDescription(e.target.value); form.clearField("description"); }}
            error={form.errors.description}
          />
          <Select label="מוצר" options={productOptions(state.products)} value={productId} onChange={setProductId} allLabel="ללא מוצר" block />
        </>
      ) : doc?.kind === "in" ? (
        <Select label="ספק" options={supplierOptions(state.suppliers)} value={supplierId} onChange={setSupplierId} placeholder="בחירת ספק" block />
      ) : (
        <Input label="לקוח" value={customer} onChange={(e) => setCustomer(e.target.value)} autoComplete="off" />
      )}
    </FormPanel>
  );
}
