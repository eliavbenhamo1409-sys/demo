"use client";

/**
 * מחסן in מרחב 3 answers one question, where: a row for each place on the floor, saying what it holds and whether
 * anything there needs a hand. The products themselves are מוצרים's, the money is סקירה's and the orders are הזמנות's,
 * so none of them is listed here again. A row is a .m3d-line in an .is-value ledger, so the door's lens reads its code and
 * the model lights the place, and the model's pointer lights the row back. The mode over the list keeps only its places.
 */

import { useMemo, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { cx } from "@/components/ui";
import { fmtAge, fmtName, fmtQty } from "@/lib/format";
import type { MapObject, MapObjectKind, StockState } from "@/lib/map3d/types";
import { resolvePlace } from "@/lib/map3d/place";
import { useData, type Fault } from "@/lib/store";
import { RailRow, RailSection } from "@/components/map3d/parts";
import type { MapView } from "@/components/map3d/view";

export type PlacesMode = "all" | "short" | "faults" | "moves";

/** A week, for the mode that shows where goods moved. */
const WEEK = 7 * 86_400_000;

/** Places that hold stock come before machines, and the two zones of the floor come last. */
const KIND_ORDER: Record<MapObjectKind, number> = { rack: 0, floor: 0, machine: 1, zone: 2 };

/** What needs a hand first: what the orders lack, then a fault, then what ran out, then what is under its minimum. */
const NEED: Record<StockState | "fault", number> = { short: 0, fault: 1, out: 2, low: 3, ok: 4 };

interface Place {
  object: MapObject;
  products: number;
  /** What it holds, in the categories of its products, most first. */
  holds: string;
  /** Its first products by name, for the line under. */
  names: string;
  worst: StockState;
  /** Products here under their minimum or out. */
  restock: number;
  faults: number;
  moves: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${fmtQty(n)} ${many}`);

function needOf(place: Place): number {
  if (place.worst === "short") return NEED.short;
  if (place.faults > 0) return NEED.fault;
  return NEED[place.worst];
}

/** The place's one word: the gravest thing on it, in the words מוצרים and סקירה use. Under להשלמה only the stock speaks. */
function stateOf(place: Place, mode: PlacesMode): { word: string; tone?: string } | null {
  if (mode === "moves") return place.moves > 0 ? { word: plural(place.moves, "תנועה אחת", "תנועות") } : null;
  if (mode === "faults") return place.faults > 0 ? { word: plural(place.faults, "תקלה", "תקלות"), tone: "m3d-num-out" } : null;
  if (place.worst === "short") return { word: "חסר להזמנות", tone: "m3d-num-short" };
  if (place.faults > 0 && mode === "all") return { word: plural(place.faults, "תקלה", "תקלות"), tone: "m3d-num-out" };
  if (place.worst === "out" || place.worst === "low") return { word: `${fmtQty(place.restock)} להשלמה`, tone: place.worst === "out" ? "m3d-num-out" : "m3d-num-low" };
  return null;
}

export function Places({ map, mode }: { map: MapView; mode: PlacesMode }): ReactElement {
  const { state, product } = useData();
  const { openFault } = useUi();

  // An open fault on no place of the floor (a general one, or on a product with no shelf) is listed under the places, never lost.
  const { places, unplaced } = useMemo(() => {
    const known = new Set(map.objects.map((o) => o.id));
    const faults = new Map<string, number>();
    const unplaced: Fault[] = [];
    for (const f of state.faults) {
      if (f.status !== "open") continue;
      const at = f.asset ?? (f.product_id ? map.placeOf(f.product_id) : null);
      if (at && known.has(at)) faults.set(at, (faults.get(at) ?? 0) + 1);
      else unplaced.push(f);
    }
    const moves = new Map<string, number>();
    for (const m of map.recent) {
      if (Date.parse(m.created_at) < map.now - WEEK) continue;
      const at = resolvePlace(m.place, map.objects)?.objectId ?? map.placeOf(m.product_id);
      if (at) moves.set(at, (moves.get(at) ?? 0) + 1);
    }
    const places = map.objects.map((object): Place => {
      const stock = map.model.byObject.get(object.id);
      const products = [...new Map((stock?.items ?? []).map((item) => [item.product.id, item])).values()];
      const kinds = new Map<string, number>();
      for (const item of products) {
        const kind = item.product.category;
        if (kind) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      }
      const ranked = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([kind]) => kind);
      const holds =
        object.kind === "machine" || object.kind === "zone"
          ? object.name
          : ranked.length === 0
            ? products.length > 0 ? plural(products.length, "מוצר אחד", "מוצרים") : "ריק"
            : ranked.length > 2 ? `${ranked.slice(0, 2).join(" · ")} ועוד ${fmtQty(ranked.length - 2)}` : ranked.join(" · ");
      const named = products.slice(0, 2).map((item) => fmtName(item.product.name));
      const names = products.length === 0 ? "" : `${plural(products.length, "מוצר אחד", "מוצרים")} · ${named.join(", ")}${products.length > 2 ? "…" : ""}`;
      return {
        object,
        products: products.length,
        holds,
        names,
        worst: stock?.worst ?? "ok",
        restock: products.filter((item) => item.state === "low" || item.state === "out").length,
        faults: faults.get(object.id) ?? 0,
        moves: moves.get(object.id) ?? 0,
      };
    });
    return { places, unplaced };
  }, [map, state.faults]);

  const shown = useMemo(() => {
    const byCode = (a: Place, b: Place) => KIND_ORDER[a.object.kind] - KIND_ORDER[b.object.kind] || a.object.id.localeCompare(b.object.id, "en", { numeric: true });
    if (mode === "moves") return { needing: [], rest: places.filter((p) => p.moves > 0).sort((a, b) => b.moves - a.moves || byCode(a, b)) };
    if (mode === "faults") return { needing: places.filter((p) => p.faults > 0).sort((a, b) => b.faults - a.faults || byCode(a, b)), rest: [] };
    // להשלמה holds what its word says, the places whose stock needs a hand, as the model lights them.
    if (mode === "short") return { needing: places.filter((p) => p.worst !== "ok").sort((a, b) => NEED[a.worst] - NEED[b.worst] || byCode(a, b)), rest: [] };
    const needing = places.filter((p) => p.worst !== "ok" || p.faults > 0).sort((a, b) => needOf(a) - needOf(b) || byCode(a, b));
    return { needing, rest: places.filter((p) => p.worst === "ok" && p.faults === 0).sort(byCode) };
  }, [places, mode]);

  const row = (place: Place) => {
    const word = stateOf(place, mode);
    return (
      <button key={place.object.id} type="button" role="row" className="m3d-line m3-place" onClick={() => map.select(place.object.id)}>
        <span className="m3d-line-place" role="cell"><span className="ltr">{place.object.id}</span></span>
        <span className="m3d-line-product" role="cell">
          <span className="m3d-line-text">
            <span className={cx("m3d-line-name", place.products === 0 && place.object.kind !== "machine" && place.object.kind !== "zone" && "mh-tone-quiet")}>{place.holds}</span>
            {place.names ? <span className="m3d-line-unit sa-truncate">{place.names}</span> : null}
          </span>
        </span>
        <span className="m3d-line-share" role="cell">
          {word ? <span className={cx("m3d-line-percent is-words", word.tone)}>{word.word}</span> : null}
        </span>
      </button>
    );
  };

  const empty = shown.needing.length === 0 && shown.rest.length === 0;
  const loose = mode === "all" || mode === "faults" ? unplaced : [];

  return (
    <>
      <div className="m3d-ledger is-value m3-places" role="table" aria-label="המקומות במחסן">
        <div className="m3d-ledger-head" role="row">
          <span role="columnheader">מקום</span>
          <span role="columnheader">מה עומד שם</span>
          <span role="columnheader">{mode === "moves" ? "השבוע" : "מצב"}</span>
        </div>
        {shown.needing.length > 0 && mode !== "faults" ? <p className="m3d-group" role="row">דורש טיפול <span className="sa-mono m3d-count">{fmtQty(shown.needing.length)}</span></p> : null}
        {shown.needing.map(row)}
        {shown.rest.length > 0 && shown.needing.length > 0 ? <p className="m3d-group" role="row">שאר המקומות <span className="sa-mono m3d-count">{fmtQty(shown.rest.length)}</span></p> : null}
        {shown.rest.map(row)}
        {empty ? (
          <p className="m3d-empty">{mode === "faults" ? (loose.length > 0 ? "אין תקלה על מקום שבמפה" : "אין תקלות פתוחות") : mode === "moves" ? "לא זזה סחורה השבוע" : mode === "short" ? "אין מה להשלים" : "אין מקומות"}</p>
        ) : null}
      </div>
      {loose.length > 0 ? (
        <RailSection title="תקלות בלי מקום במפה" count={loose.length}>
          <ul className="m3d-list">
            {loose.map((f) => {
              const p = product(f.product_id);
              return (
                <RailRow key={f.id} lead={<ProductThumb product={p} small />} onOpen={() => openFault(f.id)}>
                  <span className="m3d-line-name">{f.description}</span>
                  <span className="m3d-line-unit sa-truncate">{[p ? fmtName(p.name) : "תקלה כללית", `פתוחה ${fmtAge(f.created_at)}`].join(" · ")}</span>
                </RailRow>
              );
            })}
          </ul>
        </RailSection>
      ) : null}
    </>
  );
}
