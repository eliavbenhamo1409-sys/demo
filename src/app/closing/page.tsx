"use client";

/**
 * סגירת יום — a process, not a dashboard. The first card answers whether the day can be closed, the figures under it
 * follow the day in order: what came in, what went out, what is left, what stands in the way. Then the lists, what
 * needs a decision first. A manager's signature puts a name on the day; the midnight job still freezes its figures.
 * Every ₪ is a sale price, so the screen says במחירון.
 */
import { Suspense, useCallback, useState, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useData, orderTotal, type ItemRequest } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { FigureLine, type CheckTone, type Figure } from "@/components/app/Snapshot";
import { ProductThumb } from "@/components/app/Viz";
import { Button, Card, EmptyState, Input, Modal, MovementQty, Notice, PageHead } from "@/components/ui";
import { errorMessage, REQUIRED } from "@/components/app/forms/useForm";
import { byPromise, fmtAge, fmtCompact, fmtDay, fmtName, fmtPrice, fmtPromised, fmtQty, fmtTime, fmtUnit } from "@/lib/format";
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
  type DayOrder,
  type DaySignoff,
  type DayStock,
  type DaySummary,
  type MovedLine,
} from "@/lib/day-closing";
import "./closing.css";

/** The lines a list shows before it asks to be opened; a real day holds dozens. */
const LIST_ROWS = 6;

const ACTION_LABEL: Record<DayAction["kind"], string> = {
  request_approved: "שורה אושרה",
  request_rejected: "שורה נדחתה",
  name_approved: "שם ספק אושר",
  count: "תיקון ספירה",
  no_receipt: "הוצאה בלי קבלה",
  fault_resolved: "תקלה טופלה",
  order_delivered: "סומנה כנמסרה",
};

const STOCK_WORD: Record<DayStock["state"], string> = { short: "חסר", out: "אזל", low: "מתחת למינימום" };
const STOCK_TONE: Record<DayStock["state"], CheckTone> = { short: "short", out: "bad", low: "warn" };

const REQUEST_WORD: Record<ItemRequest["kind"], string> = { new_product: "מוצר חדש", unknown: "שורה לא מזוהה" };

/** Held together with no-break spaces: a figure that wraps breaks between things, never between a number and its name. */
const count = (n: number, one: string, many: string) => (n === 1 ? one : `${fmtQty(n)} ${many}`).replaceAll(" ", "\u00a0");

const joined = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

/** For words that wrap: a comma at the end of a line is ordinary text, a dot left there reads as a typo. */
const listed = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(", ");

const worthOf = (lines: MovedLine[]) => Math.round(lines.reduce((sum, l) => sum + (l.worth ?? 0), 0));

const distinct = (values: (string | null)[]) => new Set(values.filter(Boolean)).size;

const openCount = (o: DayOpenItems) => o.faults + o.requests + o.names;

const isLate = (o: DayOrder, day: string) => !!o.promised_on && o.promised_on < day;

const openWords = (o: DayOpenItems) =>
  listed(o.faults > 0 && count(o.faults, "תקלה אחת", "תקלות"), o.requests > 0 && count(o.requests, "שורה אחת", "שורות"), o.names > 0 && count(o.names, "שם ספק אחד", "שמות ספק"));

function stockLine(s: DayStock): string {
  const free = s.qty - s.reserved;
  if (s.state === "short") return `חסרים ${fmtQty(-free)} ${fmtUnit(-free, s.unit)} להזמנות`;
  if (s.state === "low") return `זמין ${fmtQty(free)} ${fmtUnit(free, s.unit)} · מינימום ${fmtQty(s.min_qty)}`;
  return `מינימום ${fmtQty(s.min_qty)} ${fmtUnit(s.min_qty, s.unit)}`;
}

