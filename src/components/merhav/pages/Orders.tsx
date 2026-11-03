"use client";

/**
 * הזמנות as promises: who, when, what it is worth, and whether the shelf can keep it. The horizon lays the open orders on
 * their days, the list reads along it day by day, and every order reaches for its racks and its way out to dispatch.
 * Same data, same ?status=, same search as the shared page.
 */

import { memo, Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Count, cx, EmptyState, PageHead, Select, Showing, Tabs, Toolbar, type SelectOption } from "@/components/ui";
import { byPromise, fmtAge, fmtDay, fmtName, fmtPlainDay, fmtPrice, fmtPromised, fmtQty, fmtWeekday, ORDER_STATUS_LABEL } from "@/lib/format";
import { DISPATCH_ZONE } from "@/lib/map3d/layout";
import { routeBetween } from "@/lib/map3d/route";
import type { LabelAnchor, MapObject, MapPoint, MapRoute } from "@/lib/map3d/types";
import { available, normalizeName, orderTotal, useData, type Order, type OrderLine, type Product } from "@/lib/store";
import { Figure } from "../Figure";
import { useTwin } from "../twin/Twin";

type Status = Order["status"];

const TABS: { value: Status; label: string; empty: string }[] = [
  { value: "open", label: "פתוחות", empty: "אין הזמנות פתוחות" },
  { value: "delivered", label: "נמסרו", empty: "אין הזמנות שנמסרו" },
  { value: "cancelled", label: "בוטלו", empty: "אין הזמנות שבוטלו" },
];

function toStatus(value: string | null): Status {
  return value === "delivered" || value === "cancelled" ? value : "open";
}

const digitsOf = (text: string) => text.replace(/\D/g, "");

/** A search with letters in it looks for a name, even one with a number in it, so it never matches a phone. */
const phoneDigits = (q: string) => (/\p{L}/u.test(q) ? "" : digitsOf(q));

/* ───────── an order, as this page reads it ───────── */

interface OrderRow {
  order: Order;
  lines: OrderLine[];
  /** The product the row names: what is short, when something is. */
  lead: Product | undefined;
  total: number | null;
  /** Lines of a product held past its shelf: the same reading as סקירה, which links here. */
  short: OrderLine[];
  /** Every rack that holds its lines. */
  racks: string[];
  agentName: string | undefined;
}

const isShort = (p: Product | undefined) => (p ? available(p) < 0 : false);

/** The strongest thing about an open order, wherever it is said. */
function Cover({ row, className }: { row: OrderRow; className?: string }): ReactElement {
  const missing = row.short.length > 0;
  return <span className={cx(className, missing ? "mh-tone-short" : "mh-tone-ok")}>{missing ? "חסר" : "מכוסה"}</span>;
}

const routes = new WeakMap<readonly MapObject[], Map<string, MapPoint[]>>();

/** The way from a rack to dispatch, kept per floor: a pointer crossing the list asks for the same few again and again. */
function wayOut(objects: readonly MapObject[], rack: string): MapPoint[] {
  const known = routes.get(objects) ?? new Map<string, MapPoint[]>();
  routes.set(objects, known);
  const points = known.get(rack) ?? routeBetween(objects, rack, DISPATCH_ZONE);
  known.set(rack, points);
  return points;
}

/** Where the list breaks and the horizon stands: a day, or one of these. */
const LATE = "late";
const LATER = "later";
const NO_DAY = "none";
const isDay = (key: string) => key !== LATE && key !== NO_DAY;

/** The lens on what the shelf can't keep: one more tab, in the URL as ?filter=short. */
const SHORT = "short";

/** How far into a day the list must have gone before the carriage moves on, and how long a jump keeps the carriage still. */
const READ_MARGIN = 40;
const JUMP_MS = 1200;

/** The horizon always looks a week ahead, and past three weeks it folds what remains into one place. */
const AHEAD_MIN = 6;
const AHEAD_MAX = 20;

const WEEKDAY = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

interface DayGroup {
  key: string;
  rows: OrderRow[];
  worth: number;
  unpriced: number;
}

