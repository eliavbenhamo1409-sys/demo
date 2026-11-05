"use client";

/**
 * קטלוג in מרחב 2: every product we have, in our own words, and what every supplier calls it, with thin wires between them.
 * Each name belongs to one product, so a product and its names are a star, and stars never cross. What a delivery note
 * brought in and nobody has settled yet waits at the top, with no wire. The suppliers themselves, who to call and their
 * phones, open from the ספקים key. Same data, same writes and the same words as the shared page.
 */

import { useCallback, useDeferredValue, useMemo, useState, type ReactElement } from "react";
import { productOptions } from "@/components/app/forms/options";
import { useUi } from "@/components/app/ui-state";
import { Button, Count, EmptyState, Icon, Modal, SearchBar, Showing } from "@/components/ui";
import { isTempId, normalizeName, useData, type Product, type SupplierItem } from "@/lib/store";
import { OpenPorts } from "@/components/merhav/catalog/OpenPorts";
import { Band } from "../catalog/Band";
import { useLight } from "../catalog/use-light";

type Row = { product: Product; aliases: SupplierItem[]; pending: number };

const NO_CATEGORY = "ללא קטגוריה";

/** How long a seated wire stays before its row closes. It matches the close in catalog.css. */
const SEAT = 460;

const byWork = (a: SupplierItem, b: SupplierItem) => b.times_seen - a.times_seen || b.created_at.localeCompare(a.created_at);

