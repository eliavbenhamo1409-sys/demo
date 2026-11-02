"use client";

/**
 * The owner's picture on the overview: what the shelf is worth with the worries answered beside it,
 * what runs out first, and what was promised to customers. Words and figures, one bar, no chart.
 */
import { useMemo, type CSSProperties, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { available, orderTotal, useData } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { Button, Card, EmptyState, Icon, Showing, type IconName } from "@/components/ui";
import { byPromise, daysUntil, fmtAge, fmtName, fmtPrice, fmtPromised, fmtQty } from "@/lib/format";
import type { Runway, ShelfWorth } from "@/lib/snapshot";
import { CountUp, ProductThumb, StockBar } from "./Viz";
import "./overview.css";

export type CheckTone = "ok" | "warn" | "bad" | "short" | "none";

export interface Check {
  key: string;
  label: string;
  icon: IconName;
  answer: string;
  tone: CheckTone;
  href?: string;
}

export interface OrderPromises {
  open: number;
  /** Open orders holding a product the shelf no longer covers. */
  uncovered: number;
  /** Open orders past the delivery date promised to the customer. */
  late: number;
}

/** A sum of shekels that climbs like any figure; a whole shekel is exact enough for the owner. */
export function Shekels({ value }: { value: number }): ReactElement {
  return <span className="ltr"><span className="ov-cur">₪</span><CountUp value={Math.round(value)} /></span>;
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

/** Can every open order be kept? The figure the owner sleeps on: all of them, unless the shelf fell below what they hold. */
function OrderCover({ open, uncovered, late }: OrderPromises): ReactElement {
  const percent = open > 0 ? Math.floor(((open - uncovered) / open) * 100) : 0;
  const note =
    open === 0 ? "אין הזמנות פתוחות"
    : uncovered > 0 ? `חסר מלאי ל-${fmtQty(uncovered)} מתוך ${fmtQty(open)}`
    : open === 1 ? "הזמנה אחת פתוחה, הכל על המדף"
    : `${fmtQty(open)} הזמנות פתוחות, הכל על המדף`;
  return (
    <Link href="/orders" className="ov-cover">
      <span className="ov-worth-label">הזמנות מכוסות</span>
      <span className={`ov-cover-n ${open === 0 ? "is-none" : uncovered > 0 ? "is-short" : "is-ok"}`}>
        <span className="ltr"><CountUp value={percent} />%</span>
      </span>
      <span className="ov-worth-note">{note}</span>
      {late > 0 ? <span className="ov-worth-note sa-order-late">{late === 1 ? "הזמנה אחת באיחור" : `${fmtQty(late)} הזמנות באיחור`}</span> : null}
    </Link>
  );
}

/** The first thing on the screen: what the warehouse is worth and how much of it is promised, then the promise and the worries, answered. */
export function ShelfPicture({ worth, products, orders, checks }: { worth: ShelfWorth; products: number; orders: OrderPromises; checks: Check[] }): ReactElement {
  const note = worth.unpriced > 0 ? `${fmtQty(worth.unpriced)} מוצרים ללא מחיר` : `${fmtQty(products)} מוצרים`;
  return (
    <Card className="ov-hero">
      <div className="ov-worth">
        <div className="ov-worth-label">שווי המלאי</div>
        <div className="ov-worth-n" style={{ "--len": fmtQty(Math.round(worth.total)).length + 1 } as CSSProperties}><Shekels value={worth.total} /></div>
        <div className="ov-worth-note">במחירון · {note}</div>
        <div className="ov-held">
          <StockBar
            label={`${fmtPrice(Math.round(worth.free))} זמין, ${fmtPrice(Math.round(worth.held))} משוריין להזמנות`}
            parts={[
              { tone: "ok", value: worth.free },
              { tone: "other", value: worth.held },
            ]}
          />
          <dl className="ov-parts">
            <div>
              <dt><i className="is-free" />זמין</dt>
              <dd><Shekels value={worth.free} /></dd>
            </div>
            <div>
              <dt><i className="is-held" />משוריין</dt>
              <dd><Shekels value={worth.held} /></dd>
            </div>
          </dl>
        </div>
      </div>

      <OrderCover {...orders} />

      <div className="ov-checks">
        {checks.map((c) => {
          const body = (
            <>
              <span className="ov-check-label"><Icon name={c.icon} size={18} />{c.label}</span>
              <span className={`ov-check-answer is-${c.tone}`}>{c.answer}</span>
              {c.href ? <Icon name="chevron-left" size={16} className="ov-check-chev" /> : null}
            </>
          );
          return c.href ? (
            <Link key={c.key} href={c.href} className="ov-check">{body}</Link>
          ) : (
            <div key={c.key} className="ov-check">{body}</div>
          );
        })}
      </div>
    </Card>
  );
}

const fmtDays = (n: number) => (n >= 90 ? "מעל 3 חודשים" : n === 1 ? "עוד יום" : n === 2 ? "עוד יומיים" : `עוד ${fmtQty(n)} ימים`);

/** The figure and word for one product: first what is already wrong, then the days it has left. */
function runwayFigure(r: Runway): { figure: string; word?: string; tone: CheckTone } {
  if (r.state === "short") return { figure: `חסר ${fmtQty(-r.free)}`, tone: "short" };
  if (r.state === "out") return { figure: "אזל", tone: "bad" };
  if (r.free <= 0) return { figure: "הכל משוריין", tone: "warn" };
  if (r.days === null) return { figure: "מתחת למינימום", tone: "warn" };
  return { figure: fmtDays(r.days), word: r.state === "low" ? "מתחת למינימום" : undefined, tone: r.state === "low" ? "warn" : "none" };
}

function runwayMeta({ product: p, free }: Runway): string {
  const min = p.min_qty > 0 ? `מינימום ${fmtQty(p.min_qty)}` : "";
  const stock = p.qty <= 0 ? "" : free <= 0 ? `על המדף ${fmtQty(p.qty)} ${p.unit}` : `זמין ${fmtQty(free)} ${p.unit}`;
  return [stock, min].filter(Boolean).join(" · ") || p.sku;
}

/** Instead of a chart of the past: the products closest to running out, each with the days it has. */
export function RunningOut({ rows, shown, isLoading, onDismiss }: { rows: Runway[]; shown: number; isLoading: boolean; onDismiss: (r: Runway) => void }): ReactElement {
  const { openProduct } = useUi();
  const list = rows.slice(0, shown);
  return (
    <Card
      title="מה ייגמר ראשון"
      subtitle="לפי קצב ההוצאה בחודש האחרון"
      flush
      className="ov-list ov-soon min-w-0"
      footer={
        rows.length > 0 ? (
          <>
            {rows.length > shown ? <Showing shown={shown} total={rows.length} /> : null}
            <Link href="/inventory" className="sa-btn sa-btn-link sa-btn-sm ms-auto">כל המלאי</Link>
          </>
        ) : undefined
      }
    >
      {isLoading ? (
        <RowSkeleton rows={shown} />
      ) : list.length === 0 ? (
        <EmptyState title="אין מוצרים" hint="מוצר שיתווסף למלאי יופיע כאן" />
      ) : (
        <ul className="sa-attention m-0 list-none p-0">
          {list.map((r) => {
            const { figure, word, tone } = runwayFigure(r);
            return (
              <li key={r.product.id} className="sa-attention-item">
                <ProductThumb product={r.product} />
                <button type="button" className="sa-attention-body sa-attention-open" onClick={() => openProduct(r.product.id)}>
                  <span className="sa-attention-title">{fmtName(r.product.name)}</span>
                  <span className="sa-attention-meta">{runwayMeta(r)}</span>
                </button>
                <RowFigure figure={figure} word={word} tone={tone} />
                <div className="sa-attention-actions ov-remove">
                  {r.state === "out" || r.state === "low" ? (
                    <Button variant="ghost" size="sm" iconOnly icon="x" title="הסרה מהרשימה" onClick={() => onDismiss(r)} />
                  ) : null}
                </div>
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
      title="הזמנות פתוחות"
      subtitle="לפי מועד המסירה"
      count={orders.length || undefined}
      flush
      className="ov-list min-w-0"
      footer={
        orders.length > 0 ? (
          <>
            {orders.length > shown ? <Showing shown={shown} total={orders.length} /> : null}
            <Link href="/orders" className="sa-btn sa-btn-link sa-btn-sm">כל ההזמנות</Link>
            {totals.every((t) => t !== null) ? (
              <span className="ov-total">סה״כ <span className="ltr">{fmtPrice(totals.reduce<number>((sum, t) => sum + (t ?? 0), 0))}</span></span>
            ) : null}
          </>
        ) : undefined
      }
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
                <ProductThumb product={first} />
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
                <RowFigure figure={<span className="ltr">{fmtPrice(total)}</span>} word={short ? "חסר במלאי" : "מכוסה"} tone={short ? "short" : "ok"} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
