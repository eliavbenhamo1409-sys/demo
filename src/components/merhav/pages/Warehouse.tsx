"use client";

/**
 * מחסן: the model is the page. The same orchestration as src/components/map3d/MapPage.tsx, on the one engine that stands
 * under the whole admin, so arriving here is a move of the camera and nothing loads. The rail stands on the door, the
 * controls and the tags stand in the world, and whatever this page turns on it turns off again on the way out.
 */

import { Suspense, useCallback, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { CountRail } from "@/components/map3d/CountRail";
import { labelViews } from "@/components/map3d/label-views";
import { Labels, type LabelView } from "@/components/map3d/Labels";
import { EditBar, LayoutPanel, useLayoutEditor } from "@/components/map3d/LayoutEditor";
import { MapSearch } from "@/components/map3d/MapSearch";
import { ObjectCard } from "@/components/map3d/ObjectCard";
import { OrdersRail } from "@/components/map3d/OrdersRail";
import { TodayOnly } from "@/components/map3d/parts";
import { MovesRail, StatusRail } from "@/components/map3d/StatusRail";
import { TimeRuler } from "@/components/map3d/TimeRuler";
import { useCoarsePointer, useFullscreen, useNarrow } from "@/components/map3d/use-device";
import { useMovementHistory } from "@/components/map3d/use-history";
import { ValueRail } from "@/components/map3d/ValueRail";
import type { MapView } from "@/components/map3d/view";
import { ViewSwitch } from "@/components/map3d/ViewSwitch";
import { worthOf } from "@/components/map3d/worth";
import "@/components/map3d/map3d.css";
import "@/components/map3d/map3d-aluminium.css";
import { Button, cx, Notice, Tabs } from "@/components/ui";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { DISPATCH_ZONE } from "@/lib/map3d/layout";
import { blockAt, buildMapModel, emptySpot } from "@/lib/map3d/model";
import { placeKey, resolvePlace } from "@/lib/map3d/place";
import { routeBetween } from "@/lib/map3d/route";
import { useShelves } from "@/lib/map3d/shelves";
import { buildTrail, qtyAt, TRAIL_WINDOW, type PastQty } from "@/lib/map3d/trail";
import type { Insets, LabelAnchor, MapEngine, MapObject, MapObjectKind, MapRoute, PickHit, ViewMode } from "@/lib/map3d/types";
import { isTempId, stockState, useData, type Movement, type Product } from "@/lib/store";
import { Figure } from "../Figure";
import { BackHome } from "../twin/BackHome";
import { useTwin } from "../twin/Twin";
import { aimOf, litRows, pointOf, productAim, ROW, type Aim, type LensData } from "../warehouse/lens";
import { Reach } from "../warehouse/Reach";

type RailTab = "status" | "orders" | "moves" | "count" | "value";

const TAB_LABEL: Record<RailTab, string> = { status: "מלאי", orders: "הזמנות", moves: "תנועות", count: "ספירה", value: "שווי" };
const TAB_VALUES = Object.keys(TAB_LABEL) as RailTab[];

const LEAVE_WORD: Record<MapObjectKind, string> = {
  rack: "יציאה מהמתקן",
  floor: "יציאה מהאזור",
  machine: "יציאה מהמכונה",
  zone: "יציאה מהאזור",
};

const CLOCK_MS = 60_000;
const MARK_MARGIN = 0.45;
/** How many places keep their price on the model. */
const WORTH_TAGS = 5;
/** An unknown quantity draws as an empty shelf, so this one word stays on the model at any date. */
const PAST_UNKNOWN = "לא ידוע";
/** A little past the rig's flight, so nothing changes under it. */
const PLAN_FLIGHT_MS = 740;
/** A movement's way across the floor is drawn for a row you stop on, not for each row the pointer crosses. */
const TRACE_DWELL_MS = 140;

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The rows the arrow keys walk through. */
const WALKABLE = "button.m3d-line:not(:disabled), button.m3d-shelf, .m3d-row > .sa-attention-open";

/** The walk's letters. The arrows are no search. */
const WALK_LETTERS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

interface Peek extends Aim {
  /** The row that points. Null: a figure, which points at many places. */
  row: Element | null;
}

/** What the door covers: the gauge Twin measured it with. On a phone the door stands under the model and covers none of it. */
const doorWidth = (world: HTMLElement | null) => world?.querySelector<HTMLElement>(".mh-gauge")?.offsetWidth ?? 0;

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

export function Warehouse(): ReactElement {
  return (
    <Suspense fallback={null}>
      <WarehouseInner />
    </Suspense>
  );
}

function WarehouseInner(): ReactElement {
  const { state, stats, linesOf } = useData();
  const ui = useUi();
  const { engine, failed, layout, model, flashes, world, placeOf, itemsOf, spotProduct, listen, setPageRoutes, setPastSlots, setAnchors, aimProduct, home } = useTwin();
  const editor = useLayoutEditor(layout);
  const { rows: shelfRows } = useShelves();
  const params = useSearchParams();
  const narrow = useNarrow();
  const coarse = useCoarsePointer();

  const editing = editor.draft !== null;
  const objects = editor.draft ?? layout.objects;

  const door = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const stage = useMemo(() => ({ current: world }), [world]);
  const fullscreen = useFullscreen(stage);

  const [tab, setTab] = useState<RailTab>("status");
  const [selected, setSelected] = useState<PickHit | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [chosenView, setChosenView] = useState<ViewMode | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [hover, setHover] = useState<PickHit | null>(null);
  const [linkSeen, setLinkSeen] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);

  const viewMode = chosenView ?? (narrow ? "top" : "orbit");

  // A product opened here: the drawer is a second door from the far side, and its shelf answers between the two.
  const drawerProduct = ui.panel?.type === "product" && !ui.closing ? ui.panel.id : null;
  const drawerAim = useMemo(() => (drawerProduct ? productAim(drawerProduct, itemsOf, model) : null), [drawerProduct, itemsOf, model]);
  const pointed = peek ?? drawerAim;

  useEffect(() => { (window as unknown as { __engine: unknown }).__engine = engine; }, [engine]); // TEMP
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
  const orderPlaces = useMemo(() => {
    if (tab !== "orders" || !orderId) return null;
    const ids = new Set<string>();
    for (const line of linesOf(orderId)) {
      const place = placeOf(line.product_id);
      if (place) ids.add(place);
    }
    return ids;
  }, [tab, orderId, linesOf, placeOf]);

  const routes = useMemo<MapRoute[]>(
    () =>
      [...(orderPlaces ?? [])]
        .map((id): MapRoute => ({ points: routeBetween(objects, id, DISPATCH_ZONE), tone: "ink" }))
        .filter((route) => route.points.length > 1),
    [orderPlaces, objects],
  );

  const valueLens = tab === "value" && at === null && !targetId;

  const footprints = useMemo(() => {
    if (!valueLens) return null;
    const top = worth.places[0]?.value ?? 1;
    return worth.places.map((p) => ({ objectId: p.object.id, strength: p.value / top }));
  }, [valueLens, worth.places]);

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

  // A walk opens the door and fullscreen leaves it behind: the model takes the whole stage, before any pose is worked out.
  const walking = viewMode === "walk" && !editing;
  const wide = walking || fullscreen.active;
  const wasWide = useRef(false);
  useEffect(() => {
    if (!engine || wasWide.current === wide) return;
    wasWide.current = wide;
    engine.setInsets(wide ? NO_INSETS : { ...NO_INSETS, right: doorWidth(world) });
  }, [engine, world, wide]);

  // The camera stops short of the whole floor beside the door, so the plan stands on a shorter canvas in the world's own
  // colour. It is measured before the flight there is worked out, and on the way back it waits until the flight has landed.
  const plan = editing || viewMode === "top";
  const [planWas, setPlanWas] = useState(plan);
  const [planLeaving, setPlanLeaving] = useState(false);
  if (plan !== planWas) {
    setPlanWas(plan);
    setPlanLeaving(!plan);
  }

  useEffect(() => {
    if (!planLeaving) return;
    const timer = setTimeout(() => setPlanLeaving(false), PLAN_FLIGHT_MS);
    return () => clearTimeout(timer);
  }, [planLeaving]);

  useEffect(() => {
    if (plan) engine?.renderNow();
    engine?.setEditing(editing);
    if (!editing) engine?.setView(viewMode);
  }, [engine, editing, viewMode, plan]);

  const speak = useEffectEvent(() => {
    engine?.setSelection(selection);
    engine?.setEmphasis(emphasis);
  });

  // The search hands the model back empty, after this page's effects, each time the ledger changes.
  useEffect(() => {
    queueMicrotask(() => speak());
  }, [engine, selection, emphasis, spotProduct]);

  // It does the same when it closes, so what is open here comes back.
  useEffect(() => {
    const watcher = new MutationObserver(() => {
      if (!document.querySelector(".mh-command")) window.setTimeout(() => speak());
    });
    watcher.observe(document.body, { childList: true });
    return () => watcher.disconnect();
  }, []);

  // A list that ended under the pointer may leave its line behind.
  useEffect(() => aimProduct(null), [aimProduct]);

  useEffect(() => {
    engine?.setFootprints(footprints);
  }, [engine, footprints]);

  // One line on the floor at the front of what needs a hand, so the map answers "where" before anything is read.
  // Never a box around it: a red border is the alarm this product does not sound.
  const marks = useMemo<MapRoute[]>(() => {
    if (tab !== "status" || at !== null || editing || targetId) return [];
    const lines: MapRoute[] = [];
    for (const { object: o, worst } of model.byObject.values()) {
      if (worst === "ok") continue;
      const [left, right] = [o.x - o.w / 2 - MARK_MARGIN, o.x + o.w / 2 + MARK_MARGIN];
      const front = o.z + o.d / 2 + MARK_MARGIN;
      lines.push({ points: [[left, front], [right, front]], tone: worst === "low" ? "warn" : "out" });
    }
    return lines;
  }, [tab, at, editing, targetId, model]);

  // Null would hand the floor back to Twin's own marks, which don't know this page's tabs.
  useEffect(() => {
    setPageRoutes([...routes, ...marks]);
  }, [routes, marks, setPageRoutes]);

  const fly = useEffectEvent((id: string | null) => {
    if (viewMode === "walk") return;
    const object = objects.find((o) => o.id === id);
    engine?.flyTo(object ? { objectId: object.id, shelf: object.kind === "rack" && viewMode !== "top" } : null);
  });

  // Twin fits the model to the door after this page's effects, so a flight waits for it to finish.
  const flown = useRef<string | null>(null);
  useEffect(() => {
    if (!engine || flown.current === targetId) return;
    flown.current = targetId;
    queueMicrotask(() => fly(targetId));
  }, [engine, targetId]);

  const refit = useEffectEvent(() => {
    if (wide) engine?.setInsets(NO_INSETS);
    fly(flown.current);
  });

  // Twin fits the model to the door on a new window size, and what is open stays open.
  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => refit());
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onResize);
    };
  }, []);

  const drawerPlace = drawerAim?.hit?.objectId ?? null;
  useEffect(() => {
    if (!engine || !drawerPlace || viewMode === "walk") return;
    const panel = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--panel"));
    const beside = { ...NO_INSETS, right: doorWidth(world) };
    engine.setInsets({ ...beside, left: panel });
    engine.flyTo({ objectId: drawerPlace, shelf: true });
    return () => {
      engine.setInsets(beside);
      queueMicrotask(() => fly(flown.current));
    };
  }, [engine, world, drawerPlace, viewMode]);

  /* ───────── keys ───────── */
  // The row that opened a card is gone with the list, so the keyboard carries on from the rail.
  useEffect(() => {
    if (document.activeElement === document.body) railRef.current?.focus({ preventScroll: true });
  }, [targetId]);

  const onEscape = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || ui.panel) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (editing) editor.setEditId(null);
    else if (selected) setSelected(null);
    else if (viewMode === "walk") setChosenView("orbit");
    else setOrderId(null);
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

  /* ───────── labels ───────── */
  const faultObjects = useMemo(() => {
    const ids = new Set<string>();
    for (const f of state.faults) {
      if (f.status !== "open") continue;
      const place = f.asset ?? (f.product_id ? placeOf(f.product_id) : null);
      if (place) ids.add(place);
    }
    return ids;
  }, [state.faults, placeOf]);

  const closeView = selectedObject?.kind === "rack" && viewMode !== "top" && viewMode !== "walk" ? selectedObject : null;
  const labels = useMemo(() => {
    const views = labelViews({ objects, model, past: past?.stock ?? null, money: valueLens, faults: faultObjects, open: closeView, shelf: hover ?? pointed?.hit ?? null });
    // Thirty figures on stems would hide what they stand on. The rest wait for a pointer, and the rail lists them all.
    const largest = new Set(valueLens ? worth.places.slice(0, WORTH_TAGS).map((place) => place.object.id) : []);
    const speaks = (view: LabelView) => largest.has(view.id) || view.text === PAST_UNKNOWN;
    return past || valueLens ? views.map((view) => (view.text && !speaks(view) ? { ...view, quiet: true, more: view.text, text: undefined } : view.text && past ? { ...view, quiet: true } : view)) : views;
  }, [objects, model, past, valueLens, faultObjects, closeView, hover, pointed, worth.places]);

  // Labels writes the engine's anchors itself. Through this they go by Twin, beside the point the line ends at.
  const [tagAnchors, setTagAnchors] = useState<readonly LabelAnchor[]>([]);
  const tagged = useMemo<MapEngine | null>(() => engine && { ...engine, setLabels: setTagAnchors }, [engine]);

  /* ───────── the lens: a row points at the model, and the model points back ───────── */
  // The shelf that stands open on the door stays tied to its line; a row under the pointer borrows it.
  const [reachEl, setReachEl] = useState<HTMLElement | null>(null);
  const reached = peek ? peek.hit : closeView && selectedBlock ? selection : null;
  const point = useMemo(() => (reached ? pointOf(reached, objects) : null), [reached, objects]);
  const peekedRow = peek?.row;
  const rowOf = useCallback(() => peekedRow ?? railRef.current?.querySelector(".m3d-shelfblock.is-open > .m3d-shelf") ?? null, [peekedRow]);
  useEffect(() => {
    setAnchors(point && reachEl ? [...tagAnchors, { el: reachEl, ...point }] : tagAnchors);
  }, [tagAnchors, point, reachEl, setAnchors]);

  const moves = useMemo(() => (at === null ? state.movements : recent.rows.filter((m) => Date.parse(m.created_at) <= at)), [at, state.movements, recent.rows]);
  const openOrders = useMemo(() => state.orders.filter((o) => o.status === "open" && linesOf(o.id).length > 0).reverse(), [state.orders, linesOf]);
  const lens = useMemo<LensData>(
    () => ({ objects, model, open: selectedObject, products: state.products, moves, orders: openOrders, linesOf, placeOf, itemsOf }),
    [objects, model, selectedObject, state.products, moves, openOrders, linesOf, placeOf, itemsOf],
  );

  const overRow = useRef<Element | null>(null);
  const peekRow = (row: Element | null) => {
    overRow.current = row;
    const aim = row ? aimOf(row, lens) : null;
    if (!row || !aim) {
      setPeek(null);
      return;
    }
    setPeek({ ...aim, row });
  };

  const onRailOver = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse" || !(e.target instanceof Element)) return;
    const row = e.target.closest(ROW);
    if (row !== overRow.current) peekRow(row);
  };

  const onRailFocus = (e: FocusEvent<HTMLElement>) => {
    showMenu(e);
    if (e.target instanceof Element && e.target.matches(":focus-visible")) peekRow(e.target.closest(ROW));
  };

  // Arrows walk the list, and each step lights its shelf.
  const onRailKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || viewMode === "walk") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(WALKABLE)];
    const at = rows.findIndex((row) => row === e.target);
    if (at < 0 && e.target !== e.currentTarget) return;
    e.preventDefault();
    rows[e.key === "ArrowDown" ? at + 1 : Math.max(at - 1, 0)]?.focus();
  };

  const route = peek?.route;
  useEffect(() => {
    if (!engine || !route) return;
    const timer = setTimeout(() => engine.trace(route), TRACE_DWELL_MS);
    return () => clearTimeout(timer);
  }, [engine, route]);

  // The other way round: what the pointer is on in the model stands out on the door.
  useEffect(() => {
    if (!hover || !railRef.current) return;
    const rows = litRows(railRef.current, hover, selectedObject, model);
    for (const row of rows) row.classList.add("is-lit");
    if (selectedObject) rows[0]?.scrollIntoView({ block: "nearest" });
    return () => {
      for (const row of rows) row.classList.remove("is-lit");
    };
  }, [hover, selectedObject, model]);

  /* ───────── the way out: סקירה finds the model as it was ───────── */
  const restore = useEffectEvent((on: MapEngine) => {
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
    home();
  });

  useEffect(() => {
    if (!engine) return;
    return () => restore(engine);
  }, [engine]);

  /* ───────── the rail ───────── */
  const map = useMemo<MapView>(
    () => ({ objects, model, trail, now, recent: recent.rows, ledger, placeOf, select, selectProduct }),
    [objects, model, trail, now, recent.rows, ledger, placeOf, select, selectProduct],
  );

  const toToday = () => setAt(null);

  // A menu that opens at the foot of the rail comes into view whole.
  const showMenu = (e: FocusEvent<HTMLElement>) => {
    if (e.target instanceof Element) e.target.closest(".sa-menu")?.scrollIntoView({ block: "nearest" });
  };

  const rail = () => {
    if (editing) return <LayoutPanel editor={editor} model={model} />;
    if (selectedObject) return <ObjectCard map={map} object={selectedObject} hit={selected} past={past?.stock ?? null} onShelf={setSelected} onBack={() => setSelected(null)} />;
    if (tab === "status") return <StatusRail map={map} past={past?.stock ?? null} at={at} />;
    if (tab === "moves") return <MovesRail map={map} at={at} />;
    if (at !== null) return <TodayOnly onToday={toToday} />;
    if (tab === "orders") return <OrdersRail map={map} orderId={orderId} onOrder={setOrderId} />;
    return tab === "count" ? <CountRail map={map} /> : <ValueRail map={map} worth={worth} />;
  };

  const onTab = (value: string) => {
    const next = TAB_VALUES.find((t) => t === value);
    if (!next) return;
    setTab(next);
    setSelected(null);
    peekRow(null);
  };

  const onSearchPick = (product: Product) => {
    if (placeOf(product.id)) selectProduct(product.id);
    else ui.openProduct(product.id);
  };

  const startEditing = () => {
    setAt(null);
    setSelected(null);
    editor.start();
  };

  // One button out of any close view, on the map itself, named for what it leaves.
  const leaveWord = selectedObject ? LEAVE_WORD[selectedObject.kind] : viewMode === "walk" ? "יציאה מהסיור" : null;
  const leave = () => {
    if (selectedObject) setSelected(null);
    else setChosenView("orbit");
  };

  const tabs = TAB_VALUES.map((value) => ({
    value,
    label: TAB_LABEL[value],
    count: value === "orders" && stats.openOrders > 0 ? stats.openOrders : undefined,
  }));

  const placeCount = new Set(model.slots.map((slot) => slot.objectId)).size;
  const sub =
    at !== null ? (
      <>מצב המלאי ב-<span className="sa-num">{fmtDateTime(new Date(at).toISOString())}</span></>
    ) : (
      <><span className="sa-num">{fmtQty(state.products.length)}</span> מוצרים ב-<span className="sa-num">{fmtQty(placeCount)}</span> מיקומים</>
    );

  // The same rows the rail lists under דורש טיפול, so the figure and the list can't disagree.
  const needing = useMemo(() => {
    const states = state.products.map(stockState);
    const faults = state.faults.filter((f) => f.status === "open").length;
    return { count: states.filter((s) => s !== "ok").length + faults, danger: faults > 0 || states.some((s) => s === "out" || s === "short") };
  }, [state.products, state.faults]);

  // A figure is a lens too: pointing at it asks the model where, pressing it opens its list.
  const figureIds = (value: RailTab): readonly string[] => {
    if (value === "orders") return [...new Set(openOrders.flatMap((o) => linesOf(o.id).flatMap((l) => itemsOf(l.product_id).map((item) => item.objectId)))), DISPATCH_ZONE];
    if (value === "value") return worth.places.map((p) => p.object.id);
    return [...[...model.byObject.values()].filter((stock) => stock.worst !== "ok").map((stock) => stock.object.id), ...faultObjects];
  };

  const pointFigure = (value: RailTab | null) => setPeek(value ? { ids: figureIds(value), hit: null, row: null } : null);

  return (
    <div ref={door} className="mh-wh" data-walk={walking || undefined} data-plan={plan || planLeaving || undefined} inert={walking}>
      <header className="mh-wh-head" hidden={selectedObject !== null}>
        <div className="mh-wh-title">
          <h1 className="sa-page-title">מחסן</h1>
          {(layout.editable || (window as unknown as { __edit?: boolean }).__edit /* TEMP */) && !editing && !coarse ? (
            <Button variant="secondary" icon="edit" disabled={at !== null} onClick={startEditing}>עריכת פריסה</Button>
          ) : null}
        </div>
        <p className="sa-page-sub">{sub}</p>

        {at === null && !editing ? (
          <div className="mh-wh-figures">
            <button type="button" className="mh-wh-figure" onClick={() => onTab("status")} onPointerEnter={() => pointFigure("status")} onPointerLeave={() => pointFigure(null)}>
              <span className="mh-label">{needing.count === 0 ? "הכול תקין" : "דורשים טיפול"}</span>
              <Figure className={cx(needing.count === 0 ? "mh-tone-ok" : needing.danger ? "mh-tone-out" : "mh-tone-warn")} text={fmtQty(needing.count)} />
            </button>
            <button type="button" className="mh-wh-figure" onClick={() => onTab("orders")} onPointerEnter={() => pointFigure("orders")} onPointerLeave={() => pointFigure(null)}>
              <span className="mh-label">הזמנות פתוחות</span>
              <Figure text={fmtQty(stats.openOrders)} />
            </button>
            <button type="button" className="mh-wh-figure" onClick={() => onTab("value")} onPointerEnter={() => pointFigure("value")} onPointerLeave={() => pointFigure(null)}>
              <span className="mh-label">{worth.unpriced > 0 ? `במחירון, ${fmtQty(worth.unpriced)} ללא מחיר` : "שווי במחירון"}</span>
              <Figure sign="₪" text={fmtQty(Math.round(worth.total))} />
            </button>
          </div>
        ) : null}
      </header>

      {editing ? <EditBar editor={editor} /> : selectedObject ? null : <Tabs variant="line" tabs={tabs} value={tab} onChange={onTab} />}

      <aside
        ref={railRef}
        className="m3d-rail"
        tabIndex={-1}
        aria-label="פרטי המחסן"
        onFocus={onRailFocus}
        onBlur={() => peekRow(null)}
        onKeyDown={onRailKey}
        onPointerOver={onRailOver}
        onPointerLeave={() => peekRow(null)}
        onClickCapture={() => peekRow(null)}
      >
        {rail()}
      </aside>

      {!selectedObject && !walking && !editing ? <BackHome /> : null}

      {world
        ? createPortal(
            <>
              {tagged ? (
                <div className="mh-wh-tags" data-close={closeView ? "" : undefined}>
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
              {reachEl && reached ? <Reach key={`${reached.objectId}/${reached.level}/${reached.side ?? ""}/${peek ? "peek" : "open"}`} world={world} rail={railRef} row={rowOf} anchor={reachEl} /> : null}
              {failed ? <Notice className="m3d-fail" title="המפה לא זמינה בדפדפן הזה">הרשימה ממשיכה לעבוד</Notice> : null}
              {!failed && !editing ? (
                <div className="m3d-corner">
                  <MapSearch placeOf={placeOf} onPick={onSearchPick} />
                  <div className="m3d-views">
                    {leaveWord ? <Button variant="primary" size="sm" icon="x" onClick={leave}>{leaveWord}</Button> : null}
                    {fullscreen.available ? (
                      <Button variant="secondary" size="sm" className="m3d-fullscreen" onClick={fullscreen.toggle}>{fullscreen.active ? "יציאה ממסך מלא" : "מסך מלא"}</Button>
                    ) : null}
                    <ViewSwitch view={viewMode} walk={!coarse} onView={setChosenView} />
                  </div>
                </div>
              ) : null}
              {viewMode === "walk" && !editing ? <p className="m3d-walkhint">חצים להליכה, גרירה להסתכלות</p> : null}
              {failed || editing ? null : recent.failed ? (
                <div className="m3d-ruler">
                  <span className="m3d-edge">ההיסטוריה לא נטענה</span>
                  <Button variant="link" size="sm" onClick={recent.retry}>ניסיון נוסף</Button>
                </div>
              ) : trail && trail.ticks.length > 0 ? (
                <TimeRuler trail={trail} at={at} onAt={setAt} />
              ) : null}
            </>,
            world,
          )
        : null}
    </div>
  );
}
