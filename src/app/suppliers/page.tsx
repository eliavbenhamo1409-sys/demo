"use client";

import { Suspense, useCallback, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useData, type Supplier, type SupplierItem } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { fmtQty } from "@/lib/format";
import {
  Badge,
  Button,
  EmptyState,
  MappingStatus,
  Modal,
  SearchBar,
  Select,
  Table,
  Tabs,
  type TableColumn,
} from "@/components/ui";

type Tab = "all" | "pending" | "approved" | "suppliers";

const TAB_VALUES: readonly Tab[] = ["all", "pending", "approved", "suppliers"];

function isTab(v: string | null): v is Tab {
  return v !== null && (TAB_VALUES as readonly string[]).includes(v);
}

type PendingDelete =
  | { kind: "item"; item: SupplierItem }
  | { kind: "supplier"; supplier: Supplier; itemCount: number }
  | null;

/** Hebrew subline: "{N} ספקים · {M} שמות חיצוניים · {P} ממתינים לאישור", zero parts omitted. */
function subline(suppliers: number, items: number, pending: number): string {
  const parts: string[] = [];
  if (suppliers > 0) parts.push(`${fmtQty(suppliers)} ספקים`);
  if (items > 0) parts.push(`${fmtQty(items)} שמות חיצוניים`);
  if (pending > 0) parts.push(`${fmtQty(pending)} ממתינים לאישור`);
  return parts.length ? parts.join(" · ") : "אין עדיין ספקים במילון";
}

const stop = (e: MouseEvent) => e.stopPropagation();

export default function SuppliersPage() {
  return (
    <Suspense fallback={null}>
      <SuppliersView />
    </Suspense>
  );
}

