"use client";

/**
 * The overview, in the order an owner asks: what needs a person now, then the figures, then what is happening.
 * One central card for what waits, open sections for the rest. Words and figures, no chart.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { available, orderTotal, useData, type Movement as MovementRow } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { Button, Card, EmptyState, MovementQty, Showing } from "@/components/ui";
import { byPromise, daysUntil, fmtAge, fmtName, fmtPrice, fmtPromised, fmtQty, fmtRelative, fmtUnit, MOVEMENT_LABEL } from "@/lib/format";
import type { Runway } from "@/lib/snapshot";
import { ProductThumb } from "./Viz";
import "./overview.css";

export type CheckTone = "ok" | "warn" | "bad" | "short" | "none";

/** One line of a lane: what it is, and where a click takes the person who deals with it. */
export interface LaneRow {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  word?: string;
  tone?: CheckTone;
  onOpen: () => void;
  /** Takes the line off the overview; the product stays as it is. */
  onDismiss?: () => void;
}

export interface Lane {
  key: string;
  label: string;
  count: number;
  /** Colours the count: how grave this lane is, not how long. */
  tone: CheckTone;
  /** Said in green when the lane is empty. */
  calm: string;
  rows: LaneRow[];
  /** The page that holds them all. A lane with no page of its own opens in place. */
  href?: string;
  more?: string;
}

/** The rows a lane shows before it asks to be opened, so all three stay on the first screen. */
const LANE_ROWS = 3;

