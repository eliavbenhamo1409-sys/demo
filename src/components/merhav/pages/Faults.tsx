"use client";

/**
 * תקלות as places. An open fault is a spot on the model that needs a hand: the floor marks it, a tag stands over it, and
 * the list is a lens on it, the one that has waited longest first. A row reaches for its place, and pressing the place
 * takes the camera there. Tabs, filters and the resolve and reopen flows are the shared page's, word for word.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, Count, cx, EmptyState, SearchBar, Select, Showing, type SelectOption } from "@/components/ui";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { fmtDay, fmtName, fmtQty } from "@/lib/format";
import { shelfAnchor } from "@/lib/map3d/layout";
import { shelfWords } from "@/lib/map3d/place";
import type { LabelAnchor, MapObject, MapRoute, ShelfSide } from "@/lib/map3d/types";
import { isTempId, normalizeName, useData, type Fault, type Product } from "@/lib/store";
import { Figure } from "../Figure";
import { useTwin } from "../twin/Twin";

type Tab = "open" | "resolved";

/** ISO timestamp of seven days ago; rows are compared as ISO strings like the store does. */
function weekAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

function tabFromParams(params: URLSearchParams): Tab {
  return params.get("tab") === "resolved" ? "resolved" : "open";
}

/** "תוך 40 דקות" / "תוך 3 שעות" / "תוך יומיים" — how long a fault stayed open. */
function fmtDuration(fromIso: string, toIso: string): string | null {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return null; // same minute: nothing worth saying
  if (min < 60) return `תוך ${fmtQty(min)} דקות`;
  const h = Math.round(min / 60);
  if (h === 1) return "תוך שעה";
  if (h === 2) return "תוך שעתיים";
  if (h < 24) return `תוך ${fmtQty(h)} שעות`;
  const d = Math.round(h / 24);
  if (d === 1) return "תוך יום";
  if (d === 2) return "תוך יומיים";
  return `תוך ${fmtQty(d)} ימים`;
}

/** How long an open fault has waited, as a figure and its word. */
function waited(iso: string, now: number): { n: string; word: string } {
  const min = Math.floor((now - Date.parse(iso)) / 60000);
  if (min < 1) return { n: "", word: "עכשיו" };
  if (min < 60) return { n: fmtQty(min), word: min === 1 ? "דקה" : "דקות" };
  const hours = Math.floor(min / 60);
  if (hours < 24) return { n: fmtQty(hours), word: hours === 1 ? "שעה" : "שעות" };
  const days = Math.floor(hours / 24);
  return { n: fmtQty(days), word: days === 1 ? "יום" : "ימים" };
}

/** Where a fault stands on the model. */
interface Spot {
  object: MapObject;
  level: number | null;
  side: ShelfSide | null;
  code: string;
  words: string;
  point: { x: number; y: number; z: number };
}

/** The floor's mark stands this far off what it marks, as the stock marks do. */
const MARK_MARGIN = 0.45;
const BEND = 28;
/** Clear pixels between a place and the door's edge, enough for its tag. */
const TAG_ROOM = 60;
/** Half the photo and a margin: what it needs on either side of its place. */
const PEEK_ROOM = 80;
/** A mouse crossing the list moves nothing; one that stops does. Long enough for the engine to have placed the point. */
const SLIDE_AFTER = 140;

interface PlaceTag {
  object: MapObject;
  fault: Fault;
  count: number;
}

interface StageProps {
  tags: readonly PlaceTag[];
  now: number;
  aim: { id: string; spot: Spot; photo: string | null } | null;
  rowOf: (id: string) => HTMLElement | null;
  door: HTMLElement | null;
  pinned: boolean;
  onPick: (fault: Fault) => void;
  onHome: () => void;
}

/** The photo stands where it was taken. */
function Peek({ src }: { src: string }): ReactElement {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="mh-fl-peek" src={src} alt="" />;
}

