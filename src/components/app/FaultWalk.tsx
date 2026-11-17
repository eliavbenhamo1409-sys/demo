"use client";

/**
 * מעבר על התקלות — the overview's big sheet takes the open faults one at a time and asks what to do with each:
 * hand it to a worker with an instruction, which then waits on that worker's phone, or close it with what was done.
 * Opened from the faults lane, or from סגירת יום through `/?faults=walk`; the lanes come back when it ends.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import { Button, cx, Input, Notice, Select, Tabs } from "@/components/ui";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";
import { fmtAge, fmtName, fmtQty } from "@/lib/format";
import { isTempId, useData, type Fault } from "@/lib/store";
import { errorMessage } from "./forms/useForm";
import { useUi } from "./ui-state";
import { ProductThumb } from "./Viz";
import "./fault-walk.css";

type Decision = "assigned" | "closed";

/** Past this many faults the steps would be too fine to read, so they become one line that fills. */
const STEP_MARKS = 24;

/** What still waits for a decision comes first, the longest waiting at its head; then what already waits on a worker. */
export function walkOrder(faults: Fault[]): Fault[] {
  const open = faults.filter((f) => f.status === "open").sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [...open.filter((f) => !f.assigned_to), ...open.filter((f) => f.assigned_to)];
}

const joined = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

