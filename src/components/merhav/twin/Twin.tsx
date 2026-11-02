"use client";

/**
 * The one model under the whole admin. It is created once, the first time a page shows it, and lives until the style
 * changes, so going from page to page never rebuilds it: the door slides and the same model re-centres in what is left.
 *
 * Everything goes through the engine's public contract (src/lib/map3d/types.ts): products.qty stays the only total, the
 * stock drawn is the ledger, and only a new movement id moves anything. Pages read this through useTwin(): they point
 * at a product or a place and the model answers. What a page leaves on, it clears on the way out.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { LabelFlash } from "@/components/map3d/Labels";
import { useMapEngine } from "@/components/map3d/use-engine";
import { useLiveStock } from "@/components/map3d/use-live";
import { buildMapModel, type MapItem, type MapModel } from "@/lib/map3d/model";
import { resolvePlace } from "@/lib/map3d/place";
import { useShelves } from "@/lib/map3d/shelves";
import { shelfAnchor } from "@/lib/map3d/layout";
import type { Insets, LabelAnchor, MapEngine, MapEngineEvents, MapObject, MapRoute, PickHit, StockSlot } from "@/lib/map3d/types";
import { useLayout, type Layout } from "@/lib/map3d/use-layout";
import { isTempId, useData } from "@/lib/store";

/** Where the door stands on a page. open: tucked into the rail, the model has the stage. dock: the model keeps a third.
 *  side: a narrow rail of content beside a full model. closed: the door covers the model. */
export type Door = "open" | "dock" | "side" | "closed";

interface Handlers {
  onPick?: MapEngineEvents["onPick"];
  onHover?: MapEngineEvents["onHover"];
  onDragObject?: MapEngineEvents["onDragObject"];
}

export interface Twin {
  engine: MapEngine | null;
  failed: boolean;
  layout: Layout;
  objects: readonly MapObject[];
  model: MapModel;
  flashes: ReadonlyMap<string, LabelFlash>;
  /** The node over the canvas, for what a page anchors to the model. */
  world: HTMLDivElement | null;
  /** The place that holds the most of each product. */
  placeOf: (productId: string) => string | null;
  /** Every place a product stands in. */
  itemsOf: (productId: string) => readonly MapItem[];
  /** The model holds these and lets the rest recede. Null: everything back. */
  spotObjects: (ids: readonly string[] | null, hit?: PickHit | null) => void;
  /** The same for a product, wherever it stands. */
  spotProduct: (productId: string | null) => void;
  /** Takes the model's clicks and hovers for this page. Returns the way to give them back. */
  listen: (handlers: Handlers) => () => void;
  /** A page draws its own lines and marks, and null hands the floor back. */
  setPageRoutes: (routes: readonly MapRoute[] | null) => void;
  /** A date on screen: what the shelves held then. */
  setPastSlots: (slots: readonly StockSlot[] | null) => void;
  /** Back to the view of the whole floor. */
  home: () => void;
  /** Draws the line from a point on screen to where a product stands. Null: no line. */
  aimProduct: (productId: string | null, from?: { x: number; y: number }) => void;
  /** Anchors that the page's tags add to the model; the aim point joins them. */
  setAnchors: (anchors: readonly LabelAnchor[]) => void;
  aimEl: HTMLElement | null;
  /** Where the line leaves the plate. */
  aimFrom: { current: { x: number; y: number } | null };
  aimed: string | null;
}

const TwinContext = createContext<Twin | null>(null);

export function useTwin(): Twin {
  const twin = useContext(TwinContext);
  if (!twin) throw new Error("useTwin must be used inside <TwinProvider>");
  return twin;
}

/** One line on the floor at the front of what needs a hand: where, before anything is read. Never a box. */
const MARK_MARGIN = 0.45;

const NO_ITEMS: readonly MapItem[] = [];

/** Created on the first page that shows the model, then kept: leaving this mounted is what makes a page turn seamless. */
function EngineHost({ host, events, onChange }: { host: RefObject<HTMLDivElement | null>; events: Required<MapEngineEvents>; onChange: (engine: MapEngine | null, failed: boolean) => void }): ReactElement {
  const { engine, failed } = useMapEngine(host, events);
  useEffect(() => onChange(engine, failed), [engine, failed, onChange]);
  return <div ref={host} className="mh-twin" role="img" aria-label="מודל המחסן" />;
}

