"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName, type Tone } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Mark } from "@/components/ui/Mark";
import { EmptyState } from "@/components/ui/EmptyState";
import { cx } from "@/components/ui/cx";
import { fmtQty } from "@/lib/format";
import "./worker.css";

/* ── BigAction: the home buttons ─────────────────────────────── */
export function BigAction({ title, sub, icon, tone, onClick }: { title: string; sub?: string; icon: IconName; tone: Tone; onClick: () => void }): ReactElement {
  return (
    <button type="button" className="sa-bigaction" onClick={onClick}>
      <Mark tone={tone} icon={icon} size="lg" />
      <span className="sa-bigaction-body">
        <span className="sa-bigaction-title" style={{ display: "block" }}>{title}</span>
        {sub ? <span className="sa-bigaction-sub" style={{ display: "block" }}>{sub}</span> : null}
      </span>
      <Icon name="chevron-left" className="sa-bigaction-chev" />
    </button>
  );
}

/* ── Step header with back arrow ─────────────────────────────── */
export function StepHead({ title, step, total, onBack }: { title: string; step?: number; total?: number; onBack: () => void }): ReactElement {
  return (
    <header className="wk-head">
      <button type="button" className="wk-back" aria-label="חזרה" onClick={onBack}>
        <Icon name="arrow-right" />
      </button>
      <h1 className="wk-title">{title}</h1>
      {step && total ? <span className="wk-step">{step}/{total}</span> : null}
    </header>
  );
}

/* ── Fixed footer with the one primary action ────────────────── */
export function Foot({ children }: { children: ReactNode }): ReactElement {
  return <div className="wk-foot"><div>{children}</div></div>;
}

/* ── Tall choice row ─────────────────────────────────────────── */
export function Row({ title, sub, end, selected, quiet, onClick, icon }: { title: ReactNode; sub?: ReactNode; end?: ReactNode; selected?: boolean; quiet?: boolean; icon?: IconName; onClick: () => void }): ReactElement {
  return (
    <button type="button" className={cx("wk-row", selected && "is-selected", quiet && "is-quiet")} onClick={onClick}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <span className="wk-row-body">
        <span style={{ display: "block" }} className="sa-truncate">{title}</span>
        {sub ? <span className="wk-row-sub sa-truncate">{sub}</span> : null}
      </span>
      {end !== undefined ? <span className="wk-row-end">{end}</span> : selected ? <Icon name="check" size={18} className="wk-row-end" /> : null}
    </button>
  );
}

/* ── Full-screen searchable picker ───────────────────────────── */
export type PickItem = { id: string; title: string; sub?: string; keywords?: string; end?: ReactNode };

export function Picker({ title, items, onPick, onClose, placeholder = "חיפוש…", extra, emptyTitle = "אין פריטים", emptyHint }: {
  title: string;
  items: PickItem[];
  onPick: (id: string) => void;
  onClose: () => void;
  placeholder?: string;
  /** An extra quiet row at the end, e.g. "לא יודע". */
  extra?: { label: string; onClick: () => void };
  emptyTitle?: string;
  emptyHint?: string;
}): ReactElement {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((it) => `${it.title} ${it.sub ?? ""} ${it.keywords ?? ""}`.toLowerCase().includes(n));
  }, [items, q]);
  return (
    <div className="wk-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="wk-sheet-inner">
        <StepHead title={title} onBack={onClose} />
        <Input ref={inputRef} size="touch" icon="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={placeholder} autoComplete="off" />
        <div className="wk-sheet-list">
          {filtered.length === 0 ? (
            <EmptyState title={emptyTitle} hint={emptyHint} />
          ) : (
            filtered.map((it) => <Row key={it.id} title={it.title} sub={it.sub} end={it.end} onClick={() => onPick(it.id)} />)
          )}
          {extra ? <Row quiet title={extra.label} onClick={extra.onClick} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ── Summary list ────────────────────────────────────────────── */
export type SummaryLine = { key: string; title: string; sub?: string; qty: number; unit?: string };

export function Summary({ meta, lines }: { meta: { k: string; v: ReactNode }[]; lines: SummaryLine[] }): ReactElement {
  return (
    <div className="wk-sum">
      {meta.map((m) => (
        <div key={m.k} className="wk-sum-row">
          <span className="wk-sum-k">{m.k}</span>
          <span className="wk-sum-v">{m.v}</span>
        </div>
      ))}
      {lines.map((l) => (
        <div key={l.key} className="wk-sum-row">
          <span className="wk-sum-v">
            {l.title}
            {l.sub ? <span className="wk-sum-sub">{l.sub}</span> : null}
          </span>
          <span className="wk-sum-qty">{fmtQty(l.qty)}{l.unit ? <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-tertiary)", marginInlineStart: 4 }}>{l.unit}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Full-screen quiet confirmation, auto-returns home after 4s ─ */
export function Done({ title, sub, lines, tone = "success", icon = "check" }: { title: string; sub?: string; lines: SummaryLine[]; tone?: Tone; icon?: IconName }): ReactElement {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace("/worker"), 4000);
    return () => clearTimeout(t);
  }, [router]);
  const bg = tone === "success" ? "var(--success)" : tone === "accent" ? "var(--accent)" : tone === "danger" ? "var(--danger)" : "var(--bg-inverse)";
  return (
    <div className="wk-done" role="status" aria-live="polite">
      <div className="wk-done-inner">
        <span className="wk-done-mark" style={{ background: bg, color: "#fff" }}><Icon name={icon} strokeWidth={3} /></span>
        <h1 className="wk-done-title">{title}</h1>
        {sub ? <p className="wk-done-sub">{sub}</p> : null}
        {lines.length ? <Summary meta={[]} lines={lines} /> : null}
        <Button variant="primary" size="touch" onClick={() => router.replace("/worker")}>פעולה נוספת</Button>
        <div className="wk-done-bar" aria-hidden="true"><span /></div>
      </div>
    </div>
  );
}
