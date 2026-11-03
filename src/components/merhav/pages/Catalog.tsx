"use client";

/**
 * ספקים: who brings what, and what they call it. One table of suppliers, and a row opens to the names that supplier
 * uses for our products. What a delivery note brought in and nobody has settled yet waits at the top. Same data, same
 * writes and the same words as the shared page.
 */

import { useCallback, useDeferredValue, useMemo, useState, type ReactElement } from "react";
import { productOptions } from "@/components/app/forms/options";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, Count, cx, EmptyState, Icon, Modal, SearchBar, Showing } from "@/components/ui";
import { fmtName, fmtQty, fmtRelative } from "@/lib/format";
import { isTempId, normalizeName, useData, type Supplier, type SupplierItem } from "@/lib/store";
import { OpenPorts } from "../catalog/OpenPorts";

type Row = { supplier: Supplier; names: SupplierItem[]; pending: number; products: number };

/** How long a seated name stays before its row closes. It matches the close in catalog.css. */
const SEAT = 460;

const byWork = (a: SupplierItem, b: SupplierItem) => b.times_seen - a.times_seen || b.created_at.localeCompare(a.created_at);

const digitsOf = (text: string) => text.replace(/\D/g, "");

export function Catalog(): ReactElement {
  const { state, product, supplier, mapSupplierItem, deleteSupplierItem } = useData();
  const { openAction, notify } = useUi();

  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SupplierItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [seating, setSeating] = useState<SupplierItem | null>(null);

  const supplierName = useCallback((id: string) => supplier(id)?.name ?? "ספק לא ידוע", [supplier]);

  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);

  /* ── what still needs a decision: pending names, and names whose product no longer exists ── */
  const inbox = useMemo(() => state.supplierItems.filter((i) => i.status === "pending" || !i.product_id || !product(i.product_id)).sort(byWork), [state.supplierItems, product]);

  /* ── every supplier with its names ── */
  const rows = useMemo<Row[]>(() => {
    const bySupplier = new Map<string, SupplierItem[]>();
    for (const i of state.supplierItems) {
      const list = bySupplier.get(i.supplier_id);
      if (list) list.push(i);
      else bySupplier.set(i.supplier_id, [i]);
    }
    const rank = (i: SupplierItem) => (i.status === "pending" ? 0 : 1);
    return [...state.suppliers]
      .sort((a, b) => a.name.localeCompare(b.name, "he"))
      .map((s) => {
        const names = (bySupplier.get(s.id) ?? []).slice().sort((a, b) => rank(a) - rank(b) || b.times_seen - a.times_seen || a.external_name.localeCompare(b.external_name, "he"));
        const products = new Set(names.map((n) => n.product_id).filter((id): id is string => Boolean(id && product(id))));
        for (const p of state.products) if (p.primary_supplier_id === s.id) products.add(p.id);
        return { supplier: s, names, pending: names.filter((n) => n.status === "pending").length, products: products.size };
      });
  }, [state.suppliers, state.supplierItems, state.products, product]);

  // The field answers every key at once; a long list follows a moment later instead of holding the keys back.
  const q = normalizeName(useDeferredValue(query));
  const digits = useMemo(() => (/\p{L}/u.test(q) ? "" : digitsOf(q)), [q]);
  const nameHits = useCallback(
    (n: SupplierItem) => normalizeName(n.external_name).includes(q) || normalizeName(n.external_sku).includes(q) || normalizeName(product(n.product_id)?.name).includes(q) || normalizeName(product(n.product_id)?.sku).includes(q),
    [q, product],
  );
  const visible = useMemo(() => {
    if (!q) return rows;
    return rows.filter(({ supplier: s, names }) => {
      if (normalizeName(s.name).includes(q) || normalizeName(s.contact).includes(q)) return true;
      if (digits !== "" && digitsOf(s.phone ?? "").includes(digits)) return true;
      return names.some(nameHits);
    });
  }, [rows, q, digits, nameHits]);

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

  const onOpenName = useCallback((item: SupplierItem) => openAction("map-supplier-item", { supplierItemId: item.id }), [openAction]);

  // The row of a name just approved stays for a moment, so its row can close as one movement.
  const waiting = seating && !inbox.some((i) => i.id === seating.id) ? [...inbox, seating].sort(byWork) : inbox;

  /* The search narrows everything under it, the names waiting for a decision too. */
  const inboxShown = q
    ? waiting.filter((i) => normalizeName(i.external_name).includes(q) || normalizeName(i.external_sku).includes(q) || normalizeName(supplierName(i.supplier_id)).includes(q))
    : waiting;

  const deleteSupplierLabel = pendingDelete ? supplierName(pendingDelete.supplier_id) : "";

  /* ── a supplier's names: our product, their name for it, how often it came ── */
  const names = (row: Row) => {
    const hits = q ? row.names.filter(nameHits) : row.names;
    const shown = hits.length > 0 ? hits : row.names;
    return (
      <div className="mh-sup-names" role="region" aria-label={`השמות של ${row.supplier.name}`}>
        {shown.length > 0 ? (
          <>
            <div className="mh-sup-names-head" aria-hidden="true">
              <span>מוצר במחסן</span>
              <span>שם אצל הספק</span>
              <span>נראה</span>
              <span />
            </div>
            {shown.map((n) => {
              const p = product(n.product_id);
              return (
                <button key={n.id} type="button" className="mh-sup-name-row" onClick={() => onOpenName(n)}>
                  <span className="mh-sup-ours">
                    <ProductThumb product={p} small />
                    <span className="mh-row-main">
                      <span className="mh-row-title">{p ? fmtName(p.name) : <span className="mh-tone-warn">ללא התאמה</span>}</span>
                      {p ? <span className="mh-row-sub ltr">{p.sku}</span> : null}
                    </span>
                  </span>
                  <span className="mh-row-main">
                    <span className="mh-sup-their">{n.external_name}</span>
                    {n.external_sku ? <span className="mh-row-sub ltr">{n.external_sku}</span> : null}
                  </span>
                  <span className="mh-row-sub">
                    {n.status === "pending" ? <span className="mh-tone-warn">ממתין · </span> : null}
                    {n.times_seen > 0 ? `${fmtQty(n.times_seen)} פעמים` : "עוד לא"}
                    {n.last_seen_at ? ` · ${fmtRelative(n.last_seen_at)}` : ""}
                  </span>
                  <Icon name="chevron-left" size={14} />
                </button>
              );
            })}
          </>
        ) : (
          <p className="mh-sup-none">עוד אין שמות. שם מתעודת משלוח יופיע כאן אחרי הקליטה הראשונה.</p>
        )}
        <div className="mh-sup-keys">
          <Button variant="secondary" size="sm" icon="plus" onClick={() => openAction("new-supplier-item", { supplierId: row.supplier.id })}>שם חדש</Button>
          <Button variant="ghost" size="sm" icon="edit" onClick={() => openAction("edit-supplier", { supplierId: row.supplier.id })}>עריכת ספק</Button>
        </div>
      </div>
    );
  };

  return (
    <div className="mh-cat">
      <header className="mh-cat-head">
        <div className="mh-cat-title">
          <h1 className="sa-page-title">ספקים</h1>
          <p className="sa-page-sub">מי מביא מה, ואיך הוא קורא לזה · <Count n={state.suppliers.length} one="ספק" many="ספקים" /></p>
        </div>
        <div className="mh-cat-tools">
          <SearchBar kbd={false} value={query} onChange={setQuery} placeholder="חיפוש לפי ספק, מוצר או שם אצל הספק" />
          <Button variant="primary" icon="plus" onClick={() => openAction("new-supplier")}>ספק חדש</Button>
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

      {state.suppliers.length === 0 ? (
        <EmptyState title="אין ספקים" hint="ספק ראשון יופיע כאן עם השמות שהוא נותן למוצרים">
          <Button variant="secondary" onClick={() => openAction("new-supplier")}>ספק חדש</Button>
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState title="לא נמצאו ספקים" hint={<>עבור „{query.trim()}”</>} />
      ) : (
        <div className="mh-sup" role="list" aria-label="רשימת הספקים">
          <div className="mh-sup-head" aria-hidden="true">
            <span>ספק</span>
            <span>איש קשר</span>
            <span>טלפון</span>
            <span>מוצרים</span>
            <span>שמות</span>
            <span />
          </div>
          {visible.map((row) => {
            const open = openId === row.supplier.id;
            const s = row.supplier;
            return (
              <div key={s.id} role="listitem" className={cx("mh-sup-item", open && "is-open")}>
                <button type="button" className="mh-sup-row" aria-expanded={open} onClick={() => setOpenId(open ? null : s.id)}>
                  <span className="mh-row-main">
                    <span className="mh-sup-name">{s.name}</span>
                    {row.pending > 0 ? <span className="mh-row-sub mh-tone-warn"><Count n={row.pending} one="שם ממתין לאישור" many="שמות ממתינים לאישור" /></span> : null}
                  </span>
                  <span className="mh-sup-cell">{s.contact || <span className="mh-tone-quiet">—</span>}</span>
                  <span className="mh-sup-cell">{s.phone ? <bdi className="ltr">{s.phone}</bdi> : <span className="mh-tone-quiet">—</span>}</span>
                  <span className="mh-sup-cell is-num"><span className={cx("ltr", row.products === 0 && "mh-tone-quiet")}>{fmtQty(row.products)}</span></span>
                  <span className="mh-sup-cell is-num"><span className={cx("ltr", row.names.length === 0 && "mh-tone-quiet")}>{fmtQty(row.names.length)}</span></span>
                  <Icon name="chevron-down" size={16} />
                </button>
                {open ? names(row) : null}
              </div>
            );
          })}
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
