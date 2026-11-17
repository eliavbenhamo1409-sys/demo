"use client";

/**
 * רכש וספקים in two clear states: דורש שיוך, the names from delivery notes that wait for a product, and כל הספקים,
 * the list to look someone up in. A supplier opens in the drawer with who to call, what they bring and what arrived.
 * The map of names, which the owner asked for in the aluminium style, stays as a third tab: a tool, not the page.
 */
import { Suspense, useCallback, useMemo, useState, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NameMap } from "@/components/app/dictionary/map/NameMap";
import { PendingInbox } from "@/components/app/dictionary/PendingInbox";
import { productOptions } from "@/components/app/forms/options";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Modal, Showing, Table, Tabs, Toolbar, type TableColumn } from "@/components/ui";
import { fmtCompact, fmtDayWord, fmtQty } from "@/lib/format";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { PACE_DAYS } from "@/lib/snapshot";
import { isTempId, normalizeName, useData, type Product, type Supplier, type SupplierItem } from "@/lib/store";
import { only } from "../cells";
import { Check, JustHandled, Page, type Metric } from "../parts";
import { SupplierPanel } from "../SupplierPanel";
import { pendingNames } from "../work";

type Tab = "pending" | "all" | "map";

type Row = Supplier & { products: number; names: number; waiting: number; worth: number; lines: number; last: string | null };

export function Suppliers(): ReactElement {
  return (
    <Suspense fallback={null}>
      <SuppliersInner />
    </Suspense>
  );
}

