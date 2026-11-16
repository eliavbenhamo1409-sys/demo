"use client";

import { Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { available, useData, type Product } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb, StockMeter } from "@/components/app/Viz";
import {
  Button,
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
import { fmtCompact, fmtDayWord, fmtName, fmtQty, fmtUnit } from "@/lib/format";
import { shelfWorth } from "@/lib/snapshot";
import "./inventory.css";

/** The tabs: everything in order of need (מבט כולל), what is fine, what is missing, what open orders hold. */
type View = "all" | "ok" | "missing" | "reserved";
/** Inside מלאי חסר, the row beneath: all of it, or one kind. */
type Kind = "any" | "out" | "low" | "short";
type SortKey = "level" | "name" | "qty" | "updated_at";
type SortDir = "asc" | "desc";

const VIEWS: View[] = ["all", "ok", "missing", "reserved"];
const KINDS: Kind[] = ["any", "out", "low", "short"];

/** `?filter=` holds the place: ok, missing, reserved, or one kind inside missing. The older links (low, out, short, reserved, restock) land where they meant. */
function placeFromParams(params: URLSearchParams): { view: View; kind: Kind } {
  switch (params.get("filter")) {
    case "ok": return { view: "ok", kind: "any" };
    case "missing":
    case "restock": return { view: "missing", kind: "any" };
    case "out": return { view: "missing", kind: "out" };
    case "low": return { view: "missing", kind: "low" };
    case "short": return { view: "missing", kind: "short" };
    case "reserved": return { view: "reserved", kind: "any" };
    default: return { view: "all", kind: "any" };
  }
}

function filterOf(view: View, kind: Kind): string | null {
  if (view === "missing") return kind === "any" ? "missing" : kind;
  return view === "all" ? null : view;
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

/** One reading per product, in the order of need: nothing on the shelf, orders past the shelf, under the minimum after orders, fine. */
type Level = "out" | "short" | "low" | "ok";
function levelOf(p: Product): Level {
  if (isOut(p)) return "out";
  if (isShort(p)) return "short";
  if (isLow(p)) return "low";
  return "ok";
}
const NEED: Record<Level, number> = { out: 0, short: 1, low: 2, ok: 3 };

/** What is left after orders against the minimum; within a level the one closest to empty comes first. */
function cover(p: Product): number {
  return p.min_qty > 0 ? available(p) / p.min_qty : Number.POSITIVE_INFINITY;
}

/** What a hold leaves: what can still be promised, or what the orders are missing once it passes the shelf. */
function afterOrders(p: Product): string {
  const free = available(p);
  return free < 0 ? `חסר ${fmtQty(-free)}` : `זמין ${fmtQty(free)}`;
}

/** The one real red, on the figures of a short product. Important because `sa-*` classes outrank utilities. */
const SHORT_FIGURE = "text-short! font-semibold!";

/** The figures stand beside the name and the details follow, so a narrower window gives up the last columns first: from 1100px a table clips instead of scrolling (minimal.css), and nothing may be cut off. Counts columns. */
const NARROW_PRODUCTS = "min-[601px]:max-[1379px]:[&_:is(td,th):nth-child(7)]:hidden min-[601px]:max-[1239px]:[&_:is(td,th):nth-child(6)]:hidden min-[601px]:max-[1023px]:[&_:is(td,th):nth-child(5)]:hidden";

/** Phones keep name and quantity only; the product panel has the rest. Counts columns. */
const PHONE_PRODUCTS = "max-[600px]:[&_:is(td,th):not(:nth-child(1),:nth-child(2))]:hidden";

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
  const { state, supplier } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The tab and the kind inside מלאי חסר live in the URL (?filter=ok|missing|out|low|short|reserved).
  const { view, kind } = placeFromParams(params);
  const go = useCallback(
    (nextView: View, nextKind: Kind = "any") => {
      const sp = new URLSearchParams(params.toString());
      sp.delete("filter");
      const filter = filterOf(nextView, nextKind);
      if (filter) sp.set("filter", filter);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
  // The first look is in order of need: what ran out, what orders took past the shelf, what is under the minimum, then what is fine.
  const [sortKey, setSortKey] = useState<SortKey>("level");
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
  const worth = useMemo(() => shelfWorth(state.products).total, [state.products]);
  const q = query.trim().toLowerCase();

  const baseProducts = useMemo(() => {
    return state.products.filter((p) => {
      if (category && p.category !== category) return false;
      if (supplierId && p.primary_supplier_id !== supplierId) return false;
      return true;
    });
  }, [state.products, category, supplierId]);

  /** Each product counted once by its level; חסר להזמנות also counts one that ran out while orders hold it. */
  const counts = useMemo(() => {
    const c = { out: 0, short: 0, low: 0, ok: 0, overbooked: 0, reserved: 0 };
    for (const p of baseProducts) {
      c[levelOf(p)] += 1;
      if (isShort(p)) c.overbooked += 1;
      if (isReserved(p)) c.reserved += 1;
    }
    return c;
  }, [baseProducts]);
  const missingCount = counts.out + counts.short + counts.low;

  const products = useMemo(() => {
    let list = baseProducts;
    if (view === "ok") list = list.filter((p) => levelOf(p) === "ok");
    else if (view === "missing") {
      if (kind === "out") list = list.filter(isOut);
      else if (kind === "low") list = list.filter(isLow);
      else if (kind === "short") list = list.filter(isShort);
      else list = list.filter((p) => levelOf(p) !== "ok");
    } else if (view === "reserved") list = list.filter(isReserved);
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? "").includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "level") {
        const ca = cover(a), cb = cover(b);
        const need = NEED[levelOf(a)] - NEED[levelOf(b)] || (ca < cb ? -1 : ca > cb ? 1 : 0);
        return need * dir || a.name.localeCompare(b.name, "he");
      }
      if (sortKey === "qty") return (a.qty - b.qty) * dir;
      if (sortKey === "updated_at") return a.updated_at.localeCompare(b.updated_at) * dir;
      return a.name.localeCompare(b.name, "he") * dir;
    });
  }, [baseProducts, view, kind, q, sortKey, sortDir]);

  // No state set inside another's updater: React may run an updater twice, which flipped the direction back.
  const toggleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setSortDir(key === "name" || key === "level" ? "asc" : "desc");
    },
    [sortKey],
  );

  const sortTitle = useCallback(
    (label: string, key: SortKey, spoken = label): ReactNode => {
      const active = sortKey === key;
      return (
        <button
          type="button"
          className="inline-flex items-center gap-[var(--space-1)] hover:text-ink"
          onClick={() => toggleSort(key)}
          aria-label={`מיון לפי ${spoken}`}
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
                <span className="sa-hint">{fmtUnit(p.qty, p.unit)}</span>
              </span>
              {/* Phones hide the reserved column. */}
              {isReserved(p) ? <span className={`sa-cell-sub min-[601px]:hidden! ${short ? SHORT_FIGURE : ""}`}>{short ? afterOrders(p) : `משוריין ${fmtQty(p.reserved)}`}</span> : null}
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
        // The order of need is this column's: pressing it brings the first look back after another sort.
        title: sortTitle("מול המינימום", "level", "מצב המלאי"),
        muted: true,
        render: (p) => (
          <span className="sa-level">
            <StockMeter value={available(p)} min={p.min_qty} tone={isOut(p) || isShort(p) ? "out" : isLow(p) ? "low" : "ok"} />
            <span className="sa-mono ltr">{fmtQty(p.min_qty)}</span>
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
        muted: true,
        render: (p) => {
          const name = supplier(p.primary_supplier_id)?.name;
          return <span className="sa-truncate block max-w-[140px]" title={name}>{name ?? "—"}</span>;
        },
      },
      { key: "updated_at", title: sortTitle("עודכן", "updated_at"), muted: true, className: "whitespace-nowrap", render: (p) => fmtDayWord(p.updated_at) },
    ],
    [supplier, sortTitle],
  );

  /* ───────── header ───────── */
  const tabs = [
    { value: "all", label: "מבט כולל", count: baseProducts.length },
    // A phone drops the word מלאי, so the four tabs and their counts stand without scrolling.
    { value: "ok", label: <><span className="sa-stock-word">מלאי </span>תקין</>, count: counts.ok },
    { value: "missing", label: <><span className="sa-stock-word">מלאי </span>חסר</>, count: missingCount },
    { value: "reserved", label: "משוריין", count: counts.reserved },
  ];

  /* What מלאי חסר holds, beneath it, worst first; חסר להזמנות stands last because it comes and goes. */
  const kinds = [
    { value: "any", label: "הכל", count: missingCount },
    { value: "out", label: "אזל", count: counts.out },
    { value: "low", label: "מתחת למינימום", count: counts.low },
    // Only while orders hold more than the shelf has, or while it's the open kind.
    ...(counts.overbooked > 0 || kind === "short" ? [{ value: "short", label: <span className="text-short">חסר להזמנות</span>, count: counts.overbooked }] : []),
  ];

  // A press on מלאי חסר itself always opens all of it.
  const onTab = (v: string) => {
    if ((VIEWS as string[]).includes(v)) go(v as View);
  };
  const onKind = (v: string) => {
    if ((KINDS as string[]).includes(v)) go("missing", v as Kind);
  };

  const hasFilters = Boolean(q || category || supplierId);

  const emptyCopy =
    view === "ok" ? { title: "אין מוצרים במלאי תקין", hint: "כל המוצרים חסרים או מתחת למינימום" }
    : view === "reserved" ? { title: "אין מוצרים משוריינים", hint: "מלאי שהזמנה פתוחה משריינת יופיע כאן" }
    : kind === "out" ? { title: "אין מוצרים שאזלו", hint: "לכל מוצר יש מלאי על המדף" }
    : kind === "low" ? { title: "אין מוצרים מתחת למינימום", hint: "המלאי מעל המינימום" }
    : kind === "short" ? { title: "אין מוצרים שחסרים להזמנות", hint: "המדף מכסה את כל ההזמנות" }
    : { title: "אין מלאי חסר", hint: "כל המוצרים מעל המינימום" };

  const clearFilters = () => {
    setQuery("");
    setCategory("");
    setSupplierId("");
  };

  const productsEmpty =
    state.products.length === 0 ? (
      <EmptyState title="אין מוצרים" hint="אפשר להוסיף מוצר או לקלוט סחורה">
        <Button variant="secondary" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>
        <Button variant="secondary" onClick={() => ui.openAction("receive")}>קליטת סחורה</Button>
      </EmptyState>
    ) : q ? (
      <EmptyState title="לא נמצאו מוצרים" hint={<>עבור „<bdi>{query.trim()}</bdi>”</>}>
        <Button variant="secondary" onClick={clearFilters}>ניקוי סינון</Button>
      </EmptyState>
    ) : hasFilters ? (
      <EmptyState title="לא נמצאו מוצרים" hint="אפשר להסיר את הסינון">
        <Button variant="secondary" onClick={clearFilters}>ניקוי סינון</Button>
      </EmptyState>
    ) : (
      <EmptyState title={emptyCopy.title} hint={emptyCopy.hint}>
        <Button variant="secondary" onClick={() => go("all")}>מבט כולל</Button>
      </EmptyState>
    );

  return (
    <div className="sa-page">
      <PageHead
        title="מלאי"
        sub={worth > 0 ? <>שווי <span className="ltr">{fmtCompact(worth)}</span> במחירון</> : undefined}
        actions={<Button variant="primary" icon="plus" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>}
      />

      <Toolbar
        tabs={
          <div className="sa-stock-tabs">
            <Tabs tabs={tabs} value={view} onChange={onTab} />
            {view === "missing" ? (
              <div className="sa-stock-kinds" role="group" aria-label="סוג החוסר">
                <Tabs tabs={kinds} value={kind} onChange={onKind} />
              </div>
            ) : null}
          </div>
        }
        filters={
          <>
            <Select options={categories} value={category} onChange={setCategory} allLabel="כל הקטגוריות" placeholder="קטגוריה" />
            <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} allLabel="כל הספקים" placeholder="ספק" />
          </>
        }
        query={query}
        onQuery={setQuery}
        placeholder='חיפוש לפי שם או מק"ט'
      />

      <Table<Product>
        caption="רשימת מוצרים"
        className={`sa-inventory-table ${NARROW_PRODUCTS} ${PHONE_PRODUCTS}`}
        columns={productColumns}
        data={products}
        selectedId={selectedId}
        empty={productsEmpty}
        onRowClick={(p) => ui.openProduct(p.id)}
        footer={products.length > 0 && products.length < state.products.length ? <Showing shown={products.length} total={state.products.length} /> : undefined}
      />
    </div>
  );
}
