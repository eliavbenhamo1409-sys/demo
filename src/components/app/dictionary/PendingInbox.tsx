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
import { fmtQty, fmtRelative } from "@/lib/format";

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
      <div className="sa-dict-inbox-info">
        <span className="sa-muted">{supplierName(item.supplier_id)}</span>
        <bdi className="sa-dict-inbox-name">{item.external_name}</bdi>
        {item.external_sku ? <span className="sa-dict-inbox-meta sa-mono ltr">{item.external_sku}</span> : null}
        {item.times_seen > 0 ? (
          <span className="sa-dict-inbox-meta">
            נראה <span className="sa-num">{fmtQty(item.times_seen)}</span> פעמים
            {item.last_seen_at ? ` · ${fmtRelative(item.last_seen_at)}` : ""}
          </span>
        ) : null}
        {saving ? <span className="sa-dict-inbox-meta">{SAVING}</span> : null}
      </div>
      <div className="sa-dict-inbox-actions">
        <Select
          options={productOptions}
          value={chosen}
          onChange={setChosen}
          placeholder="איזה מוצר זה?"
          searchPlaceholder="חיפוש מוצר…"
          minWidth={240}
          disabled={locked}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!chosen || saving}
          isLoading={busy}
          title={hint}
          aria-label={`אשר את "${item.external_name}"`}
          onClick={() => onApprove(item, chosen)}
        >
          אשר
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onNewProduct(item)} disabled={locked} title={hint}>
          מוצר חדש
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="trash"
          aria-label={`מחק את "${item.external_name}"`}
          title={hint ?? "מחק"}
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
      subtitle="שמות שהגיעו בתעודות משלוח. אשר למה הם שייכים והמערכת תזהה אותם לבד בפעם הבאה."
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
