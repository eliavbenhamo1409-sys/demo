"use client";

/**
 * סגירת יום — the warehouse day on one screen, so the owner doesn't go looking for it.
 * Five answers: what came in, what went out, which documents stayed open, which exceptions
 * nobody handled and what the manager approved. Every ₪ is a sale price, so the screen says במחירון.
 */
import { Suspense, useCallback, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useData } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, Card, EmptyState, MovementQty, Notice, PageHead, Stat } from "@/components/ui";
import { fmtName, fmtPrice, fmtQty, fmtTime } from "@/lib/format";
import {
  fmtClosingDay,
  isDay,
  israelToday,
  shiftDay,
  useDaySummary,
  useFirstClosedDay,
  type DayAction,
  type DayStock,
  type DaySummary,
  type MovedLine,
} from "@/lib/day-closing";
import "./closing.css";

const ACTION_LABEL: Record<DayAction["kind"], string> = {
  request_approved: "שורה אושרה",
  request_rejected: "שורה נדחתה",
  name_approved: "שם ספק אושר",
  count: "תיקון ספירה",
  no_receipt: "הוצאה בלי קבלה",
  fault_resolved: "תקלה טופלה",
  order_delivered: "סומנה כנמסרה",
};

const STOCK_WORD: Record<DayStock["state"], string> = { short: "חסר", out: "אזל", low: "מינימום" };

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${fmtQty(n)} ${many}`);

const joined = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

const worthOf = (lines: MovedLine[]) => Math.round(lines.reduce((sum, l) => sum + (l.worth ?? 0), 0));

function movedNote(lines: MovedLine[], partyOne: string, partyMany: string): string {
  const products = new Set(lines.map((l) => l.product_id)).size;
  const parties = new Set(lines.map((l) => l.party).filter(Boolean)).size;
  return joined("במחירון", count(products, "מוצר אחד", "מוצרים"), parties > 0 && count(parties, partyOne, partyMany));
}

function stockLine(s: DayStock): string {
  const free = s.qty - s.reserved;
  if (s.state === "short") return `חסרים ${fmtQty(-free)} ${s.unit} להזמנות`;
  if (s.state === "low") return `חסרים ${fmtQty(s.min_qty - free)} ${s.unit}`;
  return `מינימום ${fmtQty(s.min_qty)} ${s.unit}`;
}

/** One line of a block: what it is, then its figure with a word under it. */
function Row({ lead, title, meta, figure, word, tone, onOpen }: {
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  figure?: ReactNode;
  word?: ReactNode;
  tone?: DayStock["state"];
  onOpen?: () => void;
}): ReactElement {
  const body = (
    <>
      <span className="sa-attention-title">{title}</span>
      {meta ? <span className="sa-attention-meta">{meta}</span> : null}
    </>
  );
  return (
    <li className="sa-attention-item">
      {lead}
      {onOpen ? (
        <button type="button" className="sa-attention-body sa-attention-open" onClick={onOpen}>{body}</button>
      ) : (
        <div className="sa-attention-body">{body}</div>
      )}
      {figure || word ? (
        <span className="dc-fig">
          {figure ? <span className="dc-fig-n">{figure}</span> : null}
          {word ? <span className={tone ? `dc-fig-word is-${tone}` : "dc-fig-word"}>{word}</span> : null}
        </span>
      ) : null}
    </li>
  );
}

function Block({ id, title, size, empty, note, children }: {
  id: string;
  title: string;
  size: number;
  empty: string;
  note?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div id={id} className="dc-block">
      <Card title={title} count={size || undefined} flush>
        {size === 0 ? <EmptyState title={empty} /> : <ul className="sa-attention m-0 list-none p-0">{children}</ul>}
        {note ? <p className="dc-note">{note}</p> : null}
      </Card>
    </div>
  );
}

function Moved({ id, title, empty, lines }: { id: string; title: string; empty: string; lines: MovedLine[] }): ReactElement {
  const { product } = useData();
  const { openProduct } = useUi();
  return (
    <Block id={id} title={title} size={lines.length} empty={empty}>
      {lines.map((l) => (
        <Row
          key={`${l.product_id}|${l.party}`}
          lead={<ProductThumb product={product(l.product_id)} />}
          title={fmtName(l.name)}
          meta={
            <>
              {l.party ? <span className="sa-truncate">{l.party}</span> : null}
              {l.no_receipt > 0 ? <span className="dc-flag">בלי קבלה</span> : null}
            </>
          }
          figure={<><span className="ltr"><MovementQty qty={l.qty} type={l.type} /></span> {l.unit}</>}
          word={l.worth === null ? undefined : fmtPrice(Math.round(l.worth))}
          onOpen={() => openProduct(l.product_id, "history")}
        />
      ))}
    </Block>
  );
}

function OpenDocuments({ summary }: { summary: DaySummary }): ReactElement {
  const { openOrder, openAction } = useUi();
  return (
    <Block id="closing-open" title="תעודות פתוחות" size={summary.orders.length + summary.requests.length} empty="אין תעודות פתוחות">
      {summary.orders.map((o) => {
        const late = !!o.promised_on && o.promised_on < summary.day;
        return (
          <Row
            key={o.id}
            title={`הזמנה ${o.number} · ${o.customer}`}
            meta={joined(count(o.lines, "שורה אחת", "שורות"), o.agent)}
            word={late ? <span className="dc-flag">באיחור</span> : "פתוחה"}
            onOpen={() => openOrder(o.id)}
          />
        );
      })}
      {summary.requests.map((r) => (
        <Row
          key={r.id}
          title={`${fmtName(r.name)} × ${fmtQty(r.qty)}`}
          meta={joined(r.customer && `ללקוח ${r.customer}`, r.worker && `נשלח ע"י ${r.worker}`)}
          word="ממתין"
          onOpen={() => openAction("review-item-request", { requestId: r.id })}
        />
      ))}
    </Block>
  );
}

