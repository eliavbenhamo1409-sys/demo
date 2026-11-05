"use client";

/**
 * מחסן: the model is the page. The one engine under the whole admin shows through a frame that fills the workspace, its
 * controls stand in the frame's corner, and the side holds one object in two representations: the floor as a ledger of
 * places while nothing is chosen, and one place with its levels once it is. The same orchestration as מרחב's page
 * (src/components/merhav/pages/Warehouse.tsx) on the same Twin, spoken in ATLAS's language; whatever this page turns on
 * it turns off again on the way out.
 */

import { Fragment, Suspense, useCallback, useDeferredValue, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { labelViews } from "@/components/map3d/label-views";
import { Labels, type LabelView } from "@/components/map3d/Labels";
import { EditBar, LayoutPanel, useLayoutEditor } from "@/components/map3d/LayoutEditor";
import { MapSearch } from "@/components/map3d/MapSearch";
import { minimumShare, percentText } from "@/components/map3d/measure";
import { PlaceConfirm, TodayOnly, type PlaceChange } from "@/components/map3d/parts";
import { TimeRuler } from "@/components/map3d/TimeRuler";
import { useCoarsePointer, useFullscreen, useNarrow } from "@/components/map3d/use-device";
import { useMovementHistory, type MovementHistory } from "@/components/map3d/use-history";
import { ViewSwitch } from "@/components/map3d/ViewSwitch";
import { countedAgo, coverText, STATE_NUM } from "@/components/map3d/words";
import { worthOf } from "@/components/map3d/worth";
import "@/components/map3d/map3d.css";
import { useTwin } from "@/components/merhav/twin/Twin";
import { objectAim, pointOf, productAim, type Aim } from "@/components/merhav/warehouse/lens";
import { Button, cx, Fields, Icon, Notice, Select, Tabs, type SelectOption } from "@/components/ui";
import { fmtCompact, fmtDateTime, fmtName, fmtQty, fmtRelative, fmtSigned, fmtUnit, isToday, MOVEMENT_LABEL } from "@/lib/format";
import { DISPATCH_ZONE, levelY, RECEIVING_ZONE } from "@/lib/map3d/layout";
import { countOf, coverOf, lastOutOf, type CountInfo } from "@/lib/map3d/metrics";
import { blockAt, buildMapModel, emptySpot, shelfLines, type MapModel, type ObjectStock, type ShelfBlock } from "@/lib/map3d/model";
import { formatPlace, placeKey, placeWords, resolvePlace, SIDE_WORD } from "@/lib/map3d/place";
import { routeBetween } from "@/lib/map3d/route";
import { useShelves } from "@/lib/map3d/shelves";
import { buildTrail, qtyAt, TRAIL_WINDOW, type PastQty, type Trail } from "@/lib/map3d/trail";
import type { LabelAnchor, MapEngine, MapObject, MapObjectKind, MapRoute, PickHit, ScenePoint, ShelfSide, StockState, ViewMode } from "@/lib/map3d/types";
import { available, isTempId, stockState, useData, type Fault, type Movement, type Order, type Product } from "@/lib/store";
import { ModelFrame } from "../Frame";
import { HomeButton } from "../HomeButton";
import { StateWord, Summary, type SumItem } from "../parts";
import { Side } from "../side";

/* ───────── words ───────── */

/** What the side lists while nothing is chosen: the places, and the three other lenses of the shared page. */
type SideTab = "places" | "orders" | "moves" | "count";
type PlaceSort = "need" | "code" | "worth";

const TAB_WORD: Record<SideTab, string> = { places: "מיקומים", orders: "הזמנות", moves: "תנועות", count: "ספירה" };
const TABS = (Object.keys(TAB_WORD) as SideTab[]).map((value) => ({ value, label: TAB_WORD[value] }));

/** What stands under the code of a chosen place. A machine and a zone say their own name instead. */
const KIND_WORD: Record<MapObjectKind, string> = { rack: "מיקום במחסן", floor: "אחסון רצפה", machine: "מכונה", zone: "אזור" };
const GROUP_WORD: Record<MapObjectKind, string> = { rack: "מתקנים ואחסון", floor: "מתקנים ואחסון", machine: "מכונות", zone: "אזורים" };

const LEAVE_WORD: Record<MapObjectKind, string> = {
  rack: "יציאה מהמתקן",
  floor: "יציאה מהאזור",
  machine: "יציאה מהמכונה",
  zone: "יציאה מהאזור",
};

/** What a place needs, worst first: stock an order is short of, then a fault, an empty shelf, a low one. */
type Need = StockState | "fault";
const NEED_RANK: Record<Need, number> = { short: 0, fault: 1, out: 2, low: 3, ok: 4 };

const CLOCK_MS = 60_000;
const MARK_MARGIN = 0.45;
/** An unknown quantity draws as an empty shelf, so this one word stays on the model at any date. */
const PAST_UNKNOWN = "לא ידוע";
const FAULT_WORD = "תקלה";
/** A movement's way across the floor is drawn for a row you stop on, not for each row the pointer crosses. */
const TRACE_DWELL_MS = 140;
const MOVES_FEED = 20;

/** The rows the arrow keys walk through, on the side. */
const ROWS = "[data-row]:not(:disabled)";

/** The walk's letters. The arrows are no search. */
const WALK_LETTERS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

/* ───────── the tags, as מרחב's page shapes them (kept here, since its helpers are its own) ───────── */

/** What is worst first, then what stands lowest. */
const pressing = (view: LabelView) => (view.textClass === STATE_NUM.short ? -2 : view.textClass === STATE_NUM.out ? -1 : Number.parseInt(view.text ?? "", 10));

/**
 * From afar a rack speaks once: its name and the one word that matters most, on one tag. A figure on every shelf covered
 * the names around it, and a figure with no name says nothing. A shelf that is pointed at still speaks for itself.
 */
function oneTagEach(views: readonly LabelView[], faults: ReadonlySet<string>): LabelView[] {
  const speaks = (view: LabelView) => view.onShelf && view.attention && !view.name;
  const worst = new Map<string, LabelView>();
  for (const view of views) {
    const rack = speaks(view) ? view.hit?.objectId : undefined;
    if (!rack) continue;
    const held = worst.get(rack);
    if (!held || pressing(view) < pressing(held)) worst.set(rack, view);
  }
  return views.filter((view) => !speaks(view)).map((view) => {
    const fault = faults.has(view.id) && !view.word;
    const held = worst.get(view.id);
    // One word: a fault speaks over a low shelf, and only what the orders are short of speaks over a fault.
    const shelf = fault && held?.textClass !== STATE_NUM.short ? undefined : held;
    if (!shelf && !fault) return view;
    return { ...view, quiet: false, attention: true, more: fault ? undefined : view.more, text: shelf?.text ?? view.text, textClass: shelf?.textClass ?? view.textClass, word: fault && !shelf ? FAULT_WORD : view.word, wordClass: fault && !shelf ? STATE_NUM.out : view.wordClass };
  });
}

/** How much of a shelf's height one tag takes close up. */
const TAG_STEP = 0.2;

/** Close up, three or more products on one shelf stand in lanes too thin for a tag each, so their tags step up from the stock, one over the other. */
function stackedTags(views: readonly LabelView[], rack: MapObject): LabelView[] {
  const shelves = new Map<string, LabelView[]>();
  for (const view of views) {
    if (!view.onShelf || !view.at || !view.hit) continue;
    const key = `${view.hit.level}/${view.hit.side ?? ""}`;
    shelves.set(key, [...(shelves.get(key) ?? []), view]);
  }
  const step = (levelY(rack, 1) - levelY(rack, 0)) * TAG_STEP;
  const moved = new Map<string, LabelView>();
  for (const row of shelves.values()) {
    if (row.length < 3) continue;
    row.forEach((view, i) => {
      if (!view.at) return;
      const lift = <T extends ScenePoint>(point: T): T => ({ ...point, y: point.y + i * step });
      moved.set(view.id, { ...view, at: { ...lift(view.at), faces: view.at.faces?.map(lift) } });
    });
  }
  return views.map((view) => moved.get(view.id) ?? view);
}

/* ───────── small readings ───────── */

const fieldHolds = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

/** The object a link names: its code, or a place as products.location writes it. */
function linkedHit(text: string, objects: readonly MapObject[]): PickHit | null {
  const key = placeKey(text);
  const object = objects.find((o) => placeKey(o.id) === key);
  return object ? { objectId: object.id, level: null } : resolvePlace(text, objects);
}

/** The latest movement that really took stock on or off a shelf: where the forklift stands. */
function lastLoad(rows: readonly Movement[], objects: readonly MapObject[], placeOf: (productId: string) => string | null): string | null {
  for (const m of rows) {
    if (isTempId(m.id) || (m.type !== "in" && m.type !== "out")) continue;
    const place = resolvePlace(m.place, objects)?.objectId ?? placeOf(m.product_id);
    if (place) return place;
  }
  return null;
}

function pastText(qty: PastQty | null | undefined): string {
  if (qty?.kind === "known") return fmtQty(qty.qty);
  return qty?.kind === "absent" ? "טרם במלאי" : PAST_UNKNOWN;
}

/** The worst thing about a place: a fault weighs between an empty shelf and one the orders are short of, as the tags say it. */
function needOf(stock: ObjectStock | undefined, fault: boolean): Need {
  const worst = stock?.worst ?? "ok";
  if (worst === "short") return "short";
  return fault ? "fault" : worst;
}

/** "4", or "2–3" for a block of shelves. The side (ימין, שמאל) is said beside it in Hebrew. */
function levelText(level: number | null, through: number | null = level): string {
  if (level === null) return "—";
  return through !== null && through !== level ? `${level + 1}–${through + 1}` : `${level + 1}`;
}

const hitOf = (block: ShelfBlock): PickHit => ({ objectId: block.objectId, level: block.level, side: block.side, through: block.through ?? undefined });

/** Does a row of the levels list cover the shelf the pointer is on? */
function covers(row: PickHit, shelf: PickHit): boolean {
  if (row.level === null || shelf.level === null) return false;
  const inside = shelf.level >= row.level && shelf.level <= (row.through ?? row.level);
  return inside && (!row.side || !shelf.side || row.side === shelf.side);
}

/** A name that only repeats the code says nothing under it. */
function nameOf(object: MapObject): string | null {
  return object.name === `מתקן ${object.id}` || object.name === `אחסון רצפה ${object.id}` ? null : object.name;
}

interface Peek extends Aim {
  /** The row that points. Null: the search or a figure, which point from nowhere in particular. */
  row: Element | null;
}

type RowPoint = Pick<HTMLAttributes<HTMLElement>, "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur">;

/* ───────── the line from a row on the side to its place on the model ───────── */

const BEND = 28;
/** The air the line leaves between its end and the edge of a tag. */
const AIR = 3;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const inside = (x: number, y: number, box: Box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/** Where the segment from a to b first enters the box, or a itself when it starts inside. */
function entry(ax: number, ay: number, bx: number, by: number, box: Box): [number, number] {
  const [dx, dy] = [bx - ax, by - ay];
  let first = Number.POSITIVE_INFINITY;
  const cross = (t: number, x: number, y: number) => {
    if (t >= 0 && t <= 1 && t < first && inside(x, y, box)) first = t;
  };
  if (dx !== 0) {
    for (const edge of [box.left, box.right]) {
      const t = (edge - ax) / dx;
      cross(t, edge, ay + t * dy);
    }
  }
  if (dy !== 0) {
    for (const edge of [box.top, box.bottom]) {
      const t = (edge - ay) / dy;
      cross(t, ax + t * dx, edge);
    }
  }
  return Number.isFinite(first) ? [ax + first * dx, ay + first * dy] : [ax, ay];
}

interface SideLineProps {
  world: HTMLElement;
  /** The side's content; the zone it scrolls in is the plate the line leaves. */
  rail: RefObject<HTMLElement | null>;
  /** The row it leaves from, found at each draw: rows scroll, and a row that scrolls away takes the line with it. */
  row: () => Element | null;
  /** The node the engine keeps on the point; its transform is the one signal that the picture moved. */
  anchor: HTMLElement;
  /** The tag that stands on the point, when one does: the line stops at its edge instead of running under it. */
  card?: () => Element | null;
}

/**
 * מרחב's Reach, turned round: here the side stands on the left of the model, so the line leaves the plate's right edge,
 * runs out straight, and takes one clean diagonal to the shelf. Drawn in the world, in the shell's own leader style.
 */
function SideLine({ world, rail, row, anchor, card }: SideLineProps): ReactElement {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const list = rail.current;
    const plate = list?.closest<HTMLElement>(".at-side") ?? list;
    const draw = () => {
      const line = path.current;
      const ring = dot.current;
      if (!line || !ring || !plate) return;
      const stage = world.getBoundingClientRect();
      const edge = plate.getBoundingClientRect();
      const end = anchor.getBoundingClientRect();
      const from = row()?.getBoundingClientRect();
      const x = end.left - stage.left;
      const y = end.top - stage.top;
      const startX = edge.right - stage.left;
      const startY = from ? from.top + from.height / 2 - stage.top : -1;
      // Nothing to leave from on a full screen, where the side isn't shown.
      const off = document.fullscreenElement !== null || x < -100 || y < -100 || x <= startX || startY < edge.top - stage.top || startY > edge.bottom - stage.top;
      line.style.opacity = off ? "0" : "";
      if (off) {
        ring.style.opacity = "0";
        return;
      }
      const bend = Math.max(Math.min(startX + BEND, x - Math.abs(y - startY)), startX);
      const face = card?.()?.getBoundingClientRect();
      const box: Box | null = face && face.width > 0 ? { left: face.left - stage.left - AIR, right: face.right - stage.left + AIR, top: face.top - stage.top - AIR, bottom: face.bottom - stage.top + AIR } : null;
      const onCard = box !== null && inside(x, y, box);
      const [endX, endY] = onCard && box ? entry(bend, startY, x, y, box) : [x, y];
      line.setAttribute("d", `M${startX} ${startY} L${bend} ${startY} L${endX} ${endY}`);
      ring.style.opacity = onCard ? "0" : "";
      ring.setAttribute("cx", String(x));
      ring.setAttribute("cy", String(y));
    };
    draw();
    const watcher = new MutationObserver(draw);
    watcher.observe(anchor, { attributes: true, attributeFilter: ["style"] });
    plate?.addEventListener("scroll", draw, { passive: true });
    return () => {
      watcher.disconnect();
      plate?.removeEventListener("scroll", draw);
    };
  }, [world, rail, row, anchor, card]);

  return (
    <svg className="mh-leader" aria-hidden="true">
      <path ref={path} pathLength={1} />
      <circle ref={dot} r={4} />
    </svg>
  );
}

