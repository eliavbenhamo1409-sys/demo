"use client";

/**
 * מלאי as the cleanest table: a title and one summary line, the controls on one line with one primary key, the stock by
 * state as one bar that is also the filter, then a wide open table ruled only between rows. A row opens its product beside
 * the table, with its shelf in the window over the panel. Same data and the same ?filter= as the shared page.
 */

import { Suspense, useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUi } from "@/components/app/ui-state";
import { ProductThumb } from "@/components/app/Viz";
import { useTwin } from "@/components/merhav/twin/Twin";
import { Button, cx, EmptyState, Icon, SearchBar, Select, type SelectOption } from "@/components/ui";
import { fmtName, fmtQty } from "@/lib/format";
import type { StockState } from "@/lib/map3d/types";
import { available, stockState, useData, type Product } from "@/lib/store";
import { Head, Meter, StateWord } from "../parts";

type Lens = "products" | "ok" | "low" | "out" | "reserved" | "short";
type SortKey = "name" | "available" | "reserved" | "min" | "place";

const LENSES: Lens[] = ["products", "ok", "low", "out", "reserved", "short"];

function lensOf(params: URLSearchParams): Lens {
  const filter = params.get("filter");
  return LENSES.find((lens) => lens === filter) ?? "products";
}

const isLow = (p: Product) => stockState(p) === "low";
const isOut = (p: Product) => p.qty <= 0;
const isShort = (p: Product) => available(p) < 0;
const isHeld = (p: Product) => p.reserved > 0;

const isOk = (p: Product) => stockState(p) === "ok";

/** The bar's states are also lenses; "ok" is this page's own, the shared page has no word for what is fine. */
const IN_LENS: Record<Lens, (p: Product) => boolean> = { products: () => true, ok: isOk, low: isLow, out: isOut, reserved: isHeld, short: isShort };

/** Free stock in minimums; null with no minimum set. */
const share = (p: Product): number | null => (p.min_qty > 0 ? Math.max(available(p), 0) / p.min_qty : null);