/** What this page stands on the model: a tag over each place, the line from a row to its place, and the way back. */
function Stage({ tags, now, aim, rowOf, door, pinned, onPick, onHome }: StageProps): ReactElement | null {
  const { engine, world, setAnchors } = useTwin();
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const [point, setPoint] = useState<HTMLElement | null>(null);
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const aimId = aim?.id ?? null;
  const target = aim?.spot.point ?? null;
  const photo = aim?.photo ?? null;

  useEffect(() => {
    if (!engine) return;
    const anchors: LabelAnchor[] = [];
    for (const { object } of tags) {
      const el = nodes.current.get(object.id);
      if (el) anchors.push({ el, x: object.x, y: object.h, z: object.z });
    }
    if (point && target) anchors.push({ el: point, ...target });
    setAnchors(anchors);
    return () => setAnchors([]);
  }, [engine, tags, point, target, setAnchors]);

  // The same line as Leader.tsx, which only knows products: this one also reaches a machine, and it stays on its row through a scroll.
  useEffect(() => {
    if (!world || !point || !door || !aimId) return;
    const draw = () => {
      const line = path.current;
      const ring = dot.current;
      const row = rowOf(aimId);
      if (!line || !ring || !row) return;
      const stage = world.getBoundingClientRect();
      const end = point.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      const x = end.left - stage.left;
      const y = end.top - stage.top;
      const startX = door.getBoundingClientRect().left - stage.left;
      const startY = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight) - stage.top;
      const off = x < -100 || y < -100;
      line.style.opacity = off ? "0" : "";
      ring.style.opacity = off ? "0" : "";
      if (off) return;
      const bend = Math.max(startX - BEND, x + Math.abs(y - startY));
      line.setAttribute("d", `M${startX} ${startY} L${Math.min(bend, startX)} ${startY} L${x} ${y}`);
      ring.setAttribute("cx", String(x));
      ring.setAttribute("cy", String(y));
      world.querySelector<HTMLElement>(".mh-fl-peek")?.style.setProperty("--dx", `${Math.max(PEEK_ROOM - x, 0) - Math.max(x + PEEK_ROOM - startX, 0)}px`);
    };
    draw();
    const watcher = new MutationObserver(draw);
    watcher.observe(point, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("scroll", draw, { passive: true });
    return () => {
      watcher.disconnect();
      window.removeEventListener("scroll", draw);
    };
  }, [world, point, door, aimId, rowOf]);

  // The L can stand wider than the dock leaves it, so the picture slides out from under the door just far enough to show what the list is about.
  const slid = useRef(0);
  useEffect(() => {
    if (!engine || !world || !door || pinned) return;
    const shown = point && aimId ? [point] : [...nodes.current.values()];
    if (shown.length === 0) return;
    const rest = setTimeout(() => {
      const edge = door.getBoundingClientRect().left;
      const spots = shown.map((el) => el.getBoundingClientRect().left + slid.current);
      slid.current = Math.max(0, Math.min(Math.max(...spots) + TAG_ROOM - edge, Math.min(...spots) - TAG_ROOM));
      engine.setInsets({ top: 0, left: 0, bottom: 0, right: world.clientWidth - edge + slid.current * 2 });
    }, SLIDE_AFTER);
    return () => clearTimeout(rest);
  }, [engine, world, door, point, aimId, tags, pinned]);

  useEffect(() => {
    if (!engine || !world) return;
    const gauge = world.getBoundingClientRect();
    return () => {
      if (slid.current > 0) engine.setInsets({ top: 0, left: 0, bottom: 0, right: gauge.width - (door?.getBoundingClientRect().left || 0) });
    };
  }, [engine, world, door]);

  if (!world) return null;
  return createPortal(
    <>
      <div className={cx("mh-tags", aim && "is-aiming")} aria-hidden="true">
        {tags.map(({ object, fault, count }) => {
          const wait = waited(fault.created_at, now);
          return (
            <button
              key={object.id}
              type="button"
              tabIndex={-1}
              ref={(el) => {
                if (el) nodes.current.set(object.id, el);
                else nodes.current.delete(object.id);
              }}
              className={cx("mh-tag", aim?.spot.object.id === object.id && "is-on")}
              onClick={() => onPick(fault)}
            >
              <span className="mh-tag-body">
                <span className="mh-tag-code ltr">{object.id}</span>
                <span className="mh-tag-word">{count > 1 ? `${fmtQty(count)} תקלות` : `${wait.n} ${wait.word}`}</span>
              </span>
              {photo && aim?.spot.object.id === object.id ? <Peek src={photo} /> : null}
            </button>
          );
        })}
      </div>
      {aim ? (
        <svg key={aim.id} className="mh-leader" aria-hidden="true">
          <path ref={path} pathLength={1} />
          <circle ref={dot} r={4} />
        </svg>
      ) : null}
      <i ref={setPoint} className="mh-aim" aria-hidden="true">
        {photo && !tags.some((tag) => tag.object.id === aim?.spot.object.id) ? <Peek src={photo} /> : null}
      </i>
      {pinned ? <Button className="mh-fl-home" variant="secondary" onClick={onHome}>כל המחסן</Button> : null}
    </>,
    world,
  );
}

