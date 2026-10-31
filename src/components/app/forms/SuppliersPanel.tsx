"use client";

/**
 * The suppliers list, opened from the dictionary page header. Each row opens
 * the existing SupplierForm (edit + delete); the footer adds a new supplier.
 */
import { useMemo } from "react";
import { Button, EmptyState, SidePanel } from "@/components/ui";
import { useData } from "@/lib/store";
import { fmtQty } from "@/lib/format";
import { useUi } from "../ui-state";

export function SuppliersPanel() {
  const { state } = useData();
  const { close, openAction } = useUi();

  const suppliers = useMemo(() => [...state.suppliers].sort((a, b) => a.name.localeCompare(b.name, "he")), [state.suppliers]);

  const countBySupplier = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of state.supplierItems) m.set(i.supplier_id, (m.get(i.supplier_id) ?? 0) + 1);
    return m;
  }, [state.supplierItems]);

  const newSupplier = (
    <Button variant="primary" icon="plus" onClick={() => openAction("new-supplier")}>
      ספק חדש
    </Button>
  );

  return (
    <SidePanel
      title="ספקים"
      subtitle={`${fmtQty(suppliers.length)} ספקים`}
      onClose={close}
      className="sa-dict-suppliers"
      footer={
        <>
          <div />
          <div>{newSupplier}</div>
        </>
      }
    >
      {suppliers.length === 0 ? (
        <EmptyState icon="truck" title="אין עדיין ספקים" hint="הוסף ספק כדי לרשום איך הוא קורא למוצרים שלך">
          {newSupplier}
        </EmptyState>
      ) : (
        <ul className="sa-dict-suppliers-list" aria-label="רשימת הספקים">
          {suppliers.map((s) => {
            const sub = [s.contact, s.phone].filter((v): v is string => !!v && v.trim() !== "");
            return (
              <li key={s.id}>
                <button type="button" className="sa-dict-supplier" onClick={() => openAction("edit-supplier", { supplierId: s.id })}>
                  <span className="sa-dict-supplier-text">
                    <span className="sa-dict-supplier-name">{s.name}</span>
                    {sub.length > 0 ? (
                      <span className="sa-dict-supplier-sub">
                        {sub.map((v, idx) => (
                          <span key={idx}>
                            {idx > 0 ? " · " : null}
                            {v === s.phone ? <span className="sa-mono ltr">{v}</span> : v}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className="sa-dict-supplier-count">
                    <span className="sa-num">{fmtQty(countBySupplier.get(s.id) ?? 0)}</span> שמות
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SidePanel>
  );
}
