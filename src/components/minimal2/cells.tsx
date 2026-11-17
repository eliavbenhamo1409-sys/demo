"use client";

/** What the tables of מינימל 2 share, so the same thing looks and reads the same in every list. */
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { ProductThumb } from "@/components/app/Viz";
import { Icon, type TableColumn } from "@/components/ui";
import { fmtName, fmtQty, fmtUnit } from "@/lib/format";
import type { Product, Supplier } from "@/lib/store";

/**
 * The end of a row whose press opens it: one quiet arrow, so the same word is not written down a whole column.
 * A row keeps a button only where the button is the work itself (assign, approve, close).
 */
export function goColumn<T>(): TableColumn<T> {
  return { key: "go", title: <span className="sr-only">פתיחה</span>, className: "mn2-cell-go", render: () => <Icon name="chevron-left" size={16} className="mn2-go" /> };
}

/** For a button inside a row: it does its own thing, and the row's own press stays for everywhere else. */
export const only = (run: () => void) => (e: MouseEvent): void => {
  e.stopPropagation();
  run();
};

/** A product at the head of a row: its photo, its whole name, and how the warehouse knows it. */
export function ProductCell({ product, sub }: { product: Product | undefined; sub?: ReactNode }): ReactElement {
  return (
    <span className="mn2-cell-lead">
      <ProductThumb product={product} />
      <span>
        <span className="mn2-cell-title">{product ? fmtName(product.name) : "מוצר שנמחק"}</span>
        {product ? (
          <span className="mn2-cell-sub">
            {sub ?? (
              <>
                <span className="sa-mono ltr">{product.sku}</span>
                {product.category ? ` · ${product.category}` : null}
              </>
            )}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** A quantity with its unit beside it, so a number is never bare. A dash for nothing to say. */
export function Qty({ n, unit, tone, empty = "—" }: { n: number | null; unit?: string; tone?: "short" | "bad" | "warn" | "ok" | "quiet"; empty?: string }): ReactElement {
  if (n === null) return <span className="mn2-cell-unset">{empty}</span>;
  return (
    <span className={`mn2-qty${tone ? ` is-${tone}` : ""}`}>
      <span className="ltr">{fmtQty(n)}</span>
      {unit ? <span className="mn2-qty-unit">{fmtUnit(n, unit)}</span> : null}
    </span>
  );
}

/** Who brings it and how to reach them. The phone dials; nothing else in the cell is pressed. */
export function SupplierCell({ supplier }: { supplier: Supplier | undefined }): ReactElement {
  if (!supplier) return <span className="mn2-cell-unset">לא נקבע ספק</span>;
  return (
    <>
      <span className="mn2-cell-text mn2-nowrap"><bdi>{supplier.name}</bdi></span>
      {supplier.phone ? (
        <a className="mn2-cell-sub mn2-tel ltr" href={`tel:${supplier.phone.replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()}>{supplier.phone}</a>
      ) : null}
    </>
  );
}
