"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb, StockMeter } from "@/components/app/Viz";
import { Button, cx, Icon, Movement, MovementQty, Select, type SelectOption } from "@/components/ui";
import { fmtDateTime, fmtName, fmtQty, fmtRelative } from "@/lib/format";
import { formatPlace, placeWords, resolvePlace } from "@/lib/map3d/place";
import type { PastQty } from "@/lib/map3d/trail";
import type { StockState } from "@/lib/map3d/types";
import { stockState, useData, type Fault, type Movement as MovementRow, type Product } from "@/lib/store";
import { minimumShare, percentText } from "./measure";
import { PlaceConfirm, RailRow, RailSection, type PlaceChange } from "./parts";
import type { MapView } from "./view";
import { STATE_NUM, STATE_WORD } from "./words";

const FEED = 20;

const RANK: Record<StockState, number> = { short: 0, out: 1, low: 2, ok: 3 };
const METER_TONE: Record<StockState, "ok" | "low" | "out"> = { ok: "ok", low: "low", out: "out", short: "out" };

interface Line {
  product: Product;
  state: StockState;
  place: string | null;
  /** Available against the minimum, 1 is exactly the minimum. Null: the product has none. */
  share: number | null;
}

/** Stands at the head of the list: what needs a hand, tightest first. */
function byNeed(a: Line, b: Line): number {
  return RANK[a.state] - RANK[b.state] || (a.share ?? Infinity) - (b.share ?? Infinity) || a.product.name.localeCompare(b.product.name, "he");
}

/** The rail's first tab: every product with where it stands and how it stands against its minimum. */
export function StatusRail({ map, past, at }: { map: MapView; past: ReadonlyMap<string, PastQty> | null; at: number | null }) {
  const { state } = useData();

  const lines = useMemo(
    () =>
      state.products
        .map((product): Line => ({ product, state: stockState(product), place: map.placeOf(product.id), share: minimumShare(product) }))
        .sort(byNeed),
    [state.products, map],
  );

  if (past) return <PastLedger map={map} lines={lines} past={past} at={at} />;

  const urgent = lines.filter((line) => line.state !== "ok");
  const fine = lines.filter((line) => line.state === "ok");
  const faults = state.faults.filter((f) => f.status === "open");
  const needing = urgent.length + faults.length;

  return (
    <>
      <div className="m3d-ledger" role="table" aria-label="מלאי מול מינימום">
        <LedgerHead />
        {needing > 0 ? <p className="m3d-group" role="row">דורש טיפול <span className="sa-mono m3d-count">{fmtQty(needing)}</span></p> : null}
        {faults.map((fault) => <FaultLine key={fault.id} map={map} fault={fault} />)}
        {urgent.map((line) => <LedgerLine key={line.product.id} map={map} line={line} />)}
        {fine.length > 0 ? <p className="m3d-group" role="row">תקין <span className="sa-mono m3d-count">{fmtQty(fine.length)}</span></p> : null}
        {fine.map((line) => <LedgerLine key={line.product.id} map={map} line={line} />)}
        {lines.length === 0 ? <p className="m3d-empty">אין מוצרים</p> : null}
      </div>
      {map.model.tray.length > 0 ? <Tray map={map} /> : null}
      <AllPlaces map={map} />
    </>
  );
}

function LedgerHead({ qty = "במלאי" }: { qty?: string }) {
  return (
    <div className="m3d-ledger-head" role="row">
      <span role="columnheader">מוצר</span>
      <span role="columnheader">מיקום</span>
      <span role="columnheader" className="m3d-num">{qty}</span>
      <span role="columnheader" className="m3d-num">מהמינימום</span>
    </div>
  );
}