function Photo({ src, product, framed }: { src: string | null; product: Product | undefined; framed: boolean }): ReactElement | null {
  if (src) {
    return (
      <a className="sa-fault-thumb mh-fl-photo" href={src} target="_blank" rel="noreferrer" aria-label="פתיחת התמונה">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" />
      </a>
    );
  }
  if (product?.image_path) {
    return (
      <span className="sa-fault-thumb mh-fl-photo">
        <ProductThumb product={product} />
      </span>
    );
  }
  return framed ? <span className="sa-fault-thumb mh-fl-photo is-empty" aria-hidden="true" /> : null;
}

export function Faults(): ReactElement {
  return (
    <Suspense fallback={null}>
      <FaultsInner />
    </Suspense>
  );
}

function FaultsInner(): ReactElement {
  const { state, product, worker, resolveFault, reopenFault } = useData();
  const { openAction, openProduct, notify, panel, closing } = useUi();
  const { engine, objects, itemsOf, spotObjects, listen, setPageRoutes } = useTwin();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab = tabFromParams(params);
  const [pinned, setPinned] = useState<string | null>(null);
  const setTab = useCallback(
    (next: Tab) => {
      setPinned(null);
      const sp = new URLSearchParams(params.toString());
      if (next === "resolved") sp.set("tab", "resolved");
      else sp.delete("tab");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  /* ───────── counts ───────── */
  const open = useMemo(() => state.faults.filter((f) => f.status === "open"), [state.faults]);
  const resolved = useMemo(() => state.faults.filter((f) => f.status === "resolved"), [state.faults]);
  const resolvedThisWeek = useMemo(() => {
    const since = weekAgoIso();
    return resolved.filter((f) => f.resolved_at && f.resolved_at >= since).length;
  }, [resolved]);

  /* ───────── filters ───────── */
  const reporterOptions = useMemo<SelectOption[]>(() => {
    const ids = new Set(state.faults.map((f) => f.reported_by).filter((id): id is string => Boolean(id)));
    return state.workers.filter((w) => ids.has(w.id)).map((w) => ({ value: w.id, label: w.name }));
  }, [state.faults, state.workers]);

  const q = normalizeName(query);
  const visible = useMemo(() => {
    const base = tab === "open" ? open : resolved;
    const list = base.filter((f) => {
      if (workerId && f.reported_by !== workerId) return false;
      if (!q) return true;
      const p = product(f.product_id);
      const w = worker(f.reported_by);
      const hay = normalizeName([f.description, p?.name, p?.sku, p?.barcode, w?.name].filter(Boolean).join(" "));
      return hay.includes(q);
    });
    // Urgency is position: what has waited longest stands first. A record keeps the shared order.
    return tab === "open" ? [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)) : list;
  }, [tab, open, resolved, workerId, q, product, worker]);

  /* ───────── writes ───────── */
  const run = useCallback(
    async (f: Fault, fn: () => Promise<void>, success: string, failure: string) => {
      if (isTempId(f.id)) {
        notify({ tone: "neutral", title: "התקלה עדיין נשמרת", text: "אפשר לנסות שוב בעוד רגע" });
        return;
      }
      setBusyId(f.id);
      try {
        await fn();
        notify({ tone: "success", title: success, text: f.description });
      } catch (e) {
        notify({ tone: "danger", title: failure, text: e instanceof Error ? e.message : undefined });
      } finally {
        setBusyId(null);
      }
    },
    [notify],
  );

  // A fault that closes leaves its row the way it really goes: the row folds shut and the ones under it rise.
  const rows = useRef(new Map<string, HTMLElement>());
  const [leaving, setLeaving] = useState<readonly { fault: Fault; height: number }[]>([]);
  const leave = useCallback((f: Fault) => {
    setLeaving((list) => [...list, { fault: f, height: rows.current.get(f.id)?.offsetHeight ?? 0 }]);
  }, []);
  const gone = useCallback((id: string) => setLeaving((list) => list.filter((item) => item.fault.id !== id)), []);

  const onResolve = useCallback(
    (f: Fault) => {
      leave(f);
      return run(f, () => resolveFault(f.id), "התקלה סומנה כטופלה", "סימון התקלה נכשל");
    },
    [run, resolveFault, leave],
  );
  const onReopen = useCallback(
    (f: Fault) => {
      leave(f);
      return run(f, () => reopenFault(f.id), "התקלה נפתחה מחדש", "פתיחת התקלה נכשלה");
    },
    [run, reopenFault, leave],
  );

  const hasFilters = Boolean(q || workerId);

  /* ───────── where each fault stands ───────── */
  const spotOf = useCallback(
    (f: Fault): Spot | null => {
      const asset = objects.find((o) => o.id === f.asset);
      if (asset) return { object: asset, level: null, side: null, code: asset.id, words: asset.name, point: { x: asset.x, y: asset.h, z: asset.z } };
      const item = f.product_id ? itemsOf(f.product_id)[0] : undefined;
      const rack = item ? objects.find((o) => o.id === item.objectId) : undefined;
      if (!item || !rack) return null;
      const point = item.level === null ? { x: rack.x, y: rack.h, z: rack.z } : shelfAnchor(rack, item.level, item.side);
      return { object: rack, level: item.level, side: item.side, code: item.place, words: shelfWords(item.level, item.side) ?? rack.name, point };
    },
    [objects, itemsOf],
  );

  // Only what is open stands on the model; a record lights up only when pointed at.
  const tags = useMemo<PlaceTag[]>(() => {
    if (tab !== "open") return [];
    const byPlace = new Map<string, PlaceTag>();
    for (const fault of visible) {
      const spot = spotOf(fault);
      if (!spot) continue;
      const tag = byPlace.get(spot.object.id);
      if (tag) tag.count += 1;
      else byPlace.set(spot.object.id, { object: spot.object, fault, count: 1 });
    }
    return [...byPlace.values()];
  }, [tab, visible, spotOf]);

  // On this page the floor speaks of faults alone: with none, it is clear.
  useEffect(() => {
    const marks: MapRoute[] = tags.map(({ object: o }) => {
      const front = o.z + o.d / 2 + MARK_MARGIN;
      return { points: [[o.x - o.w / 2 - MARK_MARGIN, front], [o.x + o.w / 2 + MARK_MARGIN, front]], tone: "out" };
    });
    setPageRoutes(marks);
    return () => setPageRoutes(null);
  }, [tags, setPageRoutes]);

  /* ───────── a row reaches for its place ───────── */
  const [door, setDoor] = useState<HTMLDivElement | null>(null);
  const rowOf = useCallback((id: string) => rows.current.get(id) ?? null, []);
  const [hover, setHover] = useState<string | null>(null);
  const [modelAt, setModelAt] = useState<string | null>(null);

  const aimed = useMemo(() => visible.find((f) => f.id === (hover ?? pinned)) ?? null, [visible, hover, pinned]);
  const aimedSpot = useMemo(() => (aimed ? spotOf(aimed) : null), [aimed, spotOf]);
  const aim = useMemo(
    () => (aimed && aimedSpot ? { id: aimed.id, spot: aimedSpot, photo: faultPhotoUrl(aimed.photo_path) } : null),
    [aimed, aimedSpot],
  );

  const pinnedFault = useMemo(() => visible.find((f) => f.id === pinned) ?? null, [visible, pinned]);
  const pinnedSpot = useMemo(() => (pinnedFault ? spotOf(pinnedFault) : null), [pinnedFault, spotOf]);

  // A product open in the drawer holds the camera and the light; this page takes them back when it closes.
  const drawerHolds = panel?.type === "product" && !closing;

  useEffect(() => {
    if (drawerHolds) return;
    if (aimedSpot) spotObjects([aimedSpot.object.id], { objectId: aimedSpot.object.id, level: aimedSpot.level, side: aimedSpot.side });
    else spotObjects(tags.length > 0 ? tags.map((tag) => tag.object.id) : null);
  }, [drawerHolds, aimedSpot, tags, spotObjects]);

  useEffect(() => () => spotObjects(null), [spotObjects]);

  const pinnedObject = pinnedSpot?.object.id;
  const pinnedOnShelf = pinnedSpot?.level !== null && pinnedSpot?.level !== undefined;
  useEffect(() => {
    if (!engine || !pinnedObject) return;
    engine.flyTo({ objectId: pinnedObject, shelf: pinnedOnShelf });
    return () => engine.flyTo(null);
  }, [engine, pinnedObject, pinnedOnShelf]);

  const pin = useCallback((f: Fault) => setPinned((at) => (at === f.id ? null : f.id)), []);

  // The model answers too: pointing at a place finds its rows, pressing one takes you to the first.
  useEffect(
    () =>
      listen({
        onHover: (hit) => setModelAt(hit?.objectId ?? null),
        onPick: (hit) => {
          if (!hit) {
            setPinned(null);
            return;
          }
          const tag = tags.find((t) => t.object.id === hit.objectId);
          if (!tag) {
            router.push(`/3d?at=${encodeURIComponent(hit.objectId)}`);
            return;
          }
          setPinned(tag.fault.id);
          rows.current.get(tag.fault.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
        },
      }),
    [listen, router, tags],
  );

  /* ───────── body ───────── */
  // A fault with no photo of its own shows its product's, and a row with neither keeps the frame's place, so the titles share one edge.
  const anyPhoto = visible.some((f) => faultPhotoUrl(f.photo_path) || product(f.product_id)?.image_path);

  // What is folding away stands in its old place a moment longer.
  const folding = useMemo(() => leaving.filter(({ fault }) => fault.status === (tab === "open" ? "open" : "resolved") && !visible.some((f) => f.id === fault.id)), [leaving, visible, tab]);
  const listed = useMemo(
    () => (folding.length === 0 ? visible : [...visible, ...folding.map((item) => item.fault)].sort((a, b) => (tab === "open" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)))),
    [visible, folding, tab],
  );

  let body: ReactNode;
  if (listed.length === 0) {
    body =
      state.faults.length === 0 ? (
        <EmptyState title="אין תקלות" hint="דיווחים מהטלפון יופיעו כאן">
          <Button variant="secondary" onClick={() => openAction("fault")}>דיווח תקלה</Button>
        </EmptyState>
      ) : hasFilters ? (
        <EmptyState title="לא נמצאו תקלות" hint="אפשר להסיר את הסינון" />
      ) : tab === "open" ? (
        <EmptyState title="אין תקלות פתוחות" />
      ) : (
        <EmptyState title="אין תקלות שטופלו" hint="תקלה שטופלה תישמר כאן" />
      );
  } else {
    body = (
      <>
        <div className="mh-fl-head" aria-hidden="true">
          <span className="is-what">מה קרה</span>
          <span className="is-wait">{tab === "open" ? "ממתינה" : "טופל"}</span>
          <span className="is-place">מקום</span>
        </div>
        <ul className="mh-fl-list" aria-label={tab === "open" ? "תקלות פתוחות" : "תקלות שטופלו"}>
          {listed.map((f) => {
            const fold = folding.find((item) => item.fault.id === f.id);
            const p = product(f.product_id);
            const w = worker(f.reported_by);
            const busy = busyId === f.id;
            const done = f.status === "resolved";
            const took = done && f.resolved_at ? fmtDuration(f.created_at, f.resolved_at) : null;
            const spot = spotOf(f);
            const wait = waited(f.created_at, now);
            const place = spot?.code ?? f.asset ?? p?.location ?? null;
            return (
              <li
                key={f.id}
                ref={(el) => {
                  if (el) rows.current.set(f.id, el);
                  else rows.current.delete(f.id);
                }}
                className={cx("mh-fl-row", done && "is-done", pinned === f.id && "is-pinned", spot && spot.object.id === modelAt && "is-lit", fold && "is-leaving")}
                style={fold ? ({ "--h": `${fold.height}px` } as CSSProperties) : undefined}
                onAnimationEnd={(e) => {
                  if (e.animationName === "mh-fl-fold") gone(f.id);
                }}
                onPointerEnter={() => setHover(f.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(f.id)}
                onBlur={() => setHover(null)}
              >
                <Photo src={faultPhotoUrl(f.photo_path)} product={p} framed={anyPhoto} />
                <div className="mh-fl-main">
                  <p className="mh-fl-what">{f.description}</p>
                  <div className="mh-fl-about">
                    {p ? (
                      <button type="button" className="mh-fl-product" onClick={() => openProduct(p.id)}>
                        <span className="sa-truncate">{fmtName(p.name)}</span>
                        <span className="ltr">{p.sku}</span>
                      </button>
                    ) : f.product_id ? (
                      <span>מוצר שנמחק</span>
                    ) : spot ? null : (
                      <span>ללא מוצר</span>
                    )}
                    <span>{w ? <>דווח ע&quot;י {w.name}</> : "ללא מדווח"}{done ? ` · ${fmtDay(f.created_at)}` : ""}</span>
                  </div>
                </div>
                <div className="mh-fl-wait">
                  {done ? (
                    <span className="mh-fl-took">{took ?? "מיד"}</span>
                  ) : (
                    <>
                      {wait.n ? <span className="mh-fl-n ltr">{wait.n}</span> : null}
                      <span className="mh-fl-unit">{wait.word}</span>
                    </>
                  )}
                </div>
                <div className="mh-fl-place">
                  {spot ? (
                    <button type="button" className="mh-fl-go" aria-pressed={pinned === f.id} onClick={() => pin(f)}>
                      <span className="mh-fl-code ltr">{place}</span>
                      <span className="mh-fl-words">{spot.words}</span>
                    </button>
                  ) : place ? (
                    <span className="mh-fl-code ltr">{place}</span>
                  ) : (
                    <span className="mh-fl-words">ללא מיקום</span>
                  )}
                </div>
                <div className="mh-fl-act">
                  {done ? (
                    <Button variant="ghost" size="sm" icon="refresh" isLoading={busy} onClick={() => void onReopen(f)}>פתיחה מחדש</Button>
                  ) : (
                    <Button variant="secondary" size="sm" icon="check" isLoading={busy} onClick={() => void onResolve(f)}>סימון כטופל</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  const lens: { key: Tab; word: string; count: number }[] = [
    { key: "open", word: "פתוחות", count: open.length },
    { key: "resolved", word: "טופלו", count: resolved.length },
  ];

  return (
    <div ref={setDoor} className="mh-fl">
      <header className="mh-fl-top">
        <div>
          <h1 className="sa-page-title">תקלות</h1>
          <p className="sa-page-sub"><Count n={resolvedThisWeek} one="טופלה השבוע" many="טופלו השבוע" /></p>
        </div>
        <Button variant="primary" icon="tool" onClick={() => openAction("fault")}>דיווח תקלה</Button>
      </header>

      <div className="mh-lens mh-fl-lens" role="tablist" aria-label="סינון לפי מצב">
        {lens.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={cx("mh-lens-item", tab === item.key && "is-on")} onClick={() => setTab(item.key)}>
            <Figure className="mh-lens-n" text={fmtQty(item.count)} />
            <span className="mh-lens-word">{item.word}</span>
          </button>
        ))}
      </div>

      <div className="mh-inv-tools">
        <SearchBar kbd={false} value={query} onChange={setQuery} placeholder="חיפוש לפי תיאור, מוצר או עובד" />
        {reporterOptions.length > 0 ? <Select options={reporterOptions} value={workerId} onChange={setWorkerId} allLabel="כל העובדים" placeholder="עובד" /> : null}
      </div>

      <div className={cx("mh-fl-body", tab === "resolved" && "is-record")}>{body}</div>

      {hasFilters && visible.length > 0 ? <p className="mh-fl-foot"><Showing shown={visible.length} total={tab === "open" ? open.length : resolved.length} /></p> : null}

      <Stage tags={tags} now={now} aim={aim} rowOf={rowOf} door={door} pinned={Boolean(pinnedSpot)} onPick={pin} onHome={() => setPinned(null)} />
    </div>
  );
}
