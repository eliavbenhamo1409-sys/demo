"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, Count, cx, Fields, Icon } from "@/components/ui";
import { fmtName, fmtPrice, fmtQty, fmtRelative, isToday } from "@/lib/format";
import { DISPATCH_ZONE, RECEIVING_ZONE } from "@/lib/map3d/layout";
import { coverOf, countOf, lastOutOf } from "@/lib/map3d/metrics";
import { blockAt, shelfLines, type ObjectStock, type ShelfBlock } from "@/lib/map3d/model";
import { formatPlace, shelfWords } from "@/lib/map3d/place";
import type { PastQty } from "@/lib/map3d/trail";
import type { MapObject, PickHit } from "@/lib/map3d/types";
import { available, isTempId, useData, type Fault, type Movement } from "@/lib/store";
import { minimumShare, percentText } from "./measure";
import { RailRow } from "./parts";
import type { MapView } from "./view";
import { coverText, STATE_NUM, STATE_WORD } from "./words";

/** Past quantities, set while the page shows a date. */
export type PastStock = ReadonlyMap<string, PastQty>;

interface ObjectCardProps {
  map: MapView;
  object: MapObject;
  /** The shelf the map or a line of the rail has chosen. */
  hit: PickHit | null;
  past: PastStock | null;
  onShelf: (hit: PickHit | null) => void;
  onBack: () => void;
}

