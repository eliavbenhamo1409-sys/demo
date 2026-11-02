/**
 * What a product looks like on a shelf. Trade neutral: one small word table and the sizes a name
 * states, with a carton for anything the table doesn't know. All lengths are metres.
 */

import type { Product } from "@/lib/store";
import type { BarSection, StockFinish, StockForm } from "./types";

export interface FormOf {
  form: StockForm;
  finish: StockFinish;
  /** How much of the product's own unit one piece holds. Most hold one; stock sold by the metre stands in whole bars. */
  perPiece: number;
}

type Kind = StockForm["form"];

/** A name that states no finish still gets a tone by shape, so neighbouring products read apart on the map. */
const BAR_TONE: Record<BarSection, StockFinish> = { tube: "natural", channel: "bronze", angle: "black" };

/** A rack is 6.4 wide and 3.4 deep. */
const MAX_LENGTH = 6;
const MAX_SHEET_WIDTH = 3;
const MAX_SHEET_THICKNESS = 0.1;
const MAX_SECTION = 0.4;
const DEFAULT_SECTION = 0.04;
const DEFAULT_SHEET = { width: 1.25, length: 2.5, thickness: 0.003 };
const ROLL = { od: 0.32, id: 0.08, height: 0.05, length: 50 };
const CARTON = { width: 0.2, depth: 0.15, height: 0.1 };
/** A 5 litre canister. Other volumes scale from it. */
const CANISTER = { litres: 5, width: 0.19, depth: 0.125, height: 0.27 };
const MAX_LITRES = 220;

const wordSet = (words: string): ReadonlySet<string> => new Set(words.split(" "));

/** Whole words, because a substring would read ברגי as בר. First match wins; the name goes before the category. */
const KINDS: readonly (readonly [Kind, ReadonlySet<string>])[] = [
  ["roll", wordSet("גליל גלילים רול רולים אטם אטמים roll rolls coil coils gasket gaskets")],
  ["canister", wordSet("נוזל נוזלים שמן שמנים מיכל מכל גריקן canister jerrycan coolant oil fluid")],
  ["bar", wordSet("פרופיל פרופילים מוט מוטות צינור צינורות צנרת קורה קורות זווית זוויות זוויתן זויתן תעלה תעלות profile profiles bar bars rod rods tube tubes pipe pipes beam beams angle channel")],
  ["sheet", wordSet("לוח לוחות גיליון גיליונות גליון גליונות פח פחים פלטה פלטות sheet sheets plate plates")],
];

const ANGLE = wordSet("זווית זוויות זוויתן זויתן l angle");
const CHANNEL = wordSet("תעלה תעלות u c channel");

/** Units, read from the product's unit and never from its name. */
const PACK = wordSet("אריזה אריזות חבילה חבילות קרטון קרטונים ארגז ארגזים pack packs box boxes carton cartons");
const METRE = wordSet("מטר מטרים מ m meter meters metre metres");
const LITRE = wordSet("ליטר ליטרים ל l lt liter liters litre litres");

const FINISHES: readonly (readonly [StockFinish, ReadonlySet<string>])[] = [
  ["black", wordSet("שחור שחורה שחורים black")],
  ["white", wordSet("לבן לבנה לבנים white")],
  ["bronze", wordSet("ברונזה bronze")],
];

const NUMBER = String.raw`\d+(?:\.\d+)?`;
const END = String.raw`(?![\p{L}\p{N}])`;
/** `30×20×2`, `1250×2500 מ"מ`. A letter before the first number is a thread, as in M6×20, never a size. */
const SIZES = new RegExp(String.raw`(?<![A-Za-z\d.×])(${NUMBER})\s*×\s*(${NUMBER})(?:\s*×\s*(${NUMBER}))?(?:\s*(מ"מ|ממ|mm|ס"מ|סמ|cm|מטרים|מטר|מ'|m)${END})?`, "iu");
const MILLIMETRES = new RegExp(String.raw`(${NUMBER})\s*(?:מ"מ|ממ|mm)${END}`, "iu");
const METRES = new RegExp(String.raw`(${NUMBER})\s*(?:מטרים|מטר|מ'|m)${END}`, "iu");
const LITRES = new RegExp(String.raw`(${NUMBER})(?:\s*(?:ליטרים|ליטר|ל'|lt|liters?|litres?)|l)${END}`, "iu");

/** One spelling for what names write many ways: quotes, decimal and thousands commas, the sign of `×`. */
function tidy(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u05F3\u2018\u2019\u2032]/g, "'")
    .replace(/\u05F4|\u201C|\u201D|''/g, '"')
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\s*[xX*\u0445\u0425]\s*(?=\d)/g, "$1×");
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/['"]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function hasWord(words: readonly string[], list: ReadonlySet<string>): boolean {
  return words.some((word) => list.has(word));
}

