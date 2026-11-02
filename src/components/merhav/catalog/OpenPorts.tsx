"use client";

import { useState, type ReactElement } from "react";
import { seenText } from "@/components/app/dictionary/ProductRow";
import { Button, cx, Select, type SelectOption } from "@/components/ui";
import { fmtQty, fmtRelative } from "@/lib/format";
import { isTempId, type SupplierItem } from "@/lib/store";

interface OpenPortsProps {
  items: SupplierItem[];
  productOptions: SelectOption[];
  supplierName: (id: string) => string;
  approvingId: string | null;
  /** The row whose wire just seated, on its way out. */
  seatingId: string | null;
  onApprove: (item: SupplierItem, productId: string) => void;
  onNewProduct: (item: SupplierItem) => void;
  onDelete: (item: SupplierItem) => void;
  onPort: (item: SupplierItem) => void;
}

type RowProps = Omit<OpenPortsProps, "items" | "approvingId" | "seatingId"> & { item: SupplierItem; busy: boolean; seating: boolean };

const SAVING = "עדיין נשמר";

/** A name on one end, an empty socket on the other. Each row owns its product choice, as the shared inbox does. */
function OpenPort({ item, busy, seating, productOptions, supplierName, onApprove, onNewProduct, onDelete, onPort }: RowProps): ReactElement {
  // A product the DB still points at may have been deleted; only keep a live preselect.
  const [chosen, setChosen] = useState(() => (item.product_id && productOptions.some((o) => o.value === item.product_id) ? item.product_id : ""));
  const saving = isTempId(item.id);
  const locked = busy || saving;
  const hint = saving ? SAVING : undefined;
  return (
    <div className={cx("mh-cat-open", chosen && "is-seated", seating && "is-seating")}>
      <div className="mh-cat-open-socket">
        <Select options={productOptions} value={chosen} onChange={setChosen} placeholder="איזה מוצר זה?" searchPlaceholder='חיפוש לפי שם או מק"ט' block disabled={locked} />
        <Button variant={chosen ? "primary" : "secondary"} icon="check" disabled={!chosen || saving} isLoading={busy} title={hint} aria-label={`אישור "${item.external_name}"`} onClick={() => onApprove(item, chosen)}>אישור</Button>
      </div>

      <div className="mh-cat-open-wire">
        <i className="mh-cat-open-line" aria-hidden="true" />
        <button type="button" className="mh-cat-port" onClick={() => onPort(item)} aria-label={`שיוך "${item.external_name}"`} title="למה שייך השם הזה?"><i /></button>
      </div>

      <div className="mh-cat-open-name">
        <span className="mh-row-main">
          <span className="mh-cat-open-text"><bdi>{item.external_name}</bdi></span>
          <span className="mh-row-sub">
            {supplierName(item.supplier_id)}
            {item.external_sku ? <> · <span className="ltr">{item.external_sku}</span></> : null}
            {item.times_seen > 0 ? ` · ${seenText(item.times_seen)}` : null}
            {item.times_seen > 0 && item.last_seen_at ? ` · ${fmtRelative(item.last_seen_at)}` : null}
            {saving ? ` · ${SAVING}` : null}
          </span>
        </span>
        <span className="mh-cat-open-tools">
          <Button variant="ghost" size="sm" icon="plus" onClick={() => onNewProduct(item)} disabled={locked} title={hint}>מוצר חדש</Button>
          <Button variant="ghost" size="sm" icon="trash" aria-label={`מחיקת "${item.external_name}"`} title={hint} onClick={() => onDelete(item)} disabled={locked}>מחיקה</Button>
        </span>
      </div>
    </div>
  );
}

/** How many stand open before the rest fold away: the work stays at the top without burying the bay. */
const SHOWN = 6;

/** Names that still need a decision: at the top, because that is where the work is. */
export function OpenPorts({ items, approvingId, seatingId, ...rest }: OpenPortsProps): ReactElement {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  const more = items.length - shown.length;
  return (
    <section className="mh-cat-opens" aria-label="ממתינים לאישור">
      <header className="mh-col-head">
        <h2><span className="mh-cat-opens-n mh-tone-warn ltr">{fmtQty(items.length - (seatingId ? 1 : 0))}</span> ממתינים לאישור</h2>
        <span className="mh-col-note">שמות מתעודות משלוח שצריך לשייך למוצר</span>
      </header>
      {shown.map((item) => <OpenPort key={item.id} item={item} busy={approvingId === item.id} seating={seatingId === item.id} {...rest} />)}
      {more > 0 ? <button type="button" className="mh-cat-opens-more" onClick={() => setAll(true)}>עוד <span className="ltr">{fmtQty(more)}</span> ממתינים</button> : null}
    </section>
  );
}
