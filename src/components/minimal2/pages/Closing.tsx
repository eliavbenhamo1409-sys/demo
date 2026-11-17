"use client";

/**
 * סגירת יום as a page of work in three steps, top to bottom: what is still open, what the day came to, the decision.
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
import { markDaySigned } from "../day-state";
import type { LineName } from "../icons";
import { Line } from "../icons";
import { Block, Check, Page, Word, type Metric, type Tone } from "../parts";
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

/** One kind of open thing: its count on a line of its own, and its rows under it when opened. */
function Kind({ icon, tone, label, calm, rows, open, onToggle }: {
  icon: LineName;
  tone: Tone;
  label: string;
  calm: string;
  rows: OpenRow[];
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const [whole, setWhole] = useState(false);
  const shown = whole ? rows : rows.slice(0, LIST_ROWS);
  if (rows.length === 0) {
    return (
      <li className="mn2-kind is-clear">
        <div className="mn2-kind-head">
          <Line name={icon} size={22} />
          <span className="mn2-kind-label">{label}</span>
          <Word tone="ok">{calm}</Word>
        </div>
      </li>
    );
  }
  return (
    <li className={`mn2-kind${open ? " is-open" : ""}`}>
      <button type="button" className="mn2-kind-head" aria-expanded={open} onClick={onToggle}>
        <Line name={icon} size={22} />
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

/** What came in or went out, the biggest first; an exit with no receipt is never under the fold. */
function Moved({ icon, title, lines, parties, empty }: { icon: LineName; title: string; lines: MovedLine[]; parties: [string, string]; empty: string }): ReactElement {
  const { product } = useData();
  const { openProduct } = useUi();
  const [whole, setWhole] = useState(false);
  const sorted = [...lines].sort((a, b) => Number(b.no_receipt > 0) - Number(a.no_receipt > 0));
  const shown = whole ? sorted : sorted.slice(0, LIST_ROWS);
  const partyCount = new Set(lines.map((l) => l.party).filter(Boolean)).size;
  const noReceipt = lines.reduce((sum, l) => sum + l.no_receipt, 0);
  return (
    <div className="mn2-moved">
      <div className="mn2-moved-head">
        <Line name={icon} size={22} />
        <span className="mn2-moved-title">{title}</span>
        <span className="mn2-moved-sum ltr">{fmtCompact(worthOf(lines))}</span>
      </div>
      <p className="mn2-moved-sub">
        {lines.length === 0 ? empty : [`${fmtQty(new Set(lines.map((l) => l.product_id)).size)} מוצרים`, partyCount > 0 ? (partyCount === 1 ? parties[0] : `${fmtQty(partyCount)} ${parties[1]}`) : null, "במחירון"].filter(Boolean).join(" · ")}
        {noReceipt > 0 ? <> · <Word tone="warn">{noReceipt === 1 ? "הוצאה אחת בלי קבלה" : `${fmtQty(noReceipt)} בלי קבלה`}</Word></> : null}
      </p>
      {lines.length > 0 ? (
        <ul className="mn2-rows">
          {shown.map((l) => {
            const p = product(l.product_id);
            const body = (
              <>
                <ProductThumb product={p} small />
                <span className="mn2-row-text">
                  <span className="mn2-row-title">{fmtName(l.name)}</span>
                  <span className="mn2-row-why">{[l.party, l.no_receipt > 0 ? "בלי קבלה" : null].filter(Boolean).join(" · ") || "ללא שם"}</span>
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
      ) : null}
    </div>
  );
}

/** Closing with something open takes a written reason; the database refuses without one. */
function ReasonDialog({ title, open, sign, onClose }: { title: string; open: DayOpenItems; sign: (why: string) => Promise<void>; onClose: () => void }): ReactElement {
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
    <Modal title={title} confirmLabel="אישור סגירה" busy={busy} onConfirm={() => void confirm()} onClose={onClose}>
      <div className="flex flex-col gap-[var(--space-3)]">
        <p className="m-0">נשארים פתוחים {openWords(open)}. הסיבה נשמרת עם השם והשעה.</p>
        <Input multiline label="למה היום נסגר עם פתוחים" value={why} onChange={(e) => setWhy(e.target.value)} error={missing ? REQUIRED : undefined} data-autofocus="true" />
        {refused ? <Notice tone="danger" title="האישור לא נשמר">{refused}</Notice> : null}
      </div>
    </Modal>
  );
}

function Report({ day, summary, signoff, sign }: { day: string; summary: DaySummary; signoff: DaySignoff | null; sign: (why?: string) => Promise<void> }): ReactElement {
  const { state } = useData();
  const { openAction, openFault, notify } = useUi();
  const isToday = day === israelToday();
  const asOf = isToday ? undefined : dayEnd(day);
  // Only a day still open can be dealt with; an ended day is a record.
  const live = isToday && !signoff;

  const open: DayOpenItems = { faults: summary.faults.length, requests: summary.requests.length, names: summary.names.length };
  const blocks = openCount(open);
  const signable = !signoff && canSign(day);

  /* ───────── step 1 ───────── */
  const kinds: { key: "faults" | "requests" | "names"; icon: LineName; tone: Tone; label: string; calm: string; rows: OpenRow[] }[] = [
    {
      key: "faults", icon: "wrench", tone: "bad", label: "תקלות פתוחות", calm: "אין תקלות פתוחות",
      rows: summary.faults.map((f) => ({
        key: f.id, title: f.description,
        meta: [fmtAge(f.created_at, asOf), f.product ? fmtName(f.product) : null, f.worker ? `דווחה על ידי ${f.worker}` : null].filter(Boolean).join(" · "),
        action: live && state.faults.some((row) => row.id === f.id) ? { label: "פתיחת תקלה", run: () => openFault(f.id) } : undefined,
      })),
    },
    {
      key: "requests", icon: "stamp", tone: "warn", label: "מוצרים או שורות לא מזוהים", calm: "אין שורות ממתינות",
      rows: summary.requests.map((r) => ({
        key: r.id, title: `${fmtName(r.name)} × ${fmtQty(r.qty)}`,
        meta: [fmtAge(r.created_at, asOf), r.customer ? `ללקוח ${r.customer}` : null, r.worker ? `נשלח על ידי ${r.worker}` : null].filter(Boolean).join(" · "),
        action: live ? { label: "בדיקת השורה", run: () => openAction("review-item-request", { requestId: r.id }) } : undefined,
      })),
    },
    {
      key: "names", icon: "link-2", tone: "warn", label: "שמות ספק שטרם שויכו", calm: "כל השמות משויכים",
      rows: summary.names.map((n) => ({
        key: n.id, title: n.name,
        meta: [fmtAge(n.created_at, asOf), n.supplier].filter(Boolean).join(" · "),
        action: live ? { label: "שיוך מוצר", run: () => openAction("map-supplier-item", { supplierItemId: n.id }) } : undefined,
      })),
    },
  ];
  // The first kind with something in it stands open; a hand can open another.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const opened = picked === undefined ? kinds.find((k) => k.rows.length > 0)?.key ?? null : picked;

  /* ───────── step 2 ───────── */
  const received = summary.moved.filter((l) => l.type === "in");
  const delivered = summary.moved.filter((l) => l.type === "out");
  const late = summary.orders.filter((o) => !!o.promised_on && o.promised_on < summary.day).length;
  const nextOrder = [...summary.orders].sort(byPromise)[0];
  const stock = summary.stock;

  /* ───────── step 3 ───────── */
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const withOpen = isToday ? "סגירה עם חריגות" : "אישור עם חריגות";

  const close = async (why?: string) => {
    await sign(why);
    markDaySigned(day);
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

  return (
    <>
      <Block
        icon="list-checks"
        eyebrow="שלב 1 מתוך 3"
        title={live ? "מה נשאר פתוח" : "מה נשאר פתוח בסוף היום"}
        sub={blocks === 0 ? undefined : live ? "לכל סוג אפשר לפתוח את הרשימה ולטפל משם. מה שנשאר פתוח עובר למחר." : "הרשימה נשמרה כפי שהייתה כשהיום נגמר."}
        actions={blocks === 0 ? <Word tone="ok">הכל טופל</Word> : <span className="mn2-block-n is-warn">{fmtQty(blocks)}</span>}
      >
        {blocks === 0 ? (
          <div className="mn2-clear">
            <Check size={36} />
            <p className="mn2-clear-title">שום דבר לא מחכה</p>
            <p className="mn2-clear-hint">אין תקלה פתוחה, אין שורה לא מזוהה ואין שם ספק שמחכה לשיוך.</p>
          </div>
        ) : (
          <ul className="mn2-kinds">
            {kinds.map((k) => (
              <Kind key={k.key} icon={k.icon} tone={k.tone} label={k.label} calm={k.calm} rows={k.rows} open={opened === k.key} onToggle={() => setPicked(opened === k.key ? null : k.key)} />
            ))}
          </ul>
        )}
      </Block>

      <Block icon="clipboard-check" eyebrow="שלב 2 מתוך 3" title="בדיקת סיכום היום" sub="מה נכנס ומה יצא. כל סכום במחירון; שורה נפתחת להיסטוריה של המוצר.">
        <div className="mn2-moved-pair">
          <Moved icon="arrow-down-to-line" title="כניסות היום" lines={received} parties={["ספק אחד", "ספקים"]} empty={isToday ? "עוד לא נקלטה סחורה היום" : "לא נקלטה סחורה"} />
          <Moved icon="arrow-up-from-line" title="יציאות היום" lines={delivered} parties={["לקוח אחד", "לקוחות"]} empty={isToday ? "עוד לא נמסרה סחורה היום" : "לא נמסרה סחורה"} />
        </div>
        <ul className="mn2-facts">
          <li>
            <span className="mn2-facts-label">הזמנות פתוחות</span>
            <span className="mn2-facts-value">
              {summary.orders.length === 0 ? "אין" : fmtQty(summary.orders.length)}
              {late > 0 ? <> · <Word tone="warn">{fmtQty(late)} באיחור</Word></> : null}
              {nextOrder ? <span className="mn2-facts-more"> · הקרובה: {nextOrder.customer}</span> : null}
            </span>
          </li>
          <li>
            <span className="mn2-facts-label">עובר למחר</span>
            <span className="mn2-facts-value">
              {stock === null ? "המלאי של יום זה לא נשמר" : stock.length === 0 ? <Word tone="ok">המלאי מעל המינימום</Word> : <>{fmtQty(stock.length)} מוצרים מתחת למינימום<span className="mn2-facts-more"> · לא מעכב את הסגירה</span></>}
            </span>
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
      </Block>

      <Block
        icon="calendar-check"
        eyebrow="שלב 3 מתוך 3"
        title="החלטת סגירה"
        className={signoff ? "mn2-closed" : undefined}
        sub={signoff ? undefined : !signable ? "אפשר לאשר רק את היום ואת אתמול. היום הזה נסגר מעצמו בחצות, והנתונים שלו שמורים." : blocks === 0 ? "הכל טופל. האישור נשמר עם השם והשעה." : "אפשר לטפל קודם במה שפתוח, או לסגור עם חריגות ולכתוב למה. הסיבה נשמרת עם האישור."}
      >
        {signoff ? (
          <div className="mn2-seal">
            <Check size={44} />
            <div className="mn2-seal-text">
              <p className="mn2-seal-title">היום נסגר ואושר</p>
              <p className="mn2-seal-line">{[signoff.signed_by, fmtDay(signoff.signed_at)].filter(Boolean).join(" · ")}</p>
              {openCount(signoff.open_items) > 0 ? <p className="mn2-seal-line">נשארו פתוחים {openWords(signoff.open_items)}</p> : <p className="mn2-seal-line"><Word tone="ok">בלי חריגות</Word></p>}
              {signoff.note ? <p className="mn2-seal-note">הסיבה: {signoff.note}</p> : null}
            </div>
          </div>
        ) : signable ? (
          <div className="mn2-decide">
            {blocks === 0 ? (
              <Button variant="primary" size="lg" icon="check" isLoading={busy} onClick={() => void closeClean()}>אישור סגירה</Button>
            ) : (
              <Button variant="secondary" size="lg" onClick={() => setAsking(true)}>{withOpen}</Button>
            )}
            {blocks > 0 ? <span className="mn2-decide-note">{fmtQty(blocks)} {blocks === 1 ? "נושא פתוח" : "נושאים פתוחים"} · {openWords(open)}</span> : null}
          </div>
        ) : null}
        {refused ? <Notice tone="danger" title="האישור לא נשמר" onDismiss={() => setRefused(null)}>{refused}</Notice> : null}
      </Block>

      {asking ? <ReasonDialog title={withOpen} open={open} sign={close} onClose={() => setAsking(false)} /> : null}
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
  const isToday = day === today;
  const { summary, failed, retry } = useDaySummary(day);
  const { signoff, failed: signoffFailed, retry: retrySignoff, sign } = useDaySignoff(day);

  const go = useCallback((next: string) => router.replace(next === israelToday() ? pathname : `${pathname}?day=${next}`, { scroll: false }), [pathname, router]);

  const ready = summary && signoff !== undefined;
  const blocks = summary ? summary.faults.length + summary.requests.length + summary.names.length : 0;

  let state: { word: ReactNode; tone: Tone } | undefined;
  let lead: ReactNode = "טוען את סיכום היום.";
  if (failed || signoffFailed) lead = "הסיכום של היום לא נטען.";
  else if (ready) {
    if (signoff) {
      state = { word: "נסגר ואושר", tone: "ok" };
      lead = `היום אושר על ידי ${signoff.signed_by}. הנתונים שלו שמורים ולא משתנים.`;
    } else if (!isToday) {
      state = { word: "נסגר בחצות", tone: "none" };
      lead = blocks > 0 ? `היום נסגר מעצמו בחצות, עם ${blocks === 1 ? "נושא אחד פתוח" : `${fmtQty(blocks)} נושאים פתוחים`}.${canSign(day) ? " עדיין אפשר לאשר אותו." : ""}` : `היום נסגר מעצמו בחצות, בלי נושאים פתוחים.${canSign(day) ? " עדיין אפשר לאשר אותו." : ""}`;
    } else if (blocks > 0) {
      state = { word: `${fmtQty(blocks)} ממתינים`, tone: "warn" };
      lead = <><strong>{blocks === 1 ? "נושא אחד ממתין" : `${fmtQty(blocks)} נושאים ממתינים`}</strong> לטיפול לפני הסגירה. עוברים עליהם לפי סוג, בודקים את סיכום היום, ומחליטים איך לסגור.</>;
    } else {
      state = { word: "מוכן לסגירה", tone: "ok" };
      lead = "שום דבר לא מחכה לטיפול. נשאר לעבור על סיכום היום ולאשר את הסגירה.";
    }
  }

  const received = summary?.moved.filter((l) => l.type === "in") ?? [];
  const delivered = summary?.moved.filter((l) => l.type === "out") ?? [];
  const metrics: Metric[] | undefined = ready
    ? [
        { key: "open", label: signoff || !isToday ? "נשאר פתוח" : "ממתין לטיפול", icon: "list-checks", value: blocks, tone: blocks > 0 ? "warn" : "ok", note: blocks === 0 ? <span className="is-ok">הכל טופל</span> : "תקלות, שורות ושמות ספק" },
        { key: "in", label: "נקלט", icon: "arrow-down-to-line", value: <span className="ltr">{fmtCompact(worthOf(received))}</span>, tone: received.length > 0 ? "ok" : "none", note: received.length > 0 ? `${fmtQty(new Set(received.map((l) => l.product_id)).size)} מוצרים · במחירון` : "לא נקלטה סחורה" },
        { key: "out", label: "נמסר", icon: "arrow-up-from-line", value: <span className="ltr">{fmtCompact(worthOf(delivered))}</span>, note: delivered.length > 0 ? `${fmtQty(new Set(delivered.map((l) => l.product_id)).size)} מוצרים · במחירון` : "לא נמסרה סחורה" },
        { key: "acts", label: "החלטות מנהל", icon: "circle-check", value: summary.actions.length, tone: summary.actions.length > 0 ? "ok" : "none", note: summary.actions.length > 0 ? "אישורים, תיקונים וסגירות" : "לא נרשמו החלטות" },
      ]
    : undefined;

  return (
    <Page
      className="mn2-closing"
      title="סגירת יום"
      state={state ?? { word: fmtClosingDay(day), tone: "none" }}
      lead={<>{state ? <span className="mn2-lead-day">{fmtClosingDay(day)}{isToday ? ", עד עכשיו" : ""}. </span> : null}{lead}</>}
      action={
        <>
          {isToday ? null : <Button variant="ghost" onClick={() => go(today)}>היום</Button>}
          <Button variant="secondary" icon="chevron-right" disabled={first !== null && day <= first} onClick={() => go(shiftDay(day, -1))}>יום קודם</Button>
          <Button variant="secondary" iconEnd="chevron-left" disabled={isToday} onClick={() => go(shiftDay(day, 1))}>יום הבא</Button>
        </>
      }
      metrics={metrics}
    >
      {failed || signoffFailed ? (
        <Notice tone="danger" title="הסיכום לא נטען" action="ניסיון נוסף" onAction={() => { retry(); retrySignoff(); }} />
      ) : !ready ? (
        <div className="sa-card mn2-sheet" aria-hidden="true"><span className="sa-skeleton app-skeletonTable" /></div>
      ) : (
        <Report key={day} day={day} summary={summary} signoff={signoff} sign={sign} />
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