/** An open fault stands with the rest of what needs a hand, wherever it is reported. */
function FaultLine({ map, fault }: { map: MapView; fault: Fault }) {
  const { product } = useData();
  const { openProduct } = useUi();
  const router = useRouter();
  const p = product(fault.product_id);
  const asset = map.objects.find((o) => o.id === fault.asset)?.id ?? null;
  const place = asset ?? (fault.product_id ? map.placeOf(fault.product_id) : null);
  const open = () => {
    if (place) map.select(place);
    else if (p) openProduct(p.id);
    else router.push("/faults");
  };

  return (
    <button type="button" role="row" className="m3d-line" onClick={open}>
      <span className="sa-thumbed m3d-line-product" role="cell">
        <ProductThumb product={p} small />
        <span className="m3d-line-text">
          <span className="m3d-line-name">{fault.description}</span>
          {p ? <span className="m3d-line-unit sa-truncate">{fmtName(p.name)}</span> : null}
        </span>
      </span>
      <span className={cx("m3d-line-place", !place && "is-none")} role="cell">{place ? <span className="ltr">{place}</span> : "—"}</span>
      <span role="cell" />
      <span className="m3d-line-share" role="cell"><span className="m3d-line-percent m3d-num-out">תקלה</span></span>
    </button>
  );
}

function LedgerLine({ map, line }: { map: MapView; line: Line }) {
  const { openProduct } = useUi();
  const { product: p, state, place, share } = line;

  return (
    <button type="button" role="row" className="m3d-line" onClick={() => (place ? map.selectProduct(p.id) : openProduct(p.id))}>
      <span className="sa-thumbed m3d-line-product" role="cell">
        <ProductThumb product={p} small />
        <span className="m3d-line-text">
          <span className="m3d-line-name">{fmtName(p.name)}</span>
          {/* The percent counts what is free, so a full shelf that orders have taken says why it reads low. */}
          {p.reserved > 0 ? <span className={cx("m3d-line-unit", state === "short" && STATE_NUM.short)}>{fmtQty(p.reserved)} משוריינים להזמנות</span> : null}
        </span>
      </span>
      <span className={cx("m3d-line-place", !place && "is-none")} role="cell">{place ? <span className="ltr">{place}</span> : "—"}</span>
      <span className="m3d-num" role="cell">
        <span className="m3d-line-qty">{fmtQty(p.qty)}</span>
        <span className="m3d-line-unit">{p.unit}</span>
      </span>
      <span className="m3d-line-share" role="cell">
        {share === null ? (
          state === "ok" ? <span className="m3d-line-unit">ללא מינימום</span> : <span className={cx("m3d-line-percent", STATE_NUM[state])}>{STATE_WORD[state]}</span>
        ) : (
          <>
            <span className={cx("m3d-line-percent", STATE_NUM[state])}>{percentText(share)}</span>
            <StockMeter value={Math.max(share, 0)} min={1} tone={METER_TONE[state]} />
          </>
        )}
      </span>
    </button>
  );
}

function pastText(qty: PastQty | undefined): string {
  if (qty?.kind === "known") return fmtQty(qty.qty);
  return qty?.kind === "absent" ? "טרם במלאי" : "לא ידוע";
}

