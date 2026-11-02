"use client";

import Link, { useLinkStatus } from "next/link";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ProductThumb } from "@/components/app/Viz";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { cx } from "@/components/ui/cx";
import { fmtName, fmtQty } from "@/lib/format";
import type { Product } from "@/lib/store";
import "./worker.css";

/* ── Thinking: the one sign that the system is working ───────── */
export function ThinkingMark(): ReactElement {
  return <span className="wk-think" aria-hidden="true" />;
}

/** Stays out of the way on a good connection; speaks up when an answer is taking long. */
export function useTakingLong(active: boolean, ms = 6000): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setLong(true), ms);
    return () => {
      clearTimeout(t);
      setLong(false);
    };
  }, [active, ms]);
  return long;
}

export function Thinking({ label, longLabel = "עוד רגע" }: { label: string; longLabel?: string }): ReactElement {
  const long = useTakingLong(true);
  return (
    <span className="wk-thinking" role="status">
      <ThinkingMark />
      <span>{long ? longLabel : label}</span>
    </span>
  );
}

/** Full screen while data or a screen is loading, so the app is never just blank. */
export function Boot({ label = "טוען את המערכת" }: { label?: string }): ReactElement {
  return (
    <main className="wk-boot">
      <span className="wk-boot-name">ניהול מלאי</span>
      <Thinking label={label} />
    </main>
  );
}

/* ── System bar: the top of the home screen ──────────────────── */
export function SystemBar({ live }: { live: boolean }): ReactElement {
  return (
    <header className="wk-sys">
      <span className="wk-sys-name">ניהול מלאי</span>
      {live ? null : <span className="wk-live" role="status">מתחבר</span>}
    </header>
  );
}

/* ── BigAction: the home buttons ─────────────────────────────── */
function BigActionEnd(): ReactElement {
  const { pending } = useLinkStatus();
  return pending ? <ThinkingMark /> : <Icon name="chevron-left" className="sa-bigaction-chev" />;
}

export function BigAction({ title, sub, icon, href }: { title: string; sub?: string; icon: IconName; href: string }): ReactElement {
  return (
    <Link href={href} className="sa-bigaction">
      <Icon name={icon} className="sa-bigaction-icon" />
      <span className="sa-bigaction-body">
        <span className="sa-bigaction-title">{title}</span>
        {sub ? <span className="sa-bigaction-sub">{sub}</span> : null}
      </span>
      <BigActionEnd />
    </Link>
  );
}

/* ── Flow: the frame of every process ────────────────────────── */
export type FlowStep = { key: string; label: string };

/** How many sheets are open, and whether the top history entry is theirs. */
const sheets = { open: 0, entry: false };

/** How many entries a flow holds above its first step's. A skipped step holds none, so this isn't the step's place in the order. */
const entriesAbove = (entry: { wkEntries?: number } | null) => entry?.wkEntries ?? 0;

/**
 * Which step the flow is on, and which way it last moved, for the entrance direction.
 * Every step holds a history entry, so the phone's back moves one step and what was filled in stays.
 */
export function useSteps<T extends string>(order: readonly T[], first: T) {
  const [state, setState] = useState<{ step: T; dir: "forward" | "back" }>({ step: first, dir: "forward" });
  /** The step as of now: popstate and a finished save can both land before the render. */
  const now = useRef(first);
  const rewound = useRef(false);
  const last = order[order.length - 1];

  const depth = useCallback((entry: { wkStep?: T } | null) => order.indexOf(entry?.wkStep ?? first), [order, first]);
  const show = useCallback((step: T, dir: "forward" | "back") => {
    now.current = step;
    setState({ step, dir });
  }, []);

  useEffect(() => {
    if (rewound.current) return;
    rewound.current = true;
    // A reload drops the data but keeps the entries, so it starts over from the first step's entry.
    const stale = entriesAbove(window.history.state);
    if (stale > 0) window.history.go(-stale);
  }, []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // A saved flow sits on the first step's entry.
      const from = now.current === last ? 0 : order.indexOf(now.current);
      const to = depth(e.state);
      // A forward swipe would skip the checks on the step's button, so it bounces.
      if (to > from) window.history.back();
      else if (to < from) show(order[to], "back");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [depth, last, order, show]);

  const go = useCallback((step: T) => {
    const from = order.indexOf(now.current);
    const to = order.indexOf(step);
    if (to < from) {
      window.history.back();
    } else if (step === last) {
      // Saved: the steps leave history, so back goes home and home never reopens a finished flow.
      const entered = entriesAbove(window.history.state);
      if (entered > 0) window.history.go(-entered);
      show(step, "forward");
    } else if (to > from) {
      const entry = { ...window.history.state, wkStep: step, wkEntries: entriesAbove(window.history.state) + 1 };
      if (sheets.entry) {
        // A sheet that ends in the next step hands it its entry, so back doesn't reopen the sheet.
        sheets.entry = false;
        window.history.replaceState(entry, "");
      } else {
        window.history.pushState(entry, "");
      }
      show(step, "forward");
    }
  }, [last, order, show]);

  return { step: state.step, dir: state.dir, go };
}

