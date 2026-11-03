"use client";

/**
 * Names that still need a decision: pending names from delivery notes (with or
 * without a guessed product) and names whose product was deleted.
 * One row per name: pick the product, approve. Rendered only when non-empty.
 * Each row owns its product choice (keyed by item id), so it resets when the
 * item disappears.
 */
import { useState } from "react";
import { Button, Card, Select, type SelectOption } from "@/components/ui";
import { isTempId, type SupplierItem } from "@/lib/store";
import { fmtRelative } from "@/lib/format";
import { seenText } from "./ProductRow";

export interface PendingInboxProps {
  items: SupplierItem[];
  productOptions: SelectOption[];
  supplierName: (id: string) => string;
  approvingId: string | null;
  onApprove: (item: SupplierItem, productId: string) => void;
  onNewProduct: (item: SupplierItem) => void;
  onDelete: (item: SupplierItem) => void;
}

type RowProps = Omit<PendingInboxProps, "items" | "approvingId"> & { item: SupplierItem; busy: boolean };

const SAVING = "עדיין נשמר";

function InboxRow({ item, busy, productOptions, supplierName, onApprove, onNewProduct, onDelete }: RowProps) {
  // A product the DB still points at may have been deleted; only keep a live preselect.
  const [chosen, setChosen] = useState(() => (item.product_id && productOptions.some((o) => o.value === item.product_id) ? item.product_id : ""));
  const saving = isTempId(item.id);
  const locked = busy || saving;
  const hint = saving ? SAVING : undefined;
  return (
    <div className="sa-dict-inbox-row">
      <span className="sa-dict-inbox-mark" aria-hidden="true" />
      <div className="sa-dict-inbox-info">
        <span className="sa-dict-inbox-name"><bdi>{item.external_name}</bdi></span>
        <span className="sa-dict-inbox-meta">
          {supplierName(item.supplier_id)}
          {item.external_sku ? <> · <span className="sa-mono ltr">{item.external_sku}</span></> : null}
          {item.times_seen > 0 ? ` · ${seenText(item.times_seen)}` : null}
          {item.times_seen > 0 && item.last_seen_at ? ` · ${fmtRelative(item.last_seen_at)}` : null}
          {saving ? ` · ${SAVING}` : null}
        </span>
      </div>
      <div className="sa-dict-inbox-actions">
        <Select
          options={productOptions}
          value={chosen}
          onChange={setChosen}
          placeholder="איזה מוצר זה?"
          searchPlaceholder='חיפוש לפי שם או מק"ט'
          minWidth={200}
          disabled={locked}
        />
        <Button
          variant={chosen ? "primary" : "secondary"}
          icon="check"
          disabled={!chosen || saving}
          isLoading={busy}
          title={hint}
          aria-label={`אישור "${item.external_name}"`}
          onClick={() => onApprove(item, chosen)}
        >
          אישור
        </Button>
        <Button variant="ghost" icon="plus" onClick={() => onNewProduct(item)} disabled={locked} title={hint}>
          מוצר חדש
        </Button>
        <Button
          variant="ghost"
          iconOnly
          icon="x"
          aria-label={`מחיקת "${item.external_name}"`}
          title={hint ?? "מחיקה"}
          onClick={() => onDelete(item)}
          disabled={locked}
        />
      </div>
    </div>
  );
}

export function PendingInbox({ items, approvingId, ...rest }: PendingInboxProps) {
  return (
    <Card
      title="ממתינים לאישור"
      count={items.length}
      subtitle="שמות מתעודות משלוח שצריך לשייך למוצר"
      flush
    >
      <div className="sa-dict-inbox">
        {items.map((item) => (
          <InboxRow key={item.id} item={item} busy={approvingId === item.id} {...rest} />
        ))}
      </div>
    </Card>
  );
}
