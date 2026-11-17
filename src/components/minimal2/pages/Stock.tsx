"use client";

/**
 * מלאי, the table the whole system leans on. Columns run in the order a manager reads a product: which one it is,
 * what is on the shelf, what orders already hold, what can still be sold, and then the minimum, the place and the
 * state in a word. What can be sold is never shown as a bare negative: where orders hold more than the shelf has,
 * the cell says how much is missing, in the one loud red. Three tabs, the way the question is asked: everything,
 * what is missing, what is fine.
 */
import { Suspense, useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { StockMeter } from "@/components/app/Viz";
import { Button, EmptyState, Icon, Select, Showing, Table, Tabs, Toolbar, type SelectOption, type TableColumn } from "@/components/ui";
import { fmtCompact, fmtQty } from "@/lib/format";
import { shelfWorth } from "@/lib/snapshot";
import { available, useData, type Product } from "@/lib/store";
import { goColumn, ProductCell, Qty } from "../cells";
import { Page, Word, type Metric, type Tone } from "../parts";
import { LEVEL_WORD, levelOf, type StockLevel } from "../work";

type Tab = "all" | "missing" | "ok";
type SortKey = "need" | "name" | "qty";

/** `?filter=` holds the tab. Links that name one kind of missing (short, out, under the minimum) land on what is missing: the state column tells the kinds apart, the most pressing first. */
function tabOf(filter: string | null): Tab {
  if (filter === "ok") return "ok";
  if (filter === "missing" || filter === "attention" || filter === "restock" || filter === "short" || filter === "low" || filter === "out") return "missing";
  return "all";
}

const inTab = (level: StockLevel, tab: Tab) => tab === "all" || (tab === "ok") === (level === "ok");

const NEED: Record<StockLevel, number> = { short: 0, out: 1, low: 2, ok: 3 };
const LEVEL_TONE: Record<StockLevel, Tone> = { short: "short", out: "bad", low: "warn", ok: "ok" };

const cover = (p: Product) => (p.min_qty > 0 ? available(p) / p.min_qty : Number.POSITIVE_INFINITY);

export function Stock(): ReactElement {
  return (
    <Suspense fallback={null}>
      <StockInner />
    </Suspense>
  );
}

function StockInner(): ReactElement {
  const { state } = useData();
  const { openAction, openProduct, panel } = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab = tabOf(params.get("filter"));
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "all") sp.delete("filter");
      else sp.set("filter", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("need");
  const [asc, setAsc] = useState(true);

  const categories = useMemo(() => [...new Set(state.products.map((p) => p.category).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, "he")), [state.products]);
  const supplierOptions = useMemo<SelectOption[]>(() => state.suppliers.map((s) => ({ value: s.id, label: s.name })), [state.suppliers]);

  /* ───────── the rows ───────── */
  const base = useMemo(
    () =>
      state.products.filter((p) => {
        if (category && p.category !== category) return false;
        if (supplierId && p.primary_supplier_id !== supplierId) return false;
        return true;
      }),
    [state.products, category, supplierId],
  );

  const counts = useMemo(() => {
    const c: Record<StockLevel, number> = { short: 0, out: 0, low: 0, ok: 0 };
    for (const p of base) c[levelOf(p)] += 1;
    return c;
  }, [base]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = base.filter((p) => inTab(levelOf(p), tab) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? "").includes(q)));
    const dir = asc ? 1 : -1;
    return list.sort((a, b) => {
      if (sortKey === "qty") return (a.qty - b.qty) * dir || a.name.localeCompare(b.name, "he");
      if (sortKey === "name") return a.name.localeCompare(b.name, "he") * dir;
      const ca = cover(a), cb = cover(b);
      return (NEED[levelOf(a)] - NEED[levelOf(b)] || (ca < cb ? -1 : ca > cb ? 1 : 0)) * dir || a.name.localeCompare(b.name, "he");
    });
  }, [base, tab, q, sortKey, asc]);

  const sortBy = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setAsc((v) => !v);
      else {
        setSortKey(key);
        setAsc(key !== "qty");
      }
    },
    [sortKey],
  );

  const columns = useMemo<TableColumn<Product>[]>(() => {
    const sortable = (label: string, key: SortKey, spoken = label): ReactNode => (
      <button type="button" className="mn2-sort" onClick={() => sortBy(key)} aria-label={`מיון לפי ${spoken}`} aria-pressed={sortKey === key}>
        {label}
        {sortKey === key ? <Icon name={asc ? "chevron-up" : "chevron-down"} size={12} /> : null}
      </button>
    );
    return [
      { key: "product", title: sortable("מוצר", "name"), className: "mn2-cell-main", render: (p) => <ProductCell product={p} /> },
      { key: "qty", title: sortable("במלאי", "qty"), width: "96px", render: (p) => <Qty n={p.qty} unit={p.unit} tone={p.qty <= 0 ? "bad" : undefined} /> },
      { key: "reserved", title: "משוריין", width: "96px", render: (p) => (p.reserved > 0 ? <Qty n={p.reserved} unit={p.unit} /> : <span className="mn2-cell-unset">—</span>) },
      {
        key: "free",
        title: "זמין",
        width: "120px",
        // What can still be promised. Past the shelf it is not a negative number: it is what is missing.
        render: (p) => {
          const free = available(p);
          return free < 0 ? <span className="mn2-gap">חסר <Qty n={-free} unit={p.unit} tone="short" /></span> : <Qty n={free} unit={p.unit} tone={free === 0 ? "quiet" : undefined} />;
        },
      },
      {
        key: "min",
        title: "מינימום",
        width: "116px",
        render: (p) => {
          if (p.min_qty <= 0) return <span className="mn2-cell-unset">לא נקבע</span>;
          const level = levelOf(p);
          return (
            <span className="sa-level">
              <StockMeter value={available(p)} min={p.min_qty} tone={level === "ok" ? "ok" : level === "low" ? "low" : "out"} />
              <span className="ltr">{fmtQty(p.min_qty)}</span>
            </span>
          );
        },
      },
      { key: "location", title: "מיקום", width: "76px", render: (p) => (p.location ? <span className="mn2-cell-text ltr">{p.location}</span> : <span className="mn2-cell-unset">לא שובץ</span>) },
      { key: "state", title: sortable("מצב", "need", "מצב המלאי"), width: "132px", render: (p) => <Word tone={LEVEL_TONE[levelOf(p)]}>{LEVEL_WORD[levelOf(p)]}</Word> },
      { ...goColumn<Product>(), width: "40px" },
    ];
  }, [sortBy, sortKey, asc]);

  /* ───────── the figures: what the shelf is worth, and how much of it is still free to sell ───────── */
  const worth = useMemo(() => shelfWorth(state.products), [state.products]);
  const n = state.products.length;

  const metrics: Metric[] = [
    { key: "worth", label: "שווי המלאי", icon: "package", value: <span className="ltr">{fmtCompact(worth.total)}</span>, note: worth.unpriced > 0 ? `${fmtQty(worth.unpriced)} בלי מחיר` : undefined },
    { key: "held", label: "משוריין להזמנות", icon: "package-check", value: <span className="ltr">{fmtCompact(worth.held)}</span> },
    { key: "free", label: "זמין למכירה", icon: "package-plus", value: <span className="ltr">{fmtCompact(worth.free)}</span>, tone: "ok" },
  ];

  const missing = counts.short + counts.out + counts.low;
  const tabs = [
    { value: "all", label: "הכל", count: base.length },
    { value: "missing", label: <span className={counts.short > 0 ? "text-short" : undefined}>מלאי חסר</span>, count: missing },
    { value: "ok", label: "מלאי תקין", count: counts.ok },
  ];

  const hasFilters = Boolean(q || category || supplierId);
  const clear = () => {
    setQuery("");
    setCategory("");
    setSupplierId("");
  };
  const EMPTY: Record<Tab, string> = { all: "אין מוצרים", missing: "שום מוצר לא חסר", ok: "אין מוצרים במלאי תקין" };
  const empty =
    n === 0 ? (
      <EmptyState title="אין מוצרים" hint="אפשר להוסיף מוצר או לקלוט סחורה">
        <Button variant="secondary" onClick={() => openAction("new-product")}>מוצר חדש</Button>
        <Button variant="secondary" onClick={() => openAction("receive")}>קליטת סחורה</Button>
      </EmptyState>
    ) : hasFilters ? (
      <EmptyState title="לא נמצאו מוצרים" hint={q ? <>עבור „<bdi>{query.trim()}</bdi>”</> : "אפשר להסיר את הסינון"}>
        <Button variant="secondary" onClick={clear}>ניקוי סינון</Button>
      </EmptyState>
    ) : (
      <EmptyState title={EMPTY[tab]}>
        <Button variant="secondary" onClick={() => setTab("all")}>כל המוצרים</Button>
      </EmptyState>
    );

  return (
    <Page
      title="מלאי"
      metrics={metrics}
      toolbar={
        <Toolbar
          tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v === "missing" || v === "ok" ? v : "all")} />}
          filters={
            <>
              <Select options={categories} value={category} onChange={setCategory} allLabel="כל הקטגוריות" placeholder="קטגוריה" />
              <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} allLabel="כל הספקים" placeholder="ספק" />
            </>
          }
          query={query}
          onQuery={setQuery}
          placeholder='חיפוש שם או מק"ט'
        />
      }
    >
      <Table<Product>
        caption="רשימת מוצרים"
        className="mn2-table mn2-stock-table"
        columns={columns}
        data={rows}
        selectedId={panel?.type === "product" ? panel.id : undefined}
        empty={empty}
        onRowClick={(p) => openProduct(p.id)}
        footer={rows.length > 0 && rows.length < n ? <Showing shown={rows.length} total={n} /> : undefined}
      />
    </Page>
  );
}