/** What the walk did, said once when it ends. */
function outcome(done: Record<string, Decision>): string | null {
  const decisions = Object.values(done);
  const handed = decisions.filter((d) => d === "assigned").length;
  const closed = decisions.filter((d) => d === "closed").length;
  const parts = [
    handed === 1 ? "אחת הועברה לעובד" : handed > 1 ? `${fmtQty(handed)} הועברו לעובדים` : null,
    closed === 1 ? "אחת נסגרה" : closed > 1 ? `${fmtQty(closed)} נסגרו` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function FaultWalk({ from, onEnd }: { from: string | null; onEnd: () => void }): ReactElement {
  const { state } = useData();
  const { notify } = useUi();
  // The faults as they stood when the walk began, so a decision never reshuffles what comes next; one reported meanwhile joins at the end, in the order it came.
  // A walk opened by its address can begin before the data has arrived, so the order is taken once there is one to take.
  const ready = state.status !== "loading";
  const [first, setFirst] = useState<string[] | null>(() => (ready ? walkOrder(state.faults).map((f) => f.id) : null));
  if (first === null && ready) setFirst(walkOrder(state.faults).map((f) => f.id));
  const queue = useMemo(() => {
    const begun = first ?? [];
    const known = new Set(state.faults.map((f) => f.id));
    const added = state.faults
      .filter((f) => f.status === "open" && !begun.includes(f.id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((f) => f.id);
    return [...begun.filter((id) => known.has(id)), ...added];
  }, [first, state.faults]);
  const [currentId, setCurrentId] = useState(from);
  const [dir, setDir] = useState<"next" | "back">("next");
  const [done, setDone] = useState<Record<string, Decision>>({});

  const index = Math.max(0, currentId ? queue.indexOf(currentId) : 0);
  const fault = state.faults.find((f) => f.id === queue[index]);
  const last = index >= queue.length - 1;

  const end = (decided = done) => {
    const said = outcome(decided);
    if (said) notify({ tone: "success", title: "המעבר על התקלות הסתיים", text: said });
    onEnd();
  };

  const go = (step: 1 | -1, decided = done) => {
    const target = queue[index + step];
    if (target) {
      setDir(step > 0 ? "next" : "back");
      setCurrentId(target);
    } else if (step > 0) end(decided);
  };

  const decide = (id: string, decision: Decision | null) => {
    const decided = decision ? { ...done, [id]: decision } : done;
    setDone(decided);
    go(1, decided);
  };

  return (
    <div className="fw">
      <header className="fw-head">
        <div className="fw-head-text">
          <h3 className="fw-label">מעבר על התקלות</h3>
          {queue.length > 0 ? <span className="fw-count">{fmtQty(index + 1)} מתוך {fmtQty(queue.length)}</span> : null}
        </div>
        <div className="fw-head-nav">
          {queue.length > 1 ? (
            <>
              <Button variant="ghost" size="sm" icon="chevron-right" aria-label="הקודמת" disabled={index === 0} onClick={() => go(-1)}>
                <span className="fw-nav-word">הקודמת</span>
              </Button>
              <Button variant="ghost" size="sm" iconEnd="chevron-left" aria-label={last ? "סיום" : "הבאה"} onClick={() => go(1)}>
                <span className="fw-nav-word">{last ? "סיום" : "הבאה"}</span>
              </Button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" iconOnly icon="x" title="סגירת המעבר" onClick={() => end()} />
        </div>
      </header>
      {queue.length > STEP_MARKS ? (
        <div className="fw-steps is-bar" aria-hidden="true"><i style={{ inlineSize: `${((index + 1) / queue.length) * 100}%` }} /></div>
      ) : queue.length > 1 ? (
        <div className="fw-steps" aria-hidden="true">
          {queue.map((id, i) => <i key={id} className={i <= index ? "is-on" : undefined} />)}
        </div>
      ) : null}
      {fault ? (
        <Step key={fault.id} fault={fault} dir={dir} onDecided={(d) => decide(fault.id, d)} />
      ) : !ready ? null : (
        <div className="fw-body fw-empty">
          <p className="fw-empty-title">אין תקלות פתוחות</p>
          <Button variant="secondary" onClick={() => end()}>חזרה לסקירה</Button>
        </div>
      )}
    </div>
  );
}

/** One fault and the decision about it. Keyed by the fault, so what was typed never follows to the next one. */
function Step({ fault, dir, onDecided }: { fault: Fault; dir: "next" | "back"; onDecided: (decision: Decision | null) => void }): ReactElement {
  const { state, product, worker, assignFault, resolveFault } = useData();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [mode, setMode] = useState<"assign" | "close">("assign");
  const [workerId, setWorkerId] = useState(fault.assigned_to ?? "");
  const [instruction, setInstruction] = useState(fault.instruction ?? "");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arriving at a fault puts the reader on its title, never moving the page.
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);

  const p = product(fault.product_id);
  const photo = faultPhotoUrl(fault.photo_path);
  // The same names the lane gives a place, so a fault reads alike in both.
  const place = fault.asset ? DEFAULT_OBJECTS.find((o) => o.id === fault.asset)?.name ?? fault.asset : null;
  const reporter = worker(fault.reported_by)?.name;
  const holder = worker(fault.assigned_to);
  const isOpen = fault.status === "open";

  // How many open faults each worker already holds, so the load is seen before choosing.
  const options = useMemo(() => {
    const held = new Map<string, number>();
    for (const f of state.faults) if (f.status === "open" && f.assigned_to) held.set(f.assigned_to, (held.get(f.assigned_to) ?? 0) + 1);
    return state.workers.filter((w) => w.active || w.id === fault.assigned_to).map((w) => {
      const n = held.get(w.id) ?? 0;
      return { value: w.id, label: n > 0 ? `${w.name} · ${fmtQty(n)} בטיפול` : w.name };
    });
  }, [state.faults, state.workers, fault.assigned_to]);

  const chosen = worker(workerId);
  const told = instruction.trim();
  const same = !!fault.assigned_to && workerId === fault.assigned_to;
  const unchanged = same && told === (fault.instruction ?? "");
  const assignLabel = !chosen ? "שיוך לעובד" : unchanged ? `השארה אצל ${chosen.name}` : same ? "עדכון ההוראה" : `שיוך ל${chosen.name}`;

  // A fault still saving has no id for the database to find.
  const run = async (write: () => Promise<void>, decision: Decision) => {
    if (isTempId(fault.id)) {
      setError("התקלה עדיין נשמרת, אפשר לנסות שוב בעוד רגע");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await write();
      onDecided(decision);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTried(true);
    if (mode === "close") {
      if (note.trim()) void run(() => resolveFault(fault.id, note.trim()), "closed");
      return;
    }
    if (!chosen || !told) return;
    if (unchanged) onDecided(null);
    else void run(() => assignFault(fault.id, chosen.id, told), "assigned");
  };

  return (
    <div className="fw-body" data-dir={dir}>
      <div className="fw-fault">
        {photo ? (
          <a className="fw-photo" href={photo} target="_blank" rel="noreferrer" aria-label="פתיחת התמונה">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="תצלום התקלה" />
          </a>
        ) : p?.image_path ? <ProductThumb product={p} /> : null}
        <div className="fw-fault-text">
          <h4 ref={titleRef} tabIndex={-1} className="fw-fault-title">{fault.description}</h4>
          <p className="fw-fault-meta">
            <span>{joined(p ? fmtName(p.name) : place, reporter && `דווח ע"י ${reporter}`, fmtAge(fault.created_at))}</span>
            {place && fault.asset ? <Link href={`/3d?at=${encodeURIComponent(fault.asset)}`} className="fw-map">הצגה במפה</Link> : null}
          </p>
          {!isOpen ? (
            <p className="fw-fault-state"><span className="is-ok">טופלה</span>{fault.resolution ? ` · ${fault.resolution}` : null}</p>
          ) : holder ? (
            <p className="fw-fault-state">אצל {holder.name}{fault.assigned_at ? ` · ${fmtAge(fault.assigned_at)}` : null}</p>
          ) : null}
        </div>
      </div>

      {isOpen ? (
        <form className="fw-decide" onSubmit={submit} noValidate>
          <Tabs
            className="fw-modes"
            tabs={[{ value: "assign", label: "שיוך לעובד" }, { value: "close", label: "סגירה עם תיעוד" }]}
            value={mode}
            onChange={(v) => {
              setMode(v === "close" ? "close" : "assign");
              setTried(false);
              setError(null);
            }}
          />
          {mode === "assign" ? (
            <div className="fw-form">
              <div className="sa-field">
                <span className="sa-label">עובד</span>
                <Select options={options} value={workerId} onChange={setWorkerId} shown={chosen?.name} placeholder="בחירת עובד" searchPlaceholder="חיפוש לפי שם" block />
                {tried && !chosen ? <span className="sa-error" role="alert">חסר עובד</span> : null}
              </div>
              <Input
                label="הוראה לעובד"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="מה לעשות"
                hint="תופיע בטלפון של העובד"
                error={tried && !told ? "חסרה הוראה" : undefined}
                disabled={busy}
              />
              <Button type="submit" isLoading={busy} className="fw-go">{assignLabel}</Button>
            </div>
          ) : (
            <div className={cx("fw-form", "is-close")}>
              <Input
                label="מה נעשה"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                error={tried && !note.trim() ? "חסר מה נעשה" : undefined}
                disabled={busy}
                // Choosing to close is choosing to write, so the note takes the keys.
                autoFocus
              />
              <Button type="submit" isLoading={busy} className="fw-go">סגירת התקלה</Button>
            </div>
          )}
          {error ? <Notice tone="danger" title="לא נשמר">{error}</Notice> : null}
        </form>
      ) : null}
    </div>
  );
}