/** One line of a list: the overview's row, a figure at the far end with its word under it. */
function Row({ lead, title, meta, figure, word, tone = "none", onOpen }: {
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  figure?: ReactNode;
  word?: ReactNode;
  tone?: CheckTone;
  onOpen?: () => void;
}): ReactElement {
  const body = (
    <>
      <span className="sa-attention-title">{title}</span>
      {meta ? <span className="sa-attention-meta">{typeof meta === "string" ? <span className="sa-truncate">{meta}</span> : meta}</span> : null}
    </>
  );
  return (
    <li className={onOpen ? "sa-attention-item" : "sa-attention-item dc-static"}>
      {lead}
      {onOpen ? (
        <button type="button" className="sa-attention-body sa-attention-open" onClick={onOpen}>{body}</button>
      ) : (
        <div className="sa-attention-body">{body}</div>
      )}
      {figure || word ? (
        <span className="ov-fig">
          {figure ? <span className="ov-fig-n">{figure}</span> : null}
          {word ? <span className={`ov-fig-word is-${tone}`}>{word}</span> : null}
        </span>
      ) : null}
    </li>
  );
}

/** A section of the day. Wide ones keep the two columns of the pair below them, filled row by row, so every row in the page shares its edges. */
function Section({ id, title, sub, rows, cap, wide, empty }: {
  id: string;
  title: string;
  sub?: ReactNode;
  rows: ReactElement[];
  cap?: number;
  wide?: boolean;
  empty?: ReactNode;
}): ReactElement {
  const [whole, setWhole] = useState(false);
  const hidden = cap === undefined ? 0 : rows.length - cap;
  const list = hidden > 0 && !whole ? rows.slice(0, cap) : rows;
  return (
    <div id={id} className="dc-block">
      <Card
        title={title}
        subtitle={sub}
        actions={hidden > 0 ? <Button variant="link" size="sm" aria-expanded={whole} onClick={() => setWhole(!whole)}>{whole ? "פחות" : `עוד ${fmtQty(hidden)}`}</Button> : undefined}
        flush
        className="ov-list min-w-0"
      >
        {rows.length === 0 ? empty : <ul className={`sa-attention m-0 list-none p-0${wide ? " dc-pairs" : ""}`}>{list}</ul>}
      </Card>
    </div>
  );
}

/** What a manager has to decide: this is what stands between the day and its closing. */
function Blocks({ summary, title, asOf }: { summary: DaySummary; title: string; asOf?: number }): ReactElement {
  const { state } = useData();
  const { openAction, openFault } = useUi();
  const requestWord = (id: string) => {
    const kind = state.itemRequests.find((r) => r.id === id)?.kind;
    return kind ? REQUEST_WORD[kind] : "שורה";
  };
  return (
    <Section
      id="closing-blocks"
      title={title}
      wide
      rows={[
        ...summary.faults.map((f) => (
          <Row
            key={f.id}
            title={f.description}
            meta={joined(fmtAge(f.created_at, asOf), f.product && fmtName(f.product), f.worker && `דווח ע"י ${f.worker}`)}
            word="תקלה"
            tone="bad"
            onOpen={state.faults.some((row) => row.id === f.id) ? () => openFault(f.id) : undefined}
          />
        )),
        ...summary.requests.map((r) => (
          <Row
            key={r.id}
            title={`${fmtName(r.name)} × ${fmtQty(r.qty)}`}
            meta={joined(fmtAge(r.created_at, asOf), r.customer && `ללקוח ${r.customer}`, r.worker && `נשלח ע"י ${r.worker}`)}
            word={requestWord(r.id)}
            onOpen={() => openAction("review-item-request", { requestId: r.id })}
          />
        )),
        ...summary.names.map((n) => (
          <Row
            key={n.id}
            title={n.name}
            meta={joined(fmtAge(n.created_at, asOf), n.supplier)}
            word="שם ספק"
            onOpen={() => openAction("map-supplier-item", { supplierItemId: n.id })}
          />
        )),
      ]}
    />
  );
}