/** An open sheet holds a history entry of its own, so the phone's back closes it and leaves the flow alone. */
export function useBackToClose(onClose: () => void, open = true): void {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    sheets.open += 1;
    if (!sheets.entry) {
      sheets.entry = true;
      window.history.pushState(window.history.state, "");
    }
    const onPop = () => {
      sheets.entry = false;
      close();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      sheets.open -= 1;
      window.removeEventListener("popstate", onPop);
      // The next sheet can take the entry over in this same commit.
      queueMicrotask(() => {
        if (sheets.open > 0 || !sheets.entry) return;
        sheets.entry = false;
        window.history.back();
      });
    };
  }, [open]);
}

/** Takes the worker to what is holding them back: scrolls there and gives it a soft pulse. */
export function pointAt(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
  el.removeAttribute("data-pointed");
  void el.offsetWidth;
  el.setAttribute("data-pointed", "");
  el.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
  window.setTimeout(() => el.removeAttribute("data-pointed"), 1400);
}

export type CtaProps = {
  label: string;
  onClick: () => void;
  /** Why the worker can't go on yet. The button stays pressable and shows them where. */
  blocked?: { reason: string; onTap: () => void } | null;
  /** While set, the system is working and this says on what. */
  busy?: string | null;
};

/** The one next step: its button, and in plain words why it isn't available yet. */
export function Cta({ label, onClick, blocked, busy }: CtaProps): ReactElement {
  const stuck = blocked && !busy ? blocked : null;
  return (
    <>
      <p className={cx("wk-why", stuck && "is-on")} role="status">
        {stuck ? <><span className="wk-why-mark" aria-hidden="true" />{stuck.reason}</> : null}
      </p>
      <Button
        variant="primary"
        size="touch"
        disabled={!!busy}
        aria-busy={busy ? true : undefined}
        aria-disabled={stuck ? true : undefined}
        className={cx("wk-cta", stuck && "is-blocked", busy && "is-busy")}
        onClick={stuck ? stuck.onTap : onClick}
      >
        {busy ? <Thinking label={busy} /> : label}
      </Button>
    </>
  );
}

/** The last button of a step and the save button are one DOM node, so a double tap must not reach the next step. */
const STEP_GUARD_MS = 500;