function SuppliersInner(): ReactElement {
  const { state, product, supplier, mapSupplierItem, approveSupplierItem, deleteSupplierItem } = useData();
  const { openAction, openProduct, notify } = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const inbox = useMemo(
    () => pendingNames(state.supplierItems, product).sort((a, b) => b.times_seen - a.times_seen || b.created_at.localeCompare(a.created_at)),
    [state.supplierItems, product],
  );

  // With something to decide the page opens on it; with nothing, on the list.
  const asked = params.get("tab");
  const tab: Tab = asked === "all" || asked === "map" || asked === "pending" ? asked : inbox.length > 0 ? "pending" : "all";
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      sp.set("tab", next);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SupplierItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const since = useMemo(() => midnight(1 - PACE_DAYS), []);
  const { rows: month, isLoading: monthLoading } = useMovementsInRange(since, null);

  const supplierName = useCallback((id: string) => supplier(id)?.name ?? "ספק לא ידוע", [supplier]);
  const prodOpts = useMemo(() => productOptions(state.products), [state.products]);

  /* ───────── every supplier, with what it brings ───────── */
  const rows = useMemo<Row[]>(() => {
    const by = new Map<string, Row>(state.suppliers.map((s) => [s.id, { ...s, products: 0, names: 0, waiting: 0, worth: 0, lines: 0, last: null }]));
    for (const p of state.products) {
      const row = by.get(p.primary_supplier_id ?? "");
      if (row) row.products += 1;
    }
    for (const i of state.supplierItems) {
      const row = by.get(i.supplier_id);
      if (!row) continue;
      row.names += 1;
      if (i.status === "pending" || !i.product_id || !product(i.product_id)) row.waiting += 1;
    }
    // Newest first, so the first delivery seen for a supplier is its last.
    for (const m of month) {
      if (m.type !== "in") continue;
      const row = by.get(m.supplier_id ?? "");
      if (!row) continue;
      row.lines += 1;
      row.worth += m.qty * (product(m.product_id)?.price ?? 0);
      row.last ??= m.created_at;
    }
    return [...by.values()];
  }, [state.suppliers, state.products, state.supplierItems, month, product]);

  const q = normalizeName(query);
  const shownSuppliers = useMemo(
    () => rows.filter((s) => !q || normalizeName([s.name, s.contact, s.phone].filter(Boolean).join(" ")).includes(q)).sort((a, b) => b.waiting - a.waiting || b.worth - a.worth || a.name.localeCompare(b.name, "he")),
    [rows, q],
  );
  const shownInbox = useMemo(
    () => (q ? inbox.filter((i) => normalizeName([i.external_name, i.external_sku, supplierName(i.supplier_id)].filter(Boolean).join(" ")).includes(q)) : inbox),
    [inbox, q, supplierName],
  );

  /* ───────── the map: our product, and what each supplier calls it ───────── */
  const mapRows = useMemo(() => {
    const byProduct = new Map<string, SupplierItem[]>();
    for (const i of state.supplierItems) {
      if (!i.product_id || !product(i.product_id)) continue;
      const list = byProduct.get(i.product_id);
      if (list) list.push(i);
      else byProduct.set(i.product_id, [i]);
    }
    const list = state.products
      .map((p: Product) => ({ product: p, aliases: (byProduct.get(p.id) ?? []).slice().sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.times_seen - a.times_seen) }))
      .sort((a, b) => b.aliases.length - a.aliases.length || a.product.name.localeCompare(b.product.name, "he"));
    if (!q) return list;
    return list.filter(({ product: p, aliases }) => normalizeName(`${p.name} ${p.sku}`).includes(q) || aliases.some((a) => normalizeName(`${a.external_name} ${supplierName(a.supplier_id)}`).includes(q)));
  }, [state.products, state.supplierItems, product, q, supplierName]);

  /* ───────── writes ───────── */
  const saving = useCallback(
    (item: SupplierItem) => {
      if (!isTempId(item.id)) return false;
      notify({ tone: "neutral", title: "השם עדיין נשמר", text: "אפשר לנסות שוב בעוד רגע" });
      return true;
    },
    [notify],
  );

  const approve = useCallback(
    async (item: SupplierItem, productId?: string) => {
      if (saving(item)) return;
      setApprovingId(item.id);
      try {
        if (productId) await mapSupplierItem(item.id, productId);
        else await approveSupplierItem(item.id);
        notify({ tone: "success", title: `"${item.external_name}" אושר כ-${product(productId ?? item.product_id)?.name ?? ""}`.trim() });
      } catch (e) {
        notify({ tone: "danger", title: "האישור נכשל", text: e instanceof Error ? e.message : undefined });
      } finally {
        setApprovingId(null);
      }
    },
    [saving, mapSupplierItem, approveSupplierItem, product, notify],
  );

  const askRemove = useCallback((item: SupplierItem) => { if (!saving(item)) setRemoving(item); }, [saving]);
  const remove = useCallback(async () => {
    if (!removing) return;
    setDeleting(true);
    try {
      await deleteSupplierItem(removing.id);
      notify({ tone: "success", title: `"${removing.external_name}" הוסר`, text: supplierName(removing.supplier_id) });
      setRemoving(null);
    } catch (e) {
      notify({ tone: "danger", title: "המחיקה נכשלה", text: e instanceof Error ? e.message : undefined });
    } finally {
      setDeleting(false);
    }
  }, [removing, deleteSupplierItem, notify, supplierName]);

  const columns: TableColumn<Row>[] = [
    {
      key: "name",
      title: "ספק",
      className: "mn2-cell-main",
      render: (s) => (
        <>
          <span className="mn2-cell-title"><bdi>{s.name}</bdi></span>
          {s.waiting > 0 ? <span className="mn2-cell-sub mn2-late">{s.waiting === 1 ? "שם אחד דורש שיוך" : `${fmtQty(s.waiting)} שמות דורשים שיוך`}</span> : null}
        </>
      ),
    },
    { key: "contact", title: "איש קשר", render: (s) => (s.contact ? <span className="mn2-cell-text"><bdi>{s.contact}</bdi></span> : <span className="mn2-cell-unset">לא נרשם</span>) },
    {
      key: "phone",
      title: "טלפון",
      render: (s) => (s.phone ? <a className="mn2-cell-text mn2-tel ltr" href={`tel:${s.phone.replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()}>{s.phone}</a> : <span className="mn2-cell-unset">לא נרשם</span>),
    },
    { key: "products", title: "מוצרים", render: (s) => (s.products > 0 ? <span className="mn2-qty"><span className="ltr">{fmtQty(s.products)}</span></span> : <span className="mn2-cell-unset">אין</span>) },
    {
      key: "in",
      title: "נקלט ב-30 יום",
      render: (s) =>
        monthLoading ? <span className="mn2-cell-unset">טוען</span> : s.lines === 0 ? <span className="mn2-cell-unset">לא נקלט</span> : (
          <>
            <span className="mn2-qty"><span className="ltr">{fmtCompact(s.worth)}</span></span>
            <span className="mn2-cell-sub">אחרונה {s.last ? fmtDayWord(s.last) : ""}</span>
          </>
        ),
    },
    {
      key: "act",
      title: "פעולה",
      className: "mn2-cell-act",
      render: (s) => (
        <span className="mn2-acts">
          <Button variant="secondary" size="sm" onClick={only(() => setOpenId(s.id))}>פרטי ספק</Button>
        </span>
      ),
    },
  ];

  /* ───────── the head ───────── */
  const bought = rows.reduce((sum, s) => sum + s.worth, 0);
  const biggest = [...rows].sort((a, b) => b.worth - a.worth)[0];
  const unsourced = state.products.filter((p) => !p.primary_supplier_id || !supplier(p.primary_supplier_id)).length;

  const lead =
    state.suppliers.length === 0 ? "עוד אין ספקים. ספק ראשון נוסף כאן או בקליטת סחורה."
    : inbox.length === 0 ? `${fmtQty(state.suppliers.length)} ספקים, וכל השמות מתעודות המשלוח שלהם משויכים למוצר במחסן.`
    : `${inbox.length === 1 ? "שם אחד מתעודת משלוח מחכה" : `${fmtQty(inbox.length)} שמות מתעודות משלוח מחכים`} לשיוך למוצר במחסן. עד שישויכו, קליטה בשם הזה תעצור לשאול.`;

  const metrics: Metric[] = [
    { key: "pending", label: "דורש שיוך", icon: "link-2", value: inbox.length, tone: inbox.length > 0 ? "warn" : "ok", note: inbox.length === 0 ? <span className="is-ok">כל השמות משויכים</span> : "שמות מתעודות משלוח", onClick: () => setTab("pending"), current: tab === "pending" },
    { key: "all", label: "ספקים", icon: "truck", value: state.suppliers.length, note: unsourced > 0 ? `${fmtQty(unsourced)} מוצרים בלי ספק ראשי` : "לכל מוצר יש ספק ראשי", onClick: () => setTab("all"), current: tab === "all" },
    { key: "in", label: "נקלט ב-30 יום", icon: "arrow-down-to-line", value: <span className="ltr">{monthLoading ? "…" : fmtCompact(bought)}</span>, tone: "ok", note: "מכל הספקים, במחירון" },
    { key: "biggest", label: "הספק הגדול של החודש", icon: "chart-pie", value: biggest && biggest.worth > 0 ? <bdi className="mn2-metric-name">{biggest.name}</bdi> : "אין", note: biggest && biggest.worth > 0 && bought > 0 ? `${fmtCompact(biggest.worth)} · ${Math.round((biggest.worth / bought) * 100)}% מהקליטות` : "לא נקלטה סחורה החודש" },
  ];

  const tabs = [
    { value: "pending", label: "דורש שיוך", count: inbox.length },
    { value: "all", label: "כל הספקים", count: state.suppliers.length },
    { value: "map", label: "מפת השמות" },
  ];

  const removingFrom = removing ? supplierName(removing.supplier_id) : "";

  return (
    <Page
      title="רכש וספקים"
      state={inbox.length > 0 ? { word: `${fmtQty(inbox.length)} דורשים שיוך`, tone: "warn" } : { word: "הכל משויך", tone: "ok" }}
      lead={lead}
      action={
        <>
          <Button variant="secondary" icon="plus" onClick={() => openAction("new-supplier-item")}>שם חדש</Button>
          <Button variant="primary" icon="plus" onClick={() => openAction("new-supplier")}>ספק חדש</Button>
        </>
      }
      metrics={metrics}
      toolbar={
        <Toolbar
          tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v === "all" || v === "map" ? v : "pending")} />}
          query={query}
          onQuery={setQuery}
          placeholder={tab === "all" ? "חיפוש לפי ספק, איש קשר או טלפון" : "חיפוש לפי שם, מוצר או ספק"}
        />
      }
    >
      {tab === "pending" ? (
        <>
          <JustHandled kind="approval" sheet />
          {inbox.length === 0 ? (
            <div className="sa-card mn2-sheet">
              <div className="mn2-clear">
                <Check size={36} />
                <p className="mn2-clear-title">אין שם שדורש שיוך</p>
                <p className="mn2-clear-hint">שם חדש מתעודת משלוח יופיע כאן בפעם הראשונה שעובד קולט אותו.</p>
              </div>
            </div>
          ) : shownInbox.length === 0 ? (
            <div className="sa-card mn2-sheet">
              <EmptyState title="לא נמצאו שמות" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
                <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
              </EmptyState>
            </div>
          ) : (
            <PendingInbox
              items={shownInbox}
              productOptions={prodOpts}
              supplierName={supplierName}
              approvingId={approvingId}
              onApprove={(item, productId) => void approve(item, productId)}
              onNewProduct={(item) => openAction("new-product", { supplierItemId: item.id })}
              onDelete={askRemove}
            />
          )}
        </>
      ) : tab === "all" ? (
        <Table<Row>
          caption="רשימת ספקים"
          className="mn2-table mn2-suppliers-table"
          columns={columns}
          data={shownSuppliers}
          selectedId={openId ?? undefined}
          empty={
            state.suppliers.length === 0 ? (
              <EmptyState title="אין ספקים" hint="ספק ראשון נוסף כאן או בקליטת סחורה">
                <Button variant="secondary" onClick={() => openAction("new-supplier")}>ספק חדש</Button>
              </EmptyState>
            ) : (
              <EmptyState title="לא נמצאו ספקים" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
                <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button>
              </EmptyState>
            )
          }
          onRowClick={(s) => setOpenId(s.id)}
          footer={q && shownSuppliers.length > 0 ? <Showing shown={shownSuppliers.length} total={rows.length} /> : undefined}
        />
      ) : mapRows.length === 0 ? (
        <div className="sa-card mn2-sheet">
          <EmptyState title="לא נמצאו מוצרים" hint={q ? <>עבור „<bdi>{query.trim()}</bdi>”</> : "המפה נבנית על המוצרים במלאי"}>
            {q ? <Button variant="secondary" onClick={() => setQuery("")}>ניקוי החיפוש</Button> : null}
          </EmptyState>
        </div>
      ) : (
        <NameMap
          rows={mapRows}
          flat={!!q}
          supplierName={supplierName}
          openRowId={openRowId}
          onOpenRow={setOpenRowId}
          onCloseRow={() => setOpenRowId(null)}
          onOpenProduct={openProduct}
          onOpenName={(item) => openAction("map-supplier-item", { supplierItemId: item.id })}
          onApprove={(item) => void approve(item)}
          onRemove={askRemove}
          onSupplier={setOpenId}
          approvingId={approvingId}
        />
      )}

      {openId ? <SupplierPanel key={openId} id={openId} month={month} onClose={() => setOpenId(null)} /> : null}

      {removing ? (
        <Modal
          title={`${removing.status === "approved" ? "להסיר" : "למחוק"} את השם "${removing.external_name}" של ${removingFrom}?`}
          tone="danger"
          confirmLabel={removing.status === "approved" ? "הסרה" : "מחיקה"}
          busy={deleting}
          onConfirm={() => void remove()}
          onClose={() => !deleting && setRemoving(null)}
        >
          <p className="m-0">{removing.status === "approved" ? "קליטות עתידיות בשם הזה לא יזוהו אוטומטית." : "השם יימחק מהרשימה. אם יגיע שוב בתעודת משלוח הוא יופיע כאן מחדש."}</p>
        </Modal>
      ) : null}
    </Page>
  );
}