function groupByDay(rows: readonly OrderRow[], today: string): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const row of rows) {
    const day = row.order.promised_on;
    const key = !day ? NO_DAY : day < today ? LATE : day;
    let group = groups.get(key);
    if (!group) {
      group = { key, rows: [], worth: 0, unpriced: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    if (row.total === null) group.unpriced += 1;
    else group.worth += row.total;
  }
  // What the shelf can't keep comes first in its day: position, not volume.
  for (const group of groups.values()) group.rows.sort((a, b) => Number(b.short.length > 0) - Number(a.short.length > 0));
  return [...groups.values()];
}

interface Slot {
  key: string;
  /** The real day, on a slot that stands for one. */
  day: string | null;
  /** Where the list jumps to. */
  target: string | null;
  rows: OrderRow[];
  span: number;
}

/** The ruled days from today out, with what is late before them and what has no day after them. */
function horizonOf(groups: readonly DayGroup[], today: string): Slot[] {
  const last = groups.reduce((end, g) => (isDay(g.key) && g.key > end ? g.key : end), today);
  const ahead = Math.round((Date.parse(last) - Date.parse(today)) / 86_400_000);
  const days = Math.min(Math.max(ahead, AHEAD_MIN), AHEAD_MAX);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const slots: Slot[] = [];
  const late = byKey.get(LATE);
  if (late) slots.push({ key: LATE, day: null, target: LATE, rows: late.rows, span: 2 });
  for (let i = 0; i <= days; i++) {
    const day = addDays(today, i);
    const group = byKey.get(day);
    slots.push({ key: day, day, target: group ? day : null, rows: group?.rows ?? [], span: 1 });
  }
  const end = addDays(today, days);
  const past = groups.filter((g) => isDay(g.key) && g.key > end);
  if (past.length > 0) slots.push({ key: LATER, day: null, target: past[0].key, rows: past.flatMap((g) => g.rows), span: 2 });
  const none = byKey.get(NO_DAY);
  if (none) slots.push({ key: NO_DAY, day: null, target: NO_DAY, rows: none.rows, span: 2 });
  return slots;
}

function dayTitle(key: string, today: string): ReactNode {
  if (key === LATE) return <span className="mh-tone-warn">באיחור</span>;
  if (key === NO_DAY) return "ללא מועד מסירה";
  const word = key === today ? "היום" : key === addDays(today, 1) ? "מחר" : null;
  return word ? <>{word} <span className="mh-ord-daydate">{fmtWeekday(key)}</span></> : fmtWeekday(key);
}

/* ───────── the horizon ───────── */

interface HorizonProps {
  slots: readonly Slot[];
  today: string;
  /** The day the list is reading. */
  at: string | null;
  hot: ReadonlySet<string> | null;
  onSlab: (row: OrderRow | null, target?: HTMLElement) => void;
  onDay: (ids: readonly string[] | null) => void;
  onOpen: (row: OrderRow) => void;
  onJump: (key: string) => void;
}

/** The sum of a pile: ₪ add up across products, and a pile is drawn to that sum. */
const pileWorth = (rows: readonly OrderRow[]) => rows.reduce((sum, r) => sum + (r.total ?? 0), 0);

function slotWord(slot: Slot, today: string): string {
  if (slot.key === LATE) return "באיחור";
  if (slot.key === LATER) return "אחר כך";
  if (slot.key === NO_DAY) return "ללא יום";
  const day = slot.day ?? today;
  return day === today ? "היום" : day === addDays(today, 1) ? "מחר" : WEEKDAY[weekdayOf(day)];
}

/** A day of the month, with the month where it turns. */
function slotDate(slot: Slot): string | null {
  if (!slot.day) return null;
  const date = Number(slot.day.slice(8));
  return date === 1 ? fmtPlainDay(slot.day).replace(/^0/, "") : String(date);
}

interface Tip {
  x: number;
  body: ReactNode;
}

function Horizon({ slots, today, at, hot, onSlab, onDay, onOpen, onJump }: HorizonProps): ReactElement {
  const [tip, setTip] = useState<Tip | null>(null);
  const top = Math.max(...slots.map((s) => pileWorth(s.rows)), 1);
  const units = slots.reduce((sum, s) => sum + s.span, 0);
  const starts = slots.map((_, i) => slots.slice(0, i).reduce((sum, s) => sum + s.span, 0));
  // A day past the fold rides with the place that folds it.
  const exact = slots.findIndex((s) => s.target === at);
  const here = exact >= 0 || !at || !isDay(at) ? exact : slots.findIndex((s) => s.key === LATER);
  const stop = here >= 0 ? here : slots.findIndex((s) => s.target);

  const leave = () => {
    setTip(null);
    onSlab(null);
    onDay(null);
  };

  // One stop on the way through the page: the arrows walk the days, along time, whatever the direction of the text.
  const walk = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const days = [...e.currentTarget.querySelectorAll<HTMLElement>("button.mh-hz-day")];
    const from = days.indexOf(document.activeElement as HTMLElement);
    days[Math.min(Math.max(from + (e.key === "ArrowRight" ? 1 : -1), 0), days.length - 1)]?.focus();
  };

  return (
    <div className={cx("mh-hz", hot && "is-hot")} dir="ltr" role="group" aria-label="מסירות לפי יום" style={{ "--units": units } as CSSProperties} onPointerLeave={leave} onKeyDown={walk}>
      {slots.map((slot, i) => {
        const x = ((starts[i] + slot.span / 2) / units) * 100;
        const word = slotWord(slot, today);
        const name = slot.day ? fmtWeekday(slot.day) : word;
        const label = (
          <>
            <span className="mh-hz-word">{word}</span>{" "}
            <span className="mh-hz-date">{slotDate(slot)}</span>
          </>
        );
        const day = () => {
          setTip({ x, body: <><span>{name}</span><span className="mh-hz-tip-sub"><Count n={slot.rows.length} one="הזמנה" many="הזמנות" /> · <span className="ltr">{fmtPrice(pileWorth(slot.rows))}</span> במחירון</span></> });
          onSlab(null);
          onDay(slot.rows.map((r) => r.order.id));
        };
        return (
          <div
            key={slot.key}
            className={cx("mh-hz-slot", slot.day !== null && weekdayOf(slot.day) === 0 && "is-week", slot.day === today && "is-today", slot.day === addDays(today, 1) && "is-next", slot.key === LATE && "is-late")}
            style={{ gridColumn: `span ${slot.span}` }}
          >
            {slot.target ? (
              <button
                type="button"
                className="mh-hz-day"
                dir="rtl"
                tabIndex={i === stop ? 0 : -1}
                // Starts with the words on the key, so a voice can press it by what it reads.
                aria-label={[`${word} ${slotDate(slot) ?? ""}`.trim(), name !== word && name, slot.rows.length === 1 ? "הזמנה אחת" : `${fmtQty(slot.rows.length)} הזמנות`].filter(Boolean).join(", ")}
                onPointerEnter={day}
                onFocus={day}
                onBlur={leave}
                onClick={() => onJump(slot.target as string)}
              >
                {label}
              </button>
            ) : (
              <span className="mh-hz-day" dir="rtl">{label}</span>
            )}
            <div className="mh-hz-pile" style={{ "--i": i } as CSSProperties}>
              {slot.rows.map((row) => (
                <button
                  key={row.order.id}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  className={cx("mh-hz-slab", row.short.length > 0 && "is-short", hot?.has(row.order.id) && "is-hot")}
                  style={{ "--h": (row.total ?? 0) / top } as CSSProperties}
                  onPointerEnter={(e) => {
                    setTip({ x, body: <><span>{row.order.customer}</span><span className="mh-hz-tip-sub"><span className="ltr">{fmtPrice(row.total)}</span> · <Cover row={row} /></span></> });
                    onDay(null);
                    onSlab(row, e.currentTarget);
                  }}
                  onClick={() => onOpen(row)}
                />
              ))}
            </div>
          </div>
        );
      })}
      {here >= 0 ? <i className="mh-hz-carriage" style={{ "--at": starts[here], "--span": slots[here].span } as CSSProperties} aria-hidden="true" /> : null}
      {tip ? (
        <span className="mh-hz-tip" dir="rtl" style={{ "--x": `${tip.x}%` } as CSSProperties}>{tip.body}</span>
      ) : null}
    </div>
  );
}

