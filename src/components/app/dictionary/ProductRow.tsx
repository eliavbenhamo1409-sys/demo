"use client";

/**
 * One product in the dictionary: its photo, name and code at the start, and what
 * every supplier calls it, grouped by supplier, then the add link.
 */
import { useEffect, useRef } from "react";
import { Badge, Button } from "@/components/ui";
import { ProductThumb } from "@/components/app/Viz";
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

/** How often a name turned up on delivery notes. */
export function seenText(times: number): string {
  if (times === 1) return "נראה פעם אחת";
  if (times === 2) return "נראה פעמיים";
  return `נראה ${fmtQty(times)} פעמים`;
}

/** One supplier's names stay together, in the order the page sorted them, so whatever waits still comes first. */
function bySupplier(aliases: SupplierItem[]): SupplierItem[][] {
  const groups = new Map<string, SupplierItem[]>();
  for (const a of aliases) {
    const group = groups.get(a.supplier_id);
    if (group) group.push(a);
    else groups.set(a.supplier_id, [a]);
  }
  return [...groups.values()];
}

export function ProductRow({ product, aliases, supplierName, open, onOpen, onClose, onOpenProduct, onApprove, onRemove, approvingId }: ProductRowProps) {
  const addRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // When the inline form closes, focus goes back to the add button.
  useEffect(() => {
    if (wasOpen.current && !open) addRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <div className="sa-dict-row" role="listitem">
      <div className="sa-dict-product sa-thumbed">
        <ProductThumb product={product} />
        <div className="sa-dict-product-text">
          <button type="button" className="sa-dict-product-name" onClick={onOpenProduct} aria-label={`פתיחת מוצר ${product.name}`} title="פתיחת מוצר">
            <span className="sa-dict-product-label">{product.name}</span>
          </button>
          <span className="sa-dict-product-codes">
            <span className="sa-mono ltr">{product.sku}</span>
          </span>
        </div>
      </div>

      <div className="sa-dict-aliases">
        {aliases.length === 0 && !open ? <span className="sa-dict-none">אין שמות</span> : null}
        {bySupplier(aliases).map((group) => {
          const sup = supplierName(group[0].supplier_id);
          return (
            <div key={group[0].supplier_id} className="sa-dict-group">
              <span className="sa-dict-alias-sup" aria-label={`אצל ${sup}`}>{sup}</span>
              <div className="sa-dict-group-names">
                {group.map((a) => {
                  const pending = a.status === "pending";
                  const saving = isTempId(a.id);
                  const facts = [a.times_seen > 0 ? seenText(a.times_seen) : null, saving ? "עדיין נשמר" : null].filter((v): v is string => v !== null);
                  return (
                    <div key={a.id} className="sa-dict-alias">
                      <span className="sa-dict-alias-text">
                        <span className="sa-dict-alias-name"><bdi>{a.external_name}</bdi></span>
                        {a.external_sku || facts.length > 0 ? (
                          <span className="sa-dict-alias-meta">
                            {a.external_sku ? <span className="sa-mono ltr">{a.external_sku}</span> : null}
                            {a.external_sku && facts.length > 0 ? " · " : null}
                            {facts.join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <span className="sa-dict-alias-state">
                        {pending ? (
                          <>
                            <Badge tone="warning" dot={false}>ממתין</Badge>
                            <Button
                              variant="link"
                              size="sm"
                              aria-label={`אישור "${a.external_name}" של ${sup}`}
                              isLoading={approvingId === a.id}
                              disabled={saving}
                              onClick={() => onApprove(a)}
                            >
                              אישור
                            </Button>
                          </>
                        ) : null}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        icon="x"
                        aria-label={`הסרת "${a.external_name}" של ${sup}`}
                        className="sa-dict-alias-remove"
                        disabled={saving}
                        onClick={() => onRemove(a)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {open ? <InlineAliasForm product={product} onClose={onClose} /> : null}
      </div>

      <div className="sa-dict-action">
        {open ? null : (
          <button ref={addRef} type="button" className="sa-dict-add" onClick={onOpen} aria-label={`הוספת שם עבור ${product.name}`}>
            הוספת שם
          </button>
        )}
      </div>
    </div>
  );
}