/** Stock under its minimum is a state, not a decision: it follows the day out without holding it back. */
function Tomorrow({ stock }: { stock: DayStock[] | null }): ReactElement {
  const { product } = useData();
  const { openProduct } = useUi();
  return (
    <Section
      id="closing-stock"
      title="עובר למחר"
      sub={stock && stock.length > 0 ? "מלאי מתחת למינימום, לא מעכב את הסגירה" : undefined}
      cap={LIST_ROWS}
      wide
      empty={<EmptyState title={stock ? "המלאי מעל המינימום" : "המלאי של יום זה לא נשמר"} />}
      rows={(stock ?? []).map((s) => (
        <Row
          key={s.product_id}
          lead={<ProductThumb product={product(s.product_id)} small />}
          title={fmtName(s.name)}
          meta={stockLine(s)}
          word={STOCK_WORD[s.state]}
          tone={STOCK_TONE[s.state]}
          onOpen={product(s.product_id) ? () => openProduct(s.product_id) : undefined}
        />
      ))}
    />
  );
}

function Moved({ id, title, lines, parties, empty }: { id: string; title: string; lines: MovedLine[]; parties: [string, string]; empty: ReactNode }): ReactElement {
  const { product } = useData();
  const { openProduct } = useUi();
  const partyCount = distinct(lines.map((l) => l.party));
  // A pick-up with no receipt is the exception here, so the list's cap never hides it. The sort is stable: the rest stay by worth.
  const sorted = [...lines].sort((a, b) => Number(b.no_receipt > 0) - Number(a.no_receipt > 0));
  return (
    <Section
      id={id}
      title={title}
      sub={lines.length > 0 ? joined(`${fmtPrice(worthOf(lines))} במחירון`, partyCount > 0 && count(partyCount, ...parties)) : undefined}
      cap={LIST_ROWS}
      empty={empty}
      rows={sorted.map((l) => (
        <Row
          key={`${l.product_id}|${l.party}`}
          lead={<ProductThumb product={product(l.product_id)} small />}
          title={fmtName(l.name)}
          meta={
            <>
              {l.party ? <span className="sa-truncate">{l.party}</span> : null}
              {l.no_receipt > 0 ? <span className="dc-flag">{l.party ? "· " : null}בלי קבלה</span> : null}
            </>
          }
          figure={<span className="ltr"><MovementQty qty={l.qty} type={l.type} /></span>}
          word={joined(fmtUnit(l.qty, l.unit), l.worth !== null && fmtPrice(Math.round(l.worth)))}
          onOpen={product(l.product_id) ? () => openProduct(l.product_id, "history") : undefined}
        />
      ))}
    />
  );
}

/** The nearest delivery leads, so the late ones stand first. */
function Orders({ summary, asOf }: { summary: DaySummary; asOf?: number }): ReactElement {
  const { linesOf, product } = useData();
  const { openOrder } = useUi();
  const orders = [...summary.orders].sort(byPromise);
  const late = orders.filter((o) => isLate(o, summary.day)).length;
  return (
    <Section
      id="closing-orders"
      title="הזמנות פתוחות"
      sub={orders.length > 0 ? joined(count(orders.length, "הזמנה אחת", "הזמנות"), late > 0 && `${fmtQty(late)} באיחור`) : undefined}
      cap={LIST_ROWS}
      wide
      empty={<EmptyState title="אין הזמנות פתוחות" hint={asOf === undefined ? "הזמנה של סוכן תופיע כאן" : undefined} />}
      rows={orders.map((o) => {
        const lines = linesOf(o.id);
        const total = orderTotal(lines);
        const when = o.promised_on ? fmtPromised(o.promised_on, asOf) : null;
        const behind = isLate(o, summary.day);
        return (
          <Row
            key={o.id}
            lead={<ProductThumb product={product(lines[0]?.product_id)} small />}
            title={o.customer}
            meta={joined(`הזמנה ${o.number}`, count(o.lines, "שורה אחת", "שורות"), o.agent)}
            figure={total === null ? undefined : <span className="ltr">{fmtPrice(total)}</span>}
            word={behind ? when : when ? `מסירה ${when}` : "פתוחה"}
            tone={behind ? "warn" : "none"}
            onOpen={() => openOrder(o.id)}
          />
        );
      })}
    />
  );
}