interface ProviderProps {
  door: Door;
  /** Pixels of the world that the page's own content keeps clear on the hero. */
  children: (world: ReactNode) => ReactNode;
}

export function TwinProvider({ door, children }: ProviderProps): ReactElement {
  const { state } = useData();
  const layout = useLayout();
  const { rows: shelfRows } = useShelves();
  const router = useRouter();
  const objects = layout.objects;

  const host = useRef<HTMLDivElement>(null);
  const [world, setWorld] = useState<HTMLDivElement | null>(null);
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const handlers = useRef<Handlers | null>(null);

  // The model is built the first time it would be seen.
  const [started, setStarted] = useState(door !== "closed");
  if (door !== "closed" && !started) setStarted(true);

  /* ───────── the ledger, as the model reads it ───────── */
  const model = useMemo(() => buildMapModel(state.products, objects, shelfRows), [state.products, objects, shelfRows]);

  const byProduct = useMemo(() => {
    const map = new Map<string, MapItem[]>();
    for (const stock of model.byObject.values()) {
      for (const item of stock.items) {
        const list = map.get(item.product.id);
        if (list) list.push(item);
        else map.set(item.product.id, [item]);
      }
    }
    for (const list of map.values()) list.sort((a, b) => b.qty - a.qty);
    return map;
  }, [model]);

  const placeOf = useCallback((productId: string) => byProduct.get(productId)?.[0]?.objectId ?? null, [byProduct]);
  const itemsOf = useCallback((productId: string) => byProduct.get(productId) ?? NO_ITEMS, [byProduct]);

  const [pastSlots, setPastSlots] = useState<readonly StockSlot[] | null>(null);
  const flashes = useLiveStock({ engine, slots: model.slots, pastSlots, objects, placeOf });

  /* ───────── what is always true of the floor ───────── */
  useEffect(() => {
    engine?.setLayout(objects);
  }, [engine, objects]);

  // The forklift stands where goods were last loaded.
  const lastLoaded = useMemo(() => {
    for (const m of state.movements) {
      if (isTempId(m.id) || (m.type !== "in" && m.type !== "out")) continue;
      const place = resolvePlace(m.place, objects)?.objectId ?? placeOf(m.product_id);
      if (place) return place;
    }
    return null;
  }, [state.movements, placeOf, objects]);

  const forkliftSet = useRef(false);
  useEffect(() => {
    if (!engine) return;
    engine.setForklift(lastLoaded, { animate: forkliftSet.current });
    forkliftSet.current = true;
  }, [engine, lastLoaded]);

  const [pageRoutes, setPageRoutes] = useState<readonly MapRoute[] | null>(null);
  const marks = useMemo<MapRoute[]>(() => {
    const lines: MapRoute[] = [];
    for (const { object: o, worst } of model.byObject.values()) {
      if (worst === "ok") continue;
      const [left, right] = [o.x - o.w / 2 - MARK_MARGIN, o.x + o.w / 2 + MARK_MARGIN];
      const front = o.z + o.d / 2 + MARK_MARGIN;
      lines.push({ points: [[left, front], [right, front]], tone: worst === "low" ? "warn" : "out" });
    }
    return lines;
  }, [model]);

  useEffect(() => {
    engine?.setRoutes(pageRoutes ?? marks);
  }, [engine, pageRoutes, marks]);

  /* ───────── pointing at things ───────── */
  const spotObjects = useCallback(
    (ids: readonly string[] | null, hit: PickHit | null = null) => {
      engine?.setEmphasis(ids && ids.length > 0 ? new Set(ids) : null);
      engine?.setSelection(hit);
    },
    [engine],
  );

  const spotProduct = useCallback(
    (productId: string | null) => {
      const items = productId ? itemsOf(productId) : NO_ITEMS;
      const first = items[0];
      spotObjects(
        items.length > 0 ? items.map((item) => item.objectId) : null,
        first ? { objectId: first.objectId, level: first.level, side: first.side } : null,
      );
    },
    [itemsOf, spotObjects],
  );

  const listen = useCallback((next: Handlers) => {
    handlers.current = next;
    return () => {
      if (handlers.current === next) handlers.current = null;
    };
  }, []);

  const home = useCallback(() => engine?.flyTo(null), [engine]);

  /* ───────── the line from the plate to the shelf ───────── */
  const [aimEl, setAimEl] = useState<HTMLElement | null>(null);
  const [aimed, setAimed] = useState<string | null>(null);
  const aimFrom = useRef<{ x: number; y: number } | null>(null);
  const aimPoint = useRef<{ x: number; y: number; z: number } | null>(null);
  const anchors = useRef<readonly LabelAnchor[]>([]);

  const writeAnchors = useCallback(() => {
    if (!engine) return;
    const point = aimPoint.current;
    engine.setLabels(point && aimEl ? [...anchors.current, { el: aimEl, ...point }] : anchors.current);
  }, [engine, aimEl]);

  const setAnchors = useCallback(
    (next: readonly LabelAnchor[]) => {
      anchors.current = next;
      writeAnchors();
    },
    [writeAnchors],
  );

  const aimProduct = useCallback(
    (productId: string | null, from?: { x: number; y: number }) => {
      const item = productId ? itemsOf(productId)[0] : undefined;
      const object = item ? objects.find((o) => o.id === item.objectId) : undefined;
      if (!item || !object) {
        aimPoint.current = null;
        setAimed(null);
        writeAnchors();
        return;
      }
      aimPoint.current = item.level === null ? { x: object.x, y: object.h, z: object.z } : shelfAnchor(object, item.level, item.side);
      aimFrom.current = from ?? null;
      setAimed(productId);
      writeAnchors();
    },
    [itemsOf, objects, writeAnchors],
  );

  const events = useMemo<Required<MapEngineEvents>>(
    () => ({
      onPick: (hit) => {
        const custom = handlers.current?.onPick;
        if (custom) custom(hit);
        else if (hit) router.push(`/3d?at=${encodeURIComponent(hit.objectId)}`);
      },
      onHover: (hit) => handlers.current?.onHover?.(hit),
      onDragObject: (id, x, z, done) => handlers.current?.onDragObject?.(id, x, z, done),
    }),
    [router],
  );

  const onChange = useCallback((next: MapEngine | null, broke: boolean) => {
    setEngine(next);
    setFailed(broke);
  }, []);

  /* ───────── the door decides what is left of the stage ───────── */
  const gauge = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!engine || !world) return;
    const widthOf = (token: string) => {
      const probe = gauge.current;
      if (!probe) return 0;
      probe.style.width = `var(${token})`;
      return probe.offsetWidth;
    };
    const place = () => {
      const free = world.clientWidth;
      if (free === 0) return;
      const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
      if (door === "open") {
        insets.right = widthOf("--mh-hero-right");
        insets.bottom = widthOf("--mh-hero-bottom");
        insets.left = -widthOf("--mh-hero-bleed");
      } else if (door === "dock") insets.right = free - widthOf("--mh-dock");
      else if (door === "side") insets.right = widthOf("--mh-side");
      engine.setInsets(insets);
      engine.flyTo(null);
      if (document.visibilityState === "hidden") engine.renderNow();
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [engine, world, door]);

  const twin = useMemo<Twin>(
    () => ({ engine, failed, layout, objects, model, flashes, world, placeOf, itemsOf, spotObjects, spotProduct, listen, setPageRoutes, setPastSlots, home, aimProduct, setAnchors, aimEl, aimFrom, aimed }),
    [engine, failed, layout, objects, model, flashes, world, placeOf, itemsOf, spotObjects, spotProduct, listen, home, aimProduct, setAnchors, aimEl, aimed],
  );

  const worldNode = (
    <div ref={setWorld} className="mh-world">
      {started ? <EngineHost host={host} events={events} onChange={onChange} /> : null}
      <div className="mh-world-light" aria-hidden="true" />
      <i ref={gauge} className="mh-gauge" aria-hidden="true" />
      <i ref={setAimEl} className="mh-aim" aria-hidden="true" />
    </div>
  );

  return <TwinContext.Provider value={twin}>{children(worldNode)}</TwinContext.Provider>;
}
