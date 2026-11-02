/**
 * Translates a line read from a receipt into a warehouse product, using the
 * dictionary the manager keeps: supplier names plus product names and codes.
 *
 * "sure": the line is in the dictionary, so it maps without asking. Spelling that
 * changes nothing (ף/פ, spaces, the quotes in מ״מ) still counts as the same name.
 * "near": it only resembles an entry (a slash, a misread letter, a missing word),
 * so the worker confirms. "none": nothing close; the model gets a look next.
 */

import { normalizeName, type ItemRequest, type Product, type SupplierItem } from "@/lib/store";

export type Candidate = { productId: string; alias: string | null };
export type Match = { status: "sure"; productId: string } | { status: "near"; candidates: Candidate[] } | { status: "none" };

type Entry = { name: string; key: string; words: string[]; codes: string[]; productId: string; supplierId: string | null; approved: boolean };
export type Dictionary = Entry[];

const NEAR_SCORE = 0.6;
const MAX_CANDIDATES = 3;
const FINAL_LETTERS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

const fold = (t: string) => normalizeName(t).replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c]).replace(/["'`׳״”“’‘\p{M}]/gu, "");

/** The name however it was typed. A space between two digits stays: 2 4 is not 24. */
const spelling = (t: string) => fold(t).replace(/(?<!\d)\s+|\s+(?!\d)/g, "");

/** The name's words: punctuation separates them, and 28ממ is a number and a unit. */
const wordsOf = (t: string) =>
  fold(t)
    .replace(/(\d)x(?=\d)/g, "$1 ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/(\d)(\p{L})/gu, "$1 $2")
    .replace(/(\p{L})(\d)/gu, "$1 $2")
    .split(" ")
    .filter(Boolean);

const isNumber = (w: string) => /^\d+$/.test(w);

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return start + end >= Math.max(a.length, b.length) - 1;
}

/** One misread letter is forgiven in words of 4+ letters; numbers and short words must be exact. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (isNumber(a) || isNumber(b) || Math.min(a.length, b.length) < 4) return false;
  return oneEditApart(a, b);
}

/** 18 and 28 are different products however alike the rest reads. */
function numbersAgree(a: string[], b: string[]): boolean {
  const na = a.filter(isNumber);
  const nb = b.filter(isNumber);
  return na.every((n) => nb.includes(n)) || nb.every((n) => na.includes(n));
}

/** Share of words the two names have in common, 0 to 1. */
function likeness(a: string[], b: string[]): number {
  if (!a.length || !b.length || !numbersAgree(a, b)) return 0;
  const free = [...b];
  let shared = 0;
  for (const w of a) {
    const i = free.findIndex((x) => sameWord(w, x));
    if (i >= 0) {
      free.splice(i, 1);
      shared++;
    }
  }
  return (2 * shared) / (a.length + b.length);
}

const entry = (name: string, rest: Pick<Entry, "codes" | "productId" | "supplierId" | "approved">): Entry => ({ name, key: spelling(name), words: wordsOf(name), ...rest });

export function buildDictionary(products: Product[], supplierItems: SupplierItem[], itemRequests: ItemRequest[]): Dictionary {
  const known = new Set(products.map((p) => p.id));
  return [
    ...products.map((p) => entry(p.name, { codes: [p.sku, p.barcode ?? ""], productId: p.id, supplierId: null, approved: true })),
    ...supplierItems.flatMap((i) => (i.product_id && known.has(i.product_id)
      ? [entry(i.external_name, { codes: [i.external_sku ?? ""], productId: i.product_id, supplierId: i.supplier_id, approved: i.status === "approved" })]
      : [])),
    ...itemRequests.flatMap((r) => (r.status === "approved" && r.product_id && known.has(r.product_id)
      ? [entry(r.external_name, { codes: [], productId: r.product_id, supplierId: null, approved: true })]
      : [])),
  ];
}

/** `supplierId` limits the certain answers to that supplier's names; without one, every supplier counts. */
export function matchLine(dictionary: Dictionary, name: string, sku?: string | null, supplierId?: string | null): Match {
  const code = (sku ?? "").trim().toLowerCase();
  const key = spelling(name);
  const exact = dictionary.filter((e) => e.approved && ((code && e.codes.some((c) => c.toLowerCase() === code)) || (key && e.key === key)));
  const certain = new Set(exact.filter((e) => !supplierId || !e.supplierId || e.supplierId === supplierId).map((e) => e.productId));
  if (certain.size === 1) return { status: "sure", productId: [...certain][0] };

  const words = wordsOf(name);
  const seen = new Set<string>();
  const candidates = dictionary
    .map((e) => ({ e, score: exact.includes(e) ? 1 : likeness(words, e.words) }))
    .filter((c) => c.score >= NEAR_SCORE)
    .sort((a, b) => b.score - a.score)
    .filter(({ e }) => !seen.has(e.productId) && !!seen.add(e.productId))
    .slice(0, MAX_CANDIDATES)
    .map(({ e }) => ({ productId: e.productId, alias: e.name }));
  return candidates.length ? { status: "near", candidates } : { status: "none" };
}

/** Lines nothing resembled go to the model, which can tell two wordings mean one product. Best effort: on failure the worker decides alone. */
export async function suggestProducts(lines: string[], products: Product[], dictionary: Dictionary): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!lines.length || !products.length) return found;
  try {
    const catalog = products.map((p) => ({ id: p.id, name: p.name, aliases: dictionary.filter((e) => e.productId === p.id && e.name !== p.name).map((e) => e.name) }));
    const res = await fetch("/api/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines, catalog }) });
    const { productIds } = (await res.json()) as { productIds?: (string | null)[] };
    lines.forEach((line, i) => {
      const id = productIds?.[i];
      if (id) found.set(line, id);
    });
  } catch {
    return found;
  }
  return found;
}