function ManagerActions({ actions, asOf }: { actions: DayAction[]; asOf?: number }): ReactElement {
  return (
    <Section
      id="closing-actions"
      title="פעולות מנהל"
      sub={actions[0] ? `אחרונה ${fmtTime(actions[0].at)}` : undefined}
      cap={LIST_ROWS}
      wide
      empty={<EmptyState title="לא נרשמו פעולות מנהל" hint={asOf === undefined ? "אישור שורה, תיקון ספירה או תקלה שטופלה יופיעו כאן" : undefined} />}
      rows={actions.map((a) => (
        <Row
          key={`${a.kind}|${a.at}|${a.title}`}
          title={fmtName(a.title)}
          // On a frozen day this line is the record and nothing opens it, so the reason wraps instead of being cut.
          meta={<span className="dc-whole">{listed(ACTION_LABEL[a.kind], a.qty !== null && `${fmtQty(a.qty)}${a.unit ? ` ${fmtUnit(a.qty, a.unit)}` : ""}`, a.detail && fmtName(a.detail).replaceAll(" · ", ", "))}</span>}
          word={fmtTime(a.at)}
        />
      ))}
    />
  );
}

/** Closing with something open takes a written reason; the database refuses without one. */
function CloseOpenDialog({ title, open, sign, onClose }: { title: string; open: DayOpenItems; sign: (why: string) => Promise<void>; onClose: () => void }): ReactElement {
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
      <div className="dc-ask">
        <p className="dc-ask-open">נשארים פתוחים {openWords(open)}</p>
        <Input
          multiline
          label="סיבה"
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          error={missing ? REQUIRED : undefined}
          data-autofocus="true"
        />
        {refused ? <Notice tone="danger" title="האישור לא נשמר">{refused}</Notice> : null}
      </div>
    </Modal>
  );
}

/** The next thing in the way, in the order the list shows it, and the button that goes to it. */
function useNextStep(summary: DaySummary): { label: string; what: string; open: () => void } | null {
  const { openAction, openFault } = useUi();
  const [fault] = summary.faults;
  const [request] = summary.requests;
  const [name] = summary.names;
  if (fault) return { label: "בדיקת התקלה", what: fault.description, open: () => openFault(fault.id) };
  if (request) return { label: "בדיקת השורה", what: fmtName(request.name), open: () => openAction("review-item-request", { requestId: request.id }) };
  if (name) return { label: "התאמת שם הספק", what: name.name, open: () => openAction("map-supplier-item", { supplierItemId: name.id }) };
  return null;
}