const STATES: StockState[] = ["ok", "low", "out", "short"];

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
  const { spotProduct, itemsOf } = useTwin();

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

  const byState = useMemo(() => {
    const n: Record<StockState, number> = { ok: 0, low: 0, out: 0, short: 0 };
    for (const p of base) n[stockState(p)] += 1;
    return n;
  }, [base]);

  const q = query.trim().toLowerCase();
  const placeOf = useCallback((p: Product) => itemsOf(p.id)[0]?.place ?? p.location ?? "", [itemsOf]);
  const rows = useMemo(() => {
    const list = base.filter(IN_LENS[lens]).filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? "").includes(q));
    const dir = ascending ? 1 : -1;
    const sharePlus = (p: Product) => share(p) ?? Number.POSITIVE_INFINITY;
    return [...list].sort((a, b) => {
      if (sortKey === "available") return (available(a) - available(b)) * dir;
      if (sortKey === "reserved") return (a.reserved - b.reserved) * dir;
      if (sortKey === "min") return (sharePlus(a) - sharePlus(b)) * dir || a.name.localeCompare(b.name, "he");
      if (sortKey === "place") return placeOf(a).localeCompare(placeOf(b)) * dir;
      return a.name.localeCompare(b.name, "he") * dir;
    });
  }, [base, lens, q, sortKey, ascending, placeOf]);

  const sortBy = (key: SortKey) => {
    if (sortKey === key) setAscending((v) => !v);
    else {
      setSortKey(key);
      setAscending(key === "name" || key === "place" || key === "min");
    }
  };

  // A list that ends under the pointer never sends its row's leave.
  useEffect(() => () => spotProduct(null), [spotProduct]);

  const selected = ui.panel?.type === "product" ? ui.panel.id : undefined;
  const filtered = Boolean(q || category || supplierId);

  const legend: { key: Lens; word: string; count: number; state?: StockState }[] = [
    { key: "products", word: "הכול", count: counts.products },
    { key: "ok", word: "תקין", count: byState.ok, state: "ok" },
    { key: "low", word: "מתחת למינימום", count: counts.low, state: "low" },
    { key: "out", word: "אזל", count: counts.out, state: "out" },
    ...(counts.short > 0 || lens === "short" ? [{ key: "short" as const, word: "חסר להזמנות", count: counts.short, state: "short" as const }] : []),
    { key: "reserved", word: "משוריין", count: counts.reserved },
  ];

  const head = (key: SortKey, word: string, num = false) => (
    <th scope="col" className={cx(num && "is-num", `is-${key}`)} aria-sort={sortKey === key ? (ascending ? "ascending" : "descending") : undefined}>
      <button type="button" aria-pressed={sortKey === key} onClick={() => sortBy(key)}>
        {word}
        {sortKey === key ? <Icon name={ascending ? "chevron-up" : "chevron-down"} size={12} /> : null}
      </button>
    </th>
  );

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, p: Product) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ui.openProduct(p.id);
    }
  };

  return (
    <div className="at-inv">
      <Head title="מלאי" line={base.length > 0 ? (
        <div className="at-dist" role="group" aria-label="המלאי לפי מצב">
          <div className="at-dist-bar" aria-hidden="true">
            {STATES.filter((s) => byState[s] > 0).map((s) => (
              <i key={s} className={cx(`is-${s}`, lens !== "products" && lens !== "reserved" && lens !== s && "is-dim")} style={{ width: `${(byState[s] / base.length) * 100}%` }} />
            ))}
          </div>
          <div className="at-dist-legend">
            {legend.map((item) => (
              <button key={item.key} type="button" className={cx("at-dist-item", item.state && `is-${item.state}`)} aria-pressed={lens === item.key} onClick={() => setLens(item.key)}>
                <b className="ltr">{fmtQty(item.count)}</b>
                <span>{item.word}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}>
        <Button variant="primary" icon="plus" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>
      </Head>

      <div className="at-tools">
        <SearchBar kbd={false} value={query} onChange={setQuery} placeholder='חיפוש לפי שם, מק"ט או ברקוד' />
        <Select options={categories} value={category} onChange={setCategory} allLabel="כל הקטגוריות" placeholder="קטגוריה" />
        <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} allLabel="כל הספקים" placeholder="ספק" />
      </div>


      <div className="at-table-wrap">
        <table className="at-table">
          <thead>
            <tr>
              {head("name", "מוצר")}
              {head("place", "מיקום")}
              {head("available", "זמין", true)}
              {head("reserved", "משוריין", true)}
              {head("min", "מול המינימום")}
              <th scope="col" className="is-state">מצב</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const stock = stockState(p);
              const items = itemsOf(p.id);
              const place = items[0]?.place ?? p.location;
              const more = items.length > 1 ? items.length - 1 : 0;
              const free = available(p);
              const pct = share(p);
              return (
                <tr
                  key={p.id}
                  tabIndex={0}
                  aria-current={p.id === selected ? "true" : undefined}
                  className={cx(p.id === selected && "is-selected")}
                  onClick={() => ui.openProduct(p.id)}
                  onKeyDown={(e) => onRowKey(e, p)}
                  onPointerEnter={() => spotProduct(p.id)}
                  onPointerLeave={() => spotProduct(null)}
                  onFocus={() => spotProduct(p.id)}
                  onBlur={() => spotProduct(null)}
                >
                  <td className="is-name">
                    <span className="at-cell">
                      <ProductThumb product={p} />
                      <span className="at-cell-text">
                        <span className="at-cell-title" title={p.name}>{fmtName(p.name)}</span>
                        <span className="at-cell-sub">
                          <span className="ltr">{p.sku}</span>
                          {supplier(p.primary_supplier_id) ? ` · ${supplier(p.primary_supplier_id)?.name}` : p.category ? ` · ${p.category}` : ""}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="is-place">
                    {place ? <span className="at-place">{place}</span> : <span className="at-tone-quiet">—</span>}
                    {more > 0 ? <span className="at-place-more">+{fmtQty(more)}</span> : null}
                  </td>
                  <td className={cx("is-num", stock === "short" && "at-tone-short", stock === "out" && "at-tone-out", stock === "low" && "at-tone-warn")}>
                    {fmtQty(Math.max(free, 0))}
                    <small>{p.unit}</small>
                    {p.reserved > 0 ? <span className="at-num-sub">מתוך {fmtQty(p.qty)}</span> : null}
                  </td>
                  <td className="is-num is-reserved">{p.reserved > 0 ? fmtQty(p.reserved) : <span className="at-tone-quiet">—</span>}</td>
                  <td className="is-min">
                    {p.min_qty > 0 ? (
                      <span className="at-min">
                        <Meter value={free} min={p.min_qty} state={stock} />
                        <span className="at-min-pct">{pct !== null ? `${Math.round(pct * 100)}%` : ""}</span>
                      </span>
                    ) : (
                      <span className="at-tone-quiet">ללא מינימום</span>
                    )}
                  </td>
                  <td className="is-state">
                    <StateWord state={stock} sub={stock === "short" ? `חסר ${fmtQty(-free)}` : stock === "low" ? `מינימום ${fmtQty(p.min_qty)}` : undefined} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          state.products.length === 0 ? (
            <EmptyState title="אין מוצרים" hint="אפשר להוסיף מוצר או לקלוט סחורה">
              <Button variant="secondary" onClick={() => ui.openAction("new-product")}>מוצר חדש</Button>
              <Button variant="secondary" onClick={() => ui.openAction("receive")}>קליטת סחורה</Button>
            </EmptyState>
          ) : (
            <EmptyState title="לא נמצאו מוצרים" hint={filtered ? "אפשר להסיר את הסינון" : undefined} />
          )
        ) : lens !== "products" || filtered ? (
          <div className="at-table-foot">
            <span>{`${fmtQty(rows.length)} מתוך ${fmtQty(state.products.length)} מוצרים`}</span>
            <button type="button" className="sa-btn sa-btn-link" onClick={() => { setLens("products"); setQuery(""); setCategory(""); setSupplierId(""); }}>הצגת הכול</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
