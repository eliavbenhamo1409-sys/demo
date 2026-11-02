import { fmtQty } from "@/lib/format";
import { available, type Product } from "@/lib/store";

/** What can still be promised against the minimum, 1 being exactly the minimum: the same sum the store's states use. */
export function minimumShare(product: Pick<Product, "qty" | "reserved" | "min_qty">): number | null {
  if (product.min_qty <= 0) return null;
  return Math.max(available(product), 0) / product.min_qty;
}

export function percentText(share: number): string {
  return `${fmtQty(Math.round(share * 100))}%`;
}
