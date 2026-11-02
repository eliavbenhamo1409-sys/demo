"use client";

import { Fragment, useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { ProductThumb } from "@/components/app/Viz";
import { Button } from "@/components/ui/Button";
import { Dot } from "@/components/ui/Dot";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/cx";
import type { Product } from "@/lib/store";
import { fmtName, fmtQty } from "@/lib/format";
import type { ReadLine, Scan, ScanDoc, ScanStage } from "@/lib/worker/scan";
import { CameraButton, useBackToClose, useTakingLong } from "@/components/worker";

const STAGES: { key: ScanStage; label: string }[] = [
  { key: "prepare", label: "מכין את התמונה" },
  { key: "read", label: "קורא את הכתוב במסמך" },
  { key: "match", label: "משווה למוצרים במחסן" },
];

/** One line of the sheet. `fine` ticks it; otherwise it waits for the worker. */
export type ComparedRow = { key: string; name: string; sub: string; qty?: number; product?: Product; fine: boolean };
/** How a reading stands against an order, for the sheet to show in place of the reading itself. */
export type Compared = { title: string; lead?: string; cta: string; rows: ComparedRow[] };

function Document({ doc }: { doc: ScanDoc | null }): ReactElement {
  return (
    <figure className={cx("wk-doc", !doc && "is-waiting")}>
      {doc ? (
        <Fragment key={doc.url}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={doc.url} alt="המסמך שצולם" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="wk-doc-clean"><img src={doc.url} alt="" /></span>
          {doc.regions.map((r, i) => (
            <span key={i} className="wk-mark" style={{ "--x": r.x, "--y": r.y, "--w": r.w, "--h": r.h } as CSSProperties} />
          ))}
          <span className="wk-doc-line" />
        </Fragment>
      ) : null}
    </figure>
  );
}

function Stages({ stage, checking }: { stage: ScanStage; checking?: boolean }): ReactElement {
  const now = STAGES.findIndex((s) => s.key === stage);
  const long = useTakingLong(true, 9000);
  return (
    <div className="wk-scan-panel">
      <ol className="wk-scan-stages">
        {STAGES.map((s, i) => (
          <li key={s.key} className={cx("wk-scan-stage-row", i < now && "is-done", i === now && "is-active")} aria-current={i === now ? "step" : undefined}>
            <span className="wk-scan-tick" aria-hidden="true">{i < now ? <Icon name="check" size={18} /> : i === now ? <span className="wk-scan-spin" /> : null}</span>
            {s.key === "match" && checking ? "משווה להזמנה" : s.label}
          </li>
        ))}
      </ol>
      <p className="wk-scan-status" role="status">
        {long ? "עוד רגע, ממשיך לקרוא" : null}
      </p>
    </div>
  );
}

function ResultRow({ name, sub, qty, product, fine }: Omit<ComparedRow, "key">): ReactElement {
  return (
    <li className="wk-read">
      <span className="wk-read-tick" aria-hidden="true">{fine ? <Icon name="check" size={18} /> : <Dot tone="warning" />}</span>
      <ProductThumb product={product} small />
      <span className="wk-read-body">
        <span className="wk-read-name">{name}</span>
        <span className="wk-read-sub">{sub}</span>
      </span>
      {qty !== undefined ? <span className="wk-read-qty">{fmtQty(qty)}</span> : null}
    </li>
  );
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export function Scanner({ scan, docName, unit, identify, onContinue, onManual, onRetake, onCancel, needsDocument, checking, compared }: {
  scan: Scan;
  /** The document, with its article: התעודה, הקבלה. */
  docName: string;
  /** What the flow calls one line: "שורה" or "פריט". */
  unit: { one: string; many: string };
  /** The product a read line was recognised as, if it was. */
  identify: (line: ReadLine) => Product | undefined;
  onContinue: () => void;
  onManual: () => void;
  onRetake: (file: File | undefined) => void;
  onCancel: () => void;
  /** A photo with nothing on it is only retaken. A failed reading still goes on by hand, so an outage doesn't stop the work. */
  needsDocument?: boolean;
  /** The reading is checked against an order, so a failed one goes on unchecked rather than by hand. */
  checking?: boolean;
  compared?: Compared | null;
}): ReactElement | null {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const settled = scan.status !== "idle" && scan.status !== "reading";
  useBackToClose(onCancel, scan.status !== "idle");
  useEffect(() => {
    if (settled) headingRef.current?.focus({ preventScroll: true });
  }, [settled]);

  if (scan.status === "idle") return null;

  const open = scan.status === "read" ? scan.goods.filter((l) => !identify(l)).length : 0;
  const known = scan.status === "read" ? scan.goods.length - open : 0;

  return (
    <div className={cx("wk-scan", settled && "is-settled")} role="dialog" aria-modal="true" aria-label={`קריאת ${docName}`}>
      {scan.status === "reading" ? (
        <header className="wk-scan-head">
          <h1 className="wk-scan-title">{`מעבד את ${docName}`}</h1>
        </header>
      ) : null}
      <div className="wk-scan-stage">
        <Document doc={scan.doc} />
      </div>
      {scan.status === "reading" ? (
        <>
          <Stages stage={scan.stage} checking={checking} />
          <button type="button" className="wk-scan-cancel" onClick={onCancel}>ביטול</button>
        </>
      ) : null}

      {scan.status === "read" ? (
        <div className="wk-scan-sheet">
          <div className="wk-scan-sheet-head">
            <h2 ref={headingRef} tabIndex={-1} className="wk-scan-sheet-title">
              {compared ? compared.title : scan.goods.length ? `נקראו ${count(scan.goods.length, `${unit.one} אחת`, unit.many)}` : "לא נמצאו שורות סחורה במסמך"}
            </h2>
            {!compared || compared.lead ? (
              <p className="wk-scan-sheet-lead">
                {compared ? compared.lead : scan.goods.length
                  ? open === 0 ? "הכל זוהה" : `${known ? `${count(known, "אחת זוהתה", "זוהו")} · ` : ""}${count(open, "אחת מחכה", "מחכות")} לך`
                  : "יש במסמך רק עבודות"}
              </p>
            ) : null}
          </div>
          <ul className="wk-scan-list">
            {compared
              ? compared.rows.map(({ key, ...row }) => <ResultRow key={key} {...row} />)
              : scan.goods.map((l, i) => {
                  const p = identify(l);
                  return <ResultRow key={`${l.externalName}-${i}`} name={l.externalName} sub={p ? `זוהה: ${fmtName(p.name)}` : "מחכה לתשובה שלך"} qty={l.qty} product={p} fine={!!p} />;
                })}
            {scan.services.map((sv, i) => (
              <li key={`${sv.externalName}-${i}`} className="wk-read">
                <span className="wk-read-tick" aria-hidden="true" />
                <ProductThumb small />
                <span className="wk-read-body">
                  <span className="wk-read-name">{sv.externalName}</span>
                  <span className="wk-read-sub">עבודה, לא נוגעת במלאי</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="wk-scan-actions">
            <Button variant="primary" size="touch" onClick={onContinue}>{compared?.cta ?? "המשך לבדיקה"}</Button>
            <CameraButton quiet label="צילום מחדש" onFile={onRetake} />
          </div>
        </div>
      ) : null}

      {scan.status === "empty" || scan.status === "failed" ? (
        <div className="wk-scan-sheet">
          <div className="wk-scan-sheet-head">
            <h2 ref={headingRef} tabIndex={-1} className="wk-scan-sheet-title">{scan.status === "empty" ? "לא נמצאו שורות במסמך" : "הקריאה לא הצליחה"}</h2>
            <p className="wk-scan-sheet-lead">
              {scan.status === "failed"
                ? checking ? "לצלם שוב, או להמשיך בלי בדיקה" : "לצלם שוב, או להקליד ידנית"
                : needsDocument ? "לצלם שוב מקרוב" : "לצלם שוב מקרוב, או להקליד ידנית"}
            </p>
          </div>
          <div className="wk-scan-actions">
            <CameraButton label="צילום מחדש" onFile={onRetake} />
            {scan.status === "empty" && needsDocument
              ? <Button variant="secondary" size="touch" onClick={onCancel}>ביטול</Button>
              : <Button variant="secondary" size="touch" onClick={onManual}>{checking ? "המשך בלי בדיקה" : "הקלדה ידנית"}</Button>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