/** A date shows quantities only: the minimums and prices of that day are not on record. */
function PastLedger({ map, lines, past, at }: { map: MapView; lines: readonly Line[]; past: ReadonlyMap<string, PastQty>; at: number | null }) {
  return (
    <div className="m3d-ledger" role="table" aria-label="מלאי בתאריך">
      {at !== null ? <p className="m3d-group">המלאי ב-<span className="sa-num">{fmtDateTime(new Date(at).toISOString())}</span></p> : null}
      <div className="m3d-ledger-head is-past" role="row">
        <span role="columnheader">מוצר</span>
        <span role="columnheader">מיקום</span>
        <span role="columnheader" className="m3d-num">במלאי</span>
      </div>
      {lines.map(({ product: p, place }) => (
        <button key={p.id} type="button" role="row" className="m3d-line is-past" disabled={!place} onClick={() => place && map.select(place)}>
          <span className="sa-thumbed m3d-line-product" role="cell">
            <ProductThumb product={p} small />
            <span className="m3d-line-name">{fmtName(p.name)}</span>
          </span>
          <span className={cx("m3d-line-place", !place && "is-none")} role="cell">{place ? <span className="ltr">{place}</span> : "—"}</span>
          <span className="m3d-num" role="cell">
            <span className="m3d-line-qty">{pastText(past.get(p.id))}</span>
            {past.get(p.id)?.kind === "known" ? <span className="m3d-line-unit">{p.unit}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** What moved, newest first: one line says what and how much, the next says where and who. */
export function MovesRail({ map, at }: { map: MapView; at: number | null }) {
  const { state, product, worker } = useData();
  const { openProduct } = useUi();
  const rows = useMemo<readonly MovementRow[]>(
    () => (at === null ? state.movements : map.recent.filter((m) => Date.parse(m.created_at) <= at)).slice(0, FEED),
    [state.movements, map.recent, at],
  );

  if (rows.length === 0) return <p className="m3d-empty">אין תנועות</p>;

  return (
    <ul className="m3d-list">
      {rows.map((m) => {
        // A receipt says where it went; anything else stands where the product stands.
        const shelf = resolvePlace(m.place, map.objects);
        const place = shelf?.objectId ?? map.placeOf(m.product_id);
        const p = product(m.product_id);
        return (
          <RailRow key={m.id} lead={<ProductThumb product={p} small />} onOpen={place ? () => map.select(place, shelf ?? undefined) : () => openProduct(m.product_id, "history")} end={<span className="sa-num m3d-move-qty"><MovementQty qty={m.qty} type={m.type} /></span>}>
            <span className="m3d-line-name">{p ? fmtName(p.name) : "מוצר שנמחק"}</span>
            <span className="m3d-move-meta">
              <Movement type={m.type} />
              <span>{[m.place ? placeWords(m.place, map.objects) : place, worker(m.worker_id)?.name, fmtRelative(m.created_at)].filter(Boolean).join(" · ")}</span>
            </span>
          </RailRow>
        );
      })}
    </ul>
  );
}

/** What stands nowhere on the map: a product with no place, or the part of one no shelf holds. */
function Tray({ map }: { map: MapView }) {
  const { openAction } = useUi();
  const [picking, setPicking] = useState<string | null>(null);
  const [change, setChange] = useState<PlaceChange | null>(null);
  const { model } = map;

  const places = useMemo<SelectOption[]>(
    () => map.objects.filter((o) => o.kind === "rack" || o.kind === "floor").map((o) => ({ value: o.id, label: `${o.id} · ${o.name}` })),
    [map.objects],
  );

  const place = (product: Product, objectId: string) => {
    setPicking(null);
    if (objectId) setChange({ product, location: formatPlace(objectId, null) });
  };

  return (
    <RailSection title="ללא מיקום במפה" count={model.tray.length}>
      <ul className="m3d-list">
        {model.tray.map(({ product: p, qty }) => (
          <RailRow
            key={p.id}
            lead={<ProductThumb product={p} small />}
            end={<Button variant="link" size="sm" onClick={() => (qty > 0 ? openAction("place", { productId: p.id }) : setPicking(picking === p.id ? null : p.id))}>שיבוץ</Button>}
          >
            <span className="m3d-line-name">{fmtName(p.name)}</span>
            <span className="sa-cell-sub sa-truncate">
              <span className="ltr">{fmtQty(qty)}</span> {p.unit} · <bdi>{qty < p.qty ? `מתוך ${fmtQty(p.qty)}` : p.location || "ללא מיקום"}</bdi>
            </span>
            {picking === p.id ? (
              <div className="m3d-pick">
                <Select options={places} value="" onChange={(id) => place(p, id)} placeholder="בחירת מיקום" block defaultOpen />
              </div>
            ) : null}
          </RailRow>
        ))}
      </ul>
      {change ? <PlaceConfirm change={change} onClose={() => setChange(null)} /> : null}
    </RailSection>
  );
}

/** Empty racks and machines have no row above; this keeps every object reachable without a pointer. */
function AllPlaces({ map }: { map: MapView }) {
  return (
    <details className="m3d-all">
      <summary>
        כל המיקומים
        <Icon name="chevron-down" />
      </summary>
      <ul className="m3d-list">
        {map.objects.map((o) => {
          const count = map.model.byObject.get(o.id)?.products ?? 0;
          return (
            <RailRow key={o.id} onOpen={() => map.select(o.id)} end={count > 0 ? <span className="sa-num">{fmtQty(count)}</span> : undefined}>
              <span className="m3d-row-line">
                <span className="sa-mono ltr">{o.id}</span>
                <span className="sa-truncate text-ink-3">{o.name}</span>
              </span>
            </RailRow>
          );
        })}
      </ul>
    </details>
  );
}
