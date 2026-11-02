"use client";

/**
 * קטלוג as a patch bay: our products on one side in our own language, every supplier's names on the other, thin lines
 * between them. Each name belongs to one product, so a product and its names are a star, and stars never have to cross.
 * What waits has no line yet and stands at the top. Same data, same writes and the same words as the shared page.
 */

import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { productOptions } from "@/components/app/forms/options";
import { useUi } from "@/components/app/ui-state";
import { Button, Count, cx, EmptyState, Icon, Modal, SearchBar, Showing } from "@/components/ui";
import { isTempId, normalizeName, useData, type Product, type SupplierItem } from "@/lib/store";
import { Band } from "../catalog/Band";
import { linkKey, type Link } from "../catalog/geometry";
import { OpenPorts } from "../catalog/OpenPorts";
import { CatalogPanel, type Lens, type Trace } from "../catalog/Panel";
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
  const [lens, setLens] = useState<Lens>({ category: null, supplier: null });
  const [seating, setSeating] = useState<SupplierItem | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);

  const supplierName = useCallback((id: string) => supplier(id)?.name ?? "ספק לא ידוע", [supplier]);

  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);

  /* ── pending inbox: every name that still needs a decision ──
   * pending names (with or without a guessed product) and any name whose
   * product no longer exists (the DB nulls product_id but keeps "approved"). */
  const inbox = useMemo(() => state.supplierItems.filter((i) => i.status === "pending" || !i.product_id || !product(i.product_id)).sort(byWork), [state.supplierItems, product]);

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

  /* ── the panel: what the list holds, by group ── */
  const groupOf = useCallback((p: Product) => p.category || NO_CATEGORY, []);
  const links = useMemo<Link[]>(() => {
    const counts = new Map<string, Link>();
    for (const i of state.supplierItems) {
      const p = product(i.product_id);
      if (!p) continue;
      const key = linkKey(groupOf(p), i.supplier_id);
      const link = counts.get(key);
      if (link) link.names += 1;
      else counts.set(key, { category: groupOf(p), supplierId: i.supplier_id, names: 1 });
    }
    return [...counts.values()];
  }, [state.supplierItems, product, groupOf]);

  const categories = useMemo(() => {
    const counts = new Map(state.products.map((p) => [groupOf(p), 0]));
    for (const link of links) counts.set(link.category, (counts.get(link.category) ?? 0) + link.names);
    return [...counts].map(([key, count]) => ({ key, label: key, count }));
  }, [state.products, links, groupOf]);

  const suppliers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of state.supplierItems) counts.set(i.supplier_id, (counts.get(i.supplier_id) ?? 0) + 1);
    return [...counts].map(([key, count]) => ({ key, label: supplierName(key), count }));
  }, [state.supplierItems, supplierName]);

  const shown = useMemo(() => {
    if (!lens.category && !lens.supplier) return visible;
    return visible
      .filter((row) => !lens.category || groupOf(row.product) === lens.category)
      .map((row) => (lens.supplier ? { ...row, aliases: row.aliases.filter((a) => a.supplier_id === lens.supplier) } : row))
      .filter((row) => !lens.supplier || row.aliases.length > 0);
  }, [visible, lens, groupOf]);

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
      const target = product(productId);
      if (target) setTrace((now) => ({ link: linkKey(groupOf(target), item.supplier_id), count: (now?.count ?? 0) + 1 }));
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
    [mapSupplierItem, product, notify, stillSaving, groupOf],
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
  // From deep in the list the rows above it go, so the bay's own head comes up with the answer.
  const bay = useRef<HTMLDivElement>(null);
  const onSupplier = useCallback((id: string) => {
    setLens((now) => ({ ...now, supplier: now.supplier === id ? null : id }));
    requestAnimationFrame(() => {
      const top = bay.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) bay.current?.scrollIntoView({ block: "start" });
    });
  }, []);

  // The row of a name just approved stays for a moment, so its wire can seat and the row can close.
  const waiting = seating && !inbox.some((i) => i.id === seating.id) ? [...inbox, seating].sort(byWork) : inbox;

  /* The search filters everything under it, the names waiting for approval too. */
  const inboxShown = q
    ? waiting.filter((i) => normalizeName(i.external_name).includes(q) || normalizeName(i.external_sku).includes(q) || normalizeName(supplierName(i.supplier_id)).includes(q))
    : waiting;

  const deleteSupplierLabel = pendingDelete ? supplierName(pendingDelete.supplier_id) : "";
  const lensOn = Boolean(lens.category || lens.supplier);
  const light = useLight();

  return (
    <div className="mh-cat">
      <header className="mh-cat-head">
        <div className="mh-cat-title">
          <h1 className="sa-page-title">מיפוי קטלוג</h1>
          <p className="sa-page-sub"><Count n={state.supplierItems.length} one="שם של ספק" many="שמות של ספקים" /></p>
        </div>
        <div className="mh-cat-tools">
          <SearchBar kbd={false} value={query} onChange={setQuery} placeholder='חיפוש לפי מוצר, מק"ט או שם אצל ספק' />
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

      {links.length > 0 ? (
        <div className={cx("mh-cat-fold", q && "is-folded")} inert={q ? true : undefined}>
          <CatalogPanel categories={categories} suppliers={suppliers} links={links} lens={lens} onLens={setLens} trace={trace} />
        </div>
      ) : null}

      {state.products.length === 0 ? (
        <EmptyState title="אין מוצרים" hint="המיפוי נבנה על המוצרים במלאי">
          <Button variant="secondary" onClick={() => openAction("new-product")}>מוצר חדש</Button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="לא נמצאו תוצאות" />
      ) : (
        <div ref={bay} className="mh-cat-bay" {...light}>
          <div className="mh-cat-bay-head">
            <span>מוצר במחסן{lens.category ? <> · {lens.category}</> : null}</span>
            <span />
            <span className="mh-cat-bay-head-names">
              <span>שם אצל הספק</span>
              <span>ספק{lens.supplier ? <> · {supplierName(lens.supplier)}</> : null}</span>
              {lensOn ? (
                <button type="button" className="mh-cat-bay-clear" onClick={() => setLens({ category: null, supplier: null })}><Icon name="x" size={14} />ניקוי</button>
              ) : <span />}
            </span>
          </div>
          <div role="list" aria-label="מוצרים ושמות של ספקים">
            {shown.map(({ product: p, aliases }) => (
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
              approvingId={approvingId}
            />
            ))}
          </div>
        </div>
      )}

      {(q || lensOn) && shown.length > 0 ? <p className="mh-cat-foot"><Showing shown={shown.length} total={rows.length} /></p> : null}

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
