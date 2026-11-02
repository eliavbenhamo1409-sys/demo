"use client";

import { Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { available, useData, type Product } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb, StockMeter } from "@/components/app/Viz";
import {
  Button,
  Count,
  Dot,
  EmptyState,
  Icon,
  PageHead,
  Select,
  Showing,
  Table,
  Tabs,
  Toolbar,
  type SelectOption,
  type TableColumn,
} from "@/components/ui";
import { fmtName, fmtQty, fmtRelative } from "@/lib/format";

type Tab = "products" | "low" | "out" | "reserved" | "short";
type SortKey = "name" | "qty" | "updated_at";
type SortDir = "asc" | "desc";

const TAB_VALUES: Tab[] = ["products", "low", "out", "reserved", "short"];

function tabFromParams(params: URLSearchParams): Tab {
  const filter = params.get("filter");
  if (filter === "low") return "low";
  if (filter === "out") return "out";
  if (filter === "reserved") return "reserved";
  if (filter === "short") return "short";
  return "products";
}

/** The store's rule: what is left after open orders is under the minimum, and it isn't already short. */
function isLow(p: Product): boolean {
  const free = available(p);
  return p.qty > 0 && free >= 0 && p.min_qty > 0 && free < p.min_qty;
}
function isOut(p: Product): boolean {
  return p.qty <= 0;
}
function isShort(p: Product): boolean {
  return available(p) < 0;
}
function isReserved(p: Product): boolean {
  return p.reserved > 0;
}

/** What a hold leaves: what can still be promised, or what the orders are missing once it passes the shelf. */
function afterOrders(p: Product): string {
  const free = available(p);
  return free < 0 ? `חסר ${fmtQty(-free)}` : `זמין ${fmtQty(free)}`;
}

/** The one real red, on the figures of a short product. Important because `sa-*` classes outrank utilities. */
const SHORT_FIGURE = "text-short! font-semibold!";

/** From 1100px a table clips instead of scrolling (minimal.css), so where seven columns don't fit עודכן goes rather than being cut off. */
const HIDE_UPDATED = "min-[1100px]:max-[1379px]:[&_:is(td,th):nth-child(7)]:hidden";

/** Phones keep name and quantity only; the product panel has the rest. Counts columns. */
const PHONE_PRODUCTS = "max-[600px]:[&_:is(td,th):not(:nth-child(1),:nth-child(4))]:hidden";

/** On phones this cell takes what the quantity leaves, so a long name truncates instead of scrolling the table sideways. */
const PHONE_MAIN_CELL = "max-[600px]:w-full max-[600px]:max-w-0";

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryInner />
    </Suspense>
  );
}