/** The rail, turned to one object. Every button opens the app's own forms; nothing here writes stock. */
export function ObjectCard({ map, object, hit, past, onShelf, onBack }: ObjectCardProps) {
  const body =
    object.kind === "machine" ? (
      <MachineBody object={object} past={past !== null} />
    ) : object.kind === "zone" ? (
      <ZoneBody object={object} past={past !== null} />
    ) : (
      <StockBody map={map} object={object} hit={hit} past={past} onShelf={onShelf} />
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
  const parts = (
    <>
      {!past && stock && stock.value > 0 ? <><span className="sa-num">{fmtPrice(stock.value)}</span> במחירון · </> : null}
      <Count n={stock?.products ?? 0} one="מוצר" many="מוצרים" />
      {!past && stock && stock.unpriced > 0 ? <> · <span className="sa-num">{fmtQty(stock.unpriced)}</span> ללא מחיר</> : null}
    </>
  );
  return <Head object={object} sub={parts} />;
}

interface StockBodyProps {
  map: MapView;
  object: MapObject;
  hit: PickHit | null;
  past: PastStock | null;
  onShelf: (hit: PickHit | null) => void;
}

function StockBody({ map, object, hit, past, onShelf }: StockBodyProps) {
  const { state } = useData();
  const { openAction } = useUi();
  const stock = map.model.byObject.get(object.id);
  const dated = past !== null;

  const here = new Set(stock?.items.map((i) => i.product.id));
  const faults = dated ? [] : state.faults.filter((f) => f.status === "open" && (f.asset === object.id || (!f.asset && f.product_id !== null && here.has(f.product_id))));

  return (
    <>
      <StockHead object={object} stock={stock} past={dated} />
      {faults.length > 0 ? (
        <ul className="m3d-list">
          {faults.map((f) => <FaultRow key={f.id} fault={f} />)}
        </ul>
      ) : null}
      {dated ? (
        <PastList map={map} stock={stock} past={past} />
      ) : (
        <ShelfLedger map={map} object={object} stock={stock} hit={hit} onShelf={onShelf} />
      )}
      {!dated ? (
        <Button variant="secondary" icon="plus" onClick={() => openAction("place", { place: object.kind === "floor" ? object.id : undefined })}>שיבוץ מוצר</Button>
      ) : null}
    </>
  );
}

/** A date knows quantities per product, not per shelf. */
function PastList({ map, stock, past }: { map: MapView; stock: ObjectStock | undefined; past: PastStock }) {
  const products = [...new Map(stock?.blocks.map((block) => [block.product.id, block])).values()];
  if (products.length === 0) return <p className="m3d-empty">אין מוצרים</p>;
  return products.map((block) => <ItemBlock key={block.key} map={map} block={block} past={past.get(block.product.id) ?? null} dated />);
}

function shelfText(level: number, side: ShelfBlock["side"], through: number | null = level): string {
  return shelfWords(level, side, through)?.replace(/^(מדף|מדפים) /, "") ?? "";
}

function hitOf(block: ShelfBlock): PickHit {
  return { objectId: block.objectId, level: block.level, side: block.side, through: block.through ?? undefined };
}

/** The rack as a ledger, top shelf first: each place in it, what stands there and how that product stands against its minimum. */
function ShelfLedger({ map, object, stock, hit, onShelf }: { map: MapView; object: MapObject; stock: ObjectStock | undefined; hit: PickHit | null; onShelf: (hit: PickHit | null) => void }) {
  const { openAction } = useUi();
  const blocks = stock?.blocks ?? [];
  const open = hit && hit.level !== null ? blockAt(map.model, hit) : null;
  const toggle = (block: ShelfBlock) => onShelf(open?.key === block.key ? { objectId: object.id, level: null } : hitOf(block));
  const loose = blocks.filter((block) => block.level === null);
  const lines = object.kind === "rack" ? shelfLines(object, blocks) : [];

  return (
    <div className="m3d-shelves" role="table" aria-label="מדפים">
      <div className="m3d-shelf-head" role="row">
        <span role="columnheader">מדף</span>
        <span role="columnheader">מוצר</span>
        <span role="columnheader" className="m3d-num">כאן</span>
        <span role="columnheader" className="m3d-num">מהמינימום</span>
      </div>
      {lines.map((line) =>
        line.blocks.length === 0 ? (
          <button
            key={`${line.level}/${line.side ?? ""}`}
            type="button"
            role="row"
            className={cx("m3d-shelf is-empty", hit?.level === line.level && (line.side === null || !hit.side || hit.side === line.side) && "is-picked")}
            onClick={() => openAction("place", { place: formatPlace(object.id, line.level, line.side) })}
          >
            <span className="m3d-shelf-no" role="cell">{shelfText(line.level, line.side)}</span>
            <span className="m3d-shelf-free" role="cell">פנוי</span>
            <span className="m3d-shelf-add" role="cell">שיבוץ</span>
          </button>
        ) : (
          line.blocks.map((block) => <ShelfLine key={block.key} map={map} block={block} open={open?.key === block.key} onToggle={() => toggle(block)} />)
        ),
      )}
      {loose.map((block) => <ShelfLine key={block.key} map={map} block={block} open={open?.key === block.key} onToggle={() => toggle(block)} />)}
      {lines.length === 0 && loose.length === 0 ? <p className="m3d-empty">אין מוצרים</p> : null}
    </div>
  );
}

function ShelfLine({ map, block, open, onToggle }: { map: MapView; block: ShelfBlock; open: boolean; onToggle: () => void }) {
  const { product: p, state, level, side, through, qty } = block;
  const share = minimumShare(p);
  const word = state === "out" || state === "short" ? STATE_WORD[state] : null;
  const line = useRef<HTMLDivElement>(null);

  // Picked on the map, the line may stand below the fold.
  useEffect(() => {
    if (open) line.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  return (
    <div ref={line} className={cx("m3d-shelfblock", open && "is-open")}>
      <button type="button" role="row" className="m3d-shelf" aria-expanded={open} onClick={onToggle}>
        <span className="m3d-shelf-no" role="cell">{level === null ? "—" : shelfText(level, side, through)}</span>
        <span className="m3d-line-name" role="cell">{fmtName(p.name)}</span>
        <span className="m3d-num" role="cell">
          <span className="m3d-line-qty">{fmtQty(qty)}</span>
          <span className="m3d-line-unit">{p.unit}</span>
        </span>
        <span className={cx("m3d-num m3d-line-percent", STATE_NUM[state])} role="cell">{word ?? (share === null ? "—" : percentText(share))}</span>
        <Icon name="chevron-down" size={14} className="m3d-shelf-chevron" />
      </button>
      {open ? <ItemBlock map={map} block={block} past={null} dated={false} /> : null}
    </div>
  );
}

function pastText(past: PastQty | null): string {
  if (past?.kind === "known") return fmtQty(past.qty);
  return past?.kind === "absent" ? "טרם במלאי" : "לא ידוע";
}

interface ItemBlockProps {
  map: MapView;
  block: ShelfBlock;
  past: PastQty | null;
  dated: boolean;
}

function ItemBlock({ map, block, past, dated }: ItemBlockProps) {
  const ui = useUi();
  const p = block.product;
  const share = minimumShare(p);
  const first = block.items[0];

  return (
    <section className="m3d-item" aria-label={p.name}>
      <div className="sa-thumbed">
        <ProductThumb product={p} />
        <div>
          <button type="button" className="m3d-name" title={p.name} onClick={() => ui.openProduct(p.id)}>{fmtName(p.name)}</button>
          <span className="sa-cell-sub"><span className="sa-mono ltr">{p.sku}</span></span>
        </div>
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
              <dd className={STATE_NUM[block.state]}>{fmtQty(p.qty)}</dd>
              <dt>במלאי, {p.unit}</dt>
            </div>
            <div>
              <dd>{fmtQty(p.min_qty)}</dd>
              <dt>מינימום</dt>
            </div>
            <div>
              <dd className={STATE_NUM[block.state]}>{share === null ? "—" : percentText(share)}</dd>
              <dt>מהמינימום</dt>
            </div>
          </dl>
          <ItemFacts map={map} block={block} />
        </>
      )}
      <div className="m3d-actions">
        <Button variant="primary" size="sm" icon="arrow-down-left" disabled={dated} onClick={() => ui.openAction("receive", { productId: p.id, place: first?.place })}>קליטה</Button>
        <Button variant="secondary" size="sm" icon="arrow-up-right" disabled={dated} onClick={() => ui.openAction("issue", { productId: p.id })}>הוצאה</Button>
        <Button variant="secondary" size="sm" icon="clipboard-check" disabled={dated} onClick={() => ui.openAction("adjust", { productId: p.id })}>תיקון ספירה</Button>
        <Button variant="secondary" size="sm" icon="tool" disabled={dated} onClick={() => ui.openAction("fault", { productId: p.id })}>דיווח תקלה</Button>
        {block.qty > 0 ? (
          <Button variant="secondary" size="sm" icon="arrow-left" className="m3d-actions-wide" disabled={dated} onClick={() => ui.openAction("place", { productId: p.id, from: first?.place })}>העברה למדף אחר</Button>
        ) : null}
      </div>
    </section>
  );
}

/** The supplier to call: the product's own, or whoever last delivered it. */
function lastSupplierId(productId: string, rows: readonly Movement[]): string | null {
  return rows.find((m) => m.product_id === productId && m.type === "in" && m.supplier_id)?.supplier_id ?? null;
}

function ItemFacts({ map, block }: { map: MapView; block: ShelfBlock }) {
  const { supplier } = useData();
  const { ledger, trail } = map;
  const p = block.product;
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
      {past ? (
        <p className="m3d-empty">תקלות מוצגות להיום בלבד</p>
      ) : faults.length > 0 ? (
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
