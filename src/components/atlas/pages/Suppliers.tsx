"use client";

/**
 * ספקים as an ordered industrial library: the title, one sentence and three figures, the search on one line, the names
 * waiting for a decision as two-sided rows (the name as the supplier wrote it, one arrow, the factory product), then the
 * suppliers as a table ruled only between rows, each row unfolding what that supplier calls what. Same data, rules and
 * words as the shared page (src/app/suppliers/page.tsx); the drawers it opens are the shared ones. No model on this page.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { useUi } from "@/components/app/ui-state";
import { Button, cx, EmptyState, Icon, Modal, SearchBar, Select, type SelectOption } from "@/components/ui";
import { fmtName, fmtQty } from "@/lib/format";
import { isTempId, normalizeName, useData, type Product, type Supplier, type SupplierItem } from "@/lib/store";
import { Head, Summary, type SumItem } from "../parts";

type SortKey = "name" | "products" | "names" | "pending";

interface Row {
  supplier: Supplier;
  /** Products whose primary supplier this is. */
  products: number;
  /** Approved names with a product that still exists: the supplier's library. */
  names: SupplierItem[];
  /** Names of this supplier still waiting at the top of the page. */
  pending: number;
}

const SAVING = "עדיין נשמר";

/** How often a name turned up on delivery notes, in the shared page's words. */
const seen = (times: number) => (times === 1 ? "נראה פעם אחת" : times === 2 ? "נראה פעמיים" : `נראה ${fmtQty(times)} פעמים`);

const has = (v: string | null | undefined, q: string) => normalizeName(v).includes(q);

/* ───────── one name waiting for a decision ───────── */

interface MatchProps {
  item: SupplierItem;
  /** The product the receipt guessed, when it still exists. */
  guess: Product | undefined;
  busy: boolean;
  options: SelectOption[];
  supplierName: string;
  onApprove: (item: SupplierItem, productId: string) => void;
  onOpenProduct: (id: string) => void;
  onNewProduct: (item: SupplierItem) => void;
  onDelete: (item: SupplierItem) => void;
}

function Match({ item, guess, busy, options, supplierName, onApprove, onOpenProduct, onNewProduct, onDelete }: MatchProps): ReactElement {
  // The row owns its choice, keyed by the item, so it resets when the name leaves the list.
  const [picked, setPicked] = useState(guess?.id ?? "");
  const [changing, setChanging] = useState(false);
  const saving = isTempId(item.id);
  const locked = busy || saving;
  const hint = saving ? SAVING : undefined;
  const productId = guess && !changing ? guess.id : picked;

  return (
    <li className="at-su-match">
      <div className="at-su-from">
        <span className="at-su-ext" title={item.external_name}><bdi>{item.external_name}</bdi></span>
        <span className="at-su-meta">
          {supplierName}
          {item.external_sku ? <> · <span className="ltr">{item.external_sku}</span></> : null}
          {item.times_seen > 0 ? ` · ${seen(item.times_seen)}` : null}
          {saving ? ` · ${SAVING}` : null}
        </span>
      </div>
      <span className="at-su-arrow" aria-hidden="true"><Icon name="arrow-left" size={18} /></span>
      <div className="at-su-to">
        {guess && !changing ? (
          <>
            <button type="button" className="at-su-prod" title="פתיחת המוצר" onClick={() => onOpenProduct(guess.id)}>{fmtName(guess.name)}</button>
            <span className="at-su-meta">
              <span className="ltr">{guess.sku}</span>
              {" · "}
              <button type="button" className="at-su-swap" disabled={locked} onClick={() => setChanging(true)}>שינוי</button>
            </span>
          </>
        ) : (
          <Select options={options} value={picked} onChange={setPicked} placeholder="בחירת מוצר" searchPlaceholder='חיפוש לפי שם או מק"ט' block disabled={locked} />
        )}
      </div>
      <div className="at-su-acts">
        <Button variant="secondary" disabled={!productId || saving} isLoading={busy} title={hint} aria-label={`אישור "${item.external_name}"`} onClick={() => onApprove(item, productId)}>
          אישור
        </Button>
        <Button variant="ghost" disabled={locked} title={hint} onClick={() => onNewProduct(item)}>מוצר חדש</Button>
        <Button variant="ghost" className="at-su-del" disabled={locked} title={hint} aria-label={`מחיקת "${item.external_name}"`} onClick={() => onDelete(item)}>
          מחיקה
        </Button>
      </div>
    </li>
  );
}

/* ───────── the page ───────── */