/* ───────── one order ───────── */

interface RowProps {
  row: OrderRow;
  today: string;
  selected: boolean;
  hot: boolean;
  onReach: (row: OrderRow | null, target?: HTMLElement) => void;
  onOpen: (row: OrderRow) => void;
}

const OrderItem = memo(function OrderItem({ row, today, selected, hot, onReach, onOpen }: RowProps): ReactElement {
  const { order: o, lines, lead, total, short, racks, agentName } = row;
  const open = o.status === "open";
  const missing = short.length > 0;
  const late = open && o.promised_on !== null && o.promised_on < today;
  const gap = short.length === 1 && lead ? `חסר ${fmtQty(-available(lead))} ${lead.unit}` : `חסר ב-${fmtQty(short.length)} שורות`;
  return (
    <li>
      <button
        type="button"
        className={cx("mh-row mh-ord-row", selected && "is-selected", hot && "is-hot")}
        onPointerEnter={(e) => onReach(row, e.currentTarget)}
        onPointerLeave={() => onReach(null)}
        onFocus={(e) => onReach(row, e.currentTarget)}
        onBlur={() => onReach(null)}
        onClick={() => onOpen(row)}
      >
        <span className="mh-row-main">
          <span className="mh-row-title" title={o.customer}>{o.customer}</span>
          <span className="mh-row-sub">
            {late && o.promised_on ? <span className="mh-tone-warn">{fmtPromised(o.promised_on)} · </span> : null}
            הזמנה <span className="ltr">{o.number}</span>{agentName ? ` · ${agentName}` : ""}
          </span>
        </span>
        <span className="mh-ord-what">
          <ProductThumb product={lead} small />
          <span className="mh-row-main">
            <span className="mh-ord-name">
              <span className="mh-row-title" title={lead?.name}>{lead ? fmtName(lead.name) : "—"}</span>
              {lines.length > 1 ? <span className="mh-ord-more ltr">+{lines.length - 1}</span> : null}
            </span>
            <span className="mh-row-sub">
              {open ? (
                <>
                  {missing ? <span className="mh-tone-short">{gap}</span> : null}
                  {missing && racks.length > 0 ? " · " : ""}
                  {racks.length === 1 ? <span className="ltr">{racks[0]}</span> : racks.length > 1 ? `${fmtQty(racks.length)} מיקומים` : "ללא מיקום"}
                </>
              ) : (
                <Count n={lines.length} one="שורה" many="שורות" />
              )}
            </span>
          </span>
        </span>
        <span className={cx("mh-ord-worth ltr", total === null && "mh-tone-quiet")}>{fmtPrice(total)}</span>
        <span className="mh-ord-cover">
          {open ? <Cover row={row} className="mh-ord-word" /> : <span className={cx("mh-ord-word", `is-${o.status}`)}>{ORDER_STATUS_LABEL[o.status]}</span>}
          <span className="mh-row-sub">{open ? fmtAge(o.created_at) : fmtDay(o.closed_at ?? o.created_at)}</span>
        </span>
        {open ? null : <span className="mh-ord-promised">{o.promised_on ? fmtPlainDay(o.promised_on) : <span className="mh-tone-quiet">—</span>}</span>}
      </button>
    </li>
  );
});

