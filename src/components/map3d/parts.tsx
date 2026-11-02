"use client";

import { useState, type ReactNode } from "react";
import { errorMessage } from "@/components/app/forms/useForm";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Modal, Notice } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import { useData, type Product } from "@/lib/store";

export function RailSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="m3d-section">
      <h3 className="sa-section-title">
        {title}
        {count ? <span className="sa-mono m3d-count">{fmtQty(count)}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** A ruled row. With `onOpen` the whole row is one button, and `end` stays its own control. */
export function RailRow({ onOpen, end, expanded, children }: { onOpen?: () => void; end?: ReactNode; expanded?: boolean; children: ReactNode }) {
  return (
    <li className="sa-order-line m3d-row">
      {onOpen ? (
        <button type="button" className="sa-attention-open m3d-row-main" aria-expanded={expanded} onClick={onOpen}>
          {children}
        </button>
      ) : (
        <div className="m3d-row-main">{children}</div>
      )}
      {end ? <span className="m3d-row-end">{end}</span> : null}
    </li>
  );
}

/** What a dated view cannot show: orders, counts and ₪ are today's facts. */
export function TodayOnly({ onToday }: { onToday: () => void }) {
  return (
    <EmptyState title="מוצג להיום בלבד">
      <Button variant="secondary" onClick={onToday}>חזרה להיום</Button>
    </EmptyState>
  );
}

export interface PlaceChange {
  product: Product;
  location: string;
}

/** Every write of products.location passes here: a stray click on a map must not move stock on the workers' phones. */
export function PlaceConfirm({ change, onClose }: { change: PlaceChange; onClose: () => void }) {
  const { updateProduct } = useData();
  const { notify } = useUi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { product, location } = change;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateProduct(product.id, { location });
      notify({ tone: "success", title: `המיקום עודכן: ${location}`, text: product.name });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={`לשבץ ב-${location}?`} busy={busy} onConfirm={() => void confirm()} onClose={onClose}>
      <div className="flex flex-col gap-[var(--space-3)]">
        <p className="m-0">{product.location ? `${product.name}, כעת ב-${product.location}` : product.name}</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