export function Catalog(): ReactElement {
  const { state, product, supplier, mapSupplierItem, approveSupplierItem, unapproveSupplierItem, deleteSupplierItem } = useData();
  const { openAction, openProduct, notify } = useUi();

  const [query, setQuery] = useState("");
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SupplierItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [seating, setSeating] = useState<SupplierItem | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());

  const supplierName = useCallback((id: string) => supplier(id)?.name ?? "ספק לא ידוע", [supplier]);

  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);

  /* ── what still needs a decision: pending names, and names whose product no longer exists ── */
  const inbox = useMemo(() => state.supplierItems.filter((i) => i.status === "pending" || !i.product_id || !product(i.product_id)).sort(byWork), [state.supplierItems, product]);

  /* ── every product with its names: what waits first, then the ones with the most names ── */
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
        const aliases = (byProduct.get(p.id) ?? []).slice().sort((a, b) => rank(a) - rank(b) || b.times_seen - a.times_seen || a.external_name.localeCompare(b.external_name, "he"));
        return { product: p, aliases, pending: aliases.filter((a) => a.status === "pending").length };
      })
      .sort((a, b) => (b.pending > 0 ? 1 : 0) - (a.pending > 0 ? 1 : 0) || b.aliases.length - a.aliases.length || a.product.name.localeCompare(b.product.name, "he"));
  }, [state.products, state.supplierItems, product]);

  // The field answers every key at once; a long list follows a moment later instead of holding the keys back.
  const q = normalizeName(useDeferredValue(query));
  const visible = useMemo(() => {
    if (!q) return rows;
    return rows.filter(({ product: p, aliases }) => {
      if (normalizeName(p.name).includes(q) || normalizeName(p.sku).includes(q) || normalizeName(p.barcode).includes(q)) return true;
      return aliases.some((a) => normalizeName(a.external_name).includes(q) || normalizeName(a.external_sku).includes(q) || normalizeName(supplierName(a.supplier_id)).includes(q));
    });
  }, [rows, q, supplierName]);

  /* ── a long list stands in its categories, the busiest first; a search is already narrow and stands flat ── */
  const groupOf = useCallback((p: Product) => p.category || NO_CATEGORY, []);
  const sections = useMemo(() => {
    if (q) return null;
    const byCategory = new Map<string, Row[]>();
    for (const row of visible) {
      const key = groupOf(row.product);
      const list = byCategory.get(key);
      if (list) list.push(row);
      else byCategory.set(key, [row]);
    }
    const names = (list: Row[]) => list.reduce((sum, row) => sum + row.aliases.length, 0);
    return [...byCategory].sort(([a, la], [b, lb]) => names(lb) - names(la) || a.localeCompare(b, "he"));
  }, [q, visible, groupOf]);

  const fold = useCallback((key: string) => {
    setFolded((now) => {
      const next = new Set(now);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

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
      setSeating(item);
      window.setTimeout(() => setSeating((now) => (now?.id === item.id ? null : now)), SEAT);
      try {
        await mapSupplierItem(item.id, productId);
        const p = product(productId);
        notify({ tone: "success", title: `"${item.external_name}" אושר כ-${p?.name ?? ""}`.trim() });
      } catch (e) {
        setSeating(null);
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

  const unapprove = useCallback(
    async (item: SupplierItem) => {
      if (stillSaving(item)) return;
      try {
        await unapproveSupplierItem(item.id);
        notify({ tone: "success", title: `"${item.external_name}" חזר לממתינים` });
      } catch (e) {
        notify({ tone: "danger", title: "ביטול האישור נכשל", text: e instanceof Error ? e.message : undefined });
      }
    },
    [unapproveSupplierItem, notify, stillSaving],
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
  const onOpenName = useCallback((item: SupplierItem) => openAction("map-supplier-item", { supplierItemId: item.id }), [openAction]);
  const onApprove = useCallback((item: SupplierItem) => void approveInRow(item), [approveInRow]);
  const onUnapprove = useCallback((item: SupplierItem) => void unapprove(item), [unapprove]);
  // A supplier's name on a wire opens the supplier itself: who they are and how to reach them.
  const onSupplier = useCallback((id: string) => openAction("edit-supplier", { supplierId: id }), [openAction]);

  // The row of a name just approved stays for a moment, so its wire can seat and the row can close.
  const waiting = seating && !inbox.some((i) => i.id === seating.id) ? [...inbox, seating].sort(byWork) : inbox;

  /* The search narrows everything under it, the names waiting for a decision too. */
  const inboxShown = q
    ? waiting.filter((i) => normalizeName(i.external_name).includes(q) || normalizeName(i.external_sku).includes(q) || normalizeName(supplierName(i.supplier_id)).includes(q))
    : waiting;

  const deleteSupplierLabel = pendingDelete ? supplierName(pendingDelete.supplier_id) : "";
  const light = useLight();

  const band = ({ product: p, aliases }: Row) => (
    <Band
      key={p.id}
      product={p}
      aliases={aliases}
      supplierName={supplierName}
      open={openRowId === p.id}
      onOpen={setOpenRowId}
      onClose={closeRow}
      onOpenProduct={openProduct}
      onOpenName={onOpenName}
      onApprove={onApprove}
      onUnapprove={onUnapprove}
      onRemove={requestDelete}
      onSupplier={onSupplier}
      approvingId={aliases.some((a) => a.id === approvingId) ? approvingId : null}
    />
  );

  return (
    <div className="mh-cat m2-cat">
      <header className="mh-cat-head">
        <div className="mh-cat-title">
          <h1 className="sa-page-title">קטלוג</h1>
          <p className="sa-page-sub">כל המוצרים, ואיך כל ספק קורא להם · <Count n={state.supplierItems.length} one="שם של ספק" many="שמות של ספקים" /></p>
        </div>
        <div className="mh-cat-tools">
          <SearchBar kbd={false} value={query} onChange={setQuery} placeholder='חיפוש לפי מוצר, מק"ט, ספק או שם אצל הספק' />
          <Button variant="secondary" icon="truck" onClick={() => openAction("suppliers")}>ספקים</Button>
          <Button variant="primary" icon="plus" onClick={() => openAction("new-supplier-item")}>שם חדש</Button>
        </div>
      </header>

      {inboxShown.length > 0 ? (
        <OpenPorts
          items={inboxShown}
          productOptions={prodOpts}
          supplierName={supplierName}
          approvingId={approvingId}
          seatingId={seating?.id ?? null}
          onApprove={(item, productId) => void approveWithProduct(item, productId)}
          onNewProduct={(item) => openAction("new-product", { supplierItemId: item.id })}
          onDelete={requestDelete}
          onPort={onOpenName}
        />
      ) : null}

      {state.products.length === 0 ? (
        <EmptyState title="אין מוצרים" hint="הקטלוג נבנה על המוצרים במלאי">
          <Button variant="secondary" onClick={() => openAction("new-product")}>מוצר חדש</Button>
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState title="לא נמצאו מוצרים" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
          <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
        </EmptyState>
      ) : (
        <div className="mh-cat-bay" {...light}>
          <div className="mh-cat-bay-head">
            <span className="mh-cat-bay-held">מוצר במחסן</span>
            <span />
            <span className="mh-cat-bay-head-names">
              <span>שם אצל הספק</span>
              <span>ספק</span>
              <span />
            </span>
          </div>
          {sections ? (
            sections.map(([key, list]) => {
              const open = !folded.has(key);
              return (
                <section key={key} className="mh-cat-section" aria-label={key}>
                  <button type="button" className="mh-cat-section-head" aria-expanded={open} onClick={() => fold(key)}>
                    <span className="mh-cat-section-word">{key}</span>
                    <span className="mh-cat-section-note">
                      <Count n={list.length} one="מוצר" many="מוצרים" /> · <Count n={list.reduce((sum, row) => sum + row.aliases.length, 0)} one="שם" many="שמות" />
                    </span>
                    <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
                  </button>
                  {open ? <div role="list">{list.map(band)}</div> : null}
                </section>
              );
            })
          ) : (
            <div role="list" aria-label="מוצרים ושמות של ספקים">{visible.map(band)}</div>
          )}
        </div>
      )}

      {q && visible.length > 0 ? <p className="mh-cat-foot"><Showing shown={visible.length} total={rows.length} /></p> : null}

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
