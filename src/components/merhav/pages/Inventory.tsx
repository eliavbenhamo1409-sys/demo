"use client";

/**
 * מלאי as a tool: the skyline is the whole stock at a glance and also its filter, the rows are a ledger, and every row
 * reaches for its own shelf on the model. Same data and the same ?filter= as the shared page.
 */

import { Suspense, useCallback, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { Button, cx, EmptyState, Icon, SearchBar, Select, type SelectOption } from "@/components/ui";
import { fmtName, fmtQty, fmtRelative } from "@/lib/format";
import { available, stockState, useData, type Product } from "@/lib/store";
import { useTwin } from "../twin/Twin";

type Lens = "products" | "low" | "out" | "reserved" | "short";
type SortKey = "name" | "qty" | "updated_at";

const LENSES: Lens[] = ["products", "low", "out", "reserved", "short"];

function lensOf(params: URLSearchParams): Lens {
  const filter = params.get("filter");
  return LENSES.find((lens) => lens === filter) ?? "products";
}

const isLow = (p: Product) => stockState(p) === "low";
const isOut = (p: Product) => p.qty <= 0;
const isShort = (p: Product) => available(p) < 0;
const isHeld = (p: Product) => p.reserved > 0;

const IN_LENS: Record<Lens, (p: Product) => boolean> = { products: () => true, low: isLow, out: isOut, reserved: isHeld, short: isShort };

const STATE_WORD = { low: "מתחת למינימום", out: "אזל", short: "חסר להזמנות" } as const;

/** How many minimums fill a bar. A log scale, so the many healthy products still read as a shape and not as one flat wall. */
const SKY_TOP = 12;

/** How high a product stands: its free stock in minimums. The cut across the skyline is the minimum itself. */
function fullness(p: Product): number {
  const free = Math.max(available(p), 0);
  if (free === 0) return 0;
  const minimums = p.min_qty > 0 ? free / p.min_qty : SKY_TOP / 2;
  return Math.min(Math.log1p(minimums) / Math.log1p(SKY_TOP), 1);
}

/** The worst first, then the emptiest: the skyline climbs from what needs a hand to what is safe. */
const SEVERITY = { short: 0, out: 1, low: 2, ok: 3 } as const;
function bySkyline(a: Product, b: Product): number {
  return SEVERITY[stockState(a)] - SEVERITY[stockState(b)] || fullness(a) - fullness(b) || a.sku.localeCompare(b.sku);
}

/* ───────── the skyline ───────── */

function Skyline({ products, onHover, onOpen }: { products: Product[]; onHover: (p: Product | null) => void; onOpen: (p: Product) => void }): ReactElement {
  const sorted = useMemo(() => [...products].sort(bySkyline), [products]);
  return (
    <div className="mh-skyline" role="img" aria-label={`${fmtQty(products.length)} מוצרים לפי מצב המלאי`} onPointerLeave={() => onHover(null)}>
      {sorted.map((p) => {
        const state = stockState(p);
        return (
          <button
            key={p.id}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className={cx("mh-sky", state !== "ok" && `is-${state}`)}
            style={{ "--h": fullness(p) } as CSSProperties}
            onPointerEnter={() => onHover(p)}
            onClick={() => onOpen(p)}
          />
        );
      })}
      <i className="mh-skyline-min" style={{ bottom: `${(Math.log1p(1) / Math.log1p(SKY_TOP)) * 100}%` }} aria-hidden="true" />
    </div>
  );
}

/* ───────── one row ───────── */

function Gauge({ p }: { p: Product }): ReactElement {
  const top = Math.max(p.min_qty * 2, p.qty, 1);
  const pct = (n: number) => `${Math.min((n / top) * 100, 100)}%`;
  const state = stockState(p);
  const free = Math.max(available(p), 0);
  return (
    <span className={cx("mh-gauge-bar", state !== "ok" && `is-${state}`)} dir="ltr" aria-hidden="true">
      <i style={{ width: pct(free) }} />
      {p.reserved > 0 ? <b style={{ width: pct(Math.min(p.reserved, p.qty)) }} /> : null}
      {p.min_qty > 0 ? <u style={{ left: pct(p.min_qty) }} /> : null}
    </span>
  );
}

export function Inventory(): ReactElement {
  return (
    <Suspense fallback={null}>
      <InventoryInner />
    </Suspense>
  );
}

function InventoryInner(): ReactElement {
  const { state, supplier } = useData();
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { spotProduct, aimProduct, itemsOf } = useTwin();

  const lens = lensOf(params);
  const setLens = useCallback(
    (next: Lens) => {
      const sp = new URLSearchParams(params.toString());
      sp.delete("filter");
      if (next !== "products" && next !== lens) sp.set("filter", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, lens],
  );

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [ascending, setAscending] = useState(true);

  const categories = useMemo(() => [...new Set(state.products.map((p) => p.category).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, "he")), [state.products]);
  const supplierOptions = useMemo<SelectOption[]>(() => state.suppliers.map((s) => ({ value: s.id, label: s.name })), [state.suppliers]);

  const base = useMemo(
    () => state.products.filter((p) => (!category || p.category === category) && (!supplierId || p.primary_supplier_id === supplierId)),
    [state.products, category, supplierId],
  );

  const counts = useMemo(() => {
    const of = (test: (p: Product) => boolean) => base.filter(test).length;
    return { products: base.length, low: of(isLow), out: of(isOut), reserved: of(isHeld), short: of(isShort) };
  }, [base]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = base.filter(IN_LENS[lens]).filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? "").includes(q));
    const dir = ascending ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "qty") return (a.qty - b.qty) * dir;
      if (sortKey === "updated_at") return a.updated_at.localeCompare(b.updated_at) * dir;
      return a.name.localeCompare(b.name, "he") * dir;
    });
  }, [base, lens, q, sortKey, ascending]);

  const sortBy = (key: SortKey) => {
    if (sortKey === key) setAscending((v) => !v);
    else {
      setSortKey(key);
      setAscending(key === "name");
    }
  };

  /* ───────── a row reaches for its shelf ───────── */
  const door = useRef<HTMLDivElement>(null);
  const reach = useCallback(
    (p: Product | null, e?: PointerEvent<HTMLElement>) => {
      spotProduct(p?.id ?? null);
      if (!p || !e) {
        aimProduct(null);
        return;
      }
      const box = e.currentTarget.getBoundingClientRect();
      const edge = door.current?.getBoundingClientRect().left ?? box.left;
      aimProduct(p.id, { x: edge, y: box.top + box.height / 2 });
    },
    [spotProduct, aimProduct],
  );

  const selected = ui.panel?.type === "product" ? ui.panel.id : undefined;
  const filtered = Boolean(q || category || supplierId);

  const [skyHover, setSkyHover] = useState<Product | null>(null);
  const onSky = useCallback(
    (p: Product | null) => {
      setSkyHover(p);
      spotProduct(p?.id ?? null);
    },
    [spotProduct],
  );

  const lensRow: { key: Lens; word: string; count: number; tone?: string }[] = [
    { key: "products", word: "מוצרים", count: counts.products },
    { key: "low", word: "מתחת למינימום", count: counts.low, tone: "mh-tone-warn" },
    { key: "out", word: "אזל", count: counts.out, tone: "mh-tone-out" },
    { key: "reserved", word: "משוריין", count: counts.reserved },
    ...(counts.short > 0 || lens === "short" ? [{ key: "short" as const, word: "חסר להזמנות", count: counts.short, tone: "mh-tone-short" }] : []),
  ];

  return (
    <div ref={door} className="mh-inv">
      <header className="mh-inv-head">
        <div className="mh-inv-title">
          <h1 className="sa-page-title">מלאי</h1>
          <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>
        </div>

        <Skyline products={base} onHover={onSky} onOpen={(p) => ui.openProduct(p.id)} />

        <div className="mh-lens" role="group" aria-label="סינון לפי מצב">
          {lensRow.map((item) => (
            <button key={item.key} type="button" aria-pressed={lens === item.key} className={cx("mh-lens-item", lens === item.key && "is-on")} onClick={() => setLens(item.key)}>
              <span className={cx("mh-lens-n ltr", item.tone)}>{fmtQty(item.count)}</span>
              <span className="mh-lens-word">{item.word}</span>
            </button>
          ))}
          {skyHover ? (
            <span className="mh-lens-peek">
              <span className="mh-row-title">{fmtName(skyHover.name)}</span>
              <span className="ltr">{fmtQty(skyHover.qty)}</span>
            </span>
          ) : null}
        </div>
      </header>

      <div className="mh-inv-tools">
        <SearchBar kbd={false} value={query} onChange={setQuery} placeholder='חיפוש לפי שם, מק"ט או ברקוד' />
        <Select options={categories} value={category} onChange={setCategory} allLabel="כל הקטגוריות" placeholder="קטגוריה" />
        <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} allLabel="כל הספקים" placeholder="ספק" />
      </div>

      <div className="mh-led">
        <div className="mh-led-head">
          <button type="button" className="is-name" onClick={() => sortBy("name")} aria-pressed={sortKey === "name"}>
            מוצר {sortKey === "name" ? <Icon name={ascending ? "chevron-up" : "chevron-down"} size={12} /> : null}
          </button>
          <span className="is-place">מיקום</span>
          <span className="is-gauge">מול המינימום</span>
          <button type="button" className="is-qty" onClick={() => sortBy("qty")} aria-pressed={sortKey === "qty"}>
            כמות {sortKey === "qty" ? <Icon name={ascending ? "chevron-up" : "chevron-down"} size={12} /> : null}
          </button>
        </div>

        <ul className="mh-led-list" aria-label="רשימת מוצרים">
        {rows.map((p) => {
          const stock = stockState(p);
          const items = itemsOf(p.id);
          const place = items[0]?.place ?? p.location;
          const more = items.length > 1 ? items.length - 1 : 0;
          const free = available(p);
          return (
            <li key={p.id}>
            <button
              type="button"
              aria-current={p.id === selected ? "true" : undefined}
              className={cx("mh-led-row", p.id === selected && "is-selected")}
              onPointerEnter={(e) => reach(p, e)}
              onPointerLeave={() => reach(null)}
              onFocus={() => spotProduct(p.id)}
              onBlur={() => spotProduct(null)}
              onClick={() => ui.openProduct(p.id)}
            >
              <span className="is-name">
                <ProductThumb product={p} />
                <span className="mh-row-main">
                  <span className="mh-row-title" title={p.name}>{fmtName(p.name)}</span>
                  <span className="mh-row-sub"><span className="ltr">{p.sku}</span>{supplier(p.primary_supplier_id) ? ` · ${supplier(p.primary_supplier_id)?.name}` : p.category ? ` · ${p.category}` : ""}</span>
                </span>
              </span>
              <span className="is-place">
                {place ? <span className="ltr">{place}</span> : <span className="mh-tone-quiet">—</span>}
                {more > 0 ? <span className="mh-row-state">עוד {fmtQty(more)}</span> : null}
              </span>
              <span className="is-gauge">
                <Gauge p={p} />
                <span className="mh-row-state">{p.min_qty > 0 ? <>מינימום <span className="ltr">{fmtQty(p.min_qty)}</span></> : "ללא מינימום"}</span>
              </span>
              <span className="is-qty">
                <span className="mh-led-fig">
                  <span className={cx("ltr", stock === "short" ? "mh-tone-short" : stock === "out" ? "mh-tone-out" : stock === "low" ? "mh-tone-warn" : undefined)}>{fmtQty(p.qty)}</span>
                  <small>{p.unit}</small>
                </span>
                <span className={cx("mh-row-state", stock === "short" && "mh-tone-short")}>
                  {stock !== "ok" ? STATE_WORD[stock] : p.reserved > 0 ? <>משוריין <span className="ltr">{fmtQty(p.reserved)}</span></> : <>עודכן {fmtRelative(p.updated_at)}</>}
                  {stock === "short" ? <> <span className="ltr">{fmtQty(-free)}</span></> : null}
                </span>
              </span>
            </button>
            </li>
          );
        })}
        </ul>

        {rows.length === 0 ? (
          state.products.length === 0 ? (
            <EmptyState title="אין מוצרים" hint="אפשר להוסיף מוצר או לקלוט סחורה">
              <Button variant="secondary" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>
              <Button variant="secondary" onClick={() => ui.openAction("receive")}>קליטת סחורה</Button>
            </EmptyState>
          ) : (
            <EmptyState title="לא נמצאו מוצרים" hint={filtered ? "אפשר להסיר את הסינון" : undefined} />
          )
        ) : null}
      </div>
    </div>
  );
}
