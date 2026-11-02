"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useUi } from "@/components/app/ui-state";
import { Button, Count, Fields, Select, type SelectOption } from "@/components/ui";
import { fmtName, fmtPrice, fmtQty, fmtRelative, isToday } from "@/lib/format";
import { DISPATCH_ZONE, RACK_LEVELS, RECEIVING_ZONE } from "@/lib/map3d/layout";
import { coverOf, countOf, lastOutOf } from "@/lib/map3d/metrics";
import type { MapItem, ObjectStock } from "@/lib/map3d/model";
import { formatPlace } from "@/lib/map3d/place";
import type { PastQty } from "@/lib/map3d/trail";
import type { MapObject } from "@/lib/map3d/types";
import { available, isTempId, useData, type Fault, type Movement } from "@/lib/store";
import { minimumShare, percentText } from "./measure";
import { PlaceConfirm, RailRow, type PlaceChange } from "./parts";
import type { MapView } from "./view";
import { coverText, STATE_NUM } from "./words";

/** Past quantities, set while the page shows a date. */
export type PastStock = ReadonlyMap<string, PastQty>;

interface ObjectCardProps {
  map: MapView;
  object: MapObject;
  past: PastStock | null;
  onBack: () => void;
}

/** The rail, turned to one object. Every button opens the app's own forms; nothing here writes stock. */
export function ObjectCard({ map, object, past, onBack }: ObjectCardProps) {
  const body =
    object.kind === "machine" ? (
      <MachineBody object={object} past={past !== null} />
    ) : object.kind === "zone" ? (
      <ZoneBody object={object} past={past !== null} />
    ) : (
      <StockBody map={map} object={object} past={past} />
    );

  return (
    <div className="m3d-card">
      <Button variant="ghost" size="sm" icon="chevron-right" className="m3d-card-back" onClick={onBack}>חזרה</Button>
      {body}
    </div>
  );
}

function Head({ object, sub }: { object: MapObject; sub?: ReactNode }) {
  return (
    <header className="m3d-card-head">
      <p className="sa-panel-eyebrow sa-mono ltr self-start">{object.id}</p>
      <h2 className="m3d-card-title">{object.name}</h2>
      {sub ? <p className="m3d-card-sub">{sub}</p> : null}
      {object.note ? <p className="m3d-card-sub">{object.note}</p> : null}
    </header>
  );
}

function StockHead({ object, stock, past }: { object: MapObject; stock: ObjectStock | undefined; past: boolean }) {
  const count = stock?.items.length ?? 0;
  const parts = (
    <>
      {!past && stock && stock.value > 0 ? <><span className="sa-num">{fmtPrice(stock.value)}</span> במחירון · </> : null}
      <Count n={count} one="מוצר" many="מוצרים" />
      {!past && stock && stock.unpriced > 0 ? <> · <span className="sa-num">{fmtQty(stock.unpriced)}</span> ללא מחיר</> : null}
    </>
  );
  return <Head object={object} sub={parts} />;
}

function StockBody({ map, object, past }: { map: MapView; object: MapObject; past: PastStock | null }) {
  const { state } = useData();
  const [change, setChange] = useState<PlaceChange | null>(null);
  const stock = map.model.byObject.get(object.id);
  const items = stock?.items;
  const dated = past !== null;

  // What still has no place comes first; a product elsewhere can move here too.
  const options = useMemo<SelectOption[]>(() => {
    const here = new Set(items?.map((i) => i.product.id));
    const others = state.products.filter((p) => !here.has(p.id));
    const sorted = [...others.filter((p) => !map.placeOf(p.id)), ...others.filter((p) => map.placeOf(p.id))];
    return sorted.map((p) => ({ value: p.id, label: `${p.name} · ${p.sku}` }));
  }, [items, state.products, map]);

  const assign = (productId: string) => {
    const product = state.products.find((p) => p.id === productId);
    if (product) setChange({ product, location: formatPlace(object.id, null) });
  };

  return (
    <>
      <StockHead object={object} stock={stock} past={dated} />
      {items && items.length > 0 ? (
        items.map((item) => (
          <ItemBlock key={item.product.id} map={map} item={item} object={object} past={past?.get(item.product.id) ?? null} dated={dated} onLevel={setChange} />
        ))
      ) : (
        <p className="m3d-empty">אין מוצרים</p>
      )}
      {!dated ? (
        <Select options={options} value="" onChange={assign} placeholder="שיבוץ מוצר" searchPlaceholder="חיפוש מוצר" emptyLabel="אין מוצרים לשיבוץ" block />
      ) : null}
      {change ? <PlaceConfirm change={change} onClose={() => setChange(null)} /> : null}
    </>
  );
}

