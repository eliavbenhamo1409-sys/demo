"use client";

/**
 * מחסן: the model is the page. The same orchestration as src/components/map3d/MapPage.tsx, on the one engine that stands
 * under the whole admin, so arriving here is a move of the camera and nothing loads. The rail stands on the door, the
 * controls and the tags stand in the world, and whatever this page turns on it turns off again on the way out.
 */

import { Suspense, useCallback, useDeferredValue, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactElement, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { labelViews } from "@/components/map3d/label-views";
import { Labels, type LabelView } from "@/components/map3d/Labels";
import { EditBar, LayoutPanel, useLayoutEditor } from "@/components/map3d/LayoutEditor";
import { MapSearch } from "@/components/map3d/MapSearch";
import { ObjectCard } from "@/components/map3d/ObjectCard";
import { StatusRail } from "@/components/map3d/StatusRail";
import { TimeRuler } from "@/components/map3d/TimeRuler";
import { useCoarsePointer, useFullscreen, useNarrow } from "@/components/map3d/use-device";
import { useMovementHistory } from "@/components/map3d/use-history";
import type { MapView } from "@/components/map3d/view";
import { ViewSwitch } from "@/components/map3d/ViewSwitch";
import { STATE_NUM } from "@/components/map3d/words";
import { worthOf } from "@/components/map3d/worth";
import "@/components/map3d/map3d.css";
import "@/components/map3d/map3d-aluminium.css";
import { Button, cx, Notice } from "@/components/ui";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { DISPATCH_ZONE, levelY } from "@/lib/map3d/layout";
import { blockAt, buildMapModel, emptySpot } from "@/lib/map3d/model";
import { placeKey, resolvePlace } from "@/lib/map3d/place";
import { useShelves } from "@/lib/map3d/shelves";
import { buildTrail, qtyAt, TRAIL_WINDOW, type PastQty } from "@/lib/map3d/trail";
import type { Insets, LabelAnchor, MapEngine, MapObject, MapObjectKind, MapRoute, PickHit, ViewMode } from "@/lib/map3d/types";
import { isTempId, stockState, useData, type Movement, type Product } from "@/lib/store";
import { Figure } from "../Figure";
import { BackHome } from "../twin/BackHome";
import { useTwin } from "../twin/Twin";
import { aimOf, litRows, pointOf, productAim, ROW, type Aim, type LensData } from "../warehouse/lens";
import { Reach } from "../warehouse/Reach";

/** The figures over the list. Pointing at one asks the model where. */
type Lens = "needing" | "orders" | "value";

const LEAVE_WORD: Record<MapObjectKind, string> = {
  rack: "יציאה מהמתקן",
  floor: "יציאה מהאזור",
  machine: "יציאה מהמכונה",
  zone: "יציאה מהאזור",
};

const CLOCK_MS = 60_000;
const MARK_MARGIN = 0.45;
/** An unknown quantity draws as an empty shelf, so this one word stays on the model at any date. */
const PAST_UNKNOWN = "לא ידוע";
const FAULT_WORD = "תקלה";
/** A movement's way across the floor is drawn for a row you stop on, not for each row the pointer crosses. */
const TRACE_DWELL_MS = 140;

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The rows the arrow keys walk through. */
const WALKABLE = "button.m3d-line:not(:disabled), button.m3d-shelf, .m3d-row > .sa-attention-open";

/** The walk's letters. The arrows are no search. */
const WALK_LETTERS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

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

/** Close up, products that share a shelf stack their tags over its middle, because side by side along it they cover each other. */
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
    const middle = row.reduce((sum, view) => sum + (view.at?.x ?? 0), 0) / row.length;
    row.forEach((view, i) => {
      if (view.at) moved.set(view.id, { ...view, at: { ...view.at, x: middle, y: view.at.y + i * step } });
    });
  }
  return views.map((view) => moved.get(view.id) ?? view);
}

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
  const { engine, failed, layout, model, flashes, world, placeOf, itemsOf, listen, setPageRoutes, setPastSlots, setAnchors, aimProduct, home } = useTwin();
  const editor = useLayoutEditor(layout);
  const { rows: shelfRows } = useShelves();
  const params = useSearchParams();
  const narrow = useNarrow();
  const coarse = useCoarsePointer();

  const editing = editor.draft !== null;
  const objects = editor.draft ?? layout.objects;

  const railRef = useRef<HTMLElement>(null);
  const stage = useMemo(() => ({ current: world }), [world]);
  const fullscreen = useFullscreen(stage);

  const [selected, setSelected] = useState<PickHit | null>(null);
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


  /* ───────── the ledger, as the map reads it ───────── */
  const worth = useMemo(() => worthOf(model), [model]);

  /* ───────── history: never reaches the live view ───────── */
  const [trailStart] = useState(() => Date.now() - TRAIL_WINDOW);
  const [clock, setClock] = useState(() => Date.now());
  const recent = useMovementHistory(trailStart, true);
  const ledger = useMovementHistory(null, selected !== null);

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
  const emphasis = useMemo(() => {
    if (editing) return null;
    if (pointed) return new Set(pointed.ids);
    return targetId ? new Set([targetId]) : null;
  }, [editing, pointed, targetId]);

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
      const [left, right] = [o.x - o.w / 2 - MARK_MARGIN, o.x + o.w / 2 + MARK_MARGIN];
      const front = o.z + o.d / 2 + MARK_MARGIN;
      lines.push({ points: [[left, front], [right, front]], tone: worst === "low" ? "warn" : "out" });
    }
    return lines;
  }, [at, editing, targetId, model]);

  // Null would hand the floor back to Twin's own marks, which don't know this page's date.
  useEffect(() => {
    setPageRoutes(marks);
  }, [marks, setPageRoutes]);

  const fly = useEffectEvent((id: string | null) => {
    if (viewMode === "walk" || left.current) return;
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

  const drawerPlace = drawerAim?.hit?.objectId ?? null;
  const drawerShelf = viewMode === "walk" || narrow ? null : drawerPlace;

  // A product's shelf stands between the door and the drawer.
  const toDrawer = useEffectEvent((place: string) => {
    const panel = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--panel"));
    engine?.setInsets({ ...NO_INSETS, right: doorWidth(world), left: panel });
    engine?.flyTo({ objectId: place, shelf: true });
  });

  const refit = useEffectEvent(() => {
    if (wide) engine?.setInsets(NO_INSETS);
    if (drawerShelf) toDrawer(drawerShelf);
    else fly(flown.current);
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

  useEffect(() => {
    if (!engine || !drawerShelf) return;
    toDrawer(drawerShelf);
    return () => {
      engine.setInsets({ ...NO_INSETS, right: doorWidth(world) });
      queueMicrotask(() => fly(flown.current));
    };
  }, [engine, world, drawerShelf]);

  // A moved rack is work, and the rail stands right beside it: the way out asks the same question as ביטול.
  const askToLeave = useEffectEvent(() => editor.leave());
  useEffect(() => {
    if (!editor.dirty) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".mh-rail a, .mh-bar a")) return;
      e.preventDefault();
      e.stopPropagation();
      askToLeave();
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [editor.dirty]);

  /* ───────── keys ───────── */
  // The row that opened a card is gone with the list, so the keyboard carries on from the rail, and closing the card lands
  // back on that row, by its place in the list. Never on arrival: Tab starts a new page at its top, not halfway down the list.
  const cardWas = useRef(targetId);
  const openedRow = useRef(-1);
  useEffect(() => {
    const was = cardWas.current;
    cardWas.current = targetId;
    const rail = railRef.current;
    const lost = document.activeElement === document.body || document.activeElement === rail;
    if (was === targetId || !rail || !lost) return;
    const back = targetId === null ? rail.querySelectorAll<HTMLElement>(WALKABLE)[openedRow.current] : undefined;
    if (targetId === null) openedRow.current = -1;
    if (back) back.focus();
    else rail.focus({ preventScroll: true });
  }, [targetId]);

  const onEscape = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || ui.panel) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (editing) editor.setEditId(null);
    else if (selected) setSelected(null);
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
    const views = labelViews({ objects, model, past: past?.stock ?? null, money: false, faults: faultObjects, open: closeView, shelf: hover ?? pointed?.hit ?? null });
    if (!past) return closeView ? stackedTags(views, closeView) : oneTagEach(views, faultObjects);
    // Thirty figures on stems would hide what they stand on. They wait for a pointer, and the rail lists them all.
    const calm = (view: LabelView): LabelView => {
      if (!view.text) return view;
      return view.text === PAST_UNKNOWN ? { ...view, quiet: true } : { ...view, quiet: true, more: view.text, text: undefined };
    };
    return views.map(calm);
  }, [objects, model, past, faultObjects, closeView, hover, pointed]);

  // Labels writes the engine's anchors itself. Through this they go by Twin, beside the point the line ends at.
  const [tagAnchors, setTagAnchors] = useState<readonly LabelAnchor[]>([]);
  const tagged = useMemo<MapEngine | null>(() => engine && { ...engine, setLabels: setTagAnchors }, [engine]);

  /* ───────── the lens: a row points at the model, and the model points back ───────── */
  // The shelf that stands open on the door stays tied to its line; a row under the pointer borrows it.
  const [reachEl, setReachEl] = useState<HTMLElement | null>(null);
  const reached = peek ? peek.hit : closeView && selectedBlock ? selection : null;
  const point = useMemo(() => (reached ? pointOf(reached, objects) : null), [reached, objects]);
  const peekedRow = peek ? peek.row : undefined;
  const rowOf = useCallback(() => (peekedRow === undefined ? (railRef.current?.querySelector(".m3d-shelfblock.is-open > .m3d-shelf") ?? null) : peekedRow), [peekedRow]);
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
    const on = rows.findIndex((row) => row === e.target);
    if (on < 0 && e.target !== e.currentTarget) return;
    e.preventDefault();
    rows[e.key === "ArrowDown" ? on + 1 : Math.max(on - 1, 0)]?.focus();
  };

  // The search walks the model too: the result you stand on lights its shelf before it is picked.
  const peekResult = (e: SyntheticEvent<HTMLElement>) => {
    const item = e.target instanceof Element && e.type === "pointerover" ? e.target.closest(".sa-menu-item") : e.currentTarget.querySelector('.m3d-results [aria-selected="true"]');
    if (!item && e.type === "pointerover") return;
    const code = item?.querySelector(".app-resultSub bdi")?.textContent;
    const product = code ? state.products.find((p) => p.sku === code) : undefined;
    const aim = product ? productAim(product.id, itemsOf, model) : null;
    setPeek(aim ? { ...aim, row: null } : null);
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
    home();
  });

  useEffect(() => {
    if (!engine) return;
    left.current = false;
    return () => restore(engine);
  }, [engine]);

  /* ───────── the rail ───────── */
  // A new list starts at its head, before a card scrolls to the shelf it was opened on.
  useLayoutEffect(() => {
    railRef.current?.scrollTo({ top: 0 });
  }, [targetId]);

  const map = useMemo<MapView>(
    () => ({ objects, model, trail, now, recent: recent.rows, ledger, placeOf, select, selectProduct }),
    [objects, model, trail, now, recent.rows, ledger, placeOf, select, selectProduct],
  );

  // A menu that opens at the foot of the rail comes into view whole.
  const showMenu = (e: FocusEvent<HTMLElement>) => {
    if (e.target instanceof Element) e.target.closest(".sa-menu")?.scrollIntoView({ block: "nearest" });
  };

  const rail = () => {
    if (editing) return <LayoutPanel editor={editor} model={model} />;
    if (selectedObject) return <ObjectCard map={map} object={selectedObject} hit={selected} past={past?.stock ?? null} onShelf={setSelected} onBack={() => setSelected(null)} />;
    return <StatusRail map={map} past={past?.stock ?? null} at={at} />;
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

  const placeCount = new Set(model.slots.map((slot) => slot.objectId)).size;
  const sub = at !== null ? "מצב המלאי ב-" : <>איפה כל דבר עומד · <span className="sa-num">{fmtQty(state.products.length)}</span> מוצרים ב-<span className="sa-num">{fmtQty(placeCount)}</span> מיקומים</>;

  // The same rows the rail lists under דורש טיפול, so the figure and the list can't disagree.
  const needing = useMemo(() => {
    const states = state.products.map(stockState);
    const faults = state.faults.filter((f) => f.status === "open").length;
    return { count: states.filter((s) => s !== "ok").length + faults, danger: faults > 0 || states.some((s) => s === "out" || s === "short") };
  }, [state.products, state.faults]);

  // A figure is a lens too: pointing at it asks the model where.
  const figureIds = (value: Lens): readonly string[] => {
    if (value === "orders") return [...new Set(openOrders.flatMap((o) => linesOf(o.id).flatMap((l) => itemsOf(l.product_id).map((item) => item.objectId)))), DISPATCH_ZONE];
    if (value === "value") return worth.places.map((p) => p.object.id);
    return [...[...model.byObject.values()].filter((stock) => stock.worst !== "ok").map((stock) => stock.object.id), ...faultObjects];
  };

  const pointFigure = (value: Lens | null) => setPeek(value ? { ids: figureIds(value), hit: null, row: null } : null);

  // The list stands worst first, so what needs a hand is at its head.
  const toNeeding = () => {
    setSelected(null);
    railRef.current?.scrollTo({ top: 0 });
    railRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="mh-wh" data-walk={walking || undefined} inert={walking}>
      {selectedObject ? <h1 className="sa-sr">מחסן</h1> : null}
      <header className="mh-wh-head" hidden={selectedObject !== null}>
        <div className="mh-wh-title">
          <h1 className="sa-page-title">מחסן</h1>
          {layout.editable && !editing && !coarse ? (
            <Button variant="secondary" icon="edit" disabled={at !== null} onClick={startEditing}>עריכת פריסה</Button>
          ) : null}
        </div>
        <p className="sa-page-sub">{sub}</p>

        {at === null && !editing ? (
          <div className="mh-wh-figures">
            <button type="button" className="mh-wh-figure" onClick={toNeeding} onPointerEnter={() => pointFigure("needing")} onPointerLeave={() => pointFigure(null)} onFocus={() => pointFigure("needing")} onBlur={() => pointFigure(null)}>
              <span className="mh-label">{needing.count === 0 ? "הכול תקין" : "דורשים טיפול"}</span>
              <Figure className={cx(needing.count === 0 ? "mh-tone-ok" : needing.danger ? "mh-tone-out" : "mh-tone-warn")} text={fmtQty(needing.count)} />
            </button>
            <Link href="/orders" className="mh-wh-figure" onPointerEnter={() => pointFigure("orders")} onPointerLeave={() => pointFigure(null)} onFocus={() => pointFigure("orders")} onBlur={() => pointFigure(null)}>
              <span className="mh-label">הזמנות פתוחות</span>
              <Figure text={fmtQty(stats.openOrders)} />
            </Link>
            <div className="mh-wh-figure is-still" onPointerEnter={() => pointFigure("value")} onPointerLeave={() => pointFigure(null)}>
              <span className="mh-label">{worth.unpriced > 0 ? `במחירון, ${fmtQty(worth.unpriced)} ללא מחיר` : "שווי במחירון"}</span>
              <Figure sign="₪" text={fmtQty(Math.round(worth.total))} />
            </div>
          </div>
        ) : null}

        {/* A date is the one figure of the past, and its wheels turn as the ruler is dragged. */}
        {at !== null ? <Figure className="mh-wh-when" text={fmtDateTime(new Date(at).toISOString())} /> : null}
      </header>

      {editing ? <EditBar editor={editor} /> : null}

      <section
        ref={railRef}
        className="m3d-rail"
        tabIndex={-1}
        aria-label={selectedObject || editing ? "פרטי המחסן" : "המלאי לפי מקום"}
        onFocus={onRailFocus}
        onBlur={() => peekRow(null)}
        onKeyDown={onRailKey}
        onPointerOver={onRailOver}
        onPointerLeave={() => peekRow(null)}
        onClickCapture={(e) => {
          peekRow(null);
          const row = e.target instanceof Element ? e.target.closest(WALKABLE) : null;
          if (row && !selectedObject) openedRow.current = [...e.currentTarget.querySelectorAll(WALKABLE)].indexOf(row);
        }}
      >
        {rail()}
      </section>

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
                <div className="m3d-corner" onKeyUp={peekResult} onPointerOver={peekResult} onPointerLeave={() => setPeek(null)} onBlur={() => setPeek(null)} onClickCapture={() => setPeek(null)}>
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
