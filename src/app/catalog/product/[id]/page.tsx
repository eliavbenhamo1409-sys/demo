"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { available, useCatalog, type Product } from "@/lib/catalog";
import { ProductCard, ProductImage } from "@/components/catalog/ProductCard";
import { Reveal } from "@/components/catalog/Reveal";
import { useDrawer } from "@/components/catalog/Shell";
import { Stepper } from "@/components/catalog/Stepper";
import { fmtName, fmtPrice, fmtQty } from "@/lib/catalog/format";

const RELATED = 3;

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { product } = useCatalog();
  const p = product(id);
  if (!p) {
    return (
      <main className="cg-page">
        <h1 className="cg-page__title">המוצר לא נמצא</h1>
        <p className="cg-page__sub">ייתכן שהוסר מהקטלוג</p>
        <p style={{ marginTop: 24 }}><Link href="/catalog" className="cg-link">חזרה לקטלוג</Link></p>
      </main>
    );
  }
  // Each product starts fresh: quantity and the "added" word belong to the page they were set on.
  return <Detail key={p.id} product={p} />;
}

function Detail({ product: p }: { product: Product }) {
  const { products, inDraft, addToDraft } = useCatalog();
  const { show } = useDrawer();
  const [wanted, setWanted] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1600);
    return () => clearTimeout(t);
  }, [added]);

  const free = available(p);
  const inOrder = inDraft(p.id);
  const room = Math.floor(free - inOrder);
  const qty = Math.min(wanted, Math.max(room, 1));

  const related = useMemo(() => {
    const others = products.filter((x) => x.id !== p.id && available(x) > 0);
    const near = others.filter((x) => x.category === p.category);
    return [...near, ...others.filter((x) => x.category !== p.category)].slice(0, RELATED);
  }, [products, p.id, p.category]);

  return (
    <main className="cg-product">
      <nav className="cg-crumbs" aria-label="מיקום באתר">
        <Link href="/catalog">קטלוג</Link>
        <span aria-hidden="true">/</span>
        {p.category ? (
          <>
            <Link href={`/catalog?c=${encodeURIComponent(p.category)}`}>{p.category}</Link>
            <span aria-hidden="true">/</span>
          </>
        ) : null}
        <span aria-current="page">{fmtName(p.name)}</span>
      </nav>

      <div className="cg-product__layout">
        <div className="cg-product__media">
          <Reveal>
            <ProductImage product={p} eager />
          </Reveal>
        </div>

        <section className="cg-product__detail">
          {p.category ? <Link href={`/catalog?c=${encodeURIComponent(p.category)}`} className="cg-product__cat">{p.category}</Link> : null}
          <h1 className="cg-product__name">{fmtName(p.name)}</h1>
          {p.price !== null ? (
            <p className="cg-product__price"><span className="cg-num">{fmtPrice(p.price)}</span> <small>ל{p.unit}</small></p>
          ) : null}

          <div className="cg-avail">
            <span className="cg-avail__label">זמין עכשיו</span>
            {free > 0 ? (
              <span className="cg-avail__value"><span className="cg-num">{fmtQty(free)}</span> <small>{p.unit}</small></span>
            ) : (
              <span className="cg-avail__value">לא זמין</span>
            )}
          </div>

          {p.description ? <p className="cg-product__desc">{p.description}</p> : null}

          {/* Nothing free means nothing to choose: no quantity, no dead button to tap at a customer's side. */}
          {free > 0 ? (
            <div className="cg-buy">
              <Stepper label={`כמות של ${p.name}`} value={qty} max={Math.max(room, 1)} onChange={setWanted} />
              <button
                type="button"
                className="cg-btn"
                disabled={room < 1 || added}
                onClick={() => {
                  addToDraft(p.id, qty);
                  setWanted(1);
                  setAdded(true);
                }}
              >
                {added ? "נוסף להזמנה" : "הוספה להזמנה"}
              </button>
            </div>
          ) : null}
          {free > 0 && room < 1 && inOrder === 0 ? <p className="cg-inorder">פחות מיחידה אחת זמינה</p> : null}
          {inOrder > 0 ? (
            <p className="cg-inorder">
              בהזמנה <span className="cg-num">{fmtQty(inOrder)}</span> {p.unit} · <button type="button" className="cg-link" onClick={show}>צפייה בהזמנה</button>
            </p>
          ) : null}

          <dl className="cg-spec">
            <dt>מק״ט</dt>
            <dd className="cg-num" style={{ textAlign: "right" }}>{p.sku}</dd>
            {p.barcode ? (
              <>
                <dt>ברקוד</dt>
                <dd className="cg-num" style={{ textAlign: "right" }}>{p.barcode}</dd>
              </>
            ) : null}
            <dt>יחידה</dt>
            <dd>{p.unit}</dd>
          </dl>
        </section>
      </div>

      {related.length > 0 ? (
        <section className="cg-related" aria-label="עוד מוצרים">
          <h2 className="cg-related__title">{p.category && related.some((r) => r.category === p.category) ? `עוד מ${p.category}` : "עוד מהקטלוג"}</h2>
          <div className="cg-grid">
            {related.map((r, i) => (
              <Reveal key={r.id} i={i}>
                <ProductCard product={r} />
              </Reveal>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
