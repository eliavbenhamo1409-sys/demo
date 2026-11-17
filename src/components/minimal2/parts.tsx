"use client";

/**
 * The one frame every page of מינימל 2 stands in, so the same kind of thing is always in the same place:
 * the name and where it stands, one sentence, the figures, the one action, then tabs and search, then the work.
 * And the small things that say a thing is done: a count that comes down, a check that draws once.
 */
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { CountUp } from "@/components/app/Viz";
import { Icon } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import { useData } from "@/lib/store";
import { Line, type LineName, type LineTone } from "./icons";
import { handledToday, openFaults, pendingNames, pendingRequests } from "./work";

export type Tone = "ok" | "warn" | "bad" | "short" | "none";

/** An icon is grey. It takes colour only for the one loud red, as the owner's own sketch has it; the figure beside it says the rest. */
const LINE_TONE: Record<Tone, LineTone> = { ok: "quiet", warn: "quiet", bad: "quiet", short: "short", none: "quiet" };

export const lineTone = (tone: Tone | undefined): LineTone => (tone ? LINE_TONE[tone] : "quiet");

/** A state said in a word, in its colour: never colour alone. */
export function Word({ tone = "none", children }: { tone?: Tone; children: ReactNode }): ReactElement {
  return <span className={`mn2-word is-${tone}`}>{children}</span>;
}

/* ───────── the frame ───────── */

export interface Metric {
  key: string;
  label: string;
  /** A number counts up to its value on arrival and when it changes; anything else is shown as it is. */
  value: number | ReactNode;
  note?: ReactNode;
  tone?: Tone;
  icon?: LineName;
  href?: string;
  onClick?: () => void;
  /** This is the one the list under it shows now. */
  current?: boolean;
}

function MetricBody({ m }: { m: Metric }): ReactElement {
  return (
    <>
      <span className="mn2-metric-label">
        {m.icon ? <Line name={m.icon} size={18} tone={lineTone(m.tone)} /> : null}
        {m.label}
        {m.href || m.onClick ? <Icon name="chevron-left" size={14} className="mn2-metric-go" /> : null}
      </span>
      {/* Words stand a size under figures, so a phrase like לפני שבועיים never outweighs a number beside it. */}
      <span className={`mn2-metric-n is-${m.tone ?? "none"}${typeof m.value === "string" ? " is-words" : ""}`}>{typeof m.value === "number" ? <CountUp value={m.value} /> : m.value}</span>
      {m.note ? <span className="mn2-metric-note">{m.note}</span> : null}
    </>
  );
}

/** The page's figures on one sheet, a rule between them. One that opens something is a link or a button; the rest only say. */
export function Metrics({ items }: { items: Metric[] }): ReactElement {
  return (
    <div className="mn2-metrics" style={{ "--n": items.length } as CSSProperties}>
      {items.map((m) =>
        m.href ? (
          <Link key={m.key} href={m.href} className={`mn2-metric is-press${m.current ? " is-current" : ""}`} aria-current={m.current ? "true" : undefined}>
            <MetricBody m={m} />
          </Link>
        ) : m.onClick ? (
          <button key={m.key} type="button" className={`mn2-metric is-press${m.current ? " is-current" : ""}`} aria-pressed={m.current} onClick={m.onClick}>
            <MetricBody m={m} />
          </button>
        ) : (
          <div key={m.key} className="mn2-metric">
            <MetricBody m={m} />
          </div>
        ),
      )}
    </div>
  );
}

