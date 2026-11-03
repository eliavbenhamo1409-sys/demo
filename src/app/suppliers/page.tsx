"use client";

/**
 * מיפוי קטלוג — product first. Every product has one name in the factory;
 * each row lists what every supplier calls it. Pending names from delivery
 * notes sit in an inbox at the top until someone says which product they are.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { isTempId, normalizeName, useData, type Product, type SupplierItem } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { Button, Card, Count, EmptyState, Modal, PageHead, Showing, Toolbar } from "@/components/ui";
import { productOptions } from "@/components/app/forms/options";
import { PendingInbox } from "@/components/app/dictionary/PendingInbox";
import { ProductRow } from "@/components/app/dictionary/ProductRow";
import { ProductThumb } from "@/components/app/Viz";

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

  /* ── writes ── */
  const stillSaving = useCallback(
    (item: SupplierItem) => {
      if (!isTempId(item.id)) return false;
      notify({ tone: "neutral", title: "השם עדיין נשמר", text: "אפשר לנסות שוב בעוד רגע" });
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

  /* ── list body ── */
  let body: ReactNode;
  if (loading) {
    body = (
      <div className="sa-dict-list" aria-busy="true" aria-label="טוען">
        {SKELETON_ROWS.map((i) => (
          <div key={i} className="sa-dict-skeleton">
            <div className="sa-thumbed">
              <ProductThumb />
              <div className="flex flex-col gap-2">
                <span className="sa-skeleton" style={{ width: 160, height: 14 }} />
                <span className="sa-skeleton" style={{ width: 96 }} />
              </div>
            </div>
            <div className="sa-dict-skeleton-names">
              <span className="sa-skeleton" style={{ width: 140 }} />
              <span className="sa-skeleton" style={{ width: 110 }} />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (state.products.length === 0) {
    body = (
      <EmptyState title="אין מוצרים" hint="המיפוי נבנה על המוצרים במלאי">
        <Button variant="secondary" onClick={() => openAction("new-product")}>מוצר חדש</Button>
      </EmptyState>
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState title="לא נמצאו מוצרים" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
        <Button variant="secondary" onClick={() => setQuery("")}>ניקוי סינון</Button>
      </EmptyState>
    );
  } else {
    body = (
      <div className="sa-dict-list" role="list" aria-label="מוצרים ושמות של ספקים">
        <div className="sa-dict-head" aria-hidden="true">
          <span>מוצר במחסן</span>
          <span className="sa-dict-head-names">
            <span>ספק</span>
            <span>שם אצל הספק</span>
          </span>
          <span />
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

  /* The search filters everything under it, the names waiting for approval too. */
  const inboxShown = q
    ? inbox.filter((i) => normalizeName(i.external_name).includes(q) || normalizeName(i.external_sku).includes(q) || normalizeName(supplierName(i.supplier_id)).includes(q))
    : inbox;

  const deleteSupplierLabel = pendingDelete ? supplierName(pendingDelete.supplier_id) : "";

  return (
    <div className="sa-page sa-dict-page">
      <PageHead
        title="מיפוי קטלוג"
        sub={<Count n={state.supplierItems.length} one="שם של ספק" many="שמות של ספקים" />}
        actions={
          <>
            <Button variant="secondary" icon="truck" onClick={() => openAction("suppliers")}>ספקים</Button>
            <Button variant="primary" icon="plus" onClick={() => openAction("new-supplier-item")}>שם חדש</Button>
          </>
        }
      />

      <Toolbar query={query} onQuery={setQuery} placeholder='חיפוש לפי מוצר, מק"ט או שם אצל ספק' />

      {inboxShown.length > 0 ? (
        <PendingInbox
          items={inboxShown}
          productOptions={prodOpts}
          supplierName={supplierName}
          approvingId={approvingId}
          onApprove={(item, productId) => void approveWithProduct(item, productId)}
          onNewProduct={(item) => openAction("new-product", { supplierItemId: item.id })}
          onDelete={requestDelete}
        />
      ) : null}

      <Card flush footer={q && visible.length > 0 ? <Showing shown={visible.length} total={rows.length} /> : undefined}>
        {body}
      </Card>

      {pendingDelete ? (
        <Modal
          title={
            pendingDelete.status === "approved"
              ? `להסיר את השם "${pendingDelete.external_name}" של ${deleteSupplierLabel}?`
              : `למחוק את השם "${pendingDelete.external_name}" של ${deleteSupplierLabel}?`
          }
          tone="danger"
          confirmLabel={pendingDelete.status === "approved" ? "הסרה" : "מחיקה"}
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
