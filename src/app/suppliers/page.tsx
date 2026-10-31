"use client";

/**
 * מילון ספקים — product first. Every product has one name in the factory;
 * each row lists what every supplier calls it. Pending names from delivery
 * notes sit in an inbox at the top until someone says which product they are.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { isTempId, normalizeName, useData, type Product, type SupplierItem } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { fmtQty } from "@/lib/format";
import { Button, Card, EmptyState, Modal, SearchBar } from "@/components/ui";
import { productOptions } from "@/components/app/forms/options";
import { PendingInbox } from "@/components/app/dictionary/PendingInbox";
import { ProductRow } from "@/components/app/dictionary/ProductRow";

type Row = { product: Product; aliases: SupplierItem[]; pending: number };

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

export default function SuppliersPage() {
  const { state, product, supplier, mapSupplierItem, approveSupplierItem, deleteSupplierItem } = useData();
  const { openAction, openProduct, notify } = useUi();

  const [query, setQuery] = useState("");
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SupplierItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loading = state.status === "loading";

  const supplierName = useCallback((id: string) => supplier(id)?.name ?? "ספק לא ידוע", [supplier]);

  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);

  /* ── pending inbox: every name that still needs a decision ──
   * pending names (with or without a guessed product) and any name whose
   * product no longer exists (the DB nulls product_id but keeps "approved"). */
  const inbox = useMemo(
    () =>
      state.supplierItems
        .filter((i) => i.status === "pending" || !i.product_id || !product(i.product_id))
        .sort((a, b) => b.times_seen - a.times_seen || b.created_at.localeCompare(a.created_at)),
    [state.supplierItems, product],
  );

  /* ── products with their aliases ── */
  const rows = useMemo<Row[]>(() => {
    const byProduct = new Map<string, SupplierItem[]>();
    for (const i of state.supplierItems) {
      if (!i.product_id || !product(i.product_id)) continue;
      const list = byProduct.get(i.product_id);
      if (list) list.push(i);
      else byProduct.set(i.product_id, [i]);
    }
    const rank = (i: SupplierItem) => (i.status === "pending" ? 0 : 1);
    return state.products
      .map((p) => {
        const aliases = (byProduct.get(p.id) ?? [])
          .slice()
          .sort((a, b) => rank(a) - rank(b) || b.times_seen - a.times_seen || a.external_name.localeCompare(b.external_name, "he"));
        return { product: p, aliases, pending: aliases.filter((a) => a.status === "pending").length };
      })
      .sort((a, b) => (b.pending > 0 ? 1 : 0) - (a.pending > 0 ? 1 : 0) || b.aliases.length - a.aliases.length || a.product.name.localeCompare(b.product.name, "he"));
  }, [state.products, state.supplierItems, product]);

  const q = normalizeName(query);
  const visible = useMemo(() => {
    if (!q) return rows;
    return rows.filter(({ product: p, aliases }) => {
      if (normalizeName(p.name).includes(q) || normalizeName(p.sku).includes(q) || normalizeName(p.barcode).includes(q)) return true;
      return aliases.some(
        (a) => normalizeName(a.external_name).includes(q) || normalizeName(a.external_sku).includes(q) || normalizeName(supplierName(a.supplier_id)).includes(q),
      );
    });
  }, [rows, q, supplierName]);
  const visibleAliases = useMemo(() => visible.reduce((n, r) => n + r.aliases.length, 0), [visible]);

  /* ── writes ── */
  const stillSaving = useCallback(
    (item: SupplierItem) => {
      if (!isTempId(item.id)) return false;
      notify({ tone: "neutral", title: "השם עדיין נשמר", text: "נסה שוב בעוד רגע" });
      return true;
    },
    [notify],
  );

  const approveWithProduct = useCallback(
    async (item: SupplierItem, productId: string) => {
      if (stillSaving(item)) return;
      setApprovingId(item.id);
      try {
        await mapSupplierItem(item.id, productId);
        const p = product(productId);
        notify({ tone: "success", title: `"${item.external_name}" אושר כ-${p?.name ?? ""}`.trim() });
      } catch (e) {
        notify({ tone: "danger", title: "האישור נכשל", text: e instanceof Error ? e.message : undefined });
      } finally {
        setApprovingId(null);
      }
    },
    [mapSupplierItem, product, notify, stillSaving],
  );

  const approveInRow = useCallback(
    async (item: SupplierItem) => {
      if (stillSaving(item)) return;
      setApprovingId(item.id);
      try {
        await approveSupplierItem(item.id);
        const p = product(item.product_id);
        notify({ tone: "success", title: `"${item.external_name}" אושר כ-${p?.name ?? ""}`.trim() });
      } catch (e) {
        notify({ tone: "danger", title: "האישור נכשל", text: e instanceof Error ? e.message : undefined });
      } finally {
        setApprovingId(null);
      }
    },
    [approveSupplierItem, product, notify, stillSaving],
  );

  const requestDelete = useCallback(
    (item: SupplierItem) => {
      if (stillSaving(item)) return;
      setPendingDelete(item);
    },
    [stillSaving],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || stillSaving(pendingDelete)) return;
    setDeleting(true);
    try {
      await deleteSupplierItem(pendingDelete.id);
      notify({ tone: "success", title: `"${pendingDelete.external_name}" הוסר`, text: supplierName(pendingDelete.supplier_id) });
      setPendingDelete(null);
    } catch (e) {
      notify({ tone: "danger", title: "המחיקה נכשלה", text: e instanceof Error ? e.message : undefined });
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, deleteSupplierItem, notify, supplierName, stillSaving]);

  const closeRow = useCallback(() => setOpenRowId(null), []);

  /* ── header counts (the pending count is exactly the inbox) ── */
  const counts: ReactNode[] = [
    <><span className="sa-num">{fmtQty(state.products.length)}</span> מוצרים</>,
    <><span className="sa-num">{fmtQty(state.supplierItems.length)}</span> שמות של ספקים</>,
  ];
  if (inbox.length > 0) counts.push(<><span className="sa-num">{fmtQty(inbox.length)}</span> ממתינים לאישור</>);

  /* ── list body ── */
  let body: ReactNode;
  if (loading) {
    body = (
      <div className="sa-dict-list" aria-busy="true" aria-label="טוען">
        {SKELETON_ROWS.map((i) => (
          <div key={i} className="sa-dict-skeleton">
            <div className="flex flex-col gap-2">
              <span className="sa-skeleton" style={{ width: 160, height: 14 }} />
              <span className="sa-skeleton" style={{ width: 96 }} />
            </div>
            <div className="sa-dict-skeleton-chips">
              <span className="sa-skeleton" style={{ width: 140 }} />
              <span className="sa-skeleton" style={{ width: 110 }} />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (state.products.length === 0) {
    body = (
      <EmptyState icon="package" title="אין עדיין מוצרים במפעל" hint="המילון נבנה על המוצרים במלאי. צור מוצר ראשון ואז רשום איך הספקים קוראים לו.">
        <Button variant="primary" icon="plus" onClick={() => openAction("new-product")}>מוצר חדש</Button>
      </EmptyState>
    );
  } else if (visible.length === 0) {
    body = <EmptyState icon="search" title="לא נמצא מוצר או שם שמתאים לחיפוש" />;
  } else {
    body = (
      <div className="sa-dict-list" role="list" aria-label="מוצרים ושמות של ספקים">
        <div className="sa-dict-head" aria-hidden="true">
          <span>המוצר במפעל</span>
          <span>איך הספקים קוראים לו</span>
          <span>הוספה</span>
        </div>
        {visible.map(({ product: p, aliases }) => (
          <ProductRow
            key={p.id}
            product={p}
            aliases={aliases}
            supplierName={supplierName}
            open={openRowId === p.id}
            onOpen={() => setOpenRowId(p.id)}
            onClose={closeRow}
            onOpenProduct={() => openProduct(p.id)}
            onApprove={(item) => void approveInRow(item)}
            onRemove={requestDelete}
            approvingId={approvingId}
          />
        ))}
      </div>
    );
  }

  const deleteSupplierLabel = pendingDelete ? supplierName(pendingDelete.supplier_id) : "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <h1 className="sa-page-title" style={{ fontSize: 30, lineHeight: "36px", fontWeight: 600 }}>מילון ספקים</h1>
          <p className="sa-page-sub">
            לכל מוצר שם אחד במפעל. כאן רושמים איך כל ספק קורא לו.
            {counts.map((c, i) => (
              <span key={i}> · {c}</span>
            ))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" icon="truck" onClick={() => openAction("suppliers")}>ספקים</Button>
          <Button variant="primary" icon="plus" onClick={() => openAction("new-supplier-item")}>שם של ספק</Button>
        </div>
      </header>

      {inbox.length > 0 ? (
        <PendingInbox
          items={inbox}
          productOptions={prodOpts}
          supplierName={supplierName}
          approvingId={approvingId}
          onApprove={(item, productId) => void approveWithProduct(item, productId)}
          onNewProduct={(item) => openAction("new-product", { supplierItemId: item.id })}
          onDelete={requestDelete}
        />
      ) : null}

      <SearchBar
        kbd={false}
        value={query}
        onChange={setQuery}
        placeholder='חיפוש מוצר, מק"ט, ברקוד או שם אצל ספק…'
        className="w-full max-w-[480px]"
      />

      <Card
        flush
        footer={
          !loading && state.products.length > 0 ? (
            <span>
              <span className="sa-num">{fmtQty(visible.length)}</span> מוצרים מוצגים · <span className="sa-num">{fmtQty(visibleAliases)}</span> שמות
            </span>
          ) : undefined
        }
      >
        {body}
      </Card>

      {pendingDelete ? (
        <Modal
          title={
            pendingDelete.status === "approved"
              ? `הסר את השם "${pendingDelete.external_name}" של ${deleteSupplierLabel}?`
              : `מחק את השם "${pendingDelete.external_name}" של ${deleteSupplierLabel}?`
          }
          tone="danger"
          confirmLabel={pendingDelete.status === "approved" ? "הסר" : "מחק"}
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onClose={() => !deleting && setPendingDelete(null)}
        >
          <p className="m-0">
            {pendingDelete.status === "approved"
              ? "קליטות עתידיות בשם הזה לא יזוהו אוטומטית."
              : "השם יימחק מהרשימה. אם יגיע שוב בתעודת משלוח הוא יופיע כאן מחדש."}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