/* ───────── the racks, named on the model ───────── */

interface RackTag {
  id: string;
  /** The rack holds a product that is short. */
  short?: boolean;
  /** How many of the listed orders draw on it. */
  orders?: number;
}

/** React owns each tag, the engine only moves it. */
function RackTags({ tags }: { tags: readonly RackTag[] }): ReactElement | null {
  const { engine, objects, world, setAnchors } = useTwin();
  const nodes = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!engine) return;
    const anchors: LabelAnchor[] = [];
    for (const { id } of tags) {
      const el = nodes.current.get(id);
      const object = objects.find((o) => o.id === id);
      if (el && object) anchors.push({ el, x: object.x, y: object.h, z: object.z });
    }
    setAnchors(anchors);
    return () => setAnchors([]);
  }, [engine, tags, objects, setAnchors]);

  if (!world || !engine || tags.length === 0) return null;
  return createPortal(
    <div className="mh-tags" aria-hidden="true">
      {tags.map((tag) => (
        <span
          key={tag.id}
          ref={(el) => {
            if (el) nodes.current.set(tag.id, el);
            else nodes.current.delete(tag.id);
          }}
          className={cx("mh-tag mh-ord-tag", tag.short && "is-short")}
        >
          <span className="mh-tag-body">
            <span className="mh-tag-code ltr">{tag.id}</span>
            {tag.short ? <span className="mh-tag-word">חסר</span> : null}
            {tag.orders ? <span><Count n={tag.orders} one="הזמנה" many="הזמנות" /></span> : null}
          </span>
        </span>
      ))}
    </div>,
    world,
  );
}