function kindFrom(words: readonly string[]): Kind | null {
  return KINDS.find(([, list]) => hasWord(words, list))?.[0] ?? null;
}

function sectionFrom(words: readonly string[]): BarSection {
  if (hasWord(words, ANGLE)) return "angle";
  return hasWord(words, CHANNEL) ? "channel" : "tube";
}

/** The first size group of a name: its numbers, how many of them make a metre if it says, and the name without it. */
function readSizes(name: string): { sizes: number[]; perMetre: number | null; rest: string } | null {
  const match = SIZES.exec(name);
  if (!match) return null;
  const unit = match[4]?.toLowerCase();
  const perMetre = !unit ? null : /מ"מ|ממ|mm/.test(unit) ? 1000 : /ס"מ|סמ|cm/.test(unit) ? 100 : 1;
  const sizes = [match[1], match[2], match[3]].filter((size) => size !== undefined).map(Number);
  return { sizes, perMetre, rest: name.replace(match[0], " ") };
}

function barOf(name: string, words: readonly string[]): StockForm {
  const read = readSizes(name);
  const single = read ? undefined : MILLIMETRES.exec(name)?.[1];
  const [first, second = first, third] = read ? read.sizes.map((size) => size / (read.perMetre ?? 1000)) : single ? [Number(single) / 1000] : [];
  const sound = first > 0 && first <= MAX_SECTION && second > 0 && second <= MAX_SECTION;
  const a = sound ? first : DEFAULT_SECTION;
  const b = sound ? second : DEFAULT_SECTION;
  const thin = Math.min(a, b);
  const stated = Number(METRES.exec(read?.rest ?? name)?.[1]);
  return {
    form: "bar",
    section: sectionFrom(words),
    a,
    b,
    wall: third > 0 && third < thin / 2 ? third : thin / 20,
    length: stated > 0 ? Math.min(stated, MAX_LENGTH) : MAX_LENGTH,
  };
}

function sheetOf(name: string): StockForm {
  const read = readSizes(name);
  const sizes = read?.sizes ?? [];
  // With no unit, 1.25×2.5 can only be metres.
  const perMetre = read?.perMetre ?? (Math.max(...sizes) <= 10 ? 1 : 1000);
  const sorted = sizes.map((size) => size / perMetre).sort((x, y) => x - y);
  const [stated, width, length] = sorted.length === 3 ? sorted : [undefined, ...sorted];
  const thickness = stated ?? Number(MILLIMETRES.exec(read?.rest ?? name)?.[1]) / 1000;
  return {
    form: "sheet",
    width: width && width > 0 ? Math.min(width, MAX_SHEET_WIDTH) : DEFAULT_SHEET.width,
    length: length && length > 0 ? Math.min(length, MAX_LENGTH) : DEFAULT_SHEET.length,
    thickness: thickness > 0 && thickness <= MAX_SHEET_THICKNESS ? thickness : DEFAULT_SHEET.thickness,
  };
}

function canisterOf(name: string): StockForm {
  const stated = Number(LITRES.exec(name)?.[1]);
  const litres = stated > 0 && stated <= MAX_LITRES ? stated : CANISTER.litres;
  const size = Math.cbrt(litres / CANISTER.litres);
  return { form: "canister", width: CANISTER.width * size, depth: CANISTER.depth * size, height: CANISTER.height * size, litres };
}

function rollOf(name: string): StockForm {
  const stated = Number(METRES.exec(name)?.[1]);
  return { form: "roll", ...ROLL, length: stated > 0 ? stated : ROLL.length };
}

function shapeOf(name: string, words: readonly string[], category: string | null): StockForm {
  const kind = LITRES.test(name) ? "canister" : (kindFrom(words) ?? kindFrom(wordsOf(tidy(category ?? ""))));
  if (kind === "bar") return barOf(name, words);
  if (kind === "sheet") return sheetOf(name);
  if (kind === "canister") return canisterOf(name);
  return kind === "roll" ? rollOf(name) : { form: "carton", ...CARTON };
}

function perPieceOf(form: StockForm, unit: readonly string[]): number {
  if (form.form === "canister" && hasWord(unit, LITRE)) return form.litres;
  if ((form.form === "bar" || form.form === "roll") && hasWord(unit, METRE)) return form.length;
  return 1;
}

export function formOf(product: Pick<Product, "name" | "category" | "unit">): FormOf {
  const name = tidy(product.name);
  const words = wordsOf(name);
  const unit = wordsOf(tidy(product.unit));
  // A pack is a box whatever it holds: 40×40 brackets sold by the pack are not 40×40 bars.
  const form: StockForm = hasWord(unit, PACK) ? { form: "carton", ...CARTON } : shapeOf(name, words, product.category);
  const stated = FINISHES.find(([, list]) => hasWord(words, list))?.[0];
  return { form, finish: stated ?? (form.form === "bar" ? BAR_TONE[form.section] : "natural"), perPiece: perPieceOf(form, unit) };
}
