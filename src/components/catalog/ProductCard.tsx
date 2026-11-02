"use client";

import Link from "next/link";
import { useState } from "react";
import { available, photoUrl, type Product } from "@/lib/catalog";
import { fmtName, fmtPrice, fmtQty } from "@/lib/catalog/format";

export function ProductImage({ product, eager }: { product: Product; eager?: boolean }) {
  const src = photoUrl(product.image_path);
  // An iPhone's HEIC original shows only in Safari; everywhere else the plate stands in.
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <span className="cg-media">
      {src && src !== broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={product.name} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setBroken(src)} />
      ) : (
        <span className="cg-media__sku cg-num">{product.sku}</span>
      )}
    </span>
  );
}

/** "זמין 42 יח׳", or "לא זמין" whether it ran out or is all held. */
export function stockLabel(p: Product): string {
  const n = available(p);
  return n > 0 ? `זמין ${fmtQty(n)} ${p.unit}` : "לא זמין";
}

export function ProductCard({ product }: { product: Product }) {
  const out = available(product) <= 0;
  return (
    <Link href={`/catalog/product/${product.id}`} className={`cg-card${out ? " is-out" : ""}`}>
      <ProductImage product={product} />
      <span className="cg-card__meta">
        <span className="cg-card__row">
          <span className="cg-card__name">{fmtName(product.name)}</span>
          {product.price !== null ? <span className="cg-card__price cg-num">{fmtPrice(product.price)}</span> : null}
        </span>
        <span className="cg-stock">{stockLabel(product)}</span>
      </span>
    </Link>
  );
}