function Exceptions({ summary }: { summary: DaySummary }): ReactElement {
  const router = useRouter();
  const { product } = useData();
  const { openProduct, openAction } = useUi();
  const stock = summary.stock ?? [];
  return (
    <Block
      id="closing-exceptions"
      title="חריגות שלא טופלו"
      size={summary.faults.length + stock.length + summary.names.length}
      empty="אין חריגות פתוחות"
      note={summary.stock ? undefined : "המלאי של יום זה לא נשמר"}
    >
      {summary.faults.map((f) => (
        <Row
          key={f.id}
          title={f.description}
          meta={joined(f.product && fmtName(f.product), f.worker && `דווח ע"י ${f.worker}`)}
          word="תקלה"
          onOpen={() => router.push("/faults")}
        />
      ))}
      {stock.map((s) => (
        <Row
          key={s.product_id}
          lead={<ProductThumb product={product(s.product_id)} />}
          title={fmtName(s.name)}
          meta={stockLine(s)}
          word={STOCK_WORD[s.state]}
          tone={s.state}
          onOpen={() => openProduct(s.product_id)}
        />
      ))}
      {summary.names.map((n) => (
        <Row key={n.id} title={n.name} meta={n.supplier} word="ממתין" onOpen={() => openAction("map-supplier-item", { supplierItemId: n.id })} />
      ))}
    </Block>
  );
}

function ManagerActions({ actions }: { actions: DayAction[] }): ReactElement {
  return (
    <Block id="closing-actions" title="פעולות מנהל" size={actions.length} empty="אין פעולות מנהל">
      {actions.map((a) => (
        <Row
          key={`${a.kind}|${a.at}|${a.title}`}
          title={fmtName(a.title)}
          meta={joined(ACTION_LABEL[a.kind], a.detail && fmtName(a.detail))}
          figure={a.qty === null ? undefined : `${fmtQty(a.qty)}${a.unit ? ` ${a.unit}` : ""}`}
          word={fmtTime(a.at)}
        />
      ))}
    </Block>
  );
}

