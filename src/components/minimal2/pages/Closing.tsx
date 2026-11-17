"use client";

/**
 * סגירת יום in the order a person closes a day. First the answer and the one press: which day this is, where it
 * stands, and the button that closes it. Then what still stands open, a line for each kind that opens in place. Then
 * what came in and what went out, side by side, in the colours goods move in everywhere: in is green, out is red.
 * The same records and the same signature as the shared page (`day_summary`, `sign_day`): only the order is new.
 * A day with something open can still be closed, with a written reason; the database asks for it, not this screen.
 */
import { Suspense, useCallback, useState, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { errorMessage, REQUIRED } from "@/components/app/forms/useForm";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, Icon, Input, Modal, MovementQty, Notice } from "@/components/ui";
import { byPromise, fmtAge, fmtCompact, fmtDay, fmtName, fmtPrice, fmtQty, fmtTime, fmtUnit } from "@/lib/format";
import {
  canSign,
  dayEnd,
  fmtClosingDay,
  isDay,
  israelToday,
  shiftDay,
  useDaySignoff,
  useDaySummary,
  useFirstClosedDay,
  type DayAction,
  type DayOpenItems,
  type DaySignoff,
  type DaySummary,
  type MovedLine,
} from "@/lib/day-closing";
import { useData } from "@/lib/store";
import type { LineName } from "../icons";
import { Line } from "../icons";
import { Block, Check, lineTone, Page, Word, type Tone } from "../parts";
import { listWords } from "../work";

/** The lines a list shows before it asks to be opened. */
const LIST_ROWS = 5;

const ACTION_LABEL: Record<DayAction["kind"], string> = {
  request_approved: "שורה אושרה",
  request_rejected: "שורה נדחתה",
  name_approved: "שם ספק אושר",
  count: "תיקון ספירה",
  no_receipt: "הוצאה בלי קבלה",
  fault_resolved: "תקלה טופלה",
  order_delivered: "הזמנה נמסרה",
};

const openCount = (o: DayOpenItems) => o.faults + o.requests + o.names;

const openWords = (o: DayOpenItems) =>
  listWords([
    o.faults > 0 ? (o.faults === 1 ? "תקלה אחת" : `${fmtQty(o.faults)} תקלות`) : "",
    o.requests > 0 ? (o.requests === 1 ? "שורה אחת לא מזוהה" : `${fmtQty(o.requests)} שורות לא מזוהות`) : "",
    o.names > 0 ? (o.names === 1 ? "שם ספק אחד" : `${fmtQty(o.names)} שמות ספק`) : "",
  ].filter(Boolean));

const worthOf = (lines: MovedLine[]) => Math.round(lines.reduce((sum, l) => sum + (l.worth ?? 0), 0));

type OpenRow = { key: string; title: string; meta: string; action?: { label: string; run: () => void } };

