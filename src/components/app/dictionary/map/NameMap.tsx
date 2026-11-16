"use client";

/**
 * ספקים in the aluminium style: every product in our own words on the right, what each supplier calls it on the left,
 * a thin wire between them. A product and its names are a star, and stars never cross. A long list stands in its
 * categories, the busiest first, each folding under its word; a search is already narrow and stands flat.
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Count, Icon } from "@/components/ui";
import type { Product, SupplierItem } from "@/lib/store";
import { Band } from "./Band";
import { useLight } from "./use-light";
import "./name-map.css";

export type MapRow = { product: Product; aliases: SupplierItem[] };

const NO_CATEGORY = "ללא קטגוריה";

export interface NameMapProps {
  rows: MapRow[];
  /** A search narrows the list, and a narrow list stands flat. */
  flat: boolean;
  supplierName: (id: string) => string;
  openRowId: string | null;
  onOpenRow: (id: string) => void;
  onCloseRow: () => void;
  onOpenProduct: (id: string) => void;
  onOpenName: (item: SupplierItem) => void;
  onApprove: (item: SupplierItem) => void;
  onRemove: (item: SupplierItem) => void;
  onSupplier: (id: string) => void;
  approvingId: string | null;
}

const namesIn = (list: MapRow[]) => list.reduce((sum, row) => sum + row.aliases.length, 0);

export function NameMap({ rows, flat, supplierName, openRowId, onOpenRow, onCloseRow, onOpenProduct, onOpenName, onApprove, onRemove, onSupplier, approvingId }: NameMapProps): ReactElement {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const light = useLight();

  const sections = useMemo(() => {
    if (flat) return null;
    const byCategory = new Map<string, MapRow[]>();
    for (const row of rows) {
      const key = row.product.category || NO_CATEGORY;
      const list = byCategory.get(key);
      if (list) list.push(row);
      else byCategory.set(key, [row]);
    }
    return [...byCategory].sort(([a, la], [b, lb]) => namesIn(lb) - namesIn(la) || a.localeCompare(b, "he"));
  }, [flat, rows]);

  const fold = useCallback((key: string) => {
    setFolded((now) => {
      const next = new Set(now);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const band = ({ product: p, aliases }: MapRow) => (
    <Band
      key={p.id}
      product={p}
      aliases={aliases}
      supplierName={supplierName}
      open={openRowId === p.id}
      onOpen={onOpenRow}
      onClose={onCloseRow}
      onOpenProduct={onOpenProduct}
      onOpenName={onOpenName}
      onApprove={onApprove}
      onRemove={onRemove}
      onSupplier={onSupplier}
      approvingId={aliases.some((a) => a.id === approvingId) ? approvingId : null}
    />
  );

  return (
    // The frame is what the layout measures: the map changes shape by the room it has, not by the window.
    <div className="sa-map-frame">
    <div className="sa-map" {...light}>
      <div className="sa-map-head" aria-hidden="true">
        <span>מוצר במחסן</span>
        <span />
        <span className="sa-map-head-names">
          <span>שם אצל הספק</span>
          <span>ספק</span>
          <span />
        </span>
      </div>
      {sections ? (
        sections.map(([key, list]) => {
          const open = !folded.has(key);
          return (
            <section key={key} className="sa-map-section" aria-label={key}>
              <button type="button" className="sa-map-section-head" aria-expanded={open} onClick={() => fold(key)}>
                <span className="sa-map-section-word">{key}</span>
                <span className="sa-map-section-note">
                  <Count n={list.length} one="מוצר" many="מוצרים" /> · <Count n={namesIn(list)} one="שם" many="שמות" />
                </span>
                <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
              </button>
              {open ? <div role="list">{list.map(band)}</div> : null}
            </section>
          );
        })
      ) : (
        <div role="list" aria-label="מוצרים ושמות של ספקים">{rows.map(band)}</div>
      )}
    </div>
    </div>
  );
}