function InventoryInner() {
  const { state, stats, supplier } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The active tab lives in the URL (?filter=low|out|reserved|short).
  const tab = tabFromParams(params);
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      sp.delete("filter");
      if (next !== "products") sp.set("filter", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
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
  const reservedCount = useMemo(() => baseProducts.filter(isReserved).length, [baseProducts]);
  const shortCount = useMemo(() => baseProducts.filter(isShort).length, [baseProducts]);

  const products = useMemo(() => {
    let list = baseProducts;
    if (tab === "low") list = list.filter(isLow);
    else if (tab === "out") list = list.filter(isOut);
    else if (tab === "reserved") list = list.filter(isReserved);
    else if (tab === "short") list = list.filter(isShort);
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
          className="inline-flex items-center gap-[var(--space-1)] hover:text-ink"
          onClick={() => toggleSort(key)}
          aria-label={`מיון לפי ${label}`}
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
        className: PHONE_MAIN_CELL,
        render: (p) => (
          <span className="sa-thumbed">
            <ProductThumb product={p} />
            <span className="block min-w-0 max-w-[340px] max-[600px]:max-w-none">
              <span className="sa-cell-primary sa-truncate block" title={p.name}>{fmtName(p.name)}</span>
              <span className="sa-cell-sub sa-truncate">
                <span className="sa-mono ltr">{p.sku}</span>
                {p.category ? ` · ${p.category}` : null}
              </span>
            </span>
          </span>
        ),
      },
      {
        key: "location",
        title: "מיקום",
        muted: true,
        render: (p) => <span className="sa-truncate block max-w-[120px]" title={p.location ?? undefined}>{p.location ?? "—"}</span>,
      },
      {
        key: "supplier",
        title: "ספק",
        render: (p) => {
          const name = supplier(p.primary_supplier_id)?.name;
          return <span className="sa-truncate block max-w-[140px]" title={name}>{name ?? "—"}</span>;
        },
      },
      {
        key: "qty",
        title: sortTitle("כמות", "qty"),
        mono: true,
        render: (p) => {
          const short = isShort(p);
          const urgent = isOut(p) || short;
          const state = isOut(p) ? "אזל" : short ? "חסר להזמנות" : isLow(p) ? "מתחת למינימום" : null;
          return (
            <>
              <span className="relative inline-flex items-baseline gap-[var(--space-1)]">
                {state ? <Dot tone={urgent ? "danger" : "warning"} className={`absolute start-[-14px] top-[7px] ${short ? "bg-short!" : ""}`} /> : null}
                {state ? <span className="sa-sr">{state}</span> : null}
                <span className={`sa-stock ltr min-w-[4ch] text-right ${short ? SHORT_FIGURE : urgent ? "text-danger-text" : isLow(p) ? "text-warning-text" : ""}`}>{fmtQty(p.qty)}</span>
                <span className="sa-hint">{p.unit}</span>
              </span>
              {/* Narrower screens hide the reserved column or scroll it out of view. */}
              {isReserved(p) ? <span className={`sa-cell-sub min-[1100px]:hidden! ${short ? SHORT_FIGURE : ""}`}>{short ? afterOrders(p) : `משוריין ${fmtQty(p.reserved)}`}</span> : null}
            </>
          );
        },
      },
      {
        key: "reserved",
        title: "משוריין",
        mono: true,
        render: (p) => {
          if (!isReserved(p)) return <span className="text-ink-3">—</span>;
          const red = isShort(p) ? SHORT_FIGURE : "";
          return (
            <>
              <span className={`sa-stock ltr ${red}`}>{fmtQty(p.reserved)}</span>
              <span className={`sa-cell-sub ${red}`}>{afterOrders(p)}</span>
            </>
          );
        },
      },
      {
        key: "min_qty",
        title: "מול המינימום",
        muted: true,
        render: (p) => (
          <span className="sa-level">
            <StockMeter value={available(p)} min={p.min_qty} tone={isOut(p) || isShort(p) ? "out" : isLow(p) ? "low" : "ok"} />
            <span className="sa-mono ltr">{fmtQty(p.min_qty)}</span>
          </span>
        ),
      },
      { key: "updated_at", title: sortTitle("עודכן", "updated_at"), muted: true, className: "whitespace-nowrap", render: (p) => fmtRelative(p.updated_at) },
    ],
    [supplier, sortTitle],
  );

  /* ───────── header ───────── */
  const tabs = [
    { value: "products", label: "מוצרים", count: baseProducts.length },
    { value: "low", label: "מתחת למינימום", count: lowCount },
    { value: "out", label: "אזל", count: outCount },
    { value: "reserved", label: "משוריין", count: reservedCount },
    // Only while orders hold more than the shelf has, or while it's the open tab.
    ...(shortCount > 0 || tab === "short" ? [{ value: "short", label: <span className="text-short">חסר להזמנות</span>, count: shortCount }] : []),
  ];

  const onTab = (v: string) => {
    if ((TAB_VALUES as string[]).includes(v)) setTab(v as Tab);
  };

  const hasFilters = Boolean(q || category || supplierId);

  const productsEmpty =
    state.products.length === 0 ? (
      <EmptyState title="אין מוצרים" hint="אפשר להוסיף מוצר או לקלוט סחורה">
        <Button variant="secondary" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>
        <Button variant="secondary" onClick={() => ui.openAction("receive")}>קליטת סחורה</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState title="לא נמצאו מוצרים" hint={<>עבור <span className="sa-mono ltr">„{query.trim()}”</span></>} />
    ) : (
      <EmptyState
        title={tab === "low" ? "אין מוצרים מתחת למינימום" : tab === "out" ? "אין מוצרים שאזלו" : tab === "reserved" ? "אין מוצרים משוריינים" : tab === "short" ? "אין מוצרים שחסרים להזמנות" : "לא נמצאו מוצרים"}
        hint={hasFilters ? "אפשר להסיר את הסינון" : undefined}
      />
    );

  return (
    <div className="sa-page">
      <PageHead
        title="מלאי"
        sub={<Count n={stats.movementsToday} one="תנועה היום" many="תנועות היום" />}
        actions={<Button variant="primary" icon="plus" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>}
      />

      <Toolbar
        tabs={<Tabs tabs={tabs} value={tab} onChange={onTab} />}
        filters={
          <>
            <Select options={categories} value={category} onChange={setCategory} allLabel="כל הקטגוריות" placeholder="קטגוריה" />
            <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} allLabel="כל הספקים" placeholder="ספק" />
          </>
        }
        query={query}
        onQuery={setQuery}
        placeholder='חיפוש לפי שם, מק"ט או ברקוד'
      />

      <Table<Product>
        caption="רשימת מוצרים"
        className={`sa-inventory-table ${HIDE_UPDATED} ${PHONE_PRODUCTS}`}
        columns={productColumns}
        data={products}
        selectedId={selectedId}
        empty={productsEmpty}
        onRowClick={(p) => ui.openProduct(p.id)}
        footer={products.length < state.products.length ? <Showing shown={products.length} total={state.products.length} /> : undefined}
      />
    </div>
  );
}