/** The first thing on the page: where the day stands, in one sentence, and the one thing to do about it. */
function DayState({ day, summary, open, signoff, sign }: {
  day: string;
  summary: DaySummary;
  open: DayOpenItems;
  signoff: DaySignoff | null;
  sign: (why?: string) => Promise<void>;
}): ReactElement {
  const { notify } = useUi();
  const next = useNextStep(summary);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const isToday = day === israelToday();
  const blocks = openCount(open);
  const signable = !signoff && canSign(day);
  // An ended day is already closed, so the press only signs it.
  const signOpen = isToday ? "סגירה עם פתוחים" : "אישור עם פתוחים";

  const closeDay = async (why?: string) => {
    await sign(why);
    setAsking(false);
    notify({ tone: "success", title: "הסגירה אושרה" });
  };

  const closeClean = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await closeDay();
    } catch (e) {
      setRefused(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  let word: string;
  let tone: "ok" | "warn" | "none";
  let line: ReactNode;
  if (signoff) {
    word = "אושר";
    tone = "ok";
    line = (
      <>
        <p className="dc-state-line">{joined(signoff.signed_by, fmtDay(signoff.signed_at))}</p>
        {openCount(signoff.open_items) > 0 ? <p className="dc-state-line">נשארו פתוחים {openWords(signoff.open_items)}</p> : null}
        {signoff.note ? <p className="dc-state-note">סיבה: {signoff.note}</p> : null}
      </>
    );
  } else if (!isToday) {
    word = "נסגר בחצות";
    tone = "none";
    line = <p className="dc-state-line">{joined(blocks > 0 ? `נשארו פתוחים ${openWords(open)}` : "בלי פתוחים", signable && "אפשר לאשר עד חצות")}</p>;
  } else if (next) {
    word = `${fmtQty(blocks)} ${blocks === 1 ? "מעכב" : "מעכבים"} את הסגירה`;
    tone = "warn";
    line = <p className="dc-state-line dc-state-next">הבא בתור: {next.what}</p>;
  } else {
    word = "אפשר לסגור";
    tone = "ok";
    line = <p className="dc-state-line">האישור נשמר עם השם והשעה</p>;
  }

  return (
    <>
      <div id="closing-state" className="dc-block">
        <Card className="dc-state">
          <div className="dc-state-text">
            <h2 className={`dc-state-word is-${tone}`}>{word}</h2>
            {line}
          </div>
          {signable ? (
            <div className="dc-state-actions">
              {blocks === 0 ? (
                <Button isLoading={busy} onClick={() => void closeClean()}>אישור סגירה</Button>
              ) : (
                <>
                  <Button variant={isToday ? "secondary" : "primary"} onClick={() => setAsking(true)}>{signOpen}</Button>
                  {/* An ended day is frozen: dealing with a row can no longer change it, so signing is all that is left. */}
                  {isToday && next ? <Button onClick={next.open}>{next.label}</Button> : null}
                </>
              )}
            </div>
          ) : null}
        </Card>
      </div>
      {refused ? <Notice tone="danger" title="האישור לא נשמר" onDismiss={() => setRefused(null)}>{refused}</Notice> : null}
      {asking ? <CloseOpenDialog title={signOpen} open={open} sign={closeDay} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/** The whole day once it is read. Keyed by day, so an opened list or a refusal never follows to the next one. */
function DayReport({ day, summary, signoff, sign }: {
  day: string;
  summary: DaySummary;
  signoff: DaySignoff | null;
  sign: (why?: string) => Promise<void>;
}): ReactElement {
  const { openAction } = useUi();
  const isToday = day === israelToday();
  // A closed day keeps the ages it ended with.
  const asOf = isToday ? undefined : dayEnd(day);

  const received = summary.moved.filter((l) => l.type === "in");
  const delivered = summary.moved.filter((l) => l.type === "out");
  const noReceipt = delivered.reduce((sum, l) => sum + l.no_receipt, 0);
  const late = summary.orders.filter((o) => isLate(o, summary.day)).length;
  const open: DayOpenItems = { faults: summary.faults.length, requests: summary.requests.length, names: summary.names.length };
  const blocks = openCount(open);
  // Only a day still open can be held back; after that the same rows are what stayed undone.
  const holding = isToday && !signoff;
  const blockTitle = holding ? "מעכב" : "לא טופל";

  const products = (lines: MovedLine[]) => count(distinct(lines.map((l) => l.product_id)), "מוצר אחד", "מוצרים");

  const figures: Figure[] = [
    {
      key: "in",
      label: "נקלט",
      value: <span className="ltr dc-quiet">{fmtCompact(worthOf(received))}</span>,
      note: received.length > 0 ? listed("במחירון", products(received)) : "לא נקלטה סחורה",
      href: "#closing-in",
    },
    {
      key: "out",
      label: "נמסר",
      value: <span className="ltr dc-quiet">{fmtCompact(worthOf(delivered))}</span>,
      note:
        delivered.length > 0 ? (
          <>
            {listed("במחירון", products(delivered))}
            {noReceipt > 0 ? <>, <span className="is-warn">{fmtQty(noReceipt)} בלי קבלה</span></> : null}
          </>
        ) : "לא נמסרה סחורה",
      href: "#closing-out",
    },
    {
      key: "open",
      label: "פתוח",
      value: fmtQty(summary.orders.length),
      note:
        summary.orders.length > 0 ? (
          <>
            {summary.orders.length === 1 ? "הזמנה" : "הזמנות"}
            {late > 0 ? <>, <span className="is-warn">{fmtQty(late)} באיחור</span></> : null}
          </>
        ) : "אין הזמנות פתוחות",
      href: "#closing-orders",
    },
    {
      key: "blocks",
      label: blockTitle,
      value: <span className={holding ? (blocks > 0 ? "dc-warn" : "dc-ok") : undefined}>{fmtQty(blocks)}</span>,
      note: blocks > 0 ? openWords(open) : <span className="is-ok">הכל טופל</span>,
      href: blocks > 0 ? "#closing-blocks" : "#closing-state",
    },
  ];

  return (
    <>
      <DayState day={day} summary={summary} open={open} signoff={signoff} sign={sign} />
      <FigureLine figures={figures} />
      {blocks > 0 ? <Blocks summary={summary} title={holding ? "מעכב את הסגירה" : blockTitle} asOf={asOf} /> : null}
      <Tomorrow stock={summary.stock} />
      <div className="ov-split">
        <Moved
          id="closing-in"
          title="נקלט"
          lines={received}
          parties={["ספק אחד", "ספקים"]}
          empty={
            isToday ? (
              <EmptyState title="עוד לא נקלטה סחורה היום" hint="קליטה תופיע כאן">
                <Button variant="secondary" onClick={() => openAction("receive")}>קליטת סחורה</Button>
              </EmptyState>
            ) : <EmptyState title="לא נקלטה סחורה" />
          }
        />
        <Moved
          id="closing-out"
          title="נמסר"
          lines={delivered}
          parties={["לקוח אחד", "לקוחות"]}
          empty={
            isToday ? (
              <EmptyState title="עוד לא נמסרה סחורה היום" hint="הוצאה תופיע כאן">
                <Button variant="secondary" onClick={() => openAction("issue")}>הוצאת סחורה</Button>
              </EmptyState>
            ) : <EmptyState title="לא נמסרה סחורה" />
          }
        />
      </div>
      <Orders summary={summary} asOf={asOf} />
      <ManagerActions actions={summary.actions} asOf={asOf} />
    </>
  );
}

function Waiting(): ReactElement {
  return (
    <>
      <div aria-hidden="true">
        <Card className="dc-state">
          <span className="sa-skeleton dc-state-wait" />
        </Card>
      </div>
      <div className="ov-split" aria-hidden="true">
        {[0, 1].map((i) => (
          <Card key={i} flush>
            <ul className="sa-attention m-0 list-none p-0">
              {[0, 1, 2].map((row) => (
                <li key={row} className="sa-attention-item">
                  <span className="sa-thumb is-sm" />
                  <span className="sa-attention-body"><span className="sa-skeleton" style={{ width: `${44 + row * 14}%` }} /></span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}

function ClosingInner(): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const first = useFirstClosedDay();

  // The day lives in the URL, so a closed day can be opened from a link.
  const today = israelToday();
  const asked = params.get("day");
  const day = asked && isDay(asked) && asked < today ? asked : today;
  const isToday = day === today;
  const { summary, failed, retry } = useDaySummary(day);
  const { signoff, failed: signoffFailed, retry: retrySignoff, sign } = useDaySignoff(day);

  const go = useCallback(
    (next: string) => router.replace(next === israelToday() ? pathname : `${pathname}?day=${next}`, { scroll: false }),
    [pathname, router],
  );

  const retryBoth = () => {
    retry();
    retrySignoff();
  };

  return (
    <div className="sa-page dc-page">
      <PageHead
        title="סגירת יום"
        sub={joined(fmtClosingDay(day), isToday && "עד עכשיו, נסגר בחצות")}
        actions={
          <>
            {isToday ? null : <Button variant="ghost" onClick={() => go(today)}>היום</Button>}
            <Button variant="secondary" icon="chevron-right" disabled={first !== null && day <= first} onClick={() => go(shiftDay(day, -1))}>יום קודם</Button>
            {/* Stays in place on today, so a second quick press on יום קודם never lands on it. */}
            <Button variant="secondary" iconEnd="chevron-left" disabled={isToday} onClick={() => go(shiftDay(day, 1))}>יום הבא</Button>
          </>
        }
      />

      {failed || signoffFailed ? (
        <Notice tone="danger" title="הסיכום לא נטען" action="ניסיון נוסף" onAction={retryBoth} />
      ) : !summary || signoff === undefined ? (
        <Waiting />
      ) : (
        <DayReport key={day} day={day} summary={summary} signoff={signoff} sign={sign} />
      )}
    </div>
  );
}

export default function ClosingPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <ClosingInner />
    </Suspense>
  );
}