export function Flow({ flow, steps, current, dir, title, lead, onBack, foot, overlay, children }: {
  /** The process this is, shown above the title. */
  flow: string;
  steps: FlowStep[];
  current: string;
  dir: "forward" | "back";
  /** What the worker is doing right now. */
  title: string;
  /** What the system expects from them on this step, when the title doesn't already say it. */
  lead?: ReactNode;
  onBack: () => void;
  foot: CtaProps;
  overlay?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const router = useRouter();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const steppedAt = useRef(0);
  const index = steps.findIndex((s) => s.key === current);

  useEffect(() => { router.prefetch("/worker"); }, [router]);
  useEffect(() => {
    steppedAt.current = performance.now();
    window.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
  }, [current]);

  const press = () => {
    if (performance.now() - steppedAt.current >= STEP_GUARD_MS) foot.onClick();
  };

  return (
    <>
      <div className="wk-bar">
        <div className="wk-bar-top">
          <button type="button" className="wk-back" onClick={onBack}>
            <Icon name="chevron-right" />
            <span>חזרה</span>
          </button>
        </div>
        <ol className="wk-progress" aria-label={`התקדמות: שלב ${index + 1} מתוך ${steps.length}`}>
          {steps.map((s, i) => (
            <li key={s.key} className={cx("wk-progress-step", i < index && "is-done", i === index && "is-active")} aria-current={i === index ? "step" : undefined}>
              <span className="wk-progress-line" aria-hidden="true" />
              <span className="wk-progress-label">{s.label}</span>
            </li>
          ))}
        </ol>
      </div>
      <main key={current} className="wk-page" data-dir={dir}>
        <header className="wk-intro">
          <p className="wk-eyebrow">{flow}</p>
          <h1 ref={titleRef} tabIndex={-1} className="wk-title">{title}</h1>
          {lead ? <p className="wk-lead">{lead}</p> : null}
        </header>
        {children}
      </main>
      <div className="wk-foot"><div><Cta {...foot} onClick={press} /></div></div>
      {overlay}
    </>
  );
}

/* ── Section: one thing to do on a step ──────────────────────── */
export function Section({ id, title, lead, need, done, children }: {
  id?: string;
  title: string;
  /** What happens with it, when the title doesn't say. */
  lead?: ReactNode;
  need: "required" | "optional";
  done?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="wk-section">
      <header className="wk-section-head">
        {done ? <span className="wk-section-check" aria-hidden="true"><Icon name="check" size={18} /></span> : null}
        <div className="wk-section-text">
          <div className="wk-section-titles">
            <h2 className="wk-section-title">{title}</h2>
            {need === "optional" ? <span className="wk-need">לא חובה</span> : null}
          </div>
          {lead ? <p className="wk-section-lead">{lead}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

/* ── Hint: a quiet message, a word plus a small colour accent ── */
export function Hint({ tone = "info", title, children }: { tone?: "info" | "attention" | "success"; title: ReactNode; children?: ReactNode }): ReactElement {
  return (
    <div className={cx("wk-hint", `is-${tone}`)} role="status">
      <span className="wk-hint-mark" aria-hidden="true" />
      <div className="wk-hint-body">
        <p className="wk-hint-title">{title}</p>
        {children ? <p className="wk-hint-text">{children}</p> : null}
      </div>
    </div>
  );
}

/* ── Sheet header with back arrow ────────────────────────────── */
export function StepHead({ title, onBack }: { title: string; onBack: () => void }): ReactElement {
  return (
    <header className="wk-head">
      <button type="button" className="wk-back" onClick={onBack}>
        <Icon name="chevron-right" />
        <span>חזרה</span>
      </button>
      <h1 className="wk-head-title">{title}</h1>
    </header>
  );
}

/* ── Camera button ───────────────────────────────────────────── */
export function CameraButton({ label, onFile, quiet }: { label: string; onFile: (file: File | undefined) => void; quiet?: boolean }): ReactElement {
  return (
    <label className={cx("wk-photo", quiet && "is-quiet")}>
      <input type="file" accept="image/*" capture="environment" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} aria-label={label} />
      <Icon name="camera" />
      {label}
    </label>
  );
}

/** A row that stands for a product leads with its photo. */
type Photographed = Pick<Product, "image_path">;

/* ── Tall choice row ─────────────────────────────────────────── */
export function Row({ product, title, sub, end, selected, quiet, onClick }: { product?: Photographed; title: ReactNode; sub?: ReactNode; end?: ReactNode; selected?: boolean; quiet?: boolean; onClick: () => void }): ReactElement {
  return (
    <button type="button" className={cx("wk-row", selected && "is-selected", quiet && "is-quiet")} onClick={onClick}>
      {product ? <ProductThumb product={product} /> : null}
      <span className="wk-row-body">
        <span className="wk-row-title">{title}</span>
        {sub ? <span className="wk-row-sub">{sub}</span> : null}
      </span>
      {end !== undefined ? <span className="wk-row-end">{end}</span> : selected ? <Icon name="check" size={20} className="wk-row-end" /> : null}
    </button>
  );
}

/* ── Full-screen searchable picker ───────────────────────────── */
export type PickItem = { id: string; title: string; sub?: ReactNode; keywords?: string; end?: ReactNode; product?: Photographed };

/**
 * A warehouse product as a picker row. `stock` shows how much is on hand, for the flows that take from it.
 * The plain name stays in `keywords`: the direction marks in the title would stop a search for its size from matching.
 */
export function productPick(p: Product, stock = false): PickItem {
  return {
    id: p.id,
    title: fmtName(p.name),
    sub: <span className="sa-num">{p.sku}</span>,
    keywords: `${p.name} ${p.sku} ${p.barcode ?? ""}`,
    end: stock ? <span>במלאי <span className="sa-num">{fmtQty(p.qty)}</span> {p.unit}</span> : undefined,
    product: p,
  };
}

export function Picker({ title, context, items, onPick, onClose, placeholder = "חיפוש לפי שם", extra, emptyTitle = "לא נמצאו תוצאות" }: {
  title: string;
  /** What the worker is looking for, e.g. the wording on the receipt. */
  context?: string;
  items: PickItem[];
  onPick: (id: string) => void;
  onClose: () => void;
  placeholder?: string;
  /** An extra quiet row at the end, e.g. "לא יודע". */
  extra?: { label: string; icon?: IconName; onClick: () => void };
  emptyTitle?: string;
}): ReactElement {
  const [q, setQ] = useState("");
  useBackToClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((it) => `${it.title} ${typeof it.sub === "string" ? it.sub : ""} ${it.keywords ?? ""}`.toLowerCase().includes(n));
  }, [items, q]);
  return (
    <div className="wk-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="wk-sheet-inner">
        <StepHead title={title} onBack={onClose} />
        {context ? <p className="wk-pick-context">כתוב במסמך: <strong>{context}</strong></p> : null}
        <Input size="touch" icon="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={placeholder} autoComplete="off" />
        <div className="wk-sheet-list">
          {filtered.length === 0 ? <EmptyState title={emptyTitle} /> : (
            <div className="wk-group">
              {filtered.map((it) => <Row key={it.id} product={it.product} title={it.title} sub={it.sub} end={it.end} onClick={() => onPick(it.id)} />)}
            </div>
          )}
          {extra ? <Row quiet title={extra.label} end={extra.icon ? <Icon name={extra.icon} size={20} /> : undefined} onClick={extra.onClick} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ── Summary list ────────────────────────────────────────────── */
export type SummaryLine = { key: string; title: string; sub?: string; qty: number; unit?: string; product?: Photographed };

export function Summary({ heading, meta = [], lines, direction }: {
  heading?: string;
  meta?: { k: string; v: ReactNode }[];
  lines: SummaryLine[];
  /** Which way these lines move the stock, for the colour of the figure. */
  direction?: "in" | "out";
}): ReactElement | null {
  if (!meta.length && !lines.length) return null;
  // A line sent to the manager has no product yet: beside photos it keeps an empty frame, so the names keep one edge.
  const photos = lines.some((l) => l.product);
  return (
    <div className="wk-sum">
      {heading ? <p className="wk-sum-heading">{heading}</p> : null}
      <div className="wk-group">
        {meta.map((m) => (
          <div key={m.k} className="wk-sum-row">
            <span className="wk-sum-k">{m.k}</span>
            <span className="wk-sum-v">{m.v}</span>
          </div>
        ))}
        {lines.map((l) => (
          <div key={l.key} className="wk-sum-row">
            {photos ? <ProductThumb product={l.product} /> : null}
            <span className="wk-sum-v">
              {l.title}
              {l.sub ? <span className="wk-sum-sub">{l.sub}</span> : null}
            </span>
            <span className={cx("wk-sum-qty", direction && `is-${direction}`)}><span className="wk-sum-n">{fmtQty(l.qty)}</span>{l.unit ? <span className="wk-sum-unit">{l.unit}</span> : null}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const RETURN_MS = 8000;

/* ── Full-screen confirmation, returns home on its own ───────── */
export function Done({ title, sub, lines }: { title: string; sub?: string; lines: SummaryLine[] }): ReactElement {
  const router = useRouter();
  useEffect(() => {
    router.prefetch("/worker");
    const t = setTimeout(() => router.replace("/worker"), RETURN_MS);
    return () => clearTimeout(t);
  }, [router]);
  return (
    <div className="wk-done" role="status" aria-live="polite">
      <div className="wk-done-inner">
        <span className="wk-done-mark"><Icon name="check" /></span>
        <h1 className="wk-done-title">{title}</h1>
        {sub ? <p className="wk-done-sub">{sub}</p> : null}
        <Summary lines={lines} />
        <div className="wk-done-foot">
          <Button variant="primary" size="touch" onClick={() => router.replace("/worker")}>חזרה למסך הראשי</Button>
        </div>
      </div>
    </div>
  );
}
