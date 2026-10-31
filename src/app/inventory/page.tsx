"use client";

import { Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useData, type Movement as MovementRow, type MovementType, type Product } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import {
  Button,
  EmptyState,
  Icon,
  Movement,
  SearchBar,
  Select,
  Table,
  Tabs,
  type SelectOption,
  type TableColumn,
} from "@/components/ui";
import { fmtQty, fmtRelative, fmtSigned, fmtWhen, MOVEMENT_LABEL } from "@/lib/format";

type Tab = "products" | "low" | "out" | "movements";
type SortKey = "name" | "qty" | "updated_at";
type SortDir = "asc" | "desc";

const TAB_VALUES: Tab[] = ["products", "low", "out", "movements"];
const MOVEMENT_TYPES: MovementType[] = ["in", "out", "fault", "adjust"];

function tabFromParams(params: URLSearchParams): Tab {
  if (params.get("tab") === "movements") return "movements";
  const filter = params.get("filter");
  if (filter === "low") return "low";
  if (filter === "out") return "out";
  return "products";
}

function isLow(p: Product): boolean {
  return p.qty > 0 && p.min_qty > 0 && p.qty < p.min_qty;
}
function isOut(p: Product): boolean {
  return p.qty <= 0;
}

function joinParts(parts: (string | false)[], sep = " · "): string {
  return parts.filter((x): x is string => Boolean(x)).join(sep);
}

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryInner />
    </Suspense>
  );
}