function pastText(past: PastQty | null): string {
  if (past?.kind === "known") return fmtQty(past.qty);
  return past?.kind === "absent" ? "טרם במלאי" : "לא ידוע";
}

interface ItemBlockProps {
  map: MapView;
  item: MapItem;
  object: MapObject;
  past: PastQty | null;
  dated: boolean;
  onLevel: (change: PlaceChange) => void;
}

function ItemBlock({ map, item, object, past, dated, onLevel }: ItemBlockProps) {
  const ui = useUi();
  const p = item.product;
  const share = minimumShare(p);

  return (
    <section className="m3d-item" aria-label={p.name}>
      <div>
        <button type="button" className="m3d-name" title={p.name} onClick={() => ui.openProduct(p.id)}>{fmtName(p.name)}</button>
        <span className="sa-cell-sub"><span className="sa-mono ltr">{p.sku}</span></span>
      </div>
      {dated ? (
        <p className="m3d-qty">
          <span className="sa-num">{pastText(past)}</span>
          {past?.kind === "known" ? <span>{p.unit}</span> : null}
        </p>
      ) : (
        <>
          <dl className="m3d-summary">
            <div>
              <dd className={STATE_NUM[item.state]}>{fmtQty(p.qty)}</dd>
              <dt>במלאי, {p.unit}</dt>
            </div>
            <div>
              <dd>{fmtQty(p.min_qty)}</dd>
              <dt>מינימום</dt>
            </div>
            <div>
              <dd className={STATE_NUM[item.state]}>{share === null ? "—" : percentText(share)}</dd>
              <dt>מהמינימום</dt>
            </div>
          </dl>
          <ItemFacts map={map} item={item} />
        </>
      )}
      {object.kind === "rack" ? <LevelSelect item={item} object={object} disabled={dated} onLevel={onLevel} /> : null}
      <div className="m3d-actions">
        <Button variant="primary" size="sm" icon="arrow-down-left" disabled={dated} onClick={() => ui.openAction("receive", { productId: p.id })}>קליטה</Button>
        <Button variant="secondary" size="sm" icon="arrow-up-right" disabled={dated} onClick={() => ui.openAction("issue", { productId: p.id })}>הוצאה</Button>
        <Button variant="secondary" size="sm" icon="clipboard-check" disabled={dated} onClick={() => ui.openAction("adjust", { productId: p.id })}>תיקון ספירה</Button>
        <Button variant="secondary" size="sm" icon="tool" disabled={dated} onClick={() => ui.openAction("fault", { productId: p.id })}>דיווח תקלה</Button>
      </div>
    </section>
  );
}

/** The supplier to call: the product's own, or whoever last delivered it. */
function lastSupplierId(productId: string, rows: readonly Movement[]): string | null {
  return rows.find((m) => m.product_id === productId && m.type === "in" && m.supplier_id)?.supplier_id ?? null;
}

