/**
 * The words of a stock SMS, in the stock page's own words, short enough to stay within two segments.
 * Plain TypeScript with no Deno APIs, so it can be checked with node as well.
 */

export type Level = "low" | "short" | "out";
export type Item = { level: Level; name: string; unit: string; qty: number; reserved: number; min_qty: number };

/** Where the message points: the stock page, which opens on what is missing first. */
export const LINK = "https://worker-nine-rose.vercel.app/inventory";
/** Two segments of a Hebrew SMS: UCS-2, 67 characters a segment once a message has more than one. */
export const MAX = 134;
/** Several products may take a third segment: which products is the news. */
export const MAX_MANY = 201;

export const TEST_TEXT = "ניהול מלאי: מעכשיו תגיע לכאן הודעה כשמוצר יורד מתחת למינימום או אוזל.";

const RANK: Record<Level, number> = { low: 1, short: 2, out: 3 };
const HEAD: Record<Level, string> = { out: "אזל מהמלאי", short: "חסר להזמנות", low: "מתחת למינימום" };
const WORD: Record<Level, string> = { out: "אזל", short: "חסר להזמנות", low: "מתחת למינימום" };

const nf = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 3 });
const num = (v: number) => nf.format(v);
/** As fmtUnit in src/lib/format.ts. */
const unitOf = (qty: number, unit: string) => (unit === "אריזה" && Math.abs(qty) !== 1 ? "אריזות" : unit);

export function rank(level: string | null | undefined): number {
  return level && level in RANK ? RANK[level as Level] : 0;
}

/** The figures a manager weighs the message by, in the row's words: זמין after orders, משוריין, מינימום. */
function figures(i: Item): string {
  const free = i.qty - i.reserved;
  if (i.level === "low") return `זמין ${num(free)} ${unitOf(free, i.unit)} · מינימום ${num(i.min_qty)}`;
  if (i.level === "short") return `במלאי ${num(i.qty)} · משוריין ${num(i.reserved)} ${unitOf(i.reserved, i.unit)}`;
  return i.reserved > 0
    ? `משוריין ${num(i.reserved)} ${unitOf(i.reserved, i.unit)} · מינימום ${num(i.min_qty)}`
    : `מינימום ${num(i.min_qty)} ${unitOf(i.min_qty, i.unit)}`;
}

function clip(s: string, room: number): string {
  return s.length <= room ? s : `${s.slice(0, Math.max(room - 1, 0)).trimEnd()}…`;
}

/** One message for everything one call took, worst first. */
export function compose(items: Item[]): string {
  const sorted = [...items].sort((a, b) => RANK[b.level] - RANK[a.level]);
  if (sorted.length === 1) {
    const i = sorted[0];
    const head = `${HEAD[i.level]}: ${i.name}`;
    for (const text of [[head, figures(i), LINK], [head, LINK]].map((lines) => lines.join("\n"))) {
      if (text.length <= MAX) return text;
    }
    return `${clip(head, MAX - LINK.length - 1)}\n${LINK}`;
  }
  const head = `${sorted.length} מוצרים עברו למלאי חסר`;
  // As many named as fit; the rest as a count, and the page holds them all.
  for (let shown = sorted.length; shown >= 1; shown--) {
    const rest = sorted.length - shown;
    const lines = sorted.slice(0, shown).map((i) => `${WORD[i.level]}: ${i.name}`);
    const text = [head, ...lines, ...(rest > 0 ? [`ועוד ${rest}`] : []), LINK].join("\n");
    if (text.length <= MAX_MANY) return text;
  }
  const more = `ועוד ${sorted.length - 1}`;
  const room = MAX_MANY - [head, more, LINK].join("\n").length - 1;
  return [head, clip(`${WORD[sorted[0].level]}: ${sorted[0].name}`, room), more, LINK].join("\n");
}

/** Billing segments of a Hebrew text (UCS-2). */
export function segments(text: string): number {
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
}
