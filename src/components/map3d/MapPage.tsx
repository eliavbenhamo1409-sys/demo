"use client";

import { useCallback, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState, type FocusEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { Button, cx, Notice, PageHead, Tabs } from "@/components/ui";
import { fmtDateTime, fmtPrice, fmtQty } from "@/lib/format";
import { DISPATCH_ZONE } from "@/lib/map3d/layout";
import { blockAt, buildMapModel, emptySpot, type MapItem } from "@/lib/map3d/model";
import { placeKey, resolvePlace } from "@/lib/map3d/place";
import { routeBetween } from "@/lib/map3d/route";
import { useShelves } from "@/lib/map3d/shelves";
import { buildTrail, qtyAt, TRAIL_WINDOW, type PastQty } from "@/lib/map3d/trail";
import type { MapObject, MapObjectKind, MapRoute, PickHit, ViewMode } from "@/lib/map3d/types";
import { useLayout } from "@/lib/map3d/use-layout";
import { isTempId, stockState, useData, type Product } from "@/lib/store";
import { CountRail } from "./CountRail";
import { labelViews } from "./label-views";
import { Labels } from "./Labels";
import { EditBar, LayoutPanel, useLayoutEditor } from "./LayoutEditor";
import { MapSearch } from "./MapSearch";
import { ObjectCard } from "./ObjectCard";
import { OrdersRail } from "./OrdersRail";
import { TodayOnly } from "./parts";
import { MovesRail, StatusRail } from "./StatusRail";
import { TimeRuler } from "./TimeRuler";
import { useCoarsePointer, useFullscreen, useNarrow, useReducedMotion } from "./use-device";
import { useMapEngine } from "./use-engine";
import { useMovementHistory } from "./use-history";
import { useLiveStock } from "./use-live";
import { ValueRail } from "./ValueRail";
import type { MapView } from "./view";
import { ViewSwitch } from "./ViewSwitch";
import { worthOf } from "./worth";
import "./map3d.css";
import "./map3d-aluminium.css";

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

/** The object a link names: its code, or a place as products.location writes it. */
function linkedHit(text: string, objects: readonly MapObject[]): PickHit | null {
  const key = placeKey(text);
  const object = objects.find((o) => placeKey(o.id) === key);
  return object ? { objectId: object.id, level: null } : resolvePlace(text, objects);
}

export function MapPage() {
  const { state, stats, linesOf } = useData();
  const ui = useUi();
  const layout = useLayout();
  const editor = useLayoutEditor(layout);
  const { rows: shelfRows } = useShelves();
  const params = useSearchParams();
  const narrow = useNarrow();
  const coarse = useCoarsePointer();
  const reducedMotion = useReducedMotion();

  const editing = editor.draft !== null;
  const objects = editor.draft ?? layout.objects;

  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(stage);

  const [tab, setTab] = useState<RailTab>("status");
  const [selected, setSelected] = useState<PickHit | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [chosenView, setChosenView] = useState<ViewMode | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [hover, setHover] = useState<PickHit | null>(null);
  const [linkSeen, setLinkSeen] = useState<string | null>(null);

  const viewMode = chosenView ?? (narrow ? "top" : "orbit");

  /* ───────── the ledger, as the map reads it ───────── */
  const model = useMemo(() => buildMapModel(state.products, objects, shelfRows), [state.products, objects, shelfRows]);
  const worth = useMemo(() => worthOf(model), [model]);

  // A product on several shelves answers with the one that holds the most of it.
  const places = useMemo(() => {
    const byProduct = new Map<string, MapItem>();
    for (const stock of model.byObject.values()) {
      for (const item of stock.items) {
        const known = byProduct.get(item.product.id);
        if (!known || item.qty > known.qty) byProduct.set(item.product.id, item);
      }
    }
    return byProduct;
  }, [model]);
  const placeOf = useCallback((productId: string) => places.get(productId)?.objectId ?? null, [places]);

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

  /* ───────── selection ───────── */
  const selectedObject = (selected && objects.find((o) => o.id === selected.objectId)) || null;
  const targetId = selectedObject?.id ?? null;

  const link = params.get("at");
  const linked = useMemo(() => (link ? linkedHit(link, objects) : null), [link, objects]);
  if (link !== linkSeen && (linked || !link)) {
    setLinkSeen(link);
    if (linked && linked.objectId !== targetId) setSelected(linked);
  }

  const select = useCallback(
    (objectId: string, shelf?: PickHit) => {
      setSelected(shelf ?? { objectId, level: null });
      if (narrow) stage.current?.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
    },
    [narrow, reducedMotion],
  );

  /** Goes to the shelf that holds most of a product. */
  const selectProduct = useCallback(
    (productId: string) => {
      const item = places.get(productId);
      if (item) select(item.objectId, { objectId: item.objectId, level: item.level, side: item.side });
    },
    [places, select],
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

  const { engine, failed } = useMapEngine(host, {
    onPick: pickHit,
    onHover: setHover,
    onDragObject: (id, x, z) => {
      editor.patch(id, { x, z });
    },
  });

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

  const valueLens = tab === "value" && at === null;

  const footprints = useMemo(() => {
    if (!valueLens) return null;
    const top = worth.places[0]?.value ?? 1;
    return worth.places.map((p) => ({ objectId: p.object.id, strength: p.value / top }));
  }, [valueLens, worth.places]);

  const emphasis = useMemo(() => {
    if (editing) return null;
    if (targetId) return new Set([targetId]);
    if (orderPlaces) return new Set([...orderPlaces, DISPATCH_ZONE]);
    return valueLens ? new Set(worth.places.map((p) => p.object.id)) : null;
  }, [editing, targetId, orderPlaces, valueLens, worth.places]);

  // What the rule on the map follows: a whole block of a product, however it was reached.
  const selectedBlock = useMemo(() => (selected ? blockAt(model, selected) : null), [selected, model]);
  const selection = useMemo<PickHit | null>(() => {
    if (editing) return editor.editId ? { objectId: editor.editId, level: null } : null;
    if (!selectedBlock) return selected && selectedObject ? emptySpot(selected, selectedObject, model) : selected;
    const { objectId, level, side, through } = selectedBlock;
    return { objectId, level, side, through: through ?? undefined };
  }, [editing, editor.editId, selected, selectedObject, selectedBlock, model]);

  useEffect(() => {
    engine?.setLayout(objects);
  }, [engine, objects]);

  const flashes = useLiveStock({ engine, slots: model.slots, pastSlots: past?.slots ?? null, objects, placeOf });

  // The forklift stands where goods were last loaded: the latest movement that really took stock on or off a shelf.
  const lastLoaded = useMemo(() => {
    const rows = at === null ? state.movements : recent.rows.filter((m) => Date.parse(m.created_at) <= at);
    for (const m of rows) {
      if (isTempId(m.id) || (m.type !== "in" && m.type !== "out")) continue;
      const place = resolvePlace(m.place, objects)?.objectId ?? placeOf(m.product_id);
      if (place) return place;
    }
    return null;
  }, [at, state.movements, recent.rows, placeOf, objects]);

  const forkliftSet = useRef(false);
  useEffect(() => {
    if (!engine) return;
    engine.setForklift(lastLoaded, { animate: forkliftSet.current && at === null });
    forkliftSet.current = true;
  }, [engine, lastLoaded, at]);

  useEffect(() => {
    engine?.setEditing(editing);
    if (!editing) engine?.setView(viewMode);
  }, [engine, editing, viewMode]);

  useEffect(() => {
    engine?.setSelection(selection);
  }, [engine, selection]);

  useEffect(() => {
    engine?.setEmphasis(emphasis);
  }, [engine, emphasis]);

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

  useEffect(() => {
    engine?.setRoutes([...routes, ...marks]);
  }, [engine, routes, marks]);

  const fly = useEffectEvent((id: string | null) => {
    if (viewMode === "walk") return;
    const object = objects.find((o) => o.id === id);
    engine?.flyTo(object ? { objectId: object.id, shelf: object.kind === "rack" && viewMode !== "top" } : null);
  });

  const flown = useRef<string | null>(null);
  useEffect(() => {
    if (!engine || flown.current === targetId) return;
    flown.current = targetId;
    fly(targetId);
  }, [engine, targetId]);

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
    else setOrderId(null);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onEscape(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
  const labels = useMemo(
    () => labelViews({ objects, model, past: past?.stock ?? null, money: valueLens, faults: faultObjects, open: closeView, shelf: hover }),
    [objects, model, past, valueLens, faultObjects, closeView, hover],
  );

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
      <>איפה כל דבר עומד · <span className="sa-num">{fmtQty(state.products.length)}</span> מוצרים ב-<span className="sa-num">{fmtQty(placeCount)}</span> מיקומים</>
    );

  // The same rows the rail lists under דורש טיפול, so the figure and the list can't disagree.
  const needing = useMemo(() => {
    const states = state.products.map(stockState);
    const faults = state.faults.filter((f) => f.status === "open").length;
    return { count: states.filter((s) => s !== "ok").length + faults, danger: faults > 0 || states.some((s) => s === "out" || s === "short") };
  }, [state.products, state.faults]);

  return (
    <div className="sa-page m3d-page">
      <div className="m3d-side">
        <PageHead
          title="3D"
          sub={sub}
          actions={
            layout.editable && !editing && !coarse ? (
              <Button variant="secondary" icon="edit" disabled={at !== null} onClick={startEditing}>עריכת פריסה</Button>
            ) : undefined
          }
        />

        {at === null ? (
          <dl className="m3d-summary">
            <div>
              <dd className={cx(needing.count === 0 ? "m3d-num-good" : needing.danger ? "m3d-num-out" : "m3d-num-low")}>{fmtQty(needing.count)}</dd>
              <dt>{needing.count === 0 ? "הכול תקין" : "דורשים טיפול"}</dt>
            </div>
            <div>
              <dd>{fmtQty(stats.openOrders)}</dd>
              <dt>הזמנות פתוחות</dt>
            </div>
            <div>
              <dd>{fmtPrice(worth.total)}</dd>
              <dt>{worth.unpriced > 0 ? `במחירון, ${fmtQty(worth.unpriced)} ללא מחיר` : "שווי במחירון"}</dt>
            </div>
          </dl>
        ) : null}

        {editing ? (
          <EditBar editor={editor} />
        ) : (
          <Tabs tabs={tabs} value={tab} onChange={onTab} />
        )}

        <aside ref={railRef} className="m3d-rail" tabIndex={-1} aria-label="פרטי המחסן" onFocus={showMenu}>{rail()}</aside>
      </div>

      <div ref={stage} className="m3d-stage">
        <div className="m3d-view">
          <div ref={host} className="m3d-canvas" role="img" aria-label="מפת המחסן" />
          {engine ? (
            <Labels
              engine={engine}
              objects={objects}
              views={labels}
              flashes={flashes}
              selectedId={selection?.objectId ?? null}
              selectedKey={selectedBlock?.key ?? null}
              hoverId={hover?.objectId ?? null}
              emphasis={emphasis}
              plan={editing || viewMode === "top"}
              onPick={pickHit}
            />
          ) : null}
          {failed ? (
            <Notice className="m3d-fail" title="המפה לא זמינה בדפדפן הזה">הרשימה ממשיכה לעבוד</Notice>
          ) : null}
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
        </div>
        <div className="m3d-rulerslot">
          {failed || editing ? null : recent.failed ? (
            <div className="m3d-ruler">
              <span className="m3d-edge">ההיסטוריה לא נטענה</span>
              <Button variant="link" size="sm" onClick={recent.retry}>ניסיון נוסף</Button>
            </div>
          ) : trail && trail.ticks.length > 0 ? (
            <TimeRuler trail={trail} at={at} onAt={setAt} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