function ItemFacts({ map, item }: { map: MapView; item: MapItem }) {
  const { supplier } = useData();
  const { ledger, trail } = map;
  const p = item.product;
  const free = available(p);

  const history = ledger.ready ? ledger.rows : null;
  const lastOut = history ? lastOutOf(p.id, history) : null;
  const lastCount = history ? countOf(p, history).lastCount : null;
  const vendor = supplier(p.primary_supplier_id) ?? (history ? supplier(lastSupplierId(p.id, history)) : undefined);

  return (
    <Fields
      items={[
        ...(p.reserved > 0
          ? [{
              label: free < 0 ? "חסר" : "זמין",
              value: <span className={free < 0 ? "font-semibold text-short" : undefined}>{fmtQty(Math.abs(free))}</span>,
              num: true,
            }]
          : []),
        { label: "הוצאה אחרונה", value: history ? (lastOut ? fmtRelative(lastOut.created_at) : "אין") : undefined },
        { label: "ספירה אחרונה", value: history ? (lastCount ? fmtRelative(lastCount) : "לא נספר") : undefined },
        { label: "ימי מלאי", value: trail ? coverText(coverOf(p, trail, trail.to)) : undefined },
        { label: "ספק", value: vendor?.name },
        ...(vendor?.phone
          ? [{ label: "טלפון", value: <a className="sa-btn sa-btn-link sa-mono ltr" href={`tel:${vendor.phone}`}>{vendor.phone}</a> }]
          : []),
      ]}
    />
  );
}

function LevelSelect({ item, object, disabled, onLevel }: { item: MapItem; object: MapObject; disabled: boolean; onLevel: (change: PlaceChange) => void }) {
  const options = useMemo(
    () => Array.from({ length: object.levels ?? RACK_LEVELS }, (_, i) => ({ value: String(i + 1), label: `מפלס ${i + 1}` })),
    [object.levels],
  );
  const choose = (value: string) => {
    const level = value === "" ? null : Number(value) - 1;
    if (level !== item.level) onLevel({ product: item.product, location: formatPlace(object.id, level) });
  };
  return (
    <Select
      label="מפלס"
      options={options}
      value={item.level === null ? "" : String(item.level + 1)}
      onChange={choose}
      allLabel="מפלס לא צוין"
      placeholder="מפלס לא צוין"
      searchable={false}
      disabled={disabled}
      block
    />
  );
}

function FaultRow({ fault }: { fault: Fault }) {
  const { worker, resolveFault } = useData();
  const { notify } = useUi();
  const [busy, setBusy] = useState(false);
  const by = worker(fault.reported_by)?.name;

  const resolve = async () => {
    setBusy(true);
    try {
      await resolveFault(fault.id);
      notify({ tone: "success", title: "התקלה סומנה כטופלה" });
    } catch (e) {
      notify({ tone: "danger", title: "סימון התקלה נכשל", text: e instanceof Error ? e.message : undefined });
      setBusy(false);
    }
  };

  return (
    <RailRow end={<Button variant="link" size="sm" disabled={busy} onClick={() => void resolve()}>{busy ? "סימון…" : "סימון כטופל"}</Button>}>
      <span className="block">{fault.description}</span>
      <span className="sa-cell-sub">{[fmtRelative(fault.created_at), by ? `דווח ע"י ${by}` : null].filter(Boolean).join(" · ")}</span>
    </RailRow>
  );
}

function MachineBody({ object, past }: { object: MapObject; past: boolean }) {
  const { state } = useData();
  const { openAction } = useUi();
  const faults = state.faults.filter((f) => f.asset === object.id && f.status === "open");

  return (
    <>
      <Head object={object} />
      {faults.length > 0 ? (
        <ul className="m3d-list">
          {faults.map((f) => <FaultRow key={f.id} fault={f} />)}
        </ul>
      ) : (
        <p className="m3d-empty">אין תקלות פתוחות</p>
      )}
      <Button variant="secondary" icon="tool" disabled={past} onClick={() => openAction("fault", { asset: object.id })}>דיווח תקלה</Button>
    </>
  );
}

function ZoneBody({ object, past }: { object: MapObject; past: boolean }) {
  const { state, stats } = useData();
  const receipts = useMemo(
    () => state.movements.filter((m) => m.type === "in" && !isTempId(m.id) && isToday(m.created_at)).length,
    [state.movements],
  );

  return (
    <>
      <Head object={object} />
      {!past && object.id === RECEIVING_ZONE ? <Fields columns={1} items={[{ label: "קליטות היום", value: fmtQty(receipts), num: true }]} /> : null}
      {!past && object.id === DISPATCH_ZONE ? <Fields columns={1} items={[{ label: "הזמנות פתוחות", value: fmtQty(stats.openOrders), num: true }]} /> : null}
    </>
  );
}
