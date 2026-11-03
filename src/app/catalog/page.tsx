"use client";

import { Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { available, useCatalog, type Product } from "@/lib/catalog";
import { FACET_KINDS, FACET_LABEL, facetsOf, facetText, matchesQuery, parseQuery, sortValues, type FacetKind, type Facets } from "@/lib/catalog/facets";
import { fmtQty } from "@/lib/catalog/format";
import { ProductCard } from "@/components/catalog/ProductCard";
import { Reveal } from "@/components/catalog/Reveal";
import { SearchIcon } from "@/components/catalog/Icons";

export default function CatalogPage() {
  return (
    <Suspense fallback={null}>
      <Catalog />
    </Suspense>
  );
}

const collator = new Intl.Collator("he", { numeric: true });

/** What can be promised comes first; the rest stay visible, so an agent never quotes from memory. Within that, sizes rise: 20×20 before 100×100. */
function byAvailability(a: Product, b: Product): number {
  return Number(available(b) > 0) - Number(available(a) > 0) || collator.compare(a.name, b.name);
}

/** A row of kinds longer than this is no help on a phone; the category tabs cut first. */
const KINDS_AT_MOST = 16;

const has = (p: Product, kind: FacetKind, value: string) => facetsOf(p.name)[kind] === value;

/**
 * The category, the words and the chips live in the URL: one step back from a product lands on the same list,
 * and a link to it can be sent. Written through the browser itself, so a keystroke costs no round trip.
 */
function useUrlState() {
  const pathname = usePathname();
  const params = useSearchParams();
  const write = useCallback(
    (change: (next: URLSearchParams) => void) => {
      // Read the address itself: a tap right after a keystroke must not carry a stale copy.
      const next = new URLSearchParams(window.location.search);
      change(next);
      const s = next.toString();
      window.history.replaceState(null, "", s ? `${pathname}?${s}` : pathname);
    },
    [pathname],
  );
  return { params, write };
}

function Catalog() {
  const { products } = useCatalog();
  const { params, write } = useUrlState();
  const category = params.get("c") ?? "";
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const selected = useMemo(() => {
    const f: Facets = {};
    for (const kind of FACET_KINDS) {
      const v = params.get(kind);
      if (v) f[kind] = v;
    }
    return f;
  }, [params]);
  const chosen = useMemo(() => Object.entries(selected) as [FacetKind, string][], [selected]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [products]);

  const q = useMemo(() => parseQuery(query), [query]);
  /** The category and the words: what the rows of chips are built from. */
  const base = useMemo(() => products.filter((p) => (!category || p.category === category) && (!q || matchesQuery(p, q))), [products, category, q]);
  const list = useMemo(() => base.filter((p) => chosen.every(([k, v]) => has(p, k, v))).sort(byAvailability), [base, chosen]);

  const rows = useMemo(() => {
    const out: { kind: FacetKind; values: string[] }[] = [];
    for (const kind of FACET_KINDS) {
      const current = selected[kind];
      const all = new Set<string>();
      for (const p of base) {
        const v = facetsOf(p.name)[kind];
        if (v) all.add(v);
      }
      // A row is a choice, so it needs two values, and it stays while its chip is pressed: nothing under a finger moves.
      if (!current && (all.size < 2 || (kind === "type" && all.size > KINDS_AT_MOST))) continue;
      // Every chip leads somewhere: only the values found among the products the other rows leave.
      const values = new Set<string>();
      for (const p of base) {
        if (!chosen.every(([k, v]) => k === kind || has(p, k, v))) continue;
        const v = facetsOf(p.name)[kind];
        if (v) values.add(v);
      }
      if (current) values.add(current);
      if (values.size === 0) continue;
      out.push({ kind, values: sortValues(kind, [...values]) });
    }
    return out;
  }, [base, selected, chosen]);

  const active = Boolean(category || q || chosen.length);
  /** Matches for the words outside the chosen category and chips: the way out of an empty list. */
  const elsewhere = useMemo(() => (q && (category || chosen.length) ? products.filter((p) => matchesQuery(p, q)).length : 0), [products, q, category, chosen]);

  const setCategory = (next: string) =>
    write((u) => {
      u.delete("c");
      if (next) u.set("c", next);
      // The chips belonged to the rows of the old category.
      for (const kind of FACET_KINDS) u.delete(kind);
    });
  /** The chip under the finger, and where it was: a row above it may go when it is pressed, and the page must not slide under the hand. */
  const pressed = useRef<{ chip: HTMLElement; top: number } | null>(null);
  const toggle = (kind: FacetKind, value: string, chip: HTMLElement) => {
    pressed.current = { chip, top: chip.getBoundingClientRect().top };
    write((u) => {
      if (u.get(kind) === value) u.delete(kind);
      else u.set(kind, value);
    });
  };
  useLayoutEffect(() => {
    const was = pressed.current;
    pressed.current = null;
    if (!was || !was.chip.isConnected) return;
    const moved = was.chip.getBoundingClientRect().top - was.top;
    if (moved) window.scrollBy(0, moved);
  }, [selected]);
  /** A pressed chip stays in sight: on a phone a row runs past the edge, and the one that was chosen must not hide behind it. */
  const facetsEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (const chip of facetsEl.current?.querySelectorAll<HTMLElement>('.cg-chip[aria-pressed="true"]') ?? []) {
      const row = chip.parentElement;
      if (!row) continue;
      const r = row.getBoundingClientRect();
      const c = chip.getBoundingClientRect();
      if (c.left < r.left) row.scrollLeft -= r.left - c.left + 16;
      else if (c.right > r.right) row.scrollLeft += c.right - r.right + 16;
    }
  }, [rows]);
  const search = (next: string) => {
    setQuery(next);
    write((u) => {
      if (next.trim()) u.set("q", next);
      else u.delete("q");
    });
  };
  const clearAll = () => {
    setQuery("");
    write((u) => {
      for (const key of ["c", "q", ...FACET_KINDS]) u.delete(key);
    });
  };
  const searchEverywhere = () =>
    write((u) => {
      u.delete("c");
      for (const kind of FACET_KINDS) u.delete(kind);
    });

  return (
    <main>
      <header className="cg-hero">
        <span className="cg-eyebrow">הקטלוג</span>
        <h1 className="cg-hero__title">מה שזמין עכשיו.</h1>
      </header>
      <div className="cg-hero__media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/catalog/hero.webp" alt="" fetchPriority="high" />
      </div>

      <div className="cg-filters">
        <div className="cg-filters__inner">
          {categories.length > 0 ? (
            <div className="cg-cats" role="group" aria-label="קטגוריות">
              <button type="button" className="cg-cat" aria-pressed={!category} onClick={() => setCategory("")}>הכול</button>
              {categories.map((c) => (
                <button key={c} type="button" className="cg-cat" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>
          ) : <span />}
          <label className="cg-search">
            <SearchIcon />
            <input type="search" value={query} placeholder="חיפוש לפי שם, מידה או מק״ט" aria-label="חיפוש" onChange={(e) => search(e.target.value)} />
          </label>
        </div>
      </div>

      {rows.length > 0 || active ? (
        <div className="cg-facets" ref={facetsEl}>
          <div className="cg-facets__inner">
            {rows.map(({ kind, values }) => (
              <div key={kind} className="cg-facet" role="group" aria-label={FACET_LABEL[kind]}>
                <span className="cg-facet__label" aria-hidden="true">{FACET_LABEL[kind]}</span>
                <div className="cg-facet__chips">
                  {values.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`cg-chip${kind === "size" ? " cg-num" : ""}`}
                      aria-pressed={selected[kind] === v}
                      onClick={(e) => toggle(kind, v, e.currentTarget)}
                    >
                      {facetText(kind, v)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {active ? (
              <p className="cg-found">
                <span>{list.length === 1 ? "מוצר אחד" : <><span className="cg-num">{fmtQty(list.length)}</span> מוצרים</>}</span>
                <button type="button" className="cg-link" onClick={clearAll}>ניקוי הסינון</button>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="cg-section" aria-label="מוצרים">
        {list.length === 0 ? (
          <div className="cg-empty">
            {products.length === 0 ? (
              <p className="cg-empty__title">אין מוצרים בקטלוג</p>
            ) : elsewhere > 0 ? (
              <>
                <p className="cg-empty__title">לא נמצאו מוצרים</p>
                <p className="cg-empty__text">
                  {elsewhere === 1 ? "יש מוצר אחד שמתאים לחיפוש בשאר הקטלוג" : <>יש <span className="cg-num">{fmtQty(elsewhere)}</span> מוצרים שמתאימים לחיפוש בשאר הקטלוג</>}
                </p>
                <button type="button" className="cg-btn" onClick={searchEverywhere}>חיפוש בכל הקטלוג</button>
              </>
            ) : (
              <>
                <p className="cg-empty__title">לא נמצאו מוצרים</p>
                <p className="cg-empty__text">אפשר לנסות מילה אחרת, מידה או מק״ט</p>
                <button type="button" className="cg-btn cg-btn--ghost" onClick={clearAll}>ניקוי הסינון</button>
              </>
            )}
          </div>
        ) : (
          <div className="cg-grid">
            {list.map((p, i) => (
              <Reveal key={p.id} i={i % 4}>
                <ProductCard product={p} grid />
              </Reveal>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