/** One kind of open thing: its drawing and its count on a line, and its rows under it when opened. */
function Kind({ icon, tone, label, rows, open, onToggle }: { icon: LineName; tone: Tone; label: string; rows: OpenRow[]; open: boolean; onToggle: () => void }): ReactElement {
  const [whole, setWhole] = useState(false);
  const shown = whole ? rows : rows.slice(0, LIST_ROWS);
  return (
    <li className={`mn2-kind${open ? " is-open" : ""}`}>
      <button type="button" className="mn2-kind-head" aria-expanded={open} onClick={onToggle}>
        <Line name={icon} size={22} tone={lineTone(tone)} />
        <span className="mn2-kind-label">{label}</span>
        <span className={`mn2-kind-n is-${tone}`}>{fmtQty(rows.length)}</span>
        <Icon name="chevron-down" size={16} className="mn2-kind-chev" />
      </button>
      {open ? (
        <ul className="mn2-rows">
          {shown.map((r) => (
            <li key={r.key}>
              {r.action ? (
                <button type="button" className="mn2-row" onClick={r.action.run}>
                  <span className="mn2-row-text">
                    <span className="mn2-row-title">{r.title}</span>
                    <span className="mn2-row-why">{r.meta}</span>
                  </span>
                  <span className="sa-btn sa-btn-sm sa-btn-secondary mn2-row-act">{r.action.label}</span>
                </button>
              ) : (
                <div className="mn2-row is-static">
                  <span className="mn2-row-text">
                    <span className="mn2-row-title">{r.title}</span>
                    <span className="mn2-row-why">{r.meta}</span>
                  </span>
                </div>
              )}
            </li>
          ))}
          {rows.length > LIST_ROWS ? (
            <li className="mn2-more"><Button variant="link" size="sm" aria-expanded={whole} onClick={() => setWhole(!whole)}>{whole ? "פחות" : `עוד ${fmtQty(rows.length - LIST_ROWS)}`}</Button></li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

/** What came in or went out: its sum at the head, then its lines. An exit with no receipt is never under the fold. */
function Moved({ icon, tone, title, lines, empty }: { icon: LineName; tone: Tone; title: string; lines: MovedLine[]; empty: string }): ReactElement {
  const { product } = useData();
  const { openProduct } = useUi();
  const [whole, setWhole] = useState(false);
  const sorted = [...lines].sort((a, b) => Number(b.no_receipt > 0) - Number(a.no_receipt > 0));
  const shown = whole ? sorted : sorted.slice(0, LIST_ROWS);
  const noReceipt = lines.reduce((sum, l) => sum + l.no_receipt, 0);
  return (
    <Block
      icon={icon}
      tone={tone}
      title={title}
      sub={noReceipt > 0 ? <Word tone="warn">{noReceipt === 1 ? "הוצאה אחת בלי קבלה" : `${fmtQty(noReceipt)} הוצאות בלי קבלה`}</Word> : undefined}
      actions={<span className="mn2-block-n ltr">{fmtCompact(worthOf(lines))}</span>}
    >
      {lines.length === 0 ? (
        <p className="mn2-block-empty">{empty}</p>
      ) : (
        <ul className="mn2-rows">
          {shown.map((l) => {
            const p = product(l.product_id);
            const body = (
              <>
                <ProductThumb product={p} small />
                <span className="mn2-row-text">
                  <span className="mn2-row-title">{fmtName(l.name)}</span>
                  <span className="mn2-row-why">{l.party ?? "ללא שם"}{l.no_receipt > 0 ? <> · <Word tone="warn">בלי קבלה</Word></> : null}</span>
                </span>
                <span className="mn2-row-end">
                  <span className="mn2-row-n ltr"><MovementQty qty={l.qty} type={l.type} /></span>
                  <span className="mn2-word">{[fmtUnit(l.qty, l.unit), l.worth !== null ? fmtPrice(Math.round(l.worth)) : null].filter(Boolean).join(" · ")}</span>
                </span>
              </>
            );
            return (
              <li key={`${l.product_id}|${l.party}`}>
                {p ? <button type="button" className="mn2-row" onClick={() => openProduct(l.product_id, "history")}>{body}</button> : <div className="mn2-row is-static">{body}</div>}
              </li>
            );
          })}
          {sorted.length > LIST_ROWS ? (
            <li className="mn2-more"><Button variant="link" size="sm" aria-expanded={whole} onClick={() => setWhole(!whole)}>{whole ? "פחות" : `עוד ${fmtQty(sorted.length - LIST_ROWS)}`}</Button></li>
          ) : null}
        </ul>
      )}
    </Block>
  );
}

/** Closing with something open takes a written reason; the database refuses without one. */
function ReasonDialog({ open, sign, onClose }: { open: DayOpenItems; sign: (why: string) => Promise<void>; onClose: () => void }): ReactElement {
  const [why, setWhy] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const confirm = async () => {
    const reason = why.trim();
    setMissing(reason === "");
    if (reason === "") return;
    setBusy(true);
    setRefused(null);
    try {
      await sign(reason);
    } catch (e) {
      setRefused(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="סגירה עם פתוחים" confirmLabel="סגירת היום" busy={busy} onConfirm={() => void confirm()} onClose={onClose}>
      <div className="flex flex-col gap-[var(--space-3)]">
        <p className="m-0">נשארים פתוחים {openWords(open)}.</p>
        <Input multiline label="למה היום נסגר כך" value={why} onChange={(e) => setWhy(e.target.value)} error={missing ? REQUIRED : undefined} data-autofocus="true" />
        {refused ? <Notice tone="danger" title="הסגירה לא נשמרה">{refused}</Notice> : null}
      </div>
    </Modal>
  );
}

/** Which day this is, with a step to the day before and the day after. */
function DayStep({ day, first, go }: { day: string; first: string | null; go: (day: string) => void }): ReactElement {
  const today = israelToday();
  const isToday = day === today;
  return (
    <div className="mn2-daystep">
      <button type="button" className="mn2-daystep-go" aria-label="יום קודם" title="יום קודם" disabled={first !== null && day <= first} onClick={() => go(shiftDay(day, -1))}>
        <Icon name="chevron-right" size={18} />
      </button>
      <span className="mn2-daystep-day">{fmtClosingDay(day)}</span>
      <button type="button" className="mn2-daystep-go" aria-label="יום הבא" title="יום הבא" disabled={isToday} onClick={() => go(shiftDay(day, 1))}>
        <Icon name="chevron-left" size={18} />
      </button>
      {isToday ? null : <Button variant="ghost" size="sm" onClick={() => go(today)}>חזרה להיום</Button>}
    </div>
  );
}

function Report({ day, summary, signoff, sign, step }: { day: string; summary: DaySummary; signoff: DaySignoff | null; sign: (why?: string) => Promise<void>; step: ReactNode }): ReactElement {
  const { state } = useData();
  const { openAction, openFault, notify } = useUi();
  const isToday = day === israelToday();
  const asOf = isToday ? undefined : dayEnd(day);
  // Only a day still open can be dealt with; an ended day is a record.
  const live = isToday && !signoff;

  const open: DayOpenItems = { faults: summary.faults.length, requests: summary.requests.length, names: summary.names.length };
  const blocks = openCount(open);
  const signable = !signoff && canSign(day);

  /* ───────── what still stands open ───────── */
  const everyKind: { key: string; icon: LineName; tone: Tone; label: string; rows: OpenRow[] }[] = [
    {
      key: "faults", icon: "wrench", tone: "bad", label: "תקלות",
      rows: summary.faults.map((f) => ({
        key: f.id, title: f.description,
        meta: [fmtAge(f.created_at, asOf), f.product ? fmtName(f.product) : null, f.worker].filter(Boolean).join(" · "),
        action: live && state.faults.some((row) => row.id === f.id) ? { label: "פתיחה", run: () => openFault(f.id) } : undefined,
      })),
    },
    {
      key: "requests", icon: "stamp", tone: "warn", label: "שורות שעובד לא זיהה",
      rows: summary.requests.map((r) => ({
        key: r.id, title: `${fmtName(r.name)} × ${fmtQty(r.qty)}`,
        meta: [fmtAge(r.created_at, asOf), r.customer ? `ללקוח ${r.customer}` : null, r.worker].filter(Boolean).join(" · "),
        action: live ? { label: "בדיקה", run: () => openAction("review-item-request", { requestId: r.id }) } : undefined,
      })),
    },
    {
      key: "names", icon: "link-2", tone: "warn", label: "שמות ספק לשיוך",
      rows: summary.names.map((n) => ({
        key: n.id, title: n.name,
        meta: [fmtAge(n.created_at, asOf), n.supplier].filter(Boolean).join(" · "),
        action: live ? { label: "שיוך", run: () => openAction("map-supplier-item", { supplierItemId: n.id }) } : undefined,
      })),
    },
  ];
  // A kind with nothing open is not listed; the head already says when nothing is.
  const kinds = everyKind.filter((k) => k.rows.length > 0);
  // Every kind starts folded, so the block stays a few lines long until a hand opens one.
  const [opened, setOpened] = useState<string | null>(null);

  /* ───────── what the day came to ───────── */
  const received = summary.moved.filter((l) => l.type === "in");
  const delivered = summary.moved.filter((l) => l.type === "out");
  const late = summary.orders.filter((o) => !!o.promised_on && o.promised_on < summary.day).length;
  const nextOrder = [...summary.orders].sort(byPromise)[0];
  const stock = summary.stock;

  /* ───────── the decision ───────── */
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const close = async (why?: string) => {
    await sign(why);
    setAsking(false);
    notify({ tone: "success", title: "היום נסגר ואושר" });
  };
  const closeClean = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await close();
    } catch (e) {
      setRefused(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Where the day stands, in one coloured word: closed is green, ready is green, open things wait in amber.
  const standing = signoff ? (
    <>
      <Check size={28} />
      <div className="mn2-daystate-text">
        <p className="mn2-daystate-word is-ok">נסגר ואושר</p>
        <p className="mn2-daystate-line">
          {[signoff.signed_by, fmtDay(signoff.signed_at)].filter(Boolean).join(" · ")}
          {openCount(signoff.open_items) > 0 ? ` · נשארו פתוחים ${openWords(signoff.open_items)}` : null}
        </p>
        {signoff.note ? <p className="mn2-daystate-line">הסיבה: {signoff.note}</p> : null}
      </div>
    </>
  ) : blocks > 0 ? (
    <>
      <Line name="list-checks" size={28} tone="warn" />
      <div className="mn2-daystate-text">
        <p className="mn2-daystate-word is-warn">{blocks === 1 ? "דבר אחד נשאר פתוח" : `${fmtQty(blocks)} נשארו פתוחים`}</p>
        {isToday ? null : <p className="mn2-daystate-line">היום נסגר מעצמו בחצות</p>}
      </div>
    </>
  ) : isToday ? (
    <>
      <Line name="circle-check" size={28} tone="ok" />
      <div className="mn2-daystate-text"><p className="mn2-daystate-word is-ok">מוכן לסגירה</p></div>
    </>
  ) : (
    <>
      <Line name="clock" size={28} />
      <div className="mn2-daystate-text"><p className="mn2-daystate-word">נסגר מעצמו בחצות</p></div>
    </>
  );

  return (
    <>
      <section className="sa-card mn2-dayhead">
        {step}
        <div className="mn2-daystate">{standing}</div>
        {signable ? (
          <Button variant="primary" size="lg" icon="check" isLoading={busy} onClick={() => (blocks === 0 ? void closeClean() : setAsking(true))}>
            {isToday ? "סגירת היום" : "אישור היום"}
          </Button>
        ) : null}
      </section>
      {refused ? <Notice tone="danger" title="הסגירה לא נשמרה" onDismiss={() => setRefused(null)}>{refused}</Notice> : null}

      {kinds.length > 0 ? (
        <Block icon="list-checks" tone="warn" title={live ? "נשאר פתוח" : "נשאר פתוח בסוף היום"}>
          <ul className="mn2-kinds">
            {kinds.map((k) => (
              <Kind key={k.key} icon={k.icon} tone={k.tone} label={k.label} rows={k.rows} open={opened === k.key} onToggle={() => setOpened(opened === k.key ? null : k.key)} />
            ))}
          </ul>
        </Block>
      ) : null}

      <div className="mn2-inout">
        <Moved icon="arrow-down-to-line" tone="ok" title="נכנס" lines={received} empty={isToday ? "עוד לא נקלטה סחורה היום" : "לא נקלטה סחורה"} />
        <Moved icon="arrow-up-from-line" tone="bad" title="יצא" lines={delivered} empty={isToday ? "עוד לא יצאה סחורה היום" : "לא יצאה סחורה"} />
      </div>

      <ul className="sa-card mn2-facts">
        <li>
          <span className="mn2-facts-label">הזמנות פתוחות</span>
          <span className="mn2-facts-value">
            {summary.orders.length === 0 ? "אין" : fmtQty(summary.orders.length)}
            {late > 0 ? <> · <Word tone="warn">{fmtQty(late)} באיחור</Word></> : null}
            {nextOrder ? <span className="mn2-facts-more"> · הקרובה: {nextOrder.customer}</span> : null}
          </span>
        </li>
        <li>
          <span className="mn2-facts-label">מתחת למינימום</span>
          <span className="mn2-facts-value">{stock === null ? "לא נשמר ליום זה" : stock.length === 0 ? <Word tone="ok">אין</Word> : `${fmtQty(stock.length)} מוצרים`}</span>
        </li>
        <li>
          <span className="mn2-facts-label">החלטות מנהל</span>
          <span className="mn2-facts-value">
            {summary.actions.length === 0 ? "לא נרשמו" : (
              <>
                {fmtQty(summary.actions.length)}
                <span className="mn2-facts-more"> · אחרונה {fmtTime(summary.actions[0].at)}: {ACTION_LABEL[summary.actions[0].kind]}, {fmtName(summary.actions[0].title)}</span>
              </>
            )}
          </span>
        </li>
      </ul>

      {asking ? <ReasonDialog open={open} sign={close} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

function ClosingInner(): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const first = useFirstClosedDay();

  const today = israelToday();
  const asked = params.get("day");
  const day = asked && isDay(asked) && asked < today ? asked : today;
  const { summary, failed, retry } = useDaySummary(day);
  const { signoff, failed: signoffFailed, retry: retrySignoff, sign } = useDaySignoff(day);

  const go = useCallback((next: string) => router.replace(next === israelToday() ? pathname : `${pathname}?day=${next}`, { scroll: false }), [pathname, router]);

  const step = <DayStep day={day} first={first} go={go} />;

  return (
    <Page className="mn2-closing" title="סגירת יום">
      {failed || signoffFailed ? (
        <>
          <section className="sa-card mn2-dayhead">{step}</section>
          <Notice tone="danger" title="הסיכום לא נטען" action="ניסיון נוסף" onAction={() => { retry(); retrySignoff(); }} />
        </>
      ) : !summary || signoff === undefined ? (
        <>
          <section className="sa-card mn2-dayhead">{step}</section>
          <div className="sa-card mn2-sheet" aria-hidden="true"><span className="sa-skeleton app-skeletonTable" /></div>
        </>
      ) : (
        <Report key={day} day={day} summary={summary} signoff={signoff} sign={sign} step={step} />
      )}
    </Page>
  );
}

export function Closing(): ReactElement {
  return (
    <Suspense fallback={null}>
      <ClosingInner />
    </Suspense>
  );
}
