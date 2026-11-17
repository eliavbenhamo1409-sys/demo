"use client";

/**
 * ספקים: the list to look someone up in, and the map of what each supplier calls each product. A supplier opens in
 * the drawer with who to call, what they bring and what arrived. A name that still waits for a product is a task, so
 * it is decided under משימות לביצוע and not listed here a second time; the map shows it once it is decided, and
 * still lets a name be approved or removed where it stands.
 */
import { Suspense, useCallback, useMemo, useState, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NameMap } from "@/components/app/dictionary/map/NameMap";
import { useUi } from "@/components/app/ui-state";
import { Button, EmptyState, Modal, Showing, Table, Tabs, Toolbar, type TableColumn } from "@/components/ui";
import { fmtCompact, fmtDayWord, fmtQty } from "@/lib/format";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { PACE_DAYS } from "@/lib/snapshot";
import { isTempId, normalizeName, useData, type Product, type Supplier, type SupplierItem } from "@/lib/store";
import { goColumn } from "../cells";
import { Page, type Metric } from "../parts";
import { SupplierPanel } from "../SupplierPanel";

type Tab = "all" | "map";

type Row = Supplier & { products: number; worth: number; lines: number; last: string | null };

export function Suppliers(): ReactElement {
  return (
    <Suspense fallback={null}>
      <SuppliersInner />
    </Suspense>
  );
}

function SuppliersInner(): ReactElement {
  const { state, product, supplier, approveSupplierItem, deleteSupplierItem } = useData();
  const { openAction, openProduct, notify } = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab: Tab = params.get("tab") === "map" ? "map" : "all";
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "all") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
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

  /* ───────── every supplier, with what it brings ───────── */
  const rows = useMemo<Row[]>(() => {
    const by = new Map<string, Row>(state.suppliers.map((s) => [s.id, { ...s, products: 0, worth: 0, lines: 0, last: null }]));
    for (const p of state.products) {
      const row = by.get(p.primary_supplier_id ?? "");
      if (row) row.products += 1;
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
  }, [state.suppliers, state.products, month, product]);

  const q = normalizeName(query);
  const shownSuppliers = useMemo(
    () => rows.filter((s) => !q || normalizeName([s.name, s.contact, s.phone].filter(Boolean).join(" ")).includes(q)).sort((a, b) => b.worth - a.worth || a.name.localeCompare(b.name, "he")),
    [rows, q],
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
    async (item: SupplierItem) => {
      if (saving(item)) return;
      setApprovingId(item.id);
      try {
        await approveSupplierItem(item.id);
        notify({ tone: "success", title: `"${item.external_name}" אושר כ-${product(item.product_id)?.name ?? ""}`.trim() });
      } catch (e) {
        notify({ tone: "danger", title: "האישור נכשל", text: e instanceof Error ? e.message : undefined });
      } finally {
        setApprovingId(null);
      }
    },
    [saving, approveSupplierItem, product, notify],
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
      render: (s) => <span className="mn2-cell-title"><bdi>{s.name}</bdi></span>,
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
    goColumn(),
  ];

  /* ───────── the figures ───────── */
  const bought = rows.reduce((sum, s) => sum + s.worth, 0);
  const biggest = [...rows].sort((a, b) => b.worth - a.worth)[0];

  const metrics: Metric[] = [
    { key: "all", label: "ספקים", icon: "truck", value: state.suppliers.length },
    { key: "in", label: "נקלט ב-30 יום", icon: "arrow-down-to-line", iconTone: "ok", value: <span className="ltr">{monthLoading ? "…" : fmtCompact(bought)}</span> },
    { key: "biggest", label: "הספק הגדול החודש", icon: "chart-pie", value: biggest && biggest.worth > 0 ? <bdi className="mn2-metric-name">{biggest.name}</bdi> : "אין" },
  ];

  const tabs = [
    { value: "all", label: "ספקים" },
    { value: "map", label: "מפת השמות" },
  ];

  const removingFrom = removing ? supplierName(removing.supplier_id) : "";

  return (
    <Page
      title="ספקים"
      // A new name is taught on the map, so its button stands only there.
      action={tab === "map" ? <Button variant="secondary" icon="plus" onClick={() => openAction("new-supplier-item")}>שם חדש</Button> : undefined}
      metrics={metrics}
      toolbar={
        <Toolbar
          tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v === "map" ? "map" : "all")} />}
          query={query}
          onQuery={setQuery}
          placeholder={tab === "all" ? "חיפוש ספק, איש קשר או טלפון" : "חיפוש שם, מוצר או ספק"}
        />
      }
    >
      {tab === "all" ? (
        <Table<Row>
          caption="רשימת ספקים"
          className="mn2-table mn2-suppliers-table"
          columns={columns}
          data={shownSuppliers}
          selectedId={openId ?? undefined}
          empty={
            state.suppliers.length === 0 ? (
              <EmptyState title="אין ספקים" hint="ספק ראשון נוסף בקליטת סחורה">
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
          <EmptyState title="לא נמצאו מוצרים" hint={q ? <>עבור „<bdi>{query.trim()}</bdi>”</> : undefined}>
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
