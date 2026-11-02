"use client";

import Link from "next/link";
import { useState } from "react";
import { available, photoUrl, type Product } from "@/lib/catalog";
import { fmtName, fmtPrice, fmtQty } from "@/lib/catalog/format";

export function ProductImage({ product, eager }: { product: Product; eager?: boolean }) {
  const src = photoUrl(product.image_path);
  // An iPhone's HEIC original shows only in Safari; everywhere else the plate stands in.
  const [broken, setBroken] = useState<string | null>(null);
  const out = available(product) <= 0;
  return (
    <span className={`cg-media${out ? " is-out" : ""}`}>
      {src && src !== broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={product.name} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setBroken(src)} />
      ) : (
        <span className="cg-media__sku cg-num">{product.sku}</span>
      )}
      {/* Whether it ran out or is all held, an agent can't promise it. */}
      {out ? <span className="cg-media__out">לא זמין</span> : null}
    </span>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const free = available(product);
  return (
    <Link href={`/catalog/product/${product.id}`} className="cg-card">
      <ProductImage product={product} />
      <span className="cg-card__meta">
        <span className="cg-card__row">
          <span className="cg-card__name">{fmtName(product.name)}</span>
          {product.price !== null ? <span className="cg-card__price cg-num">{fmtPrice(product.price)}</span> : null}
        </span>
        {free > 0 ? <span className="cg-stock">זמין {fmtQty(free)} {product.unit}</span> : null}
      </span>
    </Link>
  );
}
