/**
 * What a product's name says about it, read the way an agent says it to a customer: the kind of thing,
 * its series, its thickness, its sheet size and its colour. The database stores none of this. Trade names
 * carry it ("צינור ריבועי 40×40×2 מ״מ שחור", "פרופיל כנף הזזה ס׳45 לבן"), so the catalogue reads it on the
 * phone, and the rules know nothing about what this warehouse sells.
 */

import type { Product } from "./index";

export type FacetKind = "series" | "type" | "mm" | "size" | "colour";
export type Facets = Partial<Record<FacetKind, string>>;

/** In the order the rows appear: the first thing an agent says first. */
export const FACET_KINDS: readonly FacetKind[] = ["series", "type", "mm", "size", "colour"];

export const FACET_LABEL: Record<FacetKind, string> = {
  series: "סדרה",
  type: "סוג",
  mm: "עובי",
  size: "מידה",
  colour: "צבע",
};

/** Colour words, in the order their chips stand: the plain ones first. A RAL number after one belongs to it. */
const COLOURS = [
  "לבן", "שחור", "אפור", "אנתרציט", "ברונזה", "כסוף", "כסף", "טבעי", "זהב", "שמפניה", "חום", "בז׳", "קרם", "שנהב",
  "ניקל", "פליז", "נחושת", "אלון", "אגוז", "אדום", "כחול", "ירוק", "צהוב", "כתום", "ורוד", "סגול",
];
const COLOUR = new RegExp(`(?:^|\\s)(${COLOURS.join("|")})(?:\\s(?:RAL\\s?)?(\\d{3,4})(?![\\d.,×xX*]))?(?:\\s(מט|מבריק|סאטן))?(?=\\s|$)`, "i");
const SERIES = /(?:ס׳|ס'|ס"|ס״|סדרה)\s?(\d{2,4})(?!\d)/;
/** "40×40×2", "1250×2500", "4.8×25": numbers joined by a times sign, however it was typed. */
const GROUP = /\d+(?:[.,]\d+)?(?:\s?[×xX*]\s?\d+(?:[.,]\d+)?)+/g;
/** A number before מ״מ, however the quotes were typed. */
const MM = /(\d+(?:[.,]\d+)?)\s?מ[״"'׳]?מ(?![א-ת])/g;
/** Words that make the number after them a diameter or a width, not a thickness, and end the kind of thing. */
const DIMENSION_WORDS = new Set(["קוטר", "רוחב", "אורך", "גובה", "עובי", "בקוטר", "ברוחב", "באורך", "בגובה", "בעובי"]);

const cache = new Map<string, Facets>();

/** The name without how it is sold: "(מוט 6 מ׳)", "(אריזה 100)". */
export function bareName(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

const num = (s: string) => Number(s.replace(",", "."));

export function facetsOf(name: string): Facets {
  const hit = cache.get(name);
  if (hit) return hit;

  const f: Facets = {};
  let s = bareName(name);

  const series = SERIES.exec(s);
  if (series) {
    f.series = series[1];
    s = s.replace(series[0], " ");
  }

  const colour = COLOUR.exec(s);
  if (colour) {
    f.colour = [colour[1], colour[2], colour[3]].filter(Boolean).join(" ");
    s = s.replace(colour[0], " ");
  }
  s = s.replace(/\s+/g, " ").trim();

  const groups: { start: number; end: number; numbers: number[] }[] = [];
  for (const m of s.matchAll(GROUP)) {
    groups.push({ start: m.index, end: m.index + m[0].length, numbers: m[0].split(/\s?[×xX*]\s?/).map(num) });
  }
  // A sheet is named by its two sides, both well over what a section measures.
  const sheet = groups.find((g) => g.numbers.length === 2 && g.numbers.every((n) => n >= 500));
  if (sheet) f.size = sheet.numbers.join("×");

  for (const m of s.matchAll(MM)) {
    const inGroup = groups.some((g) => m.index >= g.start && m.index < g.end);
    const before = s.slice(0, m.index).trim().split(" ").pop() ?? "";
    const value = num(m[1]);
    // A wall ("40×40×2 מ״מ"), a diameter ("קוטר 12 מ״מ") and a width are not thicknesses; nor is anything 100 מ״מ thick.
    if (inGroup || DIMENSION_WORDS.has(before) || value >= 100) continue;
    f.mm = String(value);
    break;
  }

  const kind: string[] = [];
  for (const token of s.split(" ")) {
    if (/\d/.test(token) || DIMENSION_WORDS.has(token)) break;
    kind.push(token);
  }
  if (kind.length) f.type = kind.join(" ");

  cache.set(name, f);
  return f;
}

const collator = new Intl.Collator("he", { numeric: true });
const colourRank = (v: string) => {
  const i = COLOURS.findIndex((c) => v.toLowerCase().startsWith(c));
  return i === -1 ? COLOURS.length : i;
};

/** The order chips stand in a row: numbers rise, kinds go by the alphabet, colours by the list above. Nothing moves when the set changes. */
export function sortValues(kind: FacetKind, values: string[]): string[] {
  switch (kind) {
    case "series":
    case "mm":
      return values.sort((a, b) => Number(a) - Number(b));
    case "size":
      return values.sort((a, b) => collator.compare(a, b));
    case "colour":
      return values.sort((a, b) => colourRank(a) - colourRank(b) || collator.compare(a, b));
    default:
      return values.sort((a, b) => collator.compare(a, b));
  }
}

/** A chip's text. Thickness carries its unit, so a row of "2", "3", "4" can't be read as anything else. */
export function facetText(kind: FacetKind, value: string): string {
  return kind === "mm" ? `${value} מ״מ` : value;
}

/* ─────────────────────────── search ─────────────────────────── */

/**
 * A search is what the agent would say: "ריבועי 40 40", "כנף 60 שחור", "לוח 3 1500", "tub-4040".
 * Every word must be found. A number must stand whole in the name ("3" is not "3000"), as many times as it
 * was typed ("40 40" is not "80×40"), and "40×40" must stand together, typed with ×, x, * or "על".
 */
export type Query = { words: string[]; numbers: number[]; groups: number[][] };

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[״"׳'`]/g, "")
    // "סדרה 45", "ס' 45" and "ס׳45" are one series.
    .replace(/(^|\s)(?:סדרה|ס)\s*(?=\d)/g, "$1ס")
    .replace(/\s+על\s+/g, "×")
    .replace(/(\d)\s*[x*]\s*(?=\d)/g, "$1×")
    .replace(/(\d),(?=\d)/g, "$1.")
    .replace(/\s*×\s*/g, "×")
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBER = /^\d+(?:\.\d+)?$/;
const NUMBER_GROUP = /^\d+(?:\.\d+)?(?:×\d+(?:\.\d+)?)+$/;

export function parseQuery(raw: string): Query | null {
  const n = normalise(raw);
  if (!n) return null;
  const q: Query = { words: [], numbers: [], groups: [] };
  for (const token of n.split(" ")) {
    if (NUMBER_GROUP.test(token)) q.groups.push(token.split("×").map(Number));
    else if (NUMBER.test(token)) q.numbers.push(Number(token));
    else q.words.push(token);
  }
  return q;
}

type Index = { text: string; codes: string; numbers: number[]; groups: number[][] };
const indexes = new WeakMap<Product, Index>();

function indexOf(p: Product): Index {
  const hit = indexes.get(p);
  if (hit) return hit;
  const name = normalise(p.name);
  const index: Index = {
    text: normalise([p.name, p.sku, p.barcode ?? "", p.category ?? ""].join(" ")),
    codes: normalise(`${p.sku} ${p.barcode ?? ""}`),
    numbers: [...name.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])),
    groups: [...name.matchAll(/\d+(?:\.\d+)?(?:×\d+(?:\.\d+)?)+/g)].map((m) => m[0].split("×").map(Number)),
  };
  indexes.set(p, index);
  return index;
}

function holdsInOrder(group: number[], wanted: number[]): boolean {
  for (let i = 0; i + wanted.length <= group.length; i++) {
    if (wanted.every((n, j) => group[i + j] === n)) return true;
  }
  return false;
}

export function matchesQuery(p: Product, q: Query): boolean {
  const index = indexOf(p);
  if (!q.words.every((w) => index.text.includes(w))) return false;
  if (!q.groups.every((g) => index.groups.some((have) => holdsInOrder(have, g)))) return false;
  const left = [...index.numbers];
  for (const n of q.numbers) {
    const at = left.indexOf(n);
    if (at !== -1) left.splice(at, 1);
    // Not in the name: a longer number may be the code, the way "4040" finds TUB-4040. A short one is a size, and "40" is in too many codes.
    else if (String(n).length < 3 || !index.codes.includes(String(n))) return false;
  }
  return true;
}