function Headline({ summary }: { summary: DaySummary }): ReactElement {
  const received = summary.moved.filter((l) => l.type === "in");
  const delivered = summary.moved.filter((l) => l.type === "out");
  const noReceipt = delivered.reduce((sum, l) => sum + l.no_receipt, 0);
  const open = summary.orders.length + summary.requests.length;
  const stock = summary.stock?.length ?? 0;
  const exceptions = summary.faults.length + stock + summary.names.length;
  const last = summary.actions[0];
  return (
    <div className="sa-stats dc-stats">
      <Stat
        label="נקלט"
        icon="arrow-down-left"
        href="#closing-in"
        value={fmtPrice(worthOf(received))}
        note={received.length > 0 ? movedNote(received, "ספק אחד", "ספקים") : "לא נקלטה סחורה"}
      />
      <Stat
        label="נמסר"
        icon="arrow-up-right"
        href="#closing-out"
        value={fmtPrice(worthOf(delivered))}
        note={
          delivered.length > 0 ? (
            <>
              {movedNote(delivered, "לקוח אחד", "לקוחות")}
              {noReceipt > 0 ? <span className="dc-flag"> · {count(noReceipt, "שורה אחת", "שורות")} בלי קבלה</span> : null}
            </>
          ) : "לא נמסרה סחורה"
        }
      />
      <Stat
        label="תעודות פתוחות"
        href="#closing-open"
        value={fmtQty(open)}
        note={open > 0 ? joined(summary.orders.length > 0 && count(summary.orders.length, "הזמנה אחת", "הזמנות"), summary.requests.length > 0 && `${fmtQty(summary.requests.length)} אצל המנהל`) : <span className="dc-calm">הכל סגור</span>}
      />
      <Stat
        label="חריגות שלא טופלו"
        href="#closing-exceptions"
        value={fmtQty(exceptions)}
        note={exceptions > 0 ? joined(summary.faults.length > 0 && count(summary.faults.length, "תקלה אחת", "תקלות"), stock > 0 && `${fmtQty(stock)} במלאי`, summary.names.length > 0 && `${fmtQty(summary.names.length)} שמות ספק`) : <span className="dc-calm">{summary.stock ? "הכל טופל" : "אין תקלות פתוחות"}</span>}
      />
      <Stat
        label="פעולות מנהל"
        href="#closing-actions"
        value={fmtQty(summary.actions.length)}
        note={last ? `אחרונה ${fmtTime(last.at)}` : "אין פעולות"}
      />
    </div>
  );
}

function Waiting(): ReactElement {
  return (
    <div className="dc-split" aria-hidden="true">
      {[0, 1].map((i) => (
        <Card key={i} flush>
          <ul className="sa-attention m-0 list-none p-0">
            {[0, 1, 2].map((row) => (
              <li key={row} className="sa-attention-item">
                <span className="sa-thumb" />
                <span className="sa-attention-body"><span className="sa-skeleton" style={{ width: `${44 + row * 14}%` }} /></span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
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

  const go = useCallback(
    (next: string) => router.replace(next === israelToday() ? pathname : `${pathname}?day=${next}`, { scroll: false }),
    [pathname, router],
  );

  return (
    <div className="sa-page dc-page">
      <PageHead
        title="סגירת יום"
        sub={joined(fmtClosingDay(day), isToday ? "עד עכשיו, נסגר בחצות" : "נסגר")}
        actions={
          <>
            {isToday ? null : <Button variant="ghost" onClick={() => go(today)}>היום</Button>}
            <Button variant="secondary" icon="chevron-right" disabled={first !== null && day <= first} onClick={() => go(shiftDay(day, -1))}>יום קודם</Button>
            <Button variant="secondary" iconEnd="chevron-left" disabled={isToday} onClick={() => go(shiftDay(day, 1))}>יום הבא</Button>
          </>
        }
      />

      {failed ? (
        <Notice tone="danger" title="הסיכום לא נטען" action="ניסיון נוסף" onAction={retry} />
      ) : !summary ? (
        <Waiting />
      ) : (
        <>
          <Headline summary={summary} />
          <div className="dc-split">
            <Moved id="closing-in" title="נקלט" empty="אין קליטות" lines={summary.moved.filter((l) => l.type === "in")} />
            <Moved id="closing-out" title="נמסר" empty="אין הוצאות" lines={summary.moved.filter((l) => l.type === "out")} />
            <OpenDocuments summary={summary} />
            <Exceptions summary={summary} />
          </div>
          <ManagerActions actions={summary.actions} />
        </>
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