/* ───────── the page ───────── */

export function Orders(): ReactElement {
  return (
    <Suspense fallback={null}>
      <OrdersInner />
    </Suspense>
  );
}

function OrdersInner(): ReactElement {
  const { state, stats, agent, product, linesOf } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { spotObjects, setPageRoutes, aimProduct, itemsOf, objects, listen } = useTwin();

  // The active tab lives in the URL (?status=delivered|cancelled); what the shelf can't keep is a lens on the open ones.
  const status = toStatus(params.get("status"));
  const shortLens = status === "open" && params.get("filter") === SHORT;
  const setTab = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.delete("status");
      sp.delete("filter");
      if (next === SHORT) sp.set("filter", SHORT);
      else if (next !== "open") sp.set("status", toStatus(next));
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
  const [agentId, setAgentId] = useState("");

  const agentOptions = useMemo<SelectOption[]>(() => state.agents.map((a) => ({ value: a.id, label: a.name })), [state.agents]);

  /* ───────── orders ───────── */
  const baseOrders = useMemo(() => (agentId ? state.orders.filter((o) => o.agent_id === agentId) : state.orders), [state.orders, agentId]);

  const isShortOrder = useCallback((o: Order) => linesOf(o.id).some((l) => isShort(product(l.product_id))), [linesOf, product]);

  const counts = useMemo(() => {
    const byStatus: Record<Status, number> = { open: 0, delivered: 0, cancelled: 0 };
    for (const o of baseOrders) byStatus[o.status] += 1;
    return { ...byStatus, short: baseOrders.filter((o) => o.status === "open" && isShortOrder(o)).length };
  }, [baseOrders, isShortOrder]);

  const q = normalizeName(query);
  const orders = useMemo(() => {
    const digits = phoneDigits(q);
    const found = baseOrders.filter((o) => {
      if (o.status !== status) return false;
      if (shortLens && !isShortOrder(o)) return false;
      if (!q) return true;
      return normalizeName(o.customer).includes(q) || String(o.number).includes(q) || (digits !== "" && digitsOf(o.customer_phone ?? "").includes(digits));
    });
    // What still has to go out is read by the date promised to the customer, nearest first.
    return status === "open" ? found.sort(byPromise) : found;
  }, [baseOrders, status, shortLens, isShortOrder, q]);

  const tabTotal = useMemo(() => state.orders.filter((o) => o.status === status).length, [state.orders, status]);

  const selectedId = ui.panel?.type === "order" ? ui.panel.id : undefined;

  const rows = useMemo<OrderRow[]>(
    () =>
      orders.map((order) => {
        const lines = linesOf(order.id);
        const short = order.status === "open" ? lines.filter((l) => isShort(product(l.product_id))) : [];
        const racks = [...new Set(lines.flatMap((l) => itemsOf(l.product_id).map((item) => item.objectId)))];
        return { order, lines, lead: product((short[0] ?? lines[0])?.product_id), total: orderTotal(lines), short, racks, agentName: agent(order.agent_id)?.name };
      }),
    [orders, linesOf, product, agent, itemsOf],
  );

  // The page outlives midnight on a manager's screen, and "today" with it.
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    const clock = setInterval(() => setToday(todayKey()), 60_000);
    return () => clearInterval(clock);
  }, []);

  const open = status === "open";
  const groups = useMemo(() => (open ? groupByDay(rows, today) : []), [open, rows, today]);
  const slots = useMemo(() => (groups.length > 0 ? horizonOf(groups, today) : []), [groups, today]);

  const worth = useMemo(() => rows.reduce((sum, r) => sum + (r.total ?? 0), 0), [rows]);
  const unpriced = useMemo(() => rows.filter((r) => r.total === null).length, [rows]);

  /* ───────── an order reaches for the model ───────── */
  const door = useRef<HTMLDivElement>(null);
  const [pointed, setPointed] = useState<readonly string[] | null>(null);

  const reach = useCallback(
    (row: OrderRow | null, target?: HTMLElement) => {
      setPointed(row ? [row.order.id] : null);
      const aim = row ? (row.short[0] ?? row.lines[0]) : undefined;
      if (!aim || !target) {
        aimProduct(null);
        return;
      }
      const box = target.getBoundingClientRect();
      const edge = door.current?.getBoundingClientRect().left ?? box.left;
      aimProduct(aim.product_id, { x: edge, y: box.top + box.height / 2 });
    },
    [aimProduct],
  );

  // An open panel keeps its order on the model; a product opened from it gets the shelf to itself.
  const opened = selectedId && !ui.closing ? selectedId : null;
  const lit = useMemo(() => (pointed ? rows.filter((r) => pointed.includes(r.order.id)) : rows.filter((r) => r.order.id === opened)), [rows, pointed, opened]);
  const yielded = ui.panel?.type === "product";

  // What is short draws its line in the colour of the word, so the eye goes straight to that rack.
  const shortRacks = useMemo(() => new Set(lit.flatMap((r) => r.short.flatMap((l) => itemsOf(l.product_id).map((item) => item.objectId)))), [lit, itemsOf]);

  useEffect(() => {
    if (yielded) {
      setPageRoutes(null);
      return;
    }
    const racks = [...new Set(lit.flatMap((r) => r.racks))];
    if (racks.length === 0) {
      spotObjects(null);
      setPageRoutes(null);
      return;
    }
    if (lit.some((r) => r.order.status === "open")) {
      spotObjects([...racks, DISPATCH_ZONE], { objectId: DISPATCH_ZONE, level: null });
      setPageRoutes(racks.map((rack): MapRoute => ({ points: wayOut(objects, rack), tone: shortRacks.has(rack) ? "out" : "ink" })).filter((route) => route.points.length > 1));
    } else {
      spotObjects(racks);
      setPageRoutes(null);
    }
  }, [lit, yielded, shortRacks, objects, spotObjects, setPageRoutes]);

  const letGo = useEffectEvent(() => aimProduct(null));
  useEffect(
    () => () => {
      spotObjects(null);
      setPageRoutes(null);
      letGo();
    },
    [spotObjects, setPageRoutes],
  );

  // The other way round: a rack answers with the orders that draw on it. A click still goes to the rack.
  const [rack, setRack] = useState<string | null>(null);
  useEffect(() => listen({ onHover: (hit) => setRack(hit?.objectId ?? null) }), [listen]);

  const hot = useMemo<ReadonlySet<string> | null>(() => {
    if (pointed) return new Set(pointed);
    if (!rack) return null;
    const ids = rows.filter((r) => r.racks.includes(rack)).map((r) => r.order.id);
    return ids.length > 0 ? new Set(ids) : null;
  }, [pointed, rack, rows]);

  const tags = useMemo<RackTag[]>(() => {
    if (yielded) return [];
    if (lit.length === 1) return lit[0].racks.map((id) => ({ id, short: shortRacks.has(id) }));
    return rack && lit.length === 0 && hot ? [{ id: rack, orders: hot.size }] : [];
  }, [yielded, lit, shortRacks, rack, hot]);

  /* ───────── the carriage rides the horizon as the list scrolls ───────── */
  const [at, setAt] = useState<string | null>(null);
  const held = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (groups.length === 0) return;
    let frame = 0;
    const read = () => {
      if (performance.now() < held.current) return;
      const edge = stick.current?.getBoundingClientRect().bottom ?? 0;
      let current: string | null = null;
      for (const el of listRef.current?.querySelectorAll<HTMLElement>("[data-day]") ?? []) {
        current = el.dataset.day ?? null;
        if (el.getBoundingClientRect().bottom > edge + READ_MARGIN) break;
      }
      // At the foot of the page the last days can't reach the top, so the end of the scroll is the end of the horizon.
      const end = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setAt(end ? (groups[groups.length - 1]?.key ?? current) : current);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [groups]);

  const jump = useCallback((key: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`);
    if (!el) return;
    held.current = performance.now() + JUMP_MS;
    setAt(key);
    el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);

  const { openOrder } = ui;
  const openRow = useCallback((row: OrderRow) => openOrder(row.order.id), [openOrder]);

  /* ───────── header ───────── */
  const tab = (value: string, count: number, word: string, tone?: string) => ({
    value,
    label: (
      <>
        <span className={cx("mh-ord-tab-n ltr", tone)}>{fmtQty(count)}</span>
        {word}
      </>
    ),
  });
  const tabs = [
    ...TABS.map((t) => tab(t.value, counts[t.value], t.label)),
    ...(counts.short > 0 || shortLens ? [tab(SHORT, counts.short, "חסר", "mh-tone-short")] : []),
  ];

  const empty =
    state.orders.length === 0 ? (
      <EmptyState title="אין הזמנות" hint="הזמנה מאתר הקטלוג תופיע כאן" />
    ) : q ? (
      <EmptyState title="לא נמצאו הזמנות" hint={<>עבור „{query.trim()}”</>} />
    ) : (
      <EmptyState title={shortLens ? "כל ההזמנות מכוסות" : TABS.find((t) => t.value === status)?.empty} hint={agentId ? "אפשר להסיר את הסינון" : undefined} />
    );

  const item = (row: OrderRow) => (
    <OrderItem key={row.order.id} row={row} today={today} selected={row.order.id === selectedId} hot={Boolean(hot?.has(row.order.id))} onReach={reach} onOpen={openRow} />
  );

  return (
    <div ref={door} className={cx("mh-ord", !open && "is-closed")}>
      <PageHead
        title="הזמנות"
        sub={<Count n={stats.reservedProducts} one="מוצר משוריין" many="מוצרים משוריינים" />}
        actions={
          state.orders.length > 0 ? (
            <div className="mh-ord-sum">
              <span className="mh-label">
                שווי ההזמנות במחירון
                {unpriced > 0 ? ` · ${fmtQty(unpriced)} ללא מחיר` : null}
              </span>
              <Figure className="mh-ord-sum-n" sign="₪" text={fmtQty(Math.round(worth))} />
            </div>
          ) : undefined
        }
      />

      <Toolbar
        tabs={<Tabs tabs={tabs} value={shortLens ? SHORT : status} onChange={setTab} />}
        filters={<Select options={agentOptions} value={agentId} onChange={setAgentId} allLabel="כל הסוכנים" placeholder="סוכן" />}
        query={query}
        onQuery={setQuery}
        placeholder="חיפוש לפי לקוח או הזמנה"
      />

      {rows.length > 0 ? (
        <div ref={stick} className="mh-ord-stick">
          {slots.length > 0 ? (
            <Horizon slots={slots} today={today} at={at} hot={hot} onSlab={reach} onDay={setPointed} onOpen={openRow} onJump={jump} />
          ) : null}
          <div className="mh-ord-heads" aria-hidden="true">
            <span>לקוח</span>
            <span className="is-what">מוצרים</span>
            <span className="is-worth">סכום</span>
            <span>מצב</span>
            {open ? null : <span className="is-promised">מסירה</span>}
          </div>
        </div>
      ) : null}

      <RackTags tags={tags} />

      <div ref={listRef} className="mh-ord-list" role="tabpanel" aria-label={shortLens ? "חסר" : TABS.find((t) => t.value === status)?.label}>
        {groups.map((group) => (
          <section key={group.key} data-day={group.key} className="mh-ord-day" aria-labelledby={`mh-ord-day-${group.key}`}>
            <header className="mh-ord-dayhead">
              <div className="mh-ord-daytitle">
                <h2 id={`mh-ord-day-${group.key}`}>{dayTitle(group.key, today)}</h2>
                <span className="mh-row-sub"><Count n={group.rows.length} one="הזמנה" many="הזמנות" /></span>
              </div>
              <span className="mh-ord-daysum">
                <span className="ltr">{fmtPrice(group.worth)}</span> במחירון
                {group.unpriced > 0 ? ` · ${fmtQty(group.unpriced)} ללא מחיר` : null}
              </span>
            </header>
            <ul className="mh-rows">{group.rows.map(item)}</ul>
          </section>
        ))}
        {!open && rows.length > 0 ? <ul className="mh-rows">{rows.map(item)}</ul> : null}
        {rows.length === 0 ? empty : null}
        {rows.length > 0 && rows.length < tabTotal ? <p className="mh-ord-showing"><Showing shown={rows.length} total={tabTotal} /></p> : null}
      </div>
    </div>
  );
}