/* ───────── the way back to the whole floor ───────── */


/* ───────── the page ───────── */

export function Warehouse(): ReactElement {
  return (
    <Suspense fallback={null}>
      <WarehouseInner />
    </Suspense>
  );
}

function WarehouseInner(): ReactElement {
  const { state, linesOf } = useData();
  const ui = useUi();
  const { engine, failed, layout, model, flashes, world, placeOf, itemsOf, listen, setPageRoutes, setPastSlots, setAnchors, aimProduct, holdCamera, home } = useTwin();
  const editor = useLayoutEditor(layout);
  const { rows: shelfRows } = useShelves();
  const params = useSearchParams();
  const narrow = useNarrow();
  const coarse = useCoarsePointer();

  const editing = editor.draft !== null;
  const objects = editor.draft ?? layout.objects;

  const sideRef = useRef<HTMLDivElement>(null);
  const stage = useMemo(() => ({ current: world }), [world]);
  const fullscreen = useFullscreen(stage);

  const [selected, setSelected] = useState<PickHit | null>(null);
  const [chosenView, setChosenView] = useState<ViewMode | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [hover, setHover] = useState<PickHit | null>(null);
  const [linkSeen, setLinkSeen] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [tab, setTab] = useState<SideTab>("places");
  const [sort, setSort] = useState<PlaceSort>("need");
  const [orderId, setOrderId] = useState<string | null>(null);

  const viewMode = chosenView ?? (narrow ? "top" : "orbit");

  // A product opened here: the drawer stands over the side, and its shelf answers on the model.
  const drawerProduct = ui.panel?.type === "product" && !ui.closing ? ui.panel.id : null;
  const drawerAim = useMemo(() => (drawerProduct ? productAim(drawerProduct, itemsOf, model) : null), [drawerProduct, itemsOf, model]);
  const pointed = peek ?? drawerAim;

  /* ───────── the ledger, as the map reads it ───────── */
  const worth = useMemo(() => worthOf(model), [model]);

  /* ───────── history: never reaches the live view ───────── */
  const [trailStart] = useState(() => Date.now() - TRAIL_WINDOW);
  const [clock, setClock] = useState(() => Date.now());
  const recent = useMovementHistory(trailStart, true);
  const ledger = useMovementHistory(null, tab === "count" || selected !== null);

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  const newest = recent.rows[0]?.created_at;
  const now = Math.max(clock, newest ? Date.parse(newest) : 0);
  const trail = useMemo(() => (recent.ready ? buildTrail(state.products, recent.rows, now) : null), [recent.ready, recent.rows, state.products, now]);

  // A row can land in the middle of a read; one fresh read settles it, and what stays broken hides its own history.
  const broken = trail?.broken.join() ?? "";
  const { retry: rereadRecent } = recent;
  useEffect(() => {
    if (broken) rereadRecent();
  }, [broken, rereadRecent]);

  const shownAt = useDeferredValue(at);
  const past = useMemo(() => {
    if (shownAt === null || !trail) return null;
    const stock = new Map<string, PastQty>();
    const products = state.products.map((p) => {
      const qty = qtyAt(trail, p.id, shownAt);
      stock.set(p.id, qty);
      return { ...p, qty: qty.kind === "known" ? qty.qty : 0 };
    });
    return { stock, slots: buildMapModel(products, objects, shelfRows, { dated: true }).slots };
  }, [shownAt, trail, state.products, objects, shelfRows]);

  // Twin keeps the drawn stock on the ledger; a date on screen is the one thing that overrides it.
  const pastSlots = past?.slots ?? null;
  useEffect(() => {
    setPastSlots(pastSlots);
  }, [pastSlots, setPastSlots]);

  // How many products stood in each place at the date shown: the dated model's piles, by place.
  const datedCounts = useMemo(() => {
    if (!past) return null;
    const counts = new Map<string, Set<string>>();
    for (const slot of past.slots) {
      let set = counts.get(slot.objectId);
      if (!set) {
        set = new Set();
        counts.set(slot.objectId, set);
      }
      set.add(slot.key.slice(0, slot.key.indexOf("@")));
    }
    return counts;
  }, [past]);

  /* ───────── selection ───────── */
  const selectedObject = (selected && objects.find((o) => o.id === selected.objectId)) || null;
  const targetId = selectedObject?.id ?? null;

  const link = params.get("at");
  const linked = useMemo(() => (link ? linkedHit(link, objects) : null), [link, objects]);
  if (link !== linkSeen && (linked || !link)) {
    setLinkSeen(link);
    if (linked && linked.objectId !== targetId) setSelected(linked);
  }

  const select = useCallback((objectId: string, shelf?: PickHit) => setSelected(shelf ?? { objectId, level: null }), []);

  /** Goes to the shelf that holds most of a product. */
  const selectProduct = useCallback(
    (productId: string) => {
      const item = itemsOf(productId)[0];
      if (item) select(item.objectId, { objectId: item.objectId, level: item.level, side: item.side });
    },
    [itemsOf, select],
  );

  // The address follows the selection, so a link to the same place works twice.
  useEffect(() => {
    if (link !== linkSeen) return;
    const next = targetId ? `/3d?at=${encodeURIComponent(targetId)}` : "/3d";
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [targetId, link, linkSeen]);

  const pickHit = (hit: PickHit | null) => {
    if (editing) editor.setEditId(hit?.objectId ?? null);
    else setSelected(hit);
  };

  const onModelPick = useEffectEvent(pickHit);
  const onModelDrag = useEffectEvent((id: string, x: number, z: number) => {
    editor.patch(id, { x, z });
  });

  // The model's clicks belong to this page while it stands.
  useEffect(
    () =>
      listen({
        onPick: (hit) => onModelPick(hit),
        onHover: setHover,
        onDragObject: (id, x, z) => onModelDrag(id, x, z),
      }),
    [listen],
  );

  /* ───────── what the engine draws ───────── */
  const faultObjects = useMemo(() => {
    const ids = new Set<string>();
    for (const f of state.faults) {
      if (f.status !== "open") continue;
      const place = f.asset ?? (f.product_id ? placeOf(f.product_id) : null);
      if (place) ids.add(place);
    }
    return ids;
  }, [state.faults, placeOf]);

  const openOrders = useMemo(() => state.orders.filter((o) => o.status === "open" && linesOf(o.id).length > 0).reverse(), [state.orders, linesOf]);

  // An order opened on the side: the shelves it takes from, and dispatch.
  const orderPlaces = useMemo(() => {
    if (tab !== "orders" || !orderId || selectedObject || at !== null) return null;
    const ids = new Set<string>();
    for (const line of linesOf(orderId)) {
      const place = placeOf(line.product_id);
      if (place) ids.add(place);
    }
    return ids.size > 0 ? ids : null;
  }, [tab, orderId, selectedObject, at, linesOf, placeOf]);

  // The ledger of places sorted by ₪: the floor shows where the money stands, and the tags read ₪.
  const valueLens = tab === "places" && sort === "worth" && at === null && !selectedObject && !editing;

  const emphasis = useMemo(() => {
    if (editing) return null;
    if (pointed) return new Set(pointed.ids);
    if (targetId) return new Set([targetId]);
    if (orderPlaces) return new Set([...orderPlaces, DISPATCH_ZONE]);
    return valueLens ? new Set(worth.places.map((p) => p.object.id)) : null;
  }, [editing, pointed, targetId, orderPlaces, valueLens, worth.places]);

  // What the rule on the map follows: a whole block of a product, however it was reached. A row under the pointer borrows it.
  const shown = pointed ? pointed.hit : selected;
  const shownObject = (shown && objects.find((o) => o.id === shown.objectId)) || null;
  const selectedBlock = useMemo(() => pointed?.block ?? (shown ? blockAt(model, shown) : null), [pointed, shown, model]);
  const selection = useMemo<PickHit | null>(() => {
    if (editing) return editor.editId ? { objectId: editor.editId, level: null } : null;
    if (!selectedBlock) return shown && shownObject ? emptySpot(shown, shownObject, model) : shown;
    const { objectId, level, side, through } = selectedBlock;
    return { objectId, level, side, through: through ?? undefined };
  }, [editing, editor.editId, shown, shownObject, selectedBlock, model]);

  useEffect(() => {
    engine?.setLayout(objects);
  }, [engine, objects]);

  const footprints = useMemo(() => {
    if (!valueLens) return null;
    const top = worth.places[0]?.value ?? 1;
    return worth.places.map((p) => ({ objectId: p.object.id, strength: p.value / top }));
  }, [valueLens, worth.places]);

  useEffect(() => {
    engine?.setFootprints(footprints);
  }, [engine, footprints]);

  // Twin keeps the forklift on the latest load. A date on screen drives it here, and today hands it back.
  const liveLoad = useMemo(() => lastLoad(state.movements, objects, placeOf), [state.movements, objects, placeOf]);
  const pastLoad = useMemo(
    () => (at === null ? null : lastLoad(recent.rows.filter((m) => Date.parse(m.created_at) <= at), objects, placeOf)),
    [at, recent.rows, objects, placeOf],
  );
  const dated = useRef(false);
  useEffect(() => {
    if (!engine || (at === null && !dated.current)) return;
    dated.current = at !== null;
    engine.setForklift(at === null ? liveLoad : pastLoad, { animate: false });
  }, [engine, at, liveLoad, pastLoad]);

  const walking = viewMode === "walk" && !editing;
  const plan = editing || viewMode === "top";

  useEffect(() => {
    engine?.setEditing(editing);
    if (!editing) engine?.setView(viewMode);
  }, [engine, editing, viewMode]);

  // Set on the way out: a flight or a word still in the queue must not land on the next page.
  const left = useRef(false);

  const speak = useEffectEvent(() => {
    if (left.current) return;
    engine?.setSelection(selection);
    engine?.setEmphasis(emphasis);
  });

  // After this commit's effects, so it has the last word.
  useEffect(() => {
    queueMicrotask(() => speak());
  }, [engine, selection, emphasis]);

  // This page talks to the engine itself, so the search can't hand any of it back: what is open here is said again as the plate goes.
  useEffect(() => {
    const watcher = new MutationObserver(() => {
      if (!document.querySelector(".mh-command")) window.setTimeout(() => speak());
    });
    watcher.observe(document.body, { childList: true });
    return () => watcher.disconnect();
  }, []);

  // A list that ended under the pointer may leave its line behind.
  useEffect(() => aimProduct(null), [aimProduct]);

  // One line on the floor at the front of what needs a hand, so the map answers "where" before anything is read.
  // Never a box around it: a red border is the alarm this product does not sound.
  const marks = useMemo<MapRoute[]>(() => {
    if (at !== null || editing || targetId) return [];
    const lines: MapRoute[] = [];
    for (const { object: o, worst } of model.byObject.values()) {
      if (worst === "ok") continue;
      const [l, r] = [o.x - o.w / 2 - MARK_MARGIN, o.x + o.w / 2 + MARK_MARGIN];
      const front = o.z + o.d / 2 + MARK_MARGIN;
      lines.push({ points: [[l, front], [r, front]], tone: worst === "low" ? "warn" : "out" });
    }
    return lines;
  }, [at, editing, targetId, model]);

  // An open order lays its picks on the floor, from each shelf to dispatch.
  const orderRoutes = useMemo<MapRoute[]>(
    () => [...(orderPlaces ?? [])].map((id): MapRoute => ({ points: routeBetween(objects, id, DISPATCH_ZONE), tone: "ink" })).filter((route) => route.points.length > 1),
    [orderPlaces, objects],
  );

  // Null would hand the floor back to Twin's own marks, which don't know this page's date.
  useEffect(() => {
    setPageRoutes([...orderRoutes, ...marks]);
  }, [orderRoutes, marks, setPageRoutes]);

  /* ───────── the camera ───────── */
  // Twin fits the model into the frame and keeps the camera where it is held through every change of the frame's size,
  // so a flight here is a hold: the drawer's shelf first, then the chosen place, else the whole floor.
  const drawerPlace = drawerAim?.hit?.objectId ?? null;
  const drawerShelf = viewMode === "walk" || narrow ? null : drawerPlace;
  const flight = drawerShelf ? { objectId: drawerShelf, shelf: true } : selectedObject ? { objectId: selectedObject.id, shelf: selectedObject.kind === "rack" && viewMode !== "top" } : null;
  const flightKey = flight ? `${flight.objectId}/${flight.shelf}` : "";

  const fly = useEffectEvent(() => {
    if (left.current || viewMode === "walk") return;
    holdCamera(flight);
  });

  // After Twin's own fit of this commit, so the hold has the last word.
  useEffect(() => {
    if (!engine) return;
    queueMicrotask(() => fly());
  }, [engine, flightKey, viewMode]);

  // A moved rack is work, and the side stands right beside it: the way out asks the same question as ביטול.
  const askToLeave = useEffectEvent(() => editor.leave());
  useEffect(() => {
    if (!editor.dirty) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".at-spine a, .at-areabar a")) return;
      e.preventDefault();
      e.stopPropagation();
      askToLeave();
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [editor.dirty]);

  /* ───────── keys ───────── */
  // The row that opened a place is gone with the list, so the keyboard carries on from the side, and closing the place
  // lands back on that row. Never on arrival: Tab starts a new page at its top, not halfway down the list.
  const cardWas = useRef(targetId);
  useEffect(() => {
    const was = cardWas.current;
    cardWas.current = targetId;
    const side = sideRef.current;
    const lost = document.activeElement === document.body || document.activeElement === side;
    if (was === targetId || !side || !lost) return;
    const back = was && targetId === null ? side.querySelector<HTMLElement>(`[data-row][data-id="${CSS.escape(was)}"]`) : null;
    if (back) back.focus();
    else side.focus({ preventScroll: true });
  }, [targetId]);

  const onEscape = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || ui.panel) return;
    if (fieldHolds(e.target)) return;
    if (editing) editor.setEditId(null);
    else if (selected) setSelected(null);
    else if (orderId) setOrderId(null);
    else if (viewMode === "walk") setChosenView("orbit");
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onEscape(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // On the walk the letters walk too: past the search that opens on typing, straight to the rig on the window.
  useEffect(() => {
    if (viewMode !== "walk") return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted || !WALK_LETTERS.has(e.code) || fieldHolds(e.target)) return;
      e.stopPropagation();
      window.dispatchEvent(new KeyboardEvent("keydown", { code: e.code, key: e.key }));
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [viewMode]);

  // Arrows walk the side's rows, and each step lights its place.
  const onSideKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || viewMode === "walk" || fieldHolds(e.target)) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(ROWS)];
    const on = rows.findIndex((row) => row === e.target);
    if (on < 0 && e.target !== e.currentTarget) return;
    e.preventDefault();
    rows[e.key === "ArrowDown" ? on + 1 : Math.max(on - 1, 0)]?.focus();
  };

  /* ───────── labels ───────── */
  const closeView = selectedObject?.kind === "rack" && viewMode !== "top" && viewMode !== "walk" ? selectedObject : null;
  const labels = useMemo(() => {
    const views = labelViews({ objects, model, past: past?.stock ?? null, money: valueLens, faults: faultObjects, open: closeView, shelf: hover ?? pointed?.hit ?? null });
    if (valueLens) return views;
    if (!past) return closeView ? stackedTags(views, closeView) : oneTagEach(views, faultObjects);
    // Thirty figures on stems would hide what they stand on. They wait for a pointer, and the side lists them all.
    const calm = (view: LabelView): LabelView => {
      if (!view.text) return view;
      return view.text === PAST_UNKNOWN ? { ...view, quiet: true } : { ...view, quiet: true, more: view.text, text: undefined };
    };
    return views.map(calm);
  }, [objects, model, past, valueLens, faultObjects, closeView, hover, pointed]);

  // Labels writes the engine's anchors itself. Through this they go by Twin, beside the point the line ends at.
  const [tagAnchors, setTagAnchors] = useState<readonly LabelAnchor[]>([]);
  const tagged = useMemo<MapEngine | null>(() => engine && { ...engine, setLabels: setTagAnchors }, [engine]);

  /* ───────── the lens: a row points at the model, and the model points back ───────── */
  const [reachEl, setReachEl] = useState<HTMLElement | null>(null);
  const reached = peek ? peek.hit : closeView && selectedBlock ? selection : null;
  const point = useMemo(() => (reached ? pointOf(reached, objects, model) : null), [reached, objects, model]);
  // The tag that stands on that stock, so the line stops at its edge.
  const reachedKey = useMemo(() => (reached ? ((peek?.block ?? blockAt(model, reached))?.key ?? null) : null), [reached, peek, model]);
  const cardOf = useCallback(() => (reachedKey && world ? world.querySelector(`.m3d-label[data-key="${CSS.escape(reachedKey)}"] .m3d-tag`) : null), [reachedKey, world]);
  const peekedRow = peek ? peek.row : undefined;
  const rowOf = useCallback(() => (peekedRow === undefined ? (sideRef.current?.querySelector('[data-row][aria-current="true"]') ?? null) : peekedRow), [peekedRow]);
  useEffect(() => {
    setAnchors(point && reachEl ? [...tagAnchors, { el: reachEl, ...point }] : tagAnchors);
  }, [tagAnchors, point, reachEl, setAnchors]);

  const overRow = useRef<Element | null>(null);
  const peekRow = (aim: Aim | null, row: Element | null) => {
    overRow.current = row;
    setPeek(aim ? { ...aim, row } : null);
  };

  // Each row says what it points at. The aim is read when the pointer arrives: a route across the floor is work.
  const pointAt = (aimOf: () => Aim | null): RowPoint => ({
    onPointerEnter: (e) => {
      if (e.pointerType === "mouse" && e.currentTarget !== overRow.current) peekRow(aimOf(), e.currentTarget);
    },
    onPointerLeave: () => peekRow(null, null),
    onFocus: (e) => {
      if (e.currentTarget.matches(":focus-visible")) peekRow(aimOf(), e.currentTarget);
    },
    onBlur: () => peekRow(null, null),
  });

  // The search walks the model too: the result you stand on lights its shelf before it is picked.
  const peekResult = (e: SyntheticEvent<HTMLElement>) => {
    const item = e.target instanceof Element && e.type === "pointerover" ? e.target.closest(".sa-menu-item") : e.currentTarget.querySelector('.m3d-results [aria-selected="true"]');
    if (!item && e.type === "pointerover") return;
    const code = item?.querySelector(".app-resultSub bdi")?.textContent;
    const found = code ? state.products.find((p) => p.sku === code) : undefined;
    const aim = found ? productAim(found.id, itemsOf, model) : null;
    setPeek(aim ? { ...aim, row: null } : null);
  };

  const route = peek?.route;
  useEffect(() => {
    if (!engine || !route) return;
    const timer = setTimeout(() => engine.trace(route), TRACE_DWELL_MS);
    return () => clearTimeout(timer);
  }, [engine, route]);

  // The other way round: what the pointer is on in the model stands out on the side.
  const lit = useMemo(() => {
    const keys = new Set<string>();
    if (!hover) return keys;
    if (!selectedObject) {
      keys.add(hover.objectId);
      return keys;
    }
    if (hover.objectId !== selectedObject.id) return keys;
    const blocks = model.byObject.get(selectedObject.id)?.blocks ?? [];
    for (const block of blocks) if (covers(hitOf(block), hover)) keys.add(block.key);
    for (const line of shelfLines(selectedObject, blocks)) {
      if (line.blocks.length === 0 && covers({ objectId: selectedObject.id, level: line.level, side: line.side }, hover)) keys.add(`${selectedObject.id}@empty/${line.level}/${line.side ?? ""}`);
    }
    return keys;
  }, [hover, selectedObject, model]);

  useEffect(() => {
    if (!selectedObject || lit.size === 0) return;
    sideRef.current?.querySelector("[data-lit]")?.scrollIntoView({ block: "nearest" });
  }, [lit, selectedObject]);

  /* ───────── the way out: the next page finds the model as it was ───────── */
  const restore = useEffectEvent((on: MapEngine) => {
    left.current = true;
    // History can leave from a full screen, and the world alone would stay up over a page it isn't on.
    if (document.fullscreenElement) void document.exitFullscreen();
    on.setEditing(false);
    on.setLayout(layout.objects);
    on.setSelection(null);
    on.setEmphasis(null);
    on.setFootprints(null);
    on.setForklift(liveLoad);
    on.setView("orbit");
    setPageRoutes(null);
    setPastSlots(null);
    setAnchors([]);
    holdCamera(null);
    home();
  });

  useEffect(() => {
    if (!engine) return;
    left.current = false;
    return () => restore(engine);
  }, [engine]);

  /* ───────── the side ───────── */
  // A new list starts at its head, before a place scrolls to the shelf it was opened on.
  useLayoutEffect(() => {
    sideRef.current?.closest(".at-side")?.scrollTo({ top: 0 });
  }, [targetId, tab]);

  const onSearchPick = (p: Product) => {
    if (placeOf(p.id)) selectProduct(p.id);
    else ui.openProduct(p.id);
  };

  const startEditing = () => {
    setAt(null);
    setSelected(null);
    editor.start();
  };

  // One button out of any close view, on the model itself, named for what it leaves.
  const leaveWord = selectedObject ? LEAVE_WORD[selectedObject.kind] : viewMode === "walk" ? "יציאה מהסיור" : null;
  const leave = () => {
    if (selectedObject) setSelected(null);
    else setChosenView("orbit");
  };

  const back = () => {
    setSelected(null);
    home();
  };

  const onTab = (value: string) => {
    const next = TABS.find((t) => t.value === value);
    if (next) setTab(next.value);
  };

  const places = objects.filter((o) => o.kind === "rack" || o.kind === "floor").length;

  // The same rows the side lists under דורש טיפול, so the figure and the list can't disagree.
  const needing = useMemo(() => {
    const states = state.products.map(stockState);
    const faults = state.faults.filter((f) => f.status === "open").length;
    return { count: states.filter((s) => s !== "ok").length + faults, danger: faults > 0 || states.some((s) => s === "out" || s === "short") };
  }, [state.products, state.faults]);

  const summary: SumItem[] = [
    { label: "מיקומים", value: places },
    { label: "מוצרים מונחים", value: model.placed },
    { label: "במחירון", value: `₪${fmtQty(Math.round(worth.total))}` },
    ...(worth.unpriced > 0 ? [{ label: "ללא מחיר", value: worth.unpriced }] : []),
    ...(needing.count > 0 ? [{ label: "דורשים טיפול", value: needing.count, tone: needing.danger ? ("out" as const) : ("warn" as const) }] : []),
  ];

  /* ───────── the ledger of places ───────── */
  const placeRows = useMemo(() => {
    const rows = objects.map((object) => ({ object, stock: model.byObject.get(object.id), need: needOf(model.byObject.get(object.id), faultObjects.has(object.id)) }));
    const byCode = (a: MapObject, b: MapObject) => a.id.localeCompare(b.id, "en", { numeric: true });
    const stock = rows.filter((r) => r.object.kind === "rack" || r.object.kind === "floor");
    stock.sort((a, b) => {
      if (sort === "worth") return (b.stock?.value ?? 0) - (a.stock?.value ?? 0) || byCode(a.object, b.object);
      if (sort === "code") return byCode(a.object, b.object);
      return NEED_RANK[a.need] - NEED_RANK[b.need] || byCode(a.object, b.object);
    });
    const rest = (kind: MapObjectKind) => rows.filter((r) => r.object.kind === kind).sort((a, b) => byCode(a.object, b.object));
    return [...stock, ...rest("machine"), ...rest("zone")];
  }, [objects, model, faultObjects, sort]);

  const sortBy = (key: PlaceSort) => setSort((was) => (was === key && key !== "need" ? "need" : key));

  const sortHead = (key: PlaceSort, word: string, num = false) => (
    <th scope="col" className={cx(num && "is-num", `is-${key}`)} aria-sort={sort === key ? (key === "worth" ? "descending" : "ascending") : undefined}>
      <button type="button" aria-pressed={sort === key} onClick={() => sortBy(key)}>
        {word}
        {sort === key && key !== "need" ? <Icon name={key === "worth" ? "chevron-down" : "chevron-up"} size={12} /> : null}
      </button>
    </th>
  );

  const onRowKey = (e: ReactKeyboardEvent<HTMLElement>, act: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      act();
    }
  };

  const needWord = (need: Need, stock: ObjectStock | undefined) => {
    if (need === "fault") return <span className="at-state is-out">{FAULT_WORD}</span>;
    if (!stock || stock.products === 0) return <span className="at-state is-ok">פנוי</span>;
    return <StateWord state={need} />;
  };

  const worthText = (stock: ObjectStock | undefined): ReactNode => {
    if (!stock || stock.products === 0) return <span className="at-tone-quiet">—</span>;
    if (stock.value > 0) return fmtCompact(stock.value);
    return <span className="at-tone-quiet">ללא מחיר</span>;
  };

  const placesLedger = (
    <div className="at-table-wrap at-wh-places-wrap">
      <table className="at-table at-wh-places">
        <thead>
          <tr>
            {sortHead("code", "מיקום")}
            <th scope="col" className="is-num is-count">{at === null ? "מוצרים" : "אז"}</th>
            {sortHead("need", "מצב")}
            {sortHead("worth", "שווי", true)}
          </tr>
        </thead>
        <tbody>
          {placeRows.map((row, i) => {
            const { object: o, stock, need } = row;
            const heads = i === 0 || GROUP_WORD[placeRows[i - 1].object.kind] !== GROUP_WORD[o.kind];
            const holds = o.kind === "rack" || o.kind === "floor";
            const sub = nameOf(o);
            const count = at === null ? (stock?.products ?? 0) : (datedCounts?.get(o.id)?.size ?? 0);
            return (
              <Fragment key={o.id}>
                {heads ? (
                  <tr className="at-wh-group" aria-hidden="true">
                    <td colSpan={4}>{GROUP_WORD[o.kind]}</td>
                  </tr>
                ) : null}
                <tr
                  data-row
                  data-id={o.id}
                  tabIndex={0}
                  data-lit={lit.has(o.id) || undefined}
                  onClick={() => select(o.id)}
                  onKeyDown={(e) => onRowKey(e, () => select(o.id))}
                  {...pointAt(() => objectAim(o.id))}
                >
                  <td className="is-code">
                    <span className="at-cell-text">
                      <span className="at-cell-title ltr">{o.id}</span>
                      {sub ? <span className="at-cell-sub">{sub}</span> : null}
                    </span>
                  </td>
                  {holds ? (
                    <>
                      <td className="is-num is-count">{count > 0 ? fmtQty(count) : <span className="at-tone-quiet">—</span>}</td>
                      <td className="is-need">{needWord(need, stock)}</td>
                      <td className="is-num is-worth">{worthText(stock)}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="is-need">{need === "fault" ? <span className="at-state is-out">{FAULT_WORD}</span> : null}</td>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {worth.unpriced > 0 && sort === "worth" ? <p className="at-wh-note">{worth.unpriced === 1 ? "מוצר אחד ללא מחיר לא נכלל" : `${fmtQty(worth.unpriced)} מוצרים ללא מחיר לא נכללו`}</p> : null}
    </div>
  );

  const map = useMemo(() => ({ objects, model, trail, now, ledger, placeOf, select, selectProduct }), [objects, model, trail, now, ledger, placeOf, select, selectProduct]);

  const side = () => {
    if (editing) return <LayoutPanel editor={editor} model={model} />;
    if (selectedObject) {
      return (
        <PlaceCard
          object={selectedObject}
          hit={selected}
          past={past?.stock ?? null}
          lit={lit}
          map={map}
          onShelf={setSelected}
          onBack={back}
          pointAt={pointAt}
        />
      );
    }
    return (
      <>
        <header className="at-wh-head">
          <h2 className="at-wh-title">מחסן</h2>
          {at !== null ? (
            <p className="at-wh-when">המלאי ב-<span className="ltr">{fmtDateTime(new Date(at).toISOString())}</span></p>
          ) : (
            <Summary items={summary} />
          )}
        </header>
        <Tabs variant="line" className="at-wh-tabs" tabs={TABS} value={tab} onChange={onTab} />
        {tab === "places" ? (
          <>
            {placesLedger}
            {at === null && model.tray.length > 0 ? <Tray map={map} pointAt={pointAt} /> : null}
          </>
        ) : tab === "moves" ? (
          <MovesList map={map} at={at} recent={recent.rows} pointAt={pointAt} />
        ) : at !== null ? (
          <TodayOnly onToday={() => setAt(null)} />
        ) : tab === "orders" ? (
          <OrdersList map={map} orders={openOrders} orderId={orderId} onOrder={setOrderId} pointAt={pointAt} />
        ) : (
          <CountList map={map} pointAt={pointAt} />
        )}
      </>
    );
  };

  return (
    <div className="at-wh" data-walk={walking || undefined} data-wide={fullscreen.active || undefined}>
      <ModelFrame className="at-wh-frame">
        {failed ? <Notice className="at-wh-fail" title="המפה לא זמינה בדפדפן הזה">הרשימה ממשיכה לעבוד</Notice> : null}
        {editing ? (
          <EditBar editor={editor} />
        ) : !failed ? (
          <div className="at-wh-tools" onKeyUp={peekResult} onPointerOver={peekResult} onPointerLeave={() => setPeek(null)} onBlur={() => setPeek(null)} onClickCapture={() => setPeek(null)}>
            <MapSearch placeOf={placeOf} onPick={onSearchPick} />
            {leaveWord ? <Button variant="primary" size="sm" icon="x" onClick={leave}>{leaveWord}</Button> : null}
            {layout.editable && !coarse ? <Button variant="secondary" size="sm" icon="edit" disabled={at !== null} onClick={startEditing}>עריכת פריסה</Button> : null}
            {fullscreen.available ? <Button variant="secondary" size="sm" className="at-wh-full" onClick={fullscreen.toggle}>{fullscreen.active ? "יציאה ממסך מלא" : "מסך מלא"}</Button> : null}
            <ViewSwitch view={viewMode} walk={!coarse} onView={setChosenView} />
          </div>
        ) : null}
        {walking ? <p className="at-wh-walkhint">חצים להליכה, גרירה להסתכלות</p> : null}
        {!selectedObject && !walking && !editing && !failed ? <HomeButton world={world} onHome={home} /> : null}
        {failed || editing ? null : recent.failed ? (
          <div className="at-wh-ruler">
            <div className="m3d-ruler">
              <span className="m3d-edge">ההיסטוריה לא נטענה</span>
              <Button variant="link" size="sm" onClick={recent.retry}>ניסיון נוסף</Button>
            </div>
          </div>
        ) : trail && trail.ticks.length > 0 ? (
          <div className="at-wh-ruler">
            <TimeRuler trail={trail} at={at} onAt={setAt} />
          </div>
        ) : null}
      </ModelFrame>
      <h1 className="sa-sr">מחסן</h1>

      <Side label="מחסן">
        <div ref={sideRef} className="at-wh-side" tabIndex={-1} inert={walking} data-dated={at !== null || undefined} onKeyDown={onSideKey} onClickCapture={() => peekRow(null, null)}>
          {side()}
        </div>
      </Side>

      {world
        ? createPortal(
            <>
              {tagged ? (
                <div className="at-wh-tags" data-close={closeView ? "" : undefined}>
                  <i ref={setReachEl} className="mh-aim" aria-hidden="true" />
                  <Labels
                    engine={tagged}
                    objects={objects}
                    views={labels}
                    flashes={flashes}
                    selectedId={selection?.objectId ?? null}
                    selectedKey={selectedBlock?.key ?? null}
                    hoverId={hover?.objectId ?? null}
                    emphasis={emphasis}
                    plan={plan}
                    onPick={pickHit}
                  />
                </div>
              ) : null}
              {reachEl && reached ? <SideLine key={`${reached.objectId}/${reached.level}/${reached.side ?? ""}/${peek ? "peek" : "open"}`} world={world} rail={sideRef} row={rowOf} anchor={reachEl} card={cardOf} /> : null}
            </>,
            world,
          )
        : null}
    </div>
  );
}

/* ───────── what every part of the side reads about the map ───────── */

interface MapView {
  objects: readonly MapObject[];
  model: MapModel;
  trail: Trail | null;
  now: number;
  /** All movements ever, loaded when something needs them. */
  ledger: MovementHistory;
  placeOf: (productId: string) => string | null;
  select: (objectId: string, shelf?: PickHit) => void;
  selectProduct: (productId: string) => void;
}

type PointAt = (aimOf: () => Aim | null) => RowPoint;

/* ───────── one place: its code, its levels, and what stands on each ───────── */

interface PlaceCardProps {
  object: MapObject;
  hit: PickHit | null;
  past: ReadonlyMap<string, PastQty> | null;
  lit: ReadonlySet<string>;
  map: MapView;
  onShelf: (hit: PickHit | null) => void;
  onBack: () => void;
  pointAt: PointAt;
}

function PlaceCard({ object, hit, past, lit, map, onShelf, onBack, pointAt }: PlaceCardProps): ReactElement {
  const { state } = useData();
  const { openAction } = useUi();
  const stock = map.model.byObject.get(object.id);
  const dated = past !== null;
  const holds = object.kind === "rack" || object.kind === "floor";

  const here = new Set(stock?.items.map((i) => i.product.id));
  const faults = dated ? [] : state.faults.filter((f) => f.status === "open" && (f.asset === object.id || (!f.asset && f.product_id !== null && here.has(f.product_id))));

  const under = object.kind === "machine" || object.kind === "zone" ? object.name : (nameOf(object) ?? KIND_WORD[object.kind]);
  const products = stock?.products ?? 0;
  const sum = holds ? (
    <>
      {products === 1 ? "מוצר אחד" : `${fmtQty(products)} מוצרים`}
      {!dated && stock && stock.value > 0 ? <> · <span className="ltr">{fmtCompact(stock.value)}</span> במחירון</> : null}
      {!dated && stock && stock.unpriced > 0 ? <> · {fmtQty(stock.unpriced)} ללא מחיר</> : null}
    </>
  ) : null;

  return (
    <>
      <header className="at-wh-head is-place">
        <Button variant="ghost" size="sm" icon="chevron-right" className="at-wh-back" onClick={onBack}>חזרה</Button>
        <p className="at-wh-code ltr">{object.id}</p>
        <p className="at-wh-kind">{under}</p>
        {sum ? <p className="at-wh-sum">{sum}</p> : null}
        {object.note ? <p className="at-wh-note">{object.note}</p> : null}
      </header>

      {faults.length > 0 ? (
        <ul className="at-wh-list">
          {faults.map((f) => <FaultRow key={f.id} fault={f} />)}
        </ul>
      ) : null}

      {holds ? (
        <>
          <Levels object={object} stock={stock} hit={hit} past={past} lit={lit} map={map} onShelf={onShelf} pointAt={pointAt} />
          {!dated ? (
            <div className="at-wh-foot">
              <Button variant="secondary" icon="plus" onClick={() => openAction("place", { place: object.kind === "floor" ? object.id : undefined })}>שיבוץ מוצר</Button>
            </div>
          ) : null}
        </>
      ) : object.kind === "machine" ? (
        <MachineBody object={object} faults={faults} dated={dated} />
      ) : (
        <ZoneBody object={object} dated={dated} />
      )}
    </>
  );
}

interface LevelsProps {
  object: MapObject;
  stock: ObjectStock | undefined;
  hit: PickHit | null;
  past: ReadonlyMap<string, PastQty> | null;
  lit: ReadonlySet<string>;
  map: MapView;
  onShelf: (hit: PickHit | null) => void;
  pointAt: PointAt;
}

/** The rack as it stands, top level first: each level, what stands on it, how much, and how that reads against its minimum. */
function Levels({ object, stock, hit, past, lit, map, onShelf, pointAt }: LevelsProps): ReactElement {
  const { openAction } = useUi();
  const blocks = stock?.blocks ?? [];
  const open = hit && hit.level !== null ? blockAt(map.model, hit) : null;
  const toggle = (block: ShelfBlock) => onShelf(open?.key === block.key ? { objectId: object.id, level: null } : hitOf(block));
  const loose = blocks.filter((block) => block.level === null);
  const lines = object.kind === "rack" ? shelfLines(object, blocks) : [];
  const dated = past !== null;

  const onKey = (e: ReactKeyboardEvent<HTMLElement>, act: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      act();
    }
  };

  const levelCell = (level: number | null, side: ShelfSide | null, through: number | null = level) => (
    <td className="is-level">
      <span className="ltr">{levelText(level, through)}</span>
      {side ? <span className="at-wh-side-word">{SIDE_WORD[side]}</span> : null}
    </td>
  );

  const blockRow = (block: ShelfBlock) => {
    const { product: p, state, level, side, through, qty } = block;
    const share = minimumShare(p);
    const isOpen = open?.key === block.key;
    const then = past?.get(p.id);
    return (
      <Fragment key={block.key}>
        <tr
          data-row
          tabIndex={0}
          aria-current={isOpen ? "true" : undefined}
          aria-expanded={isOpen}
          className={cx(isOpen && "is-selected")}
          data-lit={lit.has(block.key) || undefined}
          onClick={() => toggle(block)}
          onKeyDown={(e) => onKey(e, () => toggle(block))}
          {...pointAt(() => ({ ids: [object.id], hit: hitOf(block), block }))}
        >
          {levelCell(level, side, through)}
          <td className="is-product">
            <span className="at-cell">
              <ProductThumb product={p} small />
              <span className="at-cell-text">
                <span className="at-cell-title" title={p.name}>{fmtName(p.name)}</span>
                <span className="at-cell-sub"><span className="ltr">{p.sku}</span></span>
              </span>
            </span>
          </td>
          <td className="is-num is-qty">
            {dated ? pastText(then) : fmtQty(qty)}
            {!dated || then?.kind === "known" ? <small>{fmtUnit(qty, p.unit)}</small> : null}
          </td>
          <td className="is-state">{dated ? null : <StateWord state={state} sub={state === "short" ? `חסר ${fmtQty(-available(p))}` : share !== null ? percentText(share) : "ללא מינימום"} />}</td>
        </tr>
        {isOpen ? (
          <tr className="at-wh-item-row">
            <td colSpan={4}>
              <Item map={map} block={block} past={then ?? null} dated={dated} />
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    <div className="at-table-wrap at-wh-levels-wrap">
      <table className="at-table at-wh-levels">
        <thead>
          <tr>
            <th scope="col" className="is-level">מדף</th>
            <th scope="col" className="is-product">מוצר</th>
            <th scope="col" className="is-num is-qty">{dated ? "אז" : "כאן"}</th>
            <th scope="col" className="is-state">מצב</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            if (line.blocks.length > 0) return line.blocks.map(blockRow);
            const key = `${object.id}@empty/${line.level}/${line.side ?? ""}`;
            const picked = hit?.level === line.level && (line.side === null || !hit.side || hit.side === line.side);
            const place = () => openAction("place", { place: formatPlace(object.id, line.level, line.side) });
            return (
              <tr
                key={key}
                data-row
                tabIndex={0}
                className={cx("is-free", picked && "is-selected")}
                aria-current={picked ? "true" : undefined}
                data-lit={lit.has(key) || undefined}
                onClick={dated ? undefined : place}
                onKeyDown={dated ? undefined : (e) => onKey(e, place)}
                {...pointAt(() => ({ ids: [object.id], hit: { objectId: object.id, level: line.level, side: line.side } }))}
              >
                {levelCell(line.level, line.side)}
                <td className="is-product"><span className="at-tone-quiet">פנוי</span></td>
                <td className="is-num is-qty" />
                <td className="is-state">{dated ? null : <span className="at-wh-add">שיבוץ</span>}</td>
              </tr>
            );
          })}
          {loose.map(blockRow)}
        </tbody>
      </table>
      {lines.length === 0 && loose.length === 0 ? <p className="at-wh-empty">אין מוצרים</p> : null}
    </div>
  );
}

/** One product on a level, opened: its figures, its facts, and what can be done with it. Every button opens the app's own forms. */
function Item({ map, block, past, dated }: { map: MapView; block: ShelfBlock; past: PastQty | null; dated: boolean }): ReactElement {
  const ui = useUi();
  const { supplier } = useData();
  const p = block.product;
  const share = minimumShare(p);
  const first = block.items[0];
  const free = available(p);
  const { ledger, trail } = map;
  const history = ledger.ready ? ledger.rows : null;
  const lastOut = history ? lastOutOf(p.id, history) : null;
  const lastCount = history ? countOf(p, history).lastCount : null;
  const vendorId = p.primary_supplier_id ?? (history ? (history.find((m) => m.product_id === p.id && m.type === "in" && m.supplier_id)?.supplier_id ?? null) : null);
  const vendor = supplier(vendorId);

  return (
    <section className="at-wh-item" aria-label={p.name}>
      <div className="at-wh-item-head">
        <ProductThumb product={p} />
        <div className="at-cell-text">
          <button type="button" className="at-wh-name" title={p.name} onClick={() => ui.openProduct(p.id)}>{fmtName(p.name)}</button>
          <span className="at-cell-sub"><span className="ltr">{p.sku}</span>{p.category ? ` · ${p.category}` : ""}</span>
        </div>
      </div>
      {dated ? (
        <dl className="at-wh-figures">
          <div>
            <dt>אז, {p.unit}</dt>
            <dd className="ltr">{pastText(past)}</dd>
          </div>
        </dl>
      ) : (
        <>
          <dl className="at-wh-figures">
            <div>
              <dt>במלאי, {p.unit}</dt>
              <dd className={cx("ltr", block.state === "low" && "at-tone-warn", block.state === "out" && "at-tone-out", block.state === "short" && "at-tone-short")}>{fmtQty(p.qty)}</dd>
            </div>
            <div>
              <dt>מינימום</dt>
              <dd className="ltr">{p.min_qty > 0 ? fmtQty(p.min_qty) : "—"}</dd>
            </div>
            <div>
              <dt>מהמינימום</dt>
              <dd className={cx("ltr", block.state === "low" && "at-tone-warn", block.state === "out" && "at-tone-out", block.state === "short" && "at-tone-short")}>{share === null ? "—" : percentText(share)}</dd>
            </div>
          </dl>
          <Fields
            className="at-wh-facts"
            items={[
              ...(p.reserved > 0 ? [{ label: free < 0 ? "חסר להזמנות" : "זמין", value: <span className={cx("ltr", free < 0 && "at-tone-short")}>{fmtQty(Math.abs(free))}</span>, num: true }] : []),
              { label: "הוצאה אחרונה", value: history ? (lastOut ? fmtRelative(lastOut.created_at) : "אין") : undefined },
              { label: "ספירה אחרונה", value: history ? (lastCount ? fmtRelative(lastCount) : "לא נספר") : undefined },
              { label: "ימי מלאי", value: trail ? coverText(coverOf(p, trail, trail.to)) : undefined },
              { label: "ספק", value: vendor?.name },
              ...(vendor?.phone ? [{ label: "טלפון", value: <a className="at-wh-tel ltr" href={`tel:${vendor.phone}`}>{vendor.phone}</a> }] : []),
            ]}
          />
        </>
      )}
      <div className="at-wh-actions">
        <Button variant="primary" size="sm" icon="arrow-down-left" disabled={dated} onClick={() => ui.openAction("receive", { productId: p.id, place: first?.place })}>קליטה</Button>
        <Button variant="secondary" size="sm" icon="arrow-up-right" disabled={dated} onClick={() => ui.openAction("issue", { productId: p.id })}>הוצאה</Button>
        <Button variant="secondary" size="sm" icon="clipboard-check" disabled={dated} onClick={() => ui.openAction("adjust", { productId: p.id })}>תיקון ספירה</Button>
        <Button variant="secondary" size="sm" icon="tool" disabled={dated} onClick={() => ui.openAction("fault", { productId: p.id })}>דיווח תקלה</Button>
        {block.qty > 0 ? (
          <Button variant="secondary" size="sm" icon="arrow-left" className="is-wide" disabled={dated} onClick={() => ui.openAction("place", { productId: p.id, from: first?.place })}>העברה למדף אחר</Button>
        ) : null}
      </div>
    </section>
  );
}

function FaultRow({ fault }: { fault: Fault }): ReactElement {
  const { worker } = useData();
  const { openFault } = useUi();
  const by = worker(fault.reported_by)?.name;
  return (
    <li className="at-wh-row is-fault">
      <span className="at-cell-text">
        <span className="at-cell-title">{fault.description}</span>
        <span className="at-cell-sub">{[fmtRelative(fault.created_at), by ? `דווח ע"י ${by}` : null].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="at-wh-row-end">
        <span className="at-state is-out">{FAULT_WORD}</span>
        <Button variant="ghost" size="sm" onClick={() => openFault(fault.id)}>סגירה עם תיעוד</Button>
      </span>
    </li>
  );
}

function MachineBody({ object, faults, dated }: { object: MapObject; faults: readonly Fault[]; dated: boolean }): ReactElement {
  const { openAction } = useUi();
  return (
    <>
      {dated ? <p className="at-wh-empty">תקלות מוצגות להיום בלבד</p> : faults.length === 0 ? <p className="at-wh-empty">אין תקלות פתוחות</p> : null}
      <div className="at-wh-foot">
        <Button variant="secondary" icon="tool" disabled={dated} onClick={() => openAction("fault", { asset: object.id })}>דיווח תקלה</Button>
      </div>
    </>
  );
}

function ZoneBody({ object, dated }: { object: MapObject; dated: boolean }): ReactElement | null {
  const { state, stats } = useData();
  const receipts = useMemo(() => state.movements.filter((m) => m.type === "in" && !isTempId(m.id) && isToday(m.created_at)).length, [state.movements]);
  if (dated) return null;
  if (object.id === RECEIVING_ZONE) return <Fields className="at-wh-facts is-zone" columns={1} items={[{ label: "קליטות היום", value: fmtQty(receipts), num: true }]} />;
  if (object.id === DISPATCH_ZONE) return <Fields className="at-wh-facts is-zone" columns={1} items={[{ label: "הזמנות פתוחות", value: fmtQty(stats.openOrders), num: true }]} />;
  return null;
}

/* ───────── the other lenses of the floor ───────── */

/** What stands nowhere on the map: a product with no place, or the part of one no shelf holds. */
function Tray({ map, pointAt }: { map: MapView; pointAt: PointAt }): ReactElement {
  const { openAction } = useUi();
  const [picking, setPicking] = useState<string | null>(null);
  const [change, setChange] = useState<PlaceChange | null>(null);
  const { model } = map;

  const places = useMemo<SelectOption[]>(
    () => map.objects.filter((o) => o.kind === "rack" || o.kind === "floor").map((o) => ({ value: o.id, label: `${o.id} · ${o.name}` })),
    [map.objects],
  );

  // Stock on a shelf moves through the app's own form; a product with nothing on the shelf only names its home.
  const place = (p: Product, objectId: string) => {
    setPicking(null);
    if (objectId) setChange({ product: p, location: formatPlace(objectId, null) });
  };

  return (
    <section className="at-wh-section">
      <h3 className="at-wh-section-title">ללא מיקום במפה <span className="at-wh-n ltr">{fmtQty(model.tray.length)}</span></h3>
      <ul className="at-wh-list">
        {model.tray.map(({ product: p, qty }) => (
          <li key={p.id} className="at-wh-row" {...pointAt(() => null)}>
            <ProductThumb product={p} small />
            <span className="at-cell-text">
              <span className="at-cell-title" title={p.name}>{fmtName(p.name)}</span>
              <span className="at-cell-sub">
                <span className="ltr">{fmtQty(qty)}</span> {fmtUnit(qty, p.unit)} · <bdi>{qty < p.qty ? `מתוך ${fmtQty(p.qty)}` : p.location || "ללא מיקום"}</bdi>
              </span>
              {picking === p.id ? (
                <span className="at-wh-pick">
                  <Select options={places} value="" onChange={(id) => place(p, id)} placeholder="בחירת מיקום" block defaultOpen />
                </span>
              ) : null}
            </span>
            <span className="at-wh-row-end">
              <Button variant="ghost" size="sm" onClick={() => (qty > 0 ? openAction("place", { productId: p.id }) : setPicking(picking === p.id ? null : p.id))}>שיבוץ</Button>
            </span>
          </li>
        ))}
      </ul>
      {change ? <PlaceConfirm change={change} onClose={() => setChange(null)} /> : null}
    </section>
  );
}

interface OrdersListProps {
  map: MapView;
  orders: readonly Order[];
  orderId: string | null;
  onOrder: (id: string | null) => void;
  pointAt: PointAt;
}

/** Open orders, the oldest first. Opening one lays its picks on the floor, from each shelf to dispatch. */
function OrdersList({ map, orders, orderId, onOrder, pointAt }: OrdersListProps): ReactElement {
  const { linesOf, product } = useData();
  const { openOrder } = useUi();
  const { itemsOf } = useTwin();

  if (orders.length === 0) return <p className="at-wh-empty">אין הזמנות פתוחות</p>;

  const orderAim = (o: Order): Aim | null => {
    const ids = linesOf(o.id).flatMap((l) => itemsOf(l.product_id).map((item) => item.objectId));
    return ids.length > 0 ? { ids: [...new Set(ids), DISPATCH_ZONE], hit: null } : null;
  };

  return (
    <ul className="at-wh-list">
      {orders.map((o) => {
        const open = o.id === orderId;
        const lines = linesOf(o.id);
        return (
          <li key={o.id} className={cx("at-wh-order", open && "is-open")}>
            <button type="button" data-row className="at-wh-row is-button" aria-expanded={open} onClick={() => onOrder(open ? null : o.id)} {...pointAt(() => orderAim(o))}>
              <span className="at-cell-text">
                <span className="at-cell-title"><bdi>{o.customer}</bdi></span>
                <span className="at-cell-sub">
                  <span className="ltr">{fmtQty(lines.length)}</span> {lines.length === 1 ? "פריט" : "פריטים"} · {fmtRelative(o.created_at)}
                </span>
              </span>
              <Icon name={open ? "chevron-up" : "chevron-down"} size={16} className="at-wh-chev" />
            </button>
            {open ? (
              <div className="at-wh-order-body">
                <ul className="at-wh-list is-inner">
                  {lines.map((l) => {
                    const p = product(l.product_id);
                    const place = map.placeOf(l.product_id);
                    return (
                      <li key={l.id}>
                        <button type="button" data-row className="at-wh-row is-button" disabled={!place} onClick={() => place && map.select(place)} {...pointAt(() => productAim(l.product_id, itemsOf, map.model))}>
                          <ProductThumb product={p} small />
                          <span className="at-cell-text">
                            <span className="at-cell-title">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
                            <span className="at-cell-sub">
                              {place ? <span className="ltr">{place}</span> : "ללא מיקום במפה"}
                              {p && available(p) < 0 ? <> · <span className="at-tone-short">חסר</span></> : null}
                            </span>
                          </span>
                          <span className="at-wh-row-end ltr">{fmtQty(l.qty)} <small>{fmtUnit(l.qty, p?.unit)}</small></span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <Button variant="secondary" size="sm" onClick={() => openOrder(o.id)}>פתיחת ההזמנה</Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** What moved, newest first: what and how much, then where and who. Pointing at a row draws its way across the floor. */
function MovesList({ map, at, recent, pointAt }: { map: MapView; at: number | null; recent: readonly Movement[]; pointAt: PointAt }): ReactElement {
  const { state, product, worker } = useData();
  const { openProduct } = useUi();
  const rows = useMemo<readonly Movement[]>(() => (at === null ? state.movements : recent.filter((m) => Date.parse(m.created_at) <= at)).slice(0, MOVES_FEED), [state.movements, recent, at]);

  if (rows.length === 0) return <p className="at-wh-empty">אין תנועות</p>;

  const moveAim = (m: Movement): Aim | null => {
    const shelf = resolvePlace(m.place, map.objects);
    const place = shelf?.objectId ?? map.placeOf(m.product_id);
    if (!place) return null;
    const points = m.type === "in" ? routeBetween(map.objects, RECEIVING_ZONE, place) : m.type === "out" ? routeBetween(map.objects, place, DISPATCH_ZONE) : [];
    return { ids: [place], hit: shelf ?? { objectId: place, level: null }, route: points.length > 1 ? { points, tone: m.type === "in" ? "in" : "out" } : undefined };
  };

  return (
    <ul className="at-wh-list">
      {rows.map((m) => {
        // A receipt says where it went; anything else stands where the product stands.
        const shelf = resolvePlace(m.place, map.objects);
        const place = shelf?.objectId ?? map.placeOf(m.product_id);
        const p = product(m.product_id);
        const open = place ? () => map.select(place, shelf ?? undefined) : () => openProduct(m.product_id, "history");
        return (
          <li key={m.id}>
            <button type="button" data-row className="at-wh-row is-button" onClick={open} {...pointAt(() => moveAim(m))}>
              <ProductThumb product={p} small />
              <span className="at-cell-text">
                <span className="at-cell-title">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
                <span className="at-cell-sub">{[MOVEMENT_LABEL[m.type], m.place ? placeWords(m.place, map.objects) : place, worker(m.worker_id)?.name, fmtRelative(m.created_at)].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={cx("at-wh-row-end ltr is-qty", m.type === "in" && "at-tone-in", m.type === "out" && "at-tone-out")}>{fmtSigned(m.qty, m.type)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Never counted, then a figure no movement explains, then damage since the count, then the oldest count. */
function needRank(info: CountInfo): number {
  if (info.lastCount === null) return 0;
  if (info.unexplained !== 0) return 1;
  return info.faultQty > 0 ? 2 : 3;
}

const signed = (n: number) => (n < 0 ? `−${fmtQty(-n)}` : fmtQty(n));

/** When each product was last counted and what its figure can't explain. The count itself is on the product. */
function CountList({ map, pointAt }: { map: MapView; pointAt: PointAt }): ReactElement {
  const { state } = useData();
  const { openProduct } = useUi();
  const { itemsOf } = useTwin();
  const { ledger } = map;

  const rows = useMemo(
    () =>
      ledger.ready
        ? state.products
            .map((p) => ({ product: p, info: countOf(p, ledger.rows) }))
            .sort((a, b) => needRank(a.info) - needRank(b.info) || Math.abs(b.info.unexplained) - Math.abs(a.info.unexplained) || Date.parse(a.info.lastCount ?? "") - Date.parse(b.info.lastCount ?? "") || 0)
        : [],
    [state.products, ledger.ready, ledger.rows],
  );

  if (ledger.failed) return <Notice tone="danger" title="ההיסטוריה לא נטענה" action="ניסיון נוסף" onAction={ledger.retry} className="at-wh-notice" />;
  if (!ledger.ready) return <p className="at-wh-empty" role="status">טוען היסטוריה</p>;
  if (rows.length === 0) return <p className="at-wh-empty">אין מוצרים</p>;

  return (
    <div className="at-table-wrap at-wh-count-wrap">
      <table className="at-table at-wh-count">
        <thead>
          <tr>
            <th scope="col" className="is-product">מוצר</th>
            <th scope="col" className="is-when">נספר</th>
            <th scope="col" className="is-num is-gap">פער</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ product: p, info }) => {
            const place = map.placeOf(p.id);
            const open = () => (place ? map.select(place) : openProduct(p.id));
            return (
              <tr
                key={p.id}
                data-row
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open();
                  }
                }}
                {...pointAt(() => productAim(p.id, itemsOf, map.model))}
              >
                <td className="is-product">
                  <span className="at-cell">
                    <ProductThumb product={p} small />
                    <span className="at-cell-text">
                      <span className="at-cell-title" title={p.name}>{fmtName(p.name)}</span>
                      <span className="at-cell-sub">
                        {place ? <span className="ltr">{place}</span> : "ללא מיקום במפה"}
                        {info.faultQty > 0 ? <> · <span className="ltr">{fmtQty(info.faultQty)}</span> {fmtUnit(info.faultQty, p.unit)} בתקלה מאז הספירה</> : null}
                      </span>
                    </span>
                  </span>
                </td>
                <td className={cx("is-when", info.lastCount === null && "at-tone-warn")}>{info.lastCount ? countedAgo(info.lastCount, map.now) : "לא נספר"}</td>
                <td className="is-num is-gap">{info.unexplained !== 0 ? <>{signed(info.unexplained)}<small>{fmtUnit(info.unexplained, p.unit)}</small></> : <span className="at-tone-quiet">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