function SuppliersView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { state, product, supplier, approveSupplierItem, deleteSupplierItem, deleteSupplier } = useData();
  const { openAction, openProduct, notify } = useUi();

  // The URL is the source of truth for the tab (?tab=pending|approved|suppliers; absent = all).
  const urlTab = searchParams.get("tab");
  const tab: Tab = isTab(urlTab) ? urlTab : "all";
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [busy, setBusy] = useState(false);

  const changeTab = useCallback(
    (next: string) => {
      if (!isTab(next)) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === "all") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const loading = state.status === "loading";
  const pendingCount = useMemo(() => state.supplierItems.filter((i) => i.status === "pending").length, [state.supplierItems]);
  const approvedCount = state.supplierItems.length - pendingCount;

  const itemCountBySupplier = useMemo(() => {
    const total = new Map<string, number>();
    const pending = new Map<string, number>();
    for (const i of state.supplierItems) {
      total.set(i.supplier_id, (total.get(i.supplier_id) ?? 0) + 1);
      if (i.status === "pending") pending.set(i.supplier_id, (pending.get(i.supplier_id) ?? 0) + 1);
    }
    return { total, pending };
  }, [state.supplierItems]);

  const q = query.trim().toLowerCase();

  const mappings = useMemo(() => {
    const matches = (i: SupplierItem) => {
      if (supplierFilter && i.supplier_id !== supplierFilter) return false;
      if (tab === "pending" && i.status !== "pending") return false;
      if (tab === "approved" && i.status !== "approved") return false;
      if (!q) return true;
      const p = product(i.product_id);
      const s = supplier(i.supplier_id);
      const hay = [i.external_name, i.external_sku ?? "", s?.name ?? "", p?.name ?? "", p?.sku ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    };
    const rank = (i: SupplierItem) => (i.status === "pending" ? 0 : 1);
    return state.supplierItems
      .filter(matches)
      .sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at));
  }, [state.supplierItems, supplierFilter, tab, q, product, supplier]);

  const suppliers = useMemo(() => {
    return state.suppliers.filter((s) => {
      if (supplierFilter && s.id !== supplierFilter) return false;
      if (!q) return true;
      return [s.name, s.contact ?? "", s.phone ?? "", s.email ?? ""].join(" ").toLowerCase().includes(q);
    });
  }, [state.suppliers, supplierFilter, q]);

  const supplierOptions = useMemo(() => state.suppliers.map((s) => ({ value: s.id, label: s.name })), [state.suppliers]);

  const openMap = useCallback((supplierItemId: string) => openAction("map-supplier-item", { supplierItemId }), [openAction]);

  const approve = useCallback(
    async (item: SupplierItem) => {
      if (!item.product_id) {
        openMap(item.id);
        return;
      }
      try {
        await approveSupplierItem(item.id);
        notify({ tone: "success", title: "ההתאמה אושרה", text: item.external_name });
      } catch (e) {
        notify({ tone: "danger", title: "האישור נכשל", text: e instanceof Error ? e.message : undefined });
      }
    },
    [approveSupplierItem, notify, openMap],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      if (pendingDelete.kind === "item") {
        await deleteSupplierItem(pendingDelete.item.id);
        notify({ tone: "success", title: "השם החיצוני נמחק", text: pendingDelete.item.external_name });
      } else {
        await deleteSupplier(pendingDelete.supplier.id);
        notify({ tone: "success", title: "הספק נמחק", text: pendingDelete.supplier.name });
      }
      setPendingDelete(null);
    } catch (e) {
      notify({ tone: "danger", title: "המחיקה נכשלה", text: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }, [pendingDelete, deleteSupplierItem, deleteSupplier, notify]);

  /* ───────── columns ───────── */

  const mappingColumns = useMemo<TableColumn<SupplierItem>[]>(
    () => [
      {
        key: "supplier_id",
        title: "ספק",
        width: "16%",
        render: (i) => <span className="sa-cell-primary">{supplier(i.supplier_id)?.name ?? "—"}</span>,
      },
      {
        key: "external_name",
        title: "שם אצל הספק",
        render: (i) => <bdi>{i.external_name}</bdi>,
      },
      {
        key: "external_sku",
        title: 'מק"ט חיצוני',
        width: "14%",
        align: "ltr",
        mono: true,
        muted: true,
        render: (i) => i.external_sku ?? "",
      },
      {
        key: "product_id",
        title: "מוצר במפעל",
        render: (i) => {
          const p = product(i.product_id);
          if (!p) return <span className="sa-muted">— לא ממופה</span>;
          return (
            <span>
              {p.name}
              <span className="sa-cell-sub sa-mono ltr">{p.sku}</span>
            </span>
          );
        },
      },
      {
        key: "status",
        title: "סטטוס",
        width: "24%",
        render: (i) => (
          <span onClick={stop}>
            <MappingStatus
              status={i.status}
              target={product(i.product_id)?.sku}
              onApprove={() => void approve(i)}
              onFix={() => openMap(i.id)}
            />
          </span>
        ),
      },
      {
        key: "actions",
        title: <span className="sa-sr">פעולות</span>,
        width: "88px",
        render: (i) => (
          <span className="sa-row-actions" onClick={stop}>
            {i.product_id ? (
              <Button variant="ghost" size="sm" iconOnly icon="eye" aria-label="פתח מוצר" title="פתח מוצר" onClick={() => openProduct(i.product_id as string)} />
            ) : null}
            <Button variant="ghost" size="sm" iconOnly icon="trash" aria-label="מחק" title="מחק" onClick={() => setPendingDelete({ kind: "item", item: i })} />
          </span>
        ),
      },
    ],
    [supplier, product, approve, openMap, openProduct],
  );

  const supplierColumns = useMemo<TableColumn<Supplier>[]>(
    () => [
      { key: "name", title: "שם", render: (s) => <span className="sa-cell-primary">{s.name}</span> },
      { key: "contact", title: "איש קשר", render: (s) => s.contact ?? "" },
      { key: "phone", title: "טלפון", align: "ltr", mono: true, width: "14%", render: (s) => s.phone ?? "" },
      { key: "email", title: "אימייל", align: "ltr", width: "20%", render: (s) => s.email ?? "" },
      {
        key: "items",
        title: "שמות חיצוניים",
        align: "num",
        width: "12%",
        render: (s) => fmtQty(itemCountBySupplier.total.get(s.id) ?? 0),
      },
      {
        key: "pending",
        title: "לא מאושר",
        align: "num",
        width: "10%",
        render: (s) => {
          const n = itemCountBySupplier.pending.get(s.id) ?? 0;
          return <span className={n > 0 ? "sa-low" : undefined}>{fmtQty(n)}</span>;
        },
      },
      {
        key: "actions",
        title: <span className="sa-sr">פעולות</span>,
        width: "88px",
        render: (s) => (
          <span className="sa-row-actions" onClick={stop}>
            <Button variant="ghost" size="sm" iconOnly icon="edit" aria-label="עריכה" title="עריכה" onClick={() => openAction("edit-supplier", { supplierId: s.id })} />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="trash"
              aria-label="מחק"
              title="מחק"
              onClick={() => setPendingDelete({ kind: "supplier", supplier: s, itemCount: itemCountBySupplier.total.get(s.id) ?? 0 })}
            />
          </span>
        ),
      },
    ],
    [itemCountBySupplier, openAction],
  );

  /* ───────── empty states ───────── */

  const dictionaryEmpty: ReactNode =
    state.supplierItems.length === 0 ? (
      <EmptyState icon="book-open" title="המילון ריק" hint="הוסף ספק, ואז את השמות שהוא משתמש בהם">
        <Button variant="primary" icon="plus" onClick={() => openAction("new-supplier")}>ספק חדש</Button>
        {state.suppliers.length > 0 ? (
          <Button variant="secondary" icon="plus" onClick={() => openAction("new-supplier-item")}>שם חיצוני חדש</Button>
        ) : null}
      </EmptyState>
    ) : (
      <EmptyState icon="search" title="אין שמות חיצוניים שמתאימים לסינון" hint="נסה חיפוש אחר או הצג את כל הספקים" />
    );

  const suppliersEmpty: ReactNode =
    state.suppliers.length === 0 ? (
      <EmptyState icon="truck" title="אין עדיין ספקים" hint="הוסף את הספק הראשון כדי להתחיל לבנות את המילון">
        <Button variant="primary" icon="plus" onClick={() => openAction("new-supplier")}>ספק חדש</Button>
      </EmptyState>
    ) : (
      <EmptyState icon="search" title="אין ספקים שמתאימים לסינון" />
    );

  const tabs = [
    { value: "all", label: "הכל" },
    {
      value: "pending",
      label: (
        <>
          לא מאושר
          {pendingCount > 0 ? <Badge tone="warning" solid count>{fmtQty(pendingCount)}</Badge> : null}
        </>
      ),
    },
    { value: "approved", label: "מאושר" },
    { value: "suppliers", label: "ספקים" },
  ];

  const footerLabel =
    tab === "suppliers"
      ? `${fmtQty(suppliers.length)} ספקים`
      : `${fmtQty(mappings.length)} שמות חיצוניים${tab === "all" && pendingCount > 0 ? ` · ${fmtQty(pendingCount)} לא מאושר · ${fmtQty(approvedCount)} מאושר` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="sa-page-title" style={{ fontSize: 30, lineHeight: "36px", fontWeight: 600 }}>מילון ספקים</h1>
        <p className="sa-page-sub">{subline(state.suppliers.length, state.supplierItems.length, pendingCount)}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          kbd={false}
          value={query}
          onChange={setQuery}
          placeholder='חיפוש שם חיצוני, מק"ט, ספק או מוצר…'
          className="min-w-[260px] flex-1 max-w-[420px]"
        />
        <Select
          options={supplierOptions}
          value={supplierFilter}
          onChange={setSupplierFilter}
          allLabel="כל הספקים"
          placeholder="ספק"
          searchPlaceholder="חיפוש ספק…"
          minWidth={180}
        />
        <Tabs tabs={tabs} value={tab} onChange={changeTab} />
        <div className="ms-auto flex items-center gap-2">
          <Button variant="secondary" icon="plus" onClick={() => openAction("new-supplier-item")}>שם חיצוני חדש</Button>
          <Button variant="primary" onClick={() => openAction("new-supplier")}>ספק חדש</Button>
        </div>
      </div>

      {tab === "suppliers" ? (
        <Table<Supplier>
          caption="רשימת הספקים במילון"
          columns={supplierColumns}
          data={suppliers}
          isLoading={loading}
          skeletonRows={5}
          empty={suppliersEmpty}
          onRowClick={(s) => openAction("edit-supplier", { supplierId: s.id })}
          footer={<span>{footerLabel}</span>}
        />
      ) : (
        <Table<SupplierItem>
          caption="שמות חיצוניים של ספקים והתאמתם למוצרי המפעל"
          columns={mappingColumns}
          data={mappings}
          isLoading={loading}
          skeletonRows={6}
          empty={dictionaryEmpty}
          onRowClick={(i) => openMap(i.id)}
          footer={<span>{footerLabel}</span>}
        />
      )}

      {pendingDelete?.kind === "item" ? (
        <Modal
          title="מחק שם חיצוני"
          tone="danger"
          confirmLabel="מחק שם חיצוני"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onClose={() => !busy && setPendingDelete(null)}
        >
          <p>
            השם <strong><bdi>{pendingDelete.item.external_name}</bdi></strong>
            {supplier(pendingDelete.item.supplier_id) ? <> של {supplier(pendingDelete.item.supplier_id)?.name}</> : null} יימחק מהמילון.
            קליטות עתידיות בשם הזה לא יזוהו אוטומטית.
          </p>
        </Modal>
      ) : null}

      {pendingDelete?.kind === "supplier" ? (
        <Modal
          title="מחק ספק"
          tone="danger"
          confirmLabel="מחק ספק"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onClose={() => !busy && setPendingDelete(null)}
        >
          <p>
            הספק <strong>{pendingDelete.supplier.name}</strong> יימחק.
            {pendingDelete.itemCount > 0
              ? ` יחד איתו יימחקו גם ${fmtQty(pendingDelete.itemCount)} השמות החיצוניים שלו מהמילון.`
              : " לספק הזה אין שמות חיצוניים במילון."}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