function LaneColumn({ lane }: { lane: Lane }): ReactElement {
  const [open, setOpen] = useState(false);
  const rows = open ? lane.rows : lane.rows.slice(0, LANE_ROWS);
  const hidden = lane.rows.length - LANE_ROWS;
  return (
    <div className="ov-lane">
      <div className="ov-lane-head">
        <span className={`ov-lane-n is-${lane.count > 0 ? lane.tone : "ok"}`}>{fmtQty(lane.count)}</span>
        <span className="ov-lane-label">{lane.label}</span>
      </div>
      {lane.count === 0 ? (
        <p className="ov-lane-calm">{lane.calm}</p>
      ) : (
        <ul className="ov-lane-rows">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" className="ov-lane-row" onClick={r.onOpen}>
                <span className="ov-lane-text">
                  <span className="ov-lane-title">{r.title}</span>
                  {r.meta ? <span className="ov-lane-meta">{r.meta}</span> : null}
                </span>
                {r.word ? <span className={`ov-fig-word is-${r.tone ?? "none"}`}>{r.word}</span> : null}
              </button>
              {r.onDismiss ? (
                <Button variant="ghost" size="sm" iconOnly icon="x" title="הסרה מהרשימה" className="ov-lane-remove" onClick={r.onDismiss} />
              ) : lane.rows.some((other) => other.onDismiss) ? (
                <span className="ov-lane-remove" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {lane.count > 0 && lane.more ? (
        lane.href ? (
          <Link href={lane.href} className="sa-btn sa-btn-link sa-btn-sm ov-lane-more">{lane.more}</Link>
        ) : hidden > 0 ? (
          <Button variant="link" size="sm" className="ov-lane-more" onClick={() => setOpen(!open)}>{open ? "פחות" : lane.more}</Button>
        ) : null
      ) : null}
    </div>
  );
}

/** The one card on the screen: how many of each thing wait on a person, and the first few of them, each a click from being dealt with. */
export function AttentionBoard({ lanes }: { lanes: Lane[] }): ReactElement {
  const quiet = lanes.every((l) => l.count === 0);
  return (
    <div id="ov-work" className="min-w-0">
      <Card title={quiet ? "הכל תקין" : "דורש את תשומת הלב שלך"} className="ov-board">
        {lanes.map((lane) => <LaneColumn key={lane.key} lane={lane} />)}
      </Card>
    </div>
  );
}

export interface Figure {
  key: string;
  label: string;
  value: ReactNode;
  note?: ReactNode;
  href: string;
}

/** The figures after the worries: quiet, in one line, each a link to the page that explains it. */
export function FigureLine({ figures }: { figures: Figure[] }): ReactElement {
  return (
    <div className="ov-figures">
      {figures.map((f) => (
        <Link key={f.key} href={f.href} className="ov-figure">
          <span className="ov-figure-label">{f.label}</span>
          <span className="ov-figure-n">{f.value}</span>
          {f.note ? <span className="ov-figure-note">{f.note}</span> : null}
        </Link>
      ))}
    </div>
  );
}

/** One figure at the end of a row, with the state as a word under it. */
function RowFigure({ figure, word, tone }: { figure: ReactNode; word?: string; tone?: CheckTone }): ReactElement {
  return (
    <span className="ov-fig">
      <span className={`ov-fig-n ${word ? "" : `is-${tone ?? "none"}`}`}>{figure}</span>
      {word ? <span className={`ov-fig-word is-${tone ?? "none"}`}>{word}</span> : null}
    </span>
  );
}

function RowSkeleton({ rows }: { rows: number }): ReactElement {
  return (
    <ul className="sa-attention m-0 list-none p-0" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="sa-attention-item">
          <span className="sa-thumb" />
          <span className="sa-attention-body"><span className="sa-skeleton" style={{ width: `${44 + ((i * 17) % 30)}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}

const fmtDays = (n: number) => (n >= 90 ? "מעל 3 חודשים" : n === 1 ? "עוד יום" : n === 2 ? "עוד יומיים" : `עוד ${fmtQty(n)} ימים`);

/** The figure and word for one product: first what is already wrong, then the days it has left. */
export function runwayFigure(r: Runway): { figure: string; word?: string; tone: CheckTone } {
  if (r.state === "short") return { figure: `חסר ${fmtQty(-r.free)}`, tone: "short" };
  if (r.state === "out") return { figure: "אזל", tone: "bad" };
  if (r.free <= 0) return { figure: "הכל משוריין", tone: "warn" };
  if (r.days === null) return { figure: "מתחת למינימום", tone: "warn" };
  return { figure: fmtDays(r.days), word: r.state === "low" ? "מתחת למינימום" : undefined, tone: r.state === "low" ? "warn" : "none" };
}

export function runwayMeta({ product: p, free }: Runway): string {
  const min = p.min_qty > 0 ? `מינימום ${fmtQty(p.min_qty)}` : "";
  const stock = p.qty <= 0 ? "" : free <= 0 ? `על המדף ${fmtQty(p.qty)} ${fmtUnit(p.qty, p.unit)}` : `זמין ${fmtQty(free)} ${fmtUnit(free, p.unit)}`;
  return [stock, min].filter(Boolean).join(" · ") || p.sku;
}

/** What just happened in the warehouse, the latest first: what, who, when, and the figure in its colour. */
export function Activity({ rows, today, isLoading }: { rows: MovementRow[]; today: number; isLoading: boolean }): ReactElement {
  const { product, worker } = useData();
  const { openMovement, openAction } = useUi();
  return (
    <Card
      title="פעילות אחרונה"
      subtitle={today > 0 ? `${fmtQty(today)} ${today === 1 ? "תנועה" : "תנועות"} היום` : "אין תנועות היום"}
      actions={<Link href="/movements?period=all" className="sa-btn sa-btn-link sa-btn-sm">כל התנועות</Link>}
      flush
      className="ov-list min-w-0"
    >
      {isLoading ? (
        <RowSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState title="עוד לא נרשמו תנועות" hint="קליטה או הוצאה ראשונה תופיע כאן">
          <Button variant="secondary" onClick={() => openAction("receive")}>קליטת סחורה</Button>
        </EmptyState>
      ) : (
        <ul className="sa-attention m-0 list-none p-0">
          {rows.map((m) => {
            const p = product(m.product_id);
            const who = worker(m.worker_id)?.name;
            return (
              <li key={m.id} className="sa-attention-item">
                <ProductThumb product={p} small />
                <button type="button" className="sa-attention-body sa-attention-open" onClick={() => openMovement(m)}>
                  <span className="sa-attention-title">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
                  <span className="sa-attention-meta">
                    <span className="sa-truncate">{[MOVEMENT_LABEL[m.type], who, fmtRelative(m.created_at)].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
                <RowFigure figure={<span className="ltr"><MovementQty qty={m.qty} type={m.type} /></span>} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** What was promised to customers, with what each is worth and whether the shelf covers it. */
export function OpenOrders({ shown, isLoading }: { shown: number; isLoading: boolean }): ReactElement {
  const { state, linesOf, product } = useData();
  const { openOrder } = useUi();
  // The nearest delivery leads; orders with no date follow, oldest first (state.orders is newest first).
  const orders = useMemo(() => state.orders.filter((o) => o.status === "open").reverse().sort(byPromise), [state.orders]);
  const totals = orders.map((o) => orderTotal(linesOf(o.id)));
  return (
    <Card
      title="הזמנות למסירה"
      subtitle={orders.length > 0 && totals.every((t) => t !== null) ? `${fmtQty(orders.length)} פתוחות · ${fmtPrice(totals.reduce<number>((sum, t) => sum + (t ?? 0), 0))}` : "לפי מועד המסירה"}
      actions={<Link href="/orders" className="sa-btn sa-btn-link sa-btn-sm">כל ההזמנות</Link>}
      flush
      className="ov-list min-w-0"
    >
      {isLoading ? (
        <RowSkeleton rows={2} />
      ) : orders.length === 0 ? (
        <EmptyState title="אין הזמנות פתוחות" hint="הזמנה של סוכן תופיע כאן" />
      ) : (
        <ul className="sa-attention m-0 list-none p-0">
          {orders.slice(0, shown).map((o) => {
            const lines = linesOf(o.id);
            const first = product(lines[0]?.product_id);
            const total = orderTotal(lines);
            const short = lines.some((l) => {
              const p = product(l.product_id);
              return p ? available(p) < 0 : false;
            });
            return (
              <li key={o.id} className="sa-attention-item">
                <ProductThumb product={first} small />
                <button type="button" className="sa-attention-body sa-attention-open" onClick={() => openOrder(o.id)}>
                  <span className="sa-attention-title">{o.customer}</span>
                  <span className="sa-attention-meta">
                    <span className="sa-truncate">{first ? fmtName(first.name) : "—"}{lines.length > 1 ? ` +${lines.length - 1}` : ""}</span>
                    {o.promised_on ? (
                      <span className={daysUntil(o.promised_on) < 0 ? "sa-order-late" : undefined}>· מסירה {fmtPromised(o.promised_on)}</span>
                    ) : (
                      <span className="ov-age">· {fmtAge(o.created_at)}</span>
                    )}
                  </span>
                </button>
                <RowFigure figure={<span className="ltr">{fmtPrice(total)}</span>} word={short ? "חסר במלאי" : "מוכן למסירה"} tone={short ? "short" : "ok"} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Instead of a chart of the past: the healthy products that run out next, each with the days it has. */
export function RunningOut({ rows, shown, isLoading }: { rows: Runway[]; shown: number; isLoading: boolean }): ReactElement {
  const { openProduct } = useUi();
  const list = rows.slice(0, shown);
  return (
    <Card
      title="מה ייגמר בקרוב"
      subtitle="לפי קצב ההוצאה בחודש האחרון"
      actions={<Link href="/inventory" className="sa-btn sa-btn-link sa-btn-sm">כל המלאי</Link>}
      flush
      className="ov-list ov-soon min-w-0"
      footer={rows.length > shown ? <Showing shown={shown} total={rows.length} /> : undefined}
    >
      {isLoading ? (
        <RowSkeleton rows={shown} />
      ) : list.length === 0 ? (
        <EmptyState title="שום מוצר לא קרוב להיגמר" hint="לפי קצב ההוצאה בחודש האחרון" />
      ) : (
        <ul className="sa-attention m-0 list-none p-0">
          {list.map((r) => {
            const { figure, word, tone } = runwayFigure(r);
            return (
              <li key={r.product.id} className="sa-attention-item">
                <ProductThumb product={r.product} small />
                <button type="button" className="sa-attention-body sa-attention-open" onClick={() => openProduct(r.product.id)}>
                  <span className="sa-attention-title">{fmtName(r.product.name)}</span>
                  <span className="sa-attention-meta">{runwayMeta(r)}</span>
                </button>
                <RowFigure figure={figure} word={word} tone={tone} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