export interface PageProps {
  title: string;
  /** Where the page stands, in a word beside its name. */
  state?: { word: ReactNode; tone: Tone };
  /** One sentence that says what is going on. It wraps; it is never cut. */
  lead: ReactNode;
  /** The page's one main action, always at the head's far end. */
  action?: ReactNode;
  metrics?: Metric[];
  /** Tabs, filters and the page's search: always between the figures and the work. */
  toolbar?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Page({ title, state, lead, action, metrics, toolbar, className, children }: PageProps): ReactElement {
  return (
    <div className={`sa-page mn2-page${className ? ` ${className}` : ""}`}>
      <header className="mn2-head">
        <div className="mn2-head-text">
          <div className="mn2-head-title">
            <h1 className="sa-page-title">{title}</h1>
            {state ? <Word tone={state.tone}>{state.word}</Word> : null}
          </div>
          <p className="mn2-lead">{lead}</p>
        </div>
        {action ? <div className="mn2-head-action">{action}</div> : null}
      </header>
      {metrics && metrics.length > 0 ? <Metrics items={metrics} /> : null}
      {toolbar}
      {children}
    </div>
  );
}

/** A block of a page: an icon and a name, what it is for, and what can be done with all of it. */
export function Block({ icon, tone, eyebrow, title, sub, count, actions, id, className, children }: {
  icon?: LineName;
  tone?: Tone;
  /** A quiet word over the name: which step of a process this is. */
  eyebrow?: string;
  title: string;
  sub?: ReactNode;
  count?: number;
  actions?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <section id={id} className={`sa-card mn2-block${className ? ` ${className}` : ""}`}>
      <header className="mn2-block-head">
        {icon ? <Line name={icon} size={22} tone={lineTone(tone)} /> : null}
        <div className="mn2-block-text">
          {eyebrow ? <p className="mn2-block-eyebrow">{eyebrow}</p> : null}
          <h2 className="mn2-block-title">
            {title}
            {count !== undefined ? <span className="mn2-block-count">{fmtQty(count)}</span> : null}
          </h2>
          {sub ? <p className="mn2-block-sub">{sub}</p> : null}
        </div>
        {actions ? <div className="mn2-block-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A word on the desk over a part of a long page, and what the manager does there. */
export function Chapter({ title, ask, id, children }: { title: string; ask?: ReactNode; id?: string; children: ReactNode }): ReactElement {
  return (
    <section id={id} className="mn2-chapter">
      <h2 className="mn2-chapter-head">
        <span className="mn2-chapter-title">{title}</span>
        {ask ? <span className="mn2-chapter-ask">{ask}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** A green check that draws itself once. Reduced motion shows it drawn. */
export function Check({ size = 20 }: { size?: number }): ReactElement {
  return (
    <svg className="mn2-check" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle className="mn2-check-ring" cx="12" cy="12" r="10" pathLength={1} />
      <path className="mn2-check-mark" d="m16 9-5.5 5.5L8 12" pathLength={1} />
    </svg>
  );
}

/* ───────── what was just handled ───────── */

export type WinKind = "fault" | "approval" | "order";
export type Win = { id: string; kind: WinKind; title: string };

type Wins = { recent: Win[]; dismiss: (id: string) => void };

const WinsCtx = createContext<Wins>({ recent: [], dismiss: () => undefined });

type Marks = Map<string, string>;

/**
 * Watches the rows that wait on someone and notices the moment one stops waiting: a fault closed, a line decided,
 * a supplier's name approved, an order delivered. Whoever did it, here or on a phone, the list it left says so for a
 * moment before the row is gone, so handling something is seen and not only assumed.
 */
export function WinsProvider({ children }: { children: ReactNode }): ReactElement {
  const { state } = useData();

  const marks = useMemo<Marks>(() => {
    const map: Marks = new Map();
    for (const f of state.faults) map.set(`fault:${f.id}`, `${f.status}|${f.description}`);
    for (const r of state.itemRequests) map.set(`approval:${r.id}`, `${r.status === "pending" ? "open" : "resolved"}|${r.proposed_name?.trim() || r.external_name}`);
    for (const i of state.supplierItems) map.set(`approval:${i.id}`, `${i.status === "pending" ? "open" : "resolved"}|${i.external_name}`);
    for (const o of state.orders) map.set(`order:${o.id}`, `${o.status === "open" ? "open" : o.status === "delivered" ? "resolved" : "gone"}|${o.customer}`);
    return map;
  }, [state.faults, state.itemRequests, state.supplierItems, state.orders]);

  const [seen, setSeen] = useState(marks);
  const [recent, setRecent] = useState<Win[]>([]);

  // Compared while rendering, as React asks for state that follows other state: an effect would paint the old list once more.
  if (seen !== marks) {
    setSeen(marks);
    const fresh: Win[] = [];
    // The first read fills an empty map, so nothing that was already closed is announced.
    for (const [id, before] of seen) {
      const now = marks.get(id);
      if (!before.startsWith("open|") || !now?.startsWith("resolved|")) continue;
      fresh.push({ id, kind: id.slice(0, id.indexOf(":")) as WinKind, title: now.slice(now.indexOf("|") + 1) });
    }
    if (fresh.length > 0) setRecent((list) => [...list.filter((w) => !fresh.some((f) => f.id === w.id)), ...fresh].slice(-6));
  }

  const value = useMemo<Wins>(() => ({ recent, dismiss: (id) => setRecent((list) => list.filter((w) => w.id !== id)) }), [recent]);
  return <WinsCtx.Provider value={value}>{children}</WinsCtx.Provider>;
}

/** How long a handled row stays before it leaves. */
const WIN_MS = 3600;

const WIN_WORD: Record<WinKind, string> = { fault: "טופלה", approval: "הוחלט", order: "נמסרה" };

function WinRow({ win, onGone }: { win: Win; onGone: (id: string) => void }): ReactElement {
  useEffect(() => {
    const timer = setTimeout(() => onGone(win.id), WIN_MS);
    return () => clearTimeout(timer);
  }, [win.id, onGone]);
  return (
    <li className="mn2-win">
      <Check size={20} />
      <span className="mn2-win-word">{WIN_WORD[win.kind]}</span>
      <span className="mn2-win-title">{win.title}</span>
    </li>
  );
}

/** At the head of a work list: what just left it, said once and then gone. `sheet` gives it a sheet of its own, for a list that isn't on one of ours. */
export function JustHandled({ kind, sheet }: { kind: WinKind; sheet?: boolean }): ReactElement | null {
  const { recent, dismiss } = useContext(WinsCtx);
  const mine = recent.filter((w) => w.kind === kind);
  if (mine.length === 0) return null;
  const list = (
    <ul className="mn2-wins" role="status">
      {mine.map((w) => <WinRow key={w.id} win={w} onGone={dismiss} />)}
    </ul>
  );
  return sheet ? <div className="sa-card mn2-sheet">{list}</div> : list;
}

/* ───────── the day's progress ───────── */

export type DayProgress = { done: number; left: number; total: number; share: number };

/** What was handled today against what still waits for a decision. Stock is not in it: no press closes a shortage. */
export function useDayProgress(): DayProgress {
  const { state, product } = useData();
  return useMemo(() => {
    const done = handledToday(state.faults, state.itemRequests, state.supplierItems).total;
    const left = openFaults(state.faults).length + pendingRequests(state.itemRequests).length + pendingNames(state.supplierItems, product).length;
    const total = done + left;
    return { done, left, total, share: total === 0 ? 1 : done / total };
  }, [state.faults, state.itemRequests, state.supplierItems, product]);
}

const RING_R = 10;

/** The day as a ring that closes: handled today out of everything that waited. Full, it carries a check. */
export function DayRing({ progress, size = 28 }: { progress: DayProgress; size?: number }): ReactElement {
  const full = progress.left === 0;
  return (
    <svg className={`mn2-ring${full ? " is-full" : ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle className="mn2-ring-track" cx="12" cy="12" r={RING_R} />
      <circle className="mn2-ring-fill" cx="12" cy="12" r={RING_R} pathLength={1} style={{ strokeDasharray: `${Math.max(0, Math.min(1, progress.share))} 1` }} transform="rotate(-90 12 12)" />
      {full ? <path className="mn2-ring-mark" d="m16 9-5.5 5.5L8 12" pathLength={1} /> : null}
    </svg>
  );
}

/** The same fact in words, for the top bar: always there, so every decision made is seen to count. */
export function DayPulse(): ReactElement | null {
  const { state } = useData();
  const progress = useDayProgress();
  if (state.status !== "ready") return null;
  const words =
    progress.total === 0 ? "אין מה לטפל היום"
    : progress.left === 0 ? `הכל טופל היום · ${fmtQty(progress.done)}`
    : progress.done === 0 ? `${fmtQty(progress.left)} מחכים לטיפול`
    : `טופלו היום ${fmtQty(progress.done)} מתוך ${fmtQty(progress.total)}`;
  return (
    <Link href="/" className={`mn2-pulse${progress.left === 0 ? " is-full" : ""}`} title="ההתקדמות של היום: מה טופל מתוך מה שחיכה להחלטה">
      <DayRing progress={progress} />
      <span>{words}</span>
    </Link>
  );
}