export function Suppliers(): ReactElement {
  const { state, product, supplier, mapSupplierItem, approveSupplierItem, deleteSupplierItem } = useData();
  const { panel, openAction, openProduct, notify } = useUi();

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [ascending, setAscending] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SupplierItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const waitRef = useRef<HTMLElement>(null);

  const supplierName = useCallback((id: string) => supplier(id)?.name ?? "ספק לא ידוע", [supplier]);
  const options = useMemo<SelectOption[]>(() => state.products.map((p) => ({ value: p.id, label: `${p.name} · ${p.sku}` })), [state.products]);

  // Every name that still needs a decision: pending, with or without a guessed product, and any whose product is gone
  // (the DB nulls product_id but keeps "approved").
  const inbox = useMemo(
    () =>
      state.supplierItems
        .filter((i) => i.status === "pending" || !i.product_id || !product(i.product_id))
        .sort((a, b) => b.times_seen - a.times_seen || b.created_at.localeCompare(a.created_at)),
    [state.supplierItems, product],
  );

  const rows = useMemo<Row[]>(() => {
    const waiting = new Set(inbox.map((i) => i.id));
    const names = new Map<string, SupplierItem[]>();
    const pending = new Map<string, number>();
    for (const i of state.supplierItems) {
      if (waiting.has(i.id)) {
        pending.set(i.supplier_id, (pending.get(i.supplier_id) ?? 0) + 1);
        continue;
      }
      const list = names.get(i.supplier_id);
      if (list) list.push(i);
      else names.set(i.supplier_id, [i]);
    }
    const products = new Map<string, number>();
    for (const p of state.products) if (p.primary_supplier_id) products.set(p.primary_supplier_id, (products.get(p.primary_supplier_id) ?? 0) + 1);
    return state.suppliers.map((s) => ({
      supplier: s,
      products: products.get(s.id) ?? 0,
      names: (names.get(s.id) ?? []).sort((a, b) => b.times_seen - a.times_seen || a.external_name.localeCompare(b.external_name, "he")),
      pending: pending.get(s.id) ?? 0,
    }));
  }, [state.suppliers, state.supplierItems, state.products, inbox]);

  // The search reads the supplier, what it calls things, and the products it brings; the names waiting at the top too.
  const q = normalizeName(query);
  const visible = useMemo(() => {
    const list = q
      ? rows.filter(
          ({ supplier: s, names }) =>
            has(s.name, q) || has(s.contact, q) || has(s.phone, q)
            || names.some((a) => has(a.external_name, q) || has(a.external_sku, q) || has(product(a.product_id)?.name, q) || has(product(a.product_id)?.sku, q))
            || state.products.some((p) => p.primary_supplier_id === s.id && (has(p.name, q) || has(p.sku, q) || has(p.barcode, q))),
        )
      : rows;
    const dir = ascending ? 1 : -1;
    const byName = (a: Row, b: Row) => a.supplier.name.localeCompare(b.supplier.name, "he");
    return [...list].sort((a, b) => {
      if (sortKey === "products") return (a.products - b.products) * dir || byName(a, b);
      if (sortKey === "names") return (a.names.length - b.names.length) * dir || byName(a, b);
      if (sortKey === "pending") return (a.pending - b.pending) * dir || byName(a, b);
      return byName(a, b) * dir;
    });
  }, [rows, q, ascending, sortKey, product, state.products]);
  const inboxShown = q ? inbox.filter((i) => has(i.external_name, q) || has(i.external_sku, q) || has(supplierName(i.supplier_id), q)) : inbox;

  const sortBy = (key: SortKey) => {
    if (sortKey === key) setAscending((v) => !v);
    else {
      setSortKey(key);
      // Counts open with the largest first; names open in their order.
      setAscending(key === "name");
    }
  };

  /* ───────── the fold: one supplier open at a time, leaving the way it came ───────── */
  const toggle = (id: string) => {
    if (openId) setLeavingId(openId);
    setOpenId(openId === id ? null : id);
  };
  useEffect(() => {
    if (!leavingId) return;
    const t = setTimeout(() => setLeavingId(null), 240);
    return () => clearTimeout(t);
  }, [leavingId]);
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    // A key on the row's own button is the button's.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(id);
    }
  };

  /* ───────── writes, in the shared page's words ───────── */
  const stillSaving = useCallback(
    (item: SupplierItem) => {
      if (!isTempId(item.id)) return false;
      notify({ tone: "neutral", title: "השם עדיין נשמר", text: "אפשר לנסות שוב בעוד רגע" });
      return true;
    },
    [notify],
  );

  const approve = useCallback(
    async (item: SupplierItem, productId: string) => {
      if (stillSaving(item)) return;
      setApprovingId(item.id);
      try {
        // The guessed product needs only the word of approval; any other product is a new mapping.
        if (item.product_id === productId && product(productId)) await approveSupplierItem(item.id);
        else await mapSupplierItem(item.id, productId);
        notify({ tone: "success", title: `"${item.external_name}" אושר כ-${product(productId)?.name ?? ""}`.trim() });
      } catch (e) {
        notify({ tone: "danger", title: "האישור נכשל", text: e instanceof Error ? e.message : undefined });
      } finally {
        setApprovingId(null);
      }
    },
    [stillSaving, product, approveSupplierItem, mapSupplierItem, notify],
  );

  const requestDelete = useCallback(
    (item: SupplierItem) => {
      if (!stillSaving(item)) setPendingDelete(item);
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
  }, [pendingDelete, stillSaving, deleteSupplierItem, notify, supplierName]);

  /* ───────── the page ───────── */
  const summary: SumItem[] = [
    { label: "ספקים", value: state.suppliers.length },
    { label: "שמות", value: state.supplierItems.length },
  ];

  const head = (key: SortKey, word: string, className?: string, num = false) => (
    <th scope="col" className={cx(num && "is-num", className)} aria-sort={sortKey === key ? (ascending ? "ascending" : "descending") : undefined}>
      <button type="button" aria-pressed={sortKey === key} onClick={() => sortBy(key)}>
        {word}
        {sortKey === key ? <Icon name={ascending ? "chevron-up" : "chevron-down"} size={12} /> : null}
      </button>
    </th>
  );

  const editing = panel?.type === "action" && panel.kind === "edit-supplier" ? panel.ctx.supplierId : undefined;
  const deleteSupplierLabel = pendingDelete ? supplierName(pendingDelete.supplier_id) : "";

  return (
    <div className="at-su">
      <Head
        title="ספקים"
        line={
          <>
            <span className="at-su-lead">מי מביא מה, ואיך הוא קורא לזה</span>
            <Summary items={summary} />
          </>
        }
      >
        <Button variant="ghost" onClick={() => openAction("suppliers")}>רשימת ספקים</Button>
        <Button variant="secondary" onClick={() => openAction("new-supplier-item")}>שם חדש</Button>
        <Button variant="primary" icon="plus" onClick={() => openAction("new-supplier")}>ספק חדש</Button>
      </Head>

      <div className="at-tools">
        <SearchBar kbd={false} value={query} onChange={setQuery} placeholder='חיפוש לפי ספק, מוצר, מק"ט או שם אצל ספק' />
      </div>

      {inboxShown.length > 0 ? (
        <section ref={waitRef} className="at-su-wait" aria-labelledby="at-su-wait-title">
          <header className="at-su-wait-head">
            <h2 id="at-su-wait-title">
              ממתין לאישור <span className="at-su-n ltr">({fmtQty(inboxShown.length)})</span>
            </h2>
            <span className="at-su-wait-hint">שמות מתעודות משלוח שצריך לשייך למוצר במחסן</span>
          </header>
          <ul className="at-su-matches">
            {inboxShown.map((item) => (
              <Match
                key={item.id}
                item={item}
                guess={item.product_id ? product(item.product_id) : undefined}
                busy={approvingId === item.id}
                options={options}
                supplierName={supplierName(item.supplier_id)}
                onApprove={(i, id) => void approve(i, id)}
                onOpenProduct={openProduct}
                onNewProduct={(i) => openAction("new-product", { supplierItemId: i.id })}
                onDelete={requestDelete}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="at-table-wrap">
        <table className="at-table at-su-table">
          <thead>
            <tr>
              {head("name", "ספק", "is-name")}
              <th scope="col" className="is-phone">טלפון</th>
              {head("products", "מוצרים", "is-products", true)}
              {head("names", "שמות", "is-names", true)}
              {head("pending", "ממתינים", "is-pending", true)}
              <th scope="col" className="is-act" aria-label="פעולות" />
            </tr>
          </thead>
          <tbody>
            {visible.map(({ supplier: s, products, names, pending }) => {
              const open = s.id === openId;
              const fold = open ? "open" : s.id === leavingId ? "leaving" : null;
              return (
                <Fragment key={s.id}>
                  <tr
                    tabIndex={0}
                    aria-expanded={open}
                    aria-current={s.id === editing ? "true" : undefined}
                    className={cx((open || s.id === editing) && "is-selected")}
                    onClick={() => toggle(s.id)}
                    onKeyDown={(e) => onRowKey(e, s.id)}
                  >
                    <td className="is-name">
                      <span className="at-cell">
                        <span className="at-cell-text">
                          <span className="at-cell-title" title={s.name}>{s.name}</span>
                          {s.contact ? <span className="at-cell-sub">{s.contact}</span> : null}
                        </span>
                      </span>
                    </td>
                    <td className="is-phone">{s.phone ? <span className="ltr">{s.phone}</span> : <span className="at-tone-quiet">—</span>}</td>
                    <td className="is-num is-products">{products > 0 ? fmtQty(products) : <span className="at-tone-quiet">—</span>}</td>
                    <td className="is-num is-names">{names.length > 0 ? fmtQty(names.length) : <span className="at-tone-quiet">—</span>}</td>
                    <td className="is-num is-pending">{pending > 0 ? <span className="at-tone-warn">{fmtQty(pending)}</span> : <span className="at-tone-quiet">—</span>}</td>
                    <td className="is-act">
                      <span className="at-su-act">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`עריכת ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openAction("edit-supplier", { supplierId: s.id });
                          }}
                        >
                          עריכה
                        </Button>
                        <Icon name="chevron-down" size={16} className={cx("at-su-chev", open && "is-open")} />
                      </span>
                    </td>
                  </tr>
                  {fold ? (
                    <tr className="at-su-fold" aria-hidden={fold === "leaving" || undefined}>
                      <td colSpan={6}>
                        <div className={cx("at-su-fold-box", fold === "leaving" && "is-leaving")}>
                          <div className="at-su-fold-body">
                            <div className="at-su-fold-in">
                              {names.length === 0 ? (
                                <p className="at-su-fold-empty">{pending > 0 ? "עדיין אין שמות מאושרים לספק הזה." : "עדיין אין שמות לספק הזה."}</p>
                              ) : (
                                <>
                                  <div className="at-su-fold-head" aria-hidden="true">
                                    <span>שם אצל הספק</span>
                                    <span />
                                    <span>מוצר במחסן</span>
                                    <span />
                                  </div>
                                  <ul className="at-su-names" aria-label={`השמות של ${s.name}`}>
                                    {names.map((a) => {
                                      const p = product(a.product_id);
                                      if (!p) return null;
                                      const saving = isTempId(a.id);
                                      const facts = [a.times_seen > 0 ? seen(a.times_seen) : null, saving ? SAVING : null].filter((v): v is string => v !== null);
                                      return (
                                        <li key={a.id} className="at-su-name">
                                          <div className="at-su-from">
                                            <span className="at-su-ext" title={a.external_name}><bdi>{a.external_name}</bdi></span>
                                            {a.external_sku || facts.length > 0 ? (
                                              <span className="at-su-meta">
                                                {a.external_sku ? <span className="ltr">{a.external_sku}</span> : null}
                                                {a.external_sku && facts.length > 0 ? " · " : null}
                                                {facts.join(" · ")}
                                              </span>
                                            ) : null}
                                          </div>
                                          <span className="at-su-arrow" aria-hidden="true"><Icon name="arrow-left" size={16} /></span>
                                          <div className="at-su-to">
                                            <button type="button" className="at-su-prod" title="פתיחת המוצר" onClick={() => openProduct(p.id)}>{fmtName(p.name)}</button>
                                            <span className="at-su-meta ltr">{p.sku}</span>
                                          </div>
                                          <span className="at-su-act">
                                            <Button variant="ghost" size="sm" className="at-su-del" disabled={saving} aria-label={`הסרת "${a.external_name}" של ${s.name}`} onClick={() => requestDelete(a)}>
                                              הסרה
                                            </Button>
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </>
                              )}
                              <div className="at-su-fold-foot">
                                <Button variant="ghost" size="sm" icon="plus" onClick={() => openAction("new-supplier-item", { supplierId: s.id })}>שם חדש</Button>
                                {pending > 0 ? (
                                  <button type="button" className="at-su-more" onClick={() => waitRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                                    {pending === 1 ? "ועוד שם אחד ממתין לאישור למעלה" : `ועוד ${fmtQty(pending)} שמות ממתינים לאישור למעלה`}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 ? (
          state.suppliers.length === 0 ? (
            <EmptyState title="אין ספקים" hint="אפשר להוסיף ספק ולרשום איך הוא קורא למוצרים שלך">
              <Button variant="secondary" onClick={() => openAction("new-supplier")}>ספק חדש</Button>
            </EmptyState>
          ) : (
            <EmptyState title="לא נמצאו ספקים" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
              <Button variant="secondary" onClick={() => setQuery("")}>ניקוי חיפוש</Button>
            </EmptyState>
          )
        ) : q ? (
          <div className="at-table-foot">
            <span>{`${fmtQty(visible.length)} מתוך ${fmtQty(rows.length)} ספקים`}</span>
            <button type="button" className="sa-btn sa-btn-link" onClick={() => setQuery("")}>הצגת הכול</button>
          </div>
        ) : null}
      </div>

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
          <p style={{ margin: 0 }}>
            {pendingDelete.status === "approved"
              ? "קליטות עתידיות בשם הזה לא יזוהו אוטומטית."
              : "השם יימחק מהרשימה. אם יגיע שוב בתעודת משלוח הוא יופיע כאן מחדש."}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
