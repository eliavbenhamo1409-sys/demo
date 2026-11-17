"use client";

/**
 * מלאי, the table the whole system leans on. Columns run in the order a manager reads a product: which one it is,
 * what is physically there, what orders already hold, what can still be sold, what is missing, and only then the
 * minimum, the place and the state in a word. Three numbers that used to be confused each have a column of their own:
 * מלאי פיזי, זמין להזמנה חדשה, and פער להזמנות, which is never shown as a bare negative.
 */
import { Suspense, useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { StockMeter } from "@/components/app/Viz";
import { Button, EmptyState, Icon, Select, Showing, Table, Tabs, Toolbar, type SelectOption, type TableColumn } from "@/components/ui";
import { fmtCompact, fmtQty } from "@/lib/format";
import { shelfWorth } from "@/lib/snapshot";
import { available, useData, type Product } from "@/lib/store";
import { only, ProductCell, Qty } from "../cells";
import { Page, Word, type Metric, type Tone } from "../parts";
import { LEVEL_WORD, levelOf, type StockLevel } from "../work";

type Tab = "all" | "attention" | "short" | "low" | "ok";
type Hold = "" | "held" | "free";
type SortKey = "need" | "name" | "qty";

const TABS: Tab[] = ["all", "attention", "short", "low", "ok"];

/** `?filter=` holds the tab. Older links land where they meant: an empty shelf is under any minimum, and שריון is a filter of its own. */
function tabOf(filter: string | null): Tab {
  if (filter === "attention" || filter === "missing" || filter === "restock") return "attention";
  if (filter === "short") return "short";
  if (filter === "low" || filter === "out") return "low";
  if (filter === "ok") return "ok";
  return "all";
}

const inTab = (level: StockLevel, tab: Tab) =>
  tab === "all" || (tab === "attention" ? level !== "ok" : tab === "low" ? level === "low" || level === "out" : level === tab);

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
  const [hold, setHold] = useState<Hold>(params.get("filter") === "reserved" ? "held" : "");
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
        if (hold === "held" && p.reserved <= 0) return false;
        if (hold === "free" && p.reserved > 0) return false;
        return true;
      }),
    [state.products, category, supplierId, hold],
  );

  const counts = useMemo(() => {
    const c: Record<StockLevel, number> = { short: 0, out: 0, low: 0, ok: 0 };
    for (const p of base) c[levelOf(p)] += 1;
    return c;
  }, [base]);
  const attention = counts.short + counts.out + counts.low;

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
      { key: "qty", title: sortable("מלאי פיזי", "qty"), width: "88px", render: (p) => <Qty n={p.qty} unit={p.unit} tone={p.qty <= 0 ? "bad" : undefined} /> },
      { key: "reserved", title: "משוריין", width: "88px", render: (p) => (p.reserved > 0 ? <Qty n={p.reserved} unit={p.unit} /> : <span className="mn2-cell-unset">—</span>) },
      { key: "free", title: <>זמין להזמנה<br />חדשה</>, width: "96px", render: (p) => <Qty n={Math.max(0, available(p))} unit={p.unit} tone={available(p) <= 0 ? "quiet" : undefined} /> },
      {
        key: "gap",
        title: <>פער<br />להזמנות</>,
        width: "96px",
        render: (p) => {
          const free = available(p);
          return free < 0 ? <span className="mn2-gap">חסר <Qty n={-free} unit={p.unit} tone="short" /></span> : <span className="mn2-cell-unset">—</span>;
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
      { key: "state", title: sortable("סטטוס", "need", "מצב המלאי"), width: "124px", render: (p) => <Word tone={LEVEL_TONE[levelOf(p)]}>{LEVEL_WORD[levelOf(p)]}</Word> },
      {
        key: "act",
        title: "פעולה",
        width: "112px",
        className: "mn2-cell-act",
        render: (p) => (
          <span className="mn2-acts">
            <Button variant="secondary" size="sm" onClick={only(() => openProduct(p.id))}>פרטי מוצר</Button>
          </span>
        ),
      },
    ];
  }, [sortBy, sortKey, asc, openProduct]);

  /* ───────── the head ───────── */
  const worth = useMemo(() => shelfWorth(state.products), [state.products]);
  const all = useMemo(() => {
    const c = { attention: 0, short: 0, held: 0 };
    for (const p of state.products) {
      const level = levelOf(p);
      if (level !== "ok") c.attention += 1;
      if (level === "short") c.short += 1;
      if (p.reserved > 0) c.held += 1;
    }
    return c;
  }, [state.products]);

  const n = state.products.length;
  const lead =
    n === 0 ? "עוד אין מוצרים. מוצר ראשון נוסף כאן או בקליטת סחורה."
    : all.attention === 0 ? `${fmtQty(n)} מוצרים במעקב, וכולם מעל המינימום.`
    : `${fmtQty(n)} מוצרים במעקב. ${all.attention === 1 ? "מוצר אחד דורש" : `${fmtQty(all.attention)} מוצרים דורשים`} בדיקת מלאי${all.short > 0 ? `, ${all.short === 1 ? "ואחד מהם חסר" : `ו-${fmtQty(all.short)} מהם חסרים`} להזמנות קיימות` : ""}.`;

  const metrics: Metric[] = [
    { key: "worth", label: "שווי המלאי", icon: "package", value: <span className="ltr">{fmtCompact(worth.total)}</span>, note: worth.unpriced > 0 ? `במחירון · ${fmtQty(worth.unpriced)} בלי מחיר` : "לפי מחירון, נכון לעכשיו" },
    { key: "held", label: "משוריין להזמנות", icon: "package-check", value: <span className="ltr">{fmtCompact(worth.held)}</span>, note: all.held > 0 ? `${fmtQty(all.held)} מוצרים שהזמנות פתוחות מחזיקות` : "אין מלאי משוריין" },
    { key: "free", label: "זמין למכירה", icon: "package-plus", value: <span className="ltr">{fmtCompact(worth.free)}</span>, tone: "ok", note: "מה שעוד לא הובטח לאף לקוח" },
    {
      key: "attention", label: "דורשים בדיקה", icon: "package-search", value: all.attention, tone: all.attention === 0 ? "ok" : all.short > 0 ? "short" : "warn", href: "/inventory?view=shortages",
      note: all.attention === 0 ? <span className="is-ok">כל המוצרים תקינים</span> : all.short > 0 ? <span className="is-short">{fmtQty(all.short)} חסרים להזמנות</span> : "מתחת למינימום",
    },
  ];

  const tabs = [
    { value: "all", label: "כל המוצרים", count: base.length },
    { value: "attention", label: "דורש טיפול", count: attention },
    { value: "short", label: <span className={counts.short > 0 ? "text-short" : undefined}>חסר להזמנות</span>, count: counts.short },
    { value: "low", label: "מתחת למינימום", count: counts.low + counts.out },
    { value: "ok", label: "מלאי תקין", count: counts.ok },
  ];

  const hasFilters = Boolean(q || category || supplierId || hold);
  const clear = () => {
    setQuery("");
    setCategory("");
    setSupplierId("");
    setHold("");
  };
  const EMPTY: Record<Tab, { title: string; hint: string }> = {
    all: { title: "אין מוצרים", hint: "אפשר להוסיף מוצר או לקלוט סחורה" },
    attention: { title: "אין מוצר שדורש טיפול", hint: "כל המוצרים מעל המינימום" },
    short: { title: "אין מוצר שחסר להזמנות", hint: "המדף מכסה את כל ההזמנות" },
    low: { title: "אין מוצר מתחת למינימום", hint: "כל המוצרים מעל הרף שנקבע להם" },
    ok: { title: "אין מוצרים במלאי תקין", hint: "כל המוצרים חסרים או מתחת למינימום" },
  };
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
      <EmptyState title={EMPTY[tab].title} hint={EMPTY[tab].hint}>
        <Button variant="secondary" onClick={() => setTab("all")}>כל המוצרים</Button>
      </EmptyState>
    );

  return (
    <Page
      title="מלאי"
      state={all.attention === 0 ? { word: "הכל תקין", tone: "ok" } : { word: `${fmtQty(all.attention)} דורשים בדיקה`, tone: all.short > 0 ? "short" : "warn" }}
      lead={lead}
      action={<Button variant="primary" icon="plus" onClick={() => openAction("new-product")}>מוצר חדש</Button>}
      metrics={metrics}
      toolbar={
        <Toolbar
          tabs={<Tabs tabs={tabs} value={tab} onChange={(v) => setTab((TABS as string[]).includes(v) ? (v as Tab) : "all")} />}
          filters={
            <>
              <Select options={categories} value={category} onChange={setCategory} allLabel="כל הקטגוריות" placeholder="קטגוריה" />
              <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} allLabel="כל הספקים" placeholder="ספק" />
              <Select
                options={[{ value: "held", label: "רק משוריין להזמנות" }, { value: "free", label: "רק לא משוריין" }]}
                value={hold}
                onChange={(v) => setHold(v === "held" || v === "free" ? v : "")}
                allLabel="משוריין ולא משוריין"
                placeholder="שריון"
                searchable={false}
              />
            </>
          }
          query={query}
          onQuery={setQuery}
          placeholder='חיפוש לפי שם או מק"ט'
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
