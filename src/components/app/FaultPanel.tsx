"use client";

/**
 * One fault in a SidePanel: what happened, where, who reported it, and how it closes.
 * A fault closes only with a written note of what was done, so the record stays worth reading.
 * Opened via useUi().openFault(id); reads ui.panel of type "fault".
 */
import { useState } from "react";
import Link from "next/link";
import { useFloorObjects } from "@/components/map3d/use-floor-objects";
import { Button, cx, Fields, Input, Notice, SidePanel, type TimelineItem } from "@/components/ui";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { daysAgo, fmtElapsed, fmtFull, fmtName, fmtUnit } from "@/lib/format";
import { isTempId, useData } from "@/lib/store";
import { errorMessage } from "./forms/useForm";
import { History, useMovementsById } from "./MovementPanel";
import { Figure } from "./ProductPanel";
import { useUi } from "./ui-state";
import { ProductThumb } from "./Viz";

/** A worker can write a paragraph; past this length the title drops to reading size, so it doesn't fill the sheet. */
const LONG_TITLE = 60;

/** How long an open fault has waited, as a figure and its unit. Whole days count the way the overview's "לפני 5 ימים" does. */
function waited(fromIso: string): { n: number; unit: string } {
  const to = Date.now();
  const days = daysAgo(fromIso, to);
  if (days > 0) return { n: days, unit: days === 1 ? "יום" : "ימים" };
  const min = Math.max(1, Math.floor((to - new Date(fromIso).getTime()) / 60000));
  if (min < 60) return { n: min, unit: min === 1 ? "דקה" : "דקות" };
  const hours = Math.floor(min / 60);
  return { n: hours, unit: hours === 1 ? "שעה" : "שעות" };
}

export function FaultPanel() {
  const { panel } = useUi();
  if (panel?.type !== "fault") return null;
  return <FaultPanelInner key={panel.id} id={panel.id} />;
}

function FaultPanelInner({ id }: { id: string }) {
  const { state, product, worker, resolveFault, reopenFault } = useData();
  const { close, requestClose, notify, openProduct } = useUi();
  const floor = useFloorObjects();
  const [written, setWritten] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const f = state.faults.find((row) => row.id === id);
  const [moved] = useMovementsById(f?.movement_id ? [f.movement_id] : []);
  if (!f) return null;

  const isOpen = f.status === "open";
  const p = product(f.product_id);
  const reporter = worker(f.reported_by)?.name;
  const photo = faultPhotoUrl(f.photo_path);
  const objectName = f.asset ? floor.find((o) => o.id === f.asset)?.name ?? f.asset : null;
  // A closed fault says what its row says, so one fault never shows two times.
  const wait = isOpen ? waited(f.created_at) : f.resolved_at ? fmtElapsed(f.created_at, f.resolved_at) : null;

  // A fault still saving has no id for the database to find.
  const run = async (write: () => Promise<void>, done: () => void) => {
    if (isTempId(f.id)) {
      notify({ tone: "neutral", title: "התקלה עדיין נשמרת", text: "אפשר לנסות שוב בעוד רגע" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await write();
      done();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onResolve = () =>
    run(
      () => resolveFault(f.id, written.trim()),
      () => {
        notify({ tone: "success", title: "התקלה נסגרה", text: f.description });
        close();
      },
    );

  const onReopen = () =>
    run(
      () => reopenFault(f.id),
      () => {
        setWritten("");
        notify({ tone: "success", title: "התקלה נפתחה מחדש", text: f.description });
      },
    );

  // A press that leaves the sheet asks first once a note is written, like the X.
  const typed = written.trim() !== "";

  const steps: TimelineItem[] = [
    { id: "reported", title: reporter ? `דווח ע"י ${reporter}` : "דיווח", when: fmtFull(f.created_at) },
    ...(isOpen ? [] : [{ id: "closed", title: f.resolved_by ? `נסגרה ע"י ${f.resolved_by}` : "נסגרה", when: f.resolved_at ? fmtFull(f.resolved_at) : undefined }]),
  ];

  return (
    <SidePanel
      className={cx("sa-sheet", photo && "sa-product", f.description.length > LONG_TITLE && "is-long")}
      media={
        photo ? (
          <a className="sa-product-photo" href={photo} target="_blank" rel="noreferrer" aria-label="פתיחת התמונה">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="תצלום התקלה" loading="lazy" />
          </a>
        ) : null
      }
      eyebrow="תקלה"
      title={f.description}
      subtitle={<span className={`sa-state is-${isOpen ? "bad" : "ok"}`}>{isOpen ? "פתוחה" : "טופלה"}</span>}
      summary={
        wait || moved ? (
          <dl className="sa-figures">
            {wait ? <Figure label={isOpen ? "ממתינה" : "טופלה תוך"} value={wait.n} unit={wait.unit} /> : null}
            {moved ? <Figure label="כמות" value={moved.qty} unit={fmtUnit(moved.qty, p?.unit)} /> : null}
          </dl>
        ) : undefined
      }
      // The note is the one thing typed here, so the X and Escape go through the same guard as a form's.
      onClose={requestClose}
      footer={
        <div className="sa-close-fault">
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {isOpen ? (
            <>
              <Input label="מה נעשה" required multiline value={written} disabled={busy} onChange={(e) => setWritten(e.target.value)} />
              <Button variant="primary" isLoading={busy} disabled={!written.trim()} onClick={() => void onResolve()}>סגירת התקלה</Button>
            </>
          ) : (
            <Button variant="secondary" icon="refresh" isLoading={busy} onClick={() => void onReopen()}>פתיחה מחדש</Button>
          )}
        </div>
      }
    >
      {p || f.product_id || objectName ? (
        <section className="sa-group" aria-label={p || f.product_id ? "מוצר" : "מיקום"}>
          <ul className="sa-rows flex list-none flex-col">
            <li className={cx("relative flex items-center gap-[var(--space-3)] py-[var(--space-2)]", (p || !f.product_id) && "sa-order-line")}>
              {p ? (
                <>
                  <ProductThumb product={p} />
                  <button type="button" className="sa-attention-open min-w-0 flex-1" onClick={() => (typed ? requestClose() : openProduct(p.id))}>
                    <span className="sa-truncate block">{fmtName(p.name)}</span>
                    <span className="sa-cell-sub"><span className="sa-mono ltr">{p.sku}</span></span>
                  </button>
                </>
              ) : f.product_id ? (
                <span className="min-w-0 flex-1 text-ink-3">מוצר שנמחק</span>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="sa-truncate block">{objectName}</span>
                    {f.asset && !objectName?.includes(f.asset) ? <span className="sa-cell-sub"><span className="sa-mono ltr">{f.asset}</span></span> : null}
                  </span>
                  <Link
                    className="sa-btn sa-btn-link sa-btn-sm sa-row-press"
                    href={`/3d?at=${encodeURIComponent(f.asset ?? "")}`}
                    onClick={(e) => {
                      if (typed) {
                        e.preventDefault();
                        requestClose();
                      } else close();
                    }}
                  >
                    הצגה במפה
                  </Link>
                </>
              )}
            </li>
          </ul>
        </section>
      ) : null}

      {f.resolution ? <Fields columns={1} items={[{ label: "מה נעשה", value: <span className="whitespace-pre-wrap">{f.resolution}</span> }]} /> : null}

      <History items={steps} />
    </SidePanel>
  );
}
