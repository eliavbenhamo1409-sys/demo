"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { available, useCatalog, type Product } from "@/lib/catalog";
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

const matches = (p: Product, q: string) =>
  p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? "").includes(q) || (p.category ?? "").toLowerCase().includes(q);

/** What can be promised comes first; the rest stay visible, so an agent never quotes from memory. */
function byAvailability(a: Product, b: Product): number {
  return Number(available(b) > 0) - Number(available(a) > 0) || a.name.localeCompare(b.name, "he");
}

function Catalog() {
  const { products } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const category = params.get("c") ?? "";
  const [query, setQuery] = useState("");

  const setCategory = useCallback(
    (next: string) => {
      router.replace(next ? `${pathname}?c=${encodeURIComponent(next)}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, "he"));
  }, [products]);

  const q = query.trim().toLowerCase();
  const list = useMemo(
    () => products.filter((p) => (!category || p.category === category) && (!q || matches(p, q))).sort(byAvailability),
    [products, category, q],
  );

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
            <input type="search" value={query} placeholder='חיפוש לפי שם או מק"ט' aria-label="חיפוש" onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </div>

      <section className="cg-section" aria-label="מוצרים">
        {list.length === 0 ? (
          <p className="cg-empty">{products.length === 0 ? "אין מוצרים בקטלוג" : "לא נמצאו מוצרים"}</p>
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
