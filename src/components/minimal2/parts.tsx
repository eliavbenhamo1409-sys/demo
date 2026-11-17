"use client";

/**
 * The one frame every page of מינימל 2 stands in, so the same kind of thing is always in the same place:
 * the name, the figures, then tabs and search, then the work. No sentence retells the figures, and a number stands
 * once on a screen. And the small things that say a thing is done: a count that comes down, a check that draws once.
 */
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CountUp } from "@/components/app/Viz";
import { Icon } from "@/components/ui";
import { useData } from "@/lib/store";
import { Line, type LineName, type LineTone } from "./icons";
import { handledToday, openFaults, pendingNames, pendingRequests } from "./work";

export type Tone = "ok" | "warn" | "bad" | "short" | "none";

/**
 * Colour is a state, never a decoration: green is fine or done, amber waits for someone, red is missing or wrong, blue
 * is what gets pressed. An icon takes the colour of the state it stands for and is grey when it stands for none, so
 * two things that differ look different before a word is read.
 */
const LINE_TONE: Record<Tone, LineTone> = { ok: "ok", warn: "warn", bad: "bad", short: "short", none: "quiet" };

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
  /** A second fact in a word or a figure, only where the page says it nowhere else. Never a sentence. */
  note?: ReactNode;
  tone?: Tone;
  /** What the figure counts, drawn: it takes the figure's colour, so each figure of a row is told apart at a glance. */
  icon?: LineName;
  /** A colour for the drawing alone, where the figure itself stays ink: goods in are green and goods out are red. */
  iconTone?: Tone;
  href?: string;
  onClick?: () => void;
  /** This is the one the list under it shows now. */
  current?: boolean;
}

function MetricBody({ m }: { m: Metric }): ReactElement {
  return (
    <>
      <span className="mn2-metric-label">
        {m.icon ? <Line name={m.icon} size={18} tone={lineTone(m.iconTone ?? m.tone)} /> : null}
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

/** True under an area's head (`AreaHead` in Rail.tsx): the area is named there, so the page adds no title of its own. */
export const UnderAreaHead = createContext(false);

/** The free end of the rectangle's row in an area's head. A page with nothing but a search puts it there, so no row is spent on it. */
export const AreaTools = createContext<HTMLElement | null>(null);

export interface PageProps {
  /** The page's name. Drawn only where the page stands alone; under an area's head the rectangle names it. */
  title: string;
  /** A quiet word beside the name that is not a count, like the day. */
  aside?: ReactNode;
  /** News only this page has, in one line. Left out when there is none: the figures say the rest. */
  lead?: ReactNode;
  /** At the head's far end. */
  action?: ReactNode;
  metrics?: Metric[];
  /** Tabs, filters and the page's search: always between the figures and the work. */
  toolbar?: ReactNode;
  /** A search alone, for a page with no tabs of its own: it stands at the end of the area's rectangle, or in a row of its own where there is none. */
  tools?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Page({ title, aside, lead, action, metrics, toolbar, tools, className, children }: PageProps): ReactElement {
  const named = useContext(UnderAreaHead);
  const slot = useContext(AreaTools);
  return (
    <div className={`sa-page mn2-page${className ? ` ${className}` : ""}`}>
      {named && !lead && !action ? null : (
        <header className="mn2-head">
          <div className="mn2-head-text">
            {named ? null : (
              <div className="mn2-head-title">
                <h1 className="sa-page-title">{title}</h1>
                {aside ? <Word>{aside}</Word> : null}
              </div>
            )}
            {lead ? <p className="mn2-lead">{lead}</p> : null}
          </div>
          {action ? <div className="mn2-head-action">{action}</div> : null}
        </header>
      )}
      {metrics && metrics.length > 0 ? <Metrics items={metrics} /> : null}
      {toolbar}
      {tools ? (slot ? createPortal(tools, slot) : named ? null : <div className="mn2-tools">{tools}</div>) : null}
      {children}
    </div>
  );
}

/** A block of a page: an icon and a name, its figure at the far end, and the work under it. */
export function Block({ icon, tone, title, sub, actions, id, className, children }: {
  icon?: LineName;
  tone?: Tone;
  title: string;
  /** Only what the name cannot say, in a few words. */
  sub?: ReactNode;
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
          <h2 className="mn2-block-title">{title}</h2>
          {sub ? <p className="mn2-block-sub">{sub}</p> : null}
        </div>
        {actions ? <div className="mn2-block-actions">{actions}</div> : null}
      </header>
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

/**
 * What was decided today, at the far end of a head: the ring and one figure. It says nothing until the first decision
 * of the day, so it arrives as the reward for it and not as a zero to look at. What still waits is the rail's number.
 */
export function DoneToday(): ReactElement | null {
  const { state } = useData();
  const progress = useDayProgress();
  if (state.status !== "ready" || progress.done === 0) return null;
  return (
    <p className={`mn2-done${progress.left === 0 ? " is-full" : ""}`} title="החלטות מהיום: תקלות שנסגרו, שורות ושמות שאושרו">
      <DayRing progress={progress} size={24} />
      <span className="mn2-done-n"><CountUp value={progress.done} /></span>
      {progress.done === 1 ? "טופלה היום" : "טופלו היום"}
    </p>
  );
}