function InventoryInner() {
  const { state, product, supplier, worker, stats } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The active tab lives in the URL (?tab=movements, ?filter=low|out).
  const tab = tabFromParams(params);
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      sp.delete("tab");
      sp.delete("filter");
      if (next === "movements") sp.set("tab", "movements");
      else if (next === "low" || next === "out") sp.set("filter", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [moveType, setMoveType] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  /* ───────── options ───────── */
  const categories = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const p of state.products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [state.products]);

  const supplierOptions = useMemo<SelectOption[]>(
    () => state.suppliers.map((s) => ({ value: s.id, label: s.name })),
    [state.suppliers],
  );

  const typeOptions = useMemo<SelectOption[]>(
    () => MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_LABEL[t] })),
    [],
  );

  /* ───────── products ───────── */
  const q = query.trim().toLowerCase();

  const baseProducts = useMemo(() => {
    return state.products.filter((p) => {
      if (category && p.category !== category) return false;
      if (supplierId && p.primary_supplier_id !== supplierId) return false;
      return true;
    });
  }, [state.products, category, supplierId]);

  const lowCount = useMemo(() => baseProducts.filter(isLow).length, [baseProducts]);
  const outCount = useMemo(() => baseProducts.filter(isOut).length, [baseProducts]);

  const products = useMemo(() => {
    let list = baseProducts;
    if (tab === "low") list = list.filter(isLow);
    else if (tab === "out") list = list.filter(isOut);
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? "").includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "qty") return (a.qty - b.qty) * dir;
      if (sortKey === "updated_at") return a.updated_at.localeCompare(b.updated_at) * dir;
      return a.name.localeCompare(b.name, "he") * dir;
    });
  }, [baseProducts, tab, q, sortKey, sortDir]);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((k) => {
      if (k === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return k;
      }
      setSortDir(key === "name" ? "asc" : "desc");
      return key;
    });
  }, []);

  const sortTitle = useCallback(
    (label: string, key: SortKey): ReactNode => {
      const active = sortKey === key;
      return (
        <button
          type="button"
          className="inline-flex items-center gap-1 uppercase tracking-[0.06em]"
          onClick={() => toggleSort(key)}
          aria-label={`מיין לפי ${label}`}
          aria-pressed={active}
        >
          {label}
          {active ? <Icon name={sortDir === "asc" ? "chevron-up" : "chevron-down"} size={12} /> : null}
        </button>
      );
    },
    [sortKey, sortDir, toggleSort],
  );

  const selectedId = ui.panel?.type === "product" ? ui.panel.id : undefined;

  const productColumns = useMemo<TableColumn<Product>[]>(
    () => [
      {
        key: "name",
        title: sortTitle("מוצר", "name"),
        render: (p) => (
          <span className="block min-w-0">
            <span className="sa-cell-primary sa-truncate block">{p.name}</span>
            {p.category ? <span className="sa-cell-sub sa-truncate">{p.category}</span> : null}
          </span>
        ),
      },
      { key: "sku", title: 'מק"ט', mono: true, align: "ltr", width: "120px", render: (p) => p.sku },
      {
        key: "barcode",
        title: <span className="max-[1099px]:hidden">ברקוד</span>,
        mono: true,
        align: "ltr",
        muted: true,
        className: "max-[1099px]:hidden",
        render: (p) => p.barcode ?? "—",
      },
      { key: "location", title: "מיקום", muted: true, render: (p) => p.location ?? "—" },
      { key: "supplier", title: "ספק", render: (p) => supplier(p.primary_supplier_id)?.name ?? "—" },
      {
        key: "qty",
        title: sortTitle("כמות", "qty"),
        align: "num",
        width: "120px",
        render: (p) => (
          <span className={isOut(p) ? "sa-out" : isLow(p) ? "sa-low" : undefined}>
            {fmtQty(p.qty)}
            <span className="sa-qty-unit" style={{ fontSize: 12 }}>{p.unit}</span>
          </span>
        ),
      },
      { key: "min_qty", title: "מינימום", align: "num", muted: true, width: "96px", render: (p) => fmtQty(p.min_qty) },
      { key: "updated_at", title: sortTitle("עודכן", "updated_at"), muted: true, width: "140px", render: (p) => fmtRelative(p.updated_at) },
      {
        key: "actions",
        title: <span className="sa-sr">פעולות</span>,
        width: "112px",
        render: (p) => (
          <span className="sa-row-actions" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" iconOnly icon="arrow-down-left" aria-label="קליטה" title="קליטה" onClick={() => ui.openAction("receive", { productId: p.id })} />
            <Button variant="ghost" size="sm" iconOnly icon="arrow-up-right" aria-label="הוצאה" title="הוצאה" onClick={() => ui.openAction("issue", { productId: p.id })} />
            <Button variant="ghost" size="sm" iconOnly icon="more-horizontal" aria-label="עוד" title="עוד" onClick={() => ui.openProduct(p.id)} />
          </span>
        ),
      },
    ],
    [supplier, ui, sortTitle],
  );

  /* ───────── movements ───────── */
  const movements = useMemo(() => {
    return state.movements.filter((m) => {
      if (moveType && m.type !== moveType) return false;
      if (supplierId && m.supplier_id !== supplierId) return false;
      const p = product(m.product_id);
      if (category && p?.category !== category) return false;
      if (q) {
        const hay = [p?.name, p?.sku, p?.barcode, m.external_name, m.reference, m.note, worker(m.worker_id)?.name, supplier(m.supplier_id)?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [state.movements, moveType, supplierId, category, q, product, worker, supplier]);

  const movementColumns = useMemo<TableColumn<MovementRow>[]>(
    () => [
      { key: "created_at", title: "שעה", mono: true, align: "ltr", muted: true, width: "120px", render: (m) => fmtWhen(m.created_at) },
      { key: "type", title: "פעולה", width: "132px", render: (m) => <Movement type={m.type} /> },
      {
        key: "product",
        title: "מוצר",
        render: (m) => {
          const p = product(m.product_id);
          return p ? (
            <span className="block min-w-0">
              <span className="sa-cell-primary sa-truncate block">{p.name}</span>
              <span className="sa-cell-sub sa-mono ltr">{p.sku}</span>
              {m.external_name ? (
                <span className="sa-cell-sub sa-truncate">בתעודה: &quot;<bdi>{m.external_name}</bdi>&quot;</span>
              ) : null}
            </span>
          ) : (
            <span className="sa-muted">מוצר שנמחק</span>
          );
        },
      },
      {
        key: "qty",
        title: "כמות",
        align: "num",
        width: "110px",
        render: (m) => (
          <span className={m.type === "in" ? "sa-qty-in" : m.type === "out" ? "sa-qty-out" : undefined}>
            {fmtSigned(m.qty, m.type)}
          </span>
        ),
      },
      { key: "worker", title: "עובד", muted: true, render: (m) => worker(m.worker_id)?.name ?? "—" },
      { key: "supplier", title: "ספק", muted: true, render: (m) => supplier(m.supplier_id)?.name ?? "—" },
      { key: "reference", title: "אסמכתא", mono: true, align: "ltr", muted: true, width: "120px", render: (m) => m.reference ?? "—" },
    ],
    [product, worker, supplier],
  );

  /* ───────── header ───────── */
  const subline = joinParts([
    `${fmtQty(stats.products)} מוצרים`,
    stats.low > 0 && `${fmtQty(stats.low)} מתחת למינימום`,
    stats.out > 0 && `${fmtQty(stats.out)} אזלו`,
  ]);

  const tabs = [
    { value: "products", label: "מוצרים", count: baseProducts.length },
    { value: "low", label: "מתחת למינימום", count: lowCount },
    { value: "out", label: "אזל", count: outCount },
    { value: "movements", label: "תנועות" },
  ];

  const onTab = (v: string) => {
    if ((TAB_VALUES as string[]).includes(v)) setTab(v as Tab);
  };

  const hasFilters = Boolean(q || category || supplierId);

  const productsEmpty =
    state.products.length === 0 ? (
      <EmptyState icon="package" title="אין מוצרים עדיין" hint="הוסף את המוצר הראשון או קלוט סחורה">
        <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>
        <Button variant="secondary" icon="arrow-down-left" onClick={() => ui.openAction("receive")}>קליטת סחורה</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState icon="search" title="לא נמצאו מוצרים" hint={<>אין תוצאות עבור <span className="sa-mono ltr">„{query.trim()}”</span></>} />
    ) : (
      <EmptyState
        icon="check-circle"
        title={tab === "low" ? "אין מוצרים מתחת למינימום" : tab === "out" ? "אין מוצרים שאזלו" : "לא נמצאו מוצרים"}
        hint={hasFilters ? "נסה להסיר את הסינון" : undefined}
      />
    );

  const movementsEmpty =
    state.movements.length === 0 ? (
      <EmptyState icon="activity" title="אין תנועות עדיין" hint="קליטה או הוצאה ראשונה תופיע כאן">
        <Button variant="primary" icon="arrow-down-left" onClick={() => ui.openAction("receive")}>קליטת סחורה</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState icon="search" title="לא נמצאו תנועות" hint={<>אין תוצאות עבור <span className="sa-mono ltr">„{query.trim()}”</span></>} />
    ) : (
      <EmptyState icon="activity" title="לא נמצאו תנועות" hint="נסה להסיר את הסינון" />
    );

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-[var(--space-6)] px-[var(--space-10)] py-[var(--space-8)]">
      <header className="flex flex-wrap items-end justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <h1 className="sa-page-title" style={{ fontSize: 30, lineHeight: "36px", fontWeight: 600 }}>מלאי</h1>
          <p className="sa-page-sub">{subline}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <SearchBar kbd={false} value={query} onChange={setQuery} placeholder='חיפוש לפי שם, מק"ט או ברקוד' className="min-w-[240px] flex-1" />
        <Select options={categories} value={category} onChange={setCategory} allLabel="כל הקטגוריות" placeholder="קטגוריה" minWidth={160} />
        <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} allLabel="כל הספקים" placeholder="ספק" minWidth={160} />
        {tab === "movements" ? (
          <Select options={typeOptions} value={moveType} onChange={setMoveType} allLabel="כל הפעולות" placeholder="פעולה" minWidth={150} searchable={false} />
        ) : null}
        <Tabs tabs={tabs} value={tab} onChange={onTab} />
        <div className="ms-auto">
          <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>
        </div>
      </div>

      {tab === "movements" ? (
        <Table<MovementRow>
          caption="תנועות מלאי"
          columns={movementColumns}
          data={movements}
          empty={movementsEmpty}
          onRowClick={(m) => ui.openProduct(m.product_id, "history")}
          footer={<span>מציג <span className="sa-num">{fmtQty(movements.length)}</span> מתוך <span className="sa-num">{fmtQty(state.movements.length)}</span></span>}
        />
      ) : (
        <Table<Product>
          caption="רשימת מוצרים"
          columns={productColumns}
          data={products}
          selectedId={selectedId}
          empty={productsEmpty}
          onRowClick={(p) => ui.openProduct(p.id)}
          footer={<span>מציג <span className="sa-num">{fmtQty(products.length)}</span> מתוך <span className="sa-num">{fmtQty(state.products.length)}</span></span>}
        />
      )}
    </div>
  );
}
