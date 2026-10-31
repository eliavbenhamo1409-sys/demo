"use client";

/**
 * One product in the dictionary: its central name and codes at the start, and
 * every supplier's name for it as chips at the end, plus the add chip.
 */
import { useEffect, useRef } from "react";
import { Button, Icon } from "@/components/ui";
import { isTempId, type Product, type SupplierItem } from "@/lib/store";
import { fmtQty } from "@/lib/format";
import { InlineAliasForm } from "./InlineAliasForm";

export interface ProductRowProps {
  product: Product;
  aliases: SupplierItem[];
  supplierName: (id: string) => string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onOpenProduct: () => void;
  onApprove: (item: SupplierItem) => void;
  onRemove: (item: SupplierItem) => void;
  approvingId: string | null;
}

export function ProductRow({ product, aliases, supplierName, open, onOpen, onClose, onOpenProduct, onApprove, onRemove, approvingId }: ProductRowProps) {
  const addRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // When the inline form closes, focus goes back to the add chip.
  useEffect(() => {
    if (wasOpen.current && !open) addRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <div className={open ? "sa-dict-row is-open" : "sa-dict-row"} role="listitem">
      <div className="sa-dict-product">
        <button type="button" className="sa-dict-product-name" onClick={onOpenProduct} aria-label={`פתח מוצר ${product.name}`} title="פתח מוצר">
          {product.name}
        </button>
        <span className="sa-dict-product-codes">
          <span className="sa-mono ltr">{product.sku}</span>
          {product.barcode ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="sa-mono ltr">{product.barcode}</span>
            </>
          ) : null}
        </span>
      </div>

      <div className="sa-dict-aliases">
        {aliases.length === 0 && !open ? <span className="sa-dict-none">אין עדיין שמות של ספקים</span> : null}
        {aliases.map((a) => {
          const pending = a.status === "pending";
          const sup = supplierName(a.supplier_id);
          const saving = isTempId(a.id);
          const meta = [
            a.external_sku ? `מק"ט חיצוני ${a.external_sku}` : null,
            a.times_seen > 0 ? `נראה ${fmtQty(a.times_seen)} פעמים` : null,
            saving ? "עדיין נשמר" : null,
          ]
            .filter((v): v is string => v !== null)
            .join(" · ");
          return (
            <span key={a.id} className={pending ? "sa-dict-chip is-pending" : "sa-dict-chip"} title={meta || undefined}>
              <bdi className="sa-dict-chip-name">{a.external_name}</bdi>
              <span className="sa-dict-chip-sup" aria-label={`אצל ${sup}`}>{sup}</span>
              {pending ? (
                <Button
                  variant="link"
                  size="sm"
                  className="sa-dict-chip-approve"
                  aria-label={`אשר את "${a.external_name}" של ${sup}`}
                  isLoading={approvingId === a.id}
                  disabled={saving}
                  onClick={() => onApprove(a)}
                >
                  אשר
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon="x"
                aria-label={`הסר את "${a.external_name}" של ${sup}`}
                className="sa-dict-chip-x"
                disabled={saving}
                onClick={() => onRemove(a)}
              />
            </span>
          );
        })}
        {open ? <InlineAliasForm product={product} onClose={onClose} /> : null}
      </div>

      <div className="sa-dict-action">
        {open ? null : (
          <button ref={addRef} type="button" className="sa-dict-add" onClick={onOpen} aria-label={`שם של ספק עבור ${product.name}`}>
            <Icon name="plus" size={14} />
            שם של ספק
          </button>
        )}
      </div>
    </div>
  );
}
