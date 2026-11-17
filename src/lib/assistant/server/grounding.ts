/**
 * The rule "every number comes from a read" as code, not as a request to the model. Every number that came back
 * from the database in this conversation is remembered; an answer is then read for its numbers, and any that was
 * never seen is named. The route sends the answer back once for correction, and what still stands is shown to the
 * manager as unverified.
 */

/** 1,234.5 or 1234.5 or 12. A comma counts only between groups of three, so "3, 5" stays two numbers. */
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** Counting what is listed ("3 מוצרים", "ב-2 הזמנות") is not a business figure. */
const SMALL = 10;

const canon = (n: number): string => String(Math.round(Math.abs(n) * 100) / 100);

function numbersIn(text: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const value = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(value)) out.push({ raw: m[0], value });
  }
  return out;
}

export class Known {
  private readonly seen = new Set<string>();

  /** A figure from the database, with the ways a person would write it: whole, one decimal, in thousands, in millions. */
  add(n: number): void {
    if (!Number.isFinite(n)) return;
    const a = Math.abs(n);
    this.seen.add(canon(a));
    this.seen.add(canon(Math.round(a)));
    this.seen.add(canon(Math.round(a * 10) / 10));
    if (a >= 1000) {
      this.seen.add(canon(Math.round(a / 1000)));
      this.seen.add(canon(Math.round(a / 100) / 10));
    }
    if (a >= 1_000_000) {
      this.seen.add(canon(Math.round(a / 1_000_000)));
      this.seen.add(canon(Math.round(a / 100_000) / 10));
      this.seen.add(canon(Math.round(a / 10_000) / 100));
    }
  }

  /** Numbers inside words: a product's size in its name, the parts of a date, what the manager typed. */
  addText(text: string): void {
    for (const { value } of numbersIn(text)) this.seen.add(canon(value));
  }

  /** Everything a read returned. A list's length counts too: "5 מוצרים" of five rows is a read, not arithmetic. */
  addJson(v: unknown): void {
    if (typeof v === "number") this.add(v);
    else if (typeof v === "string") this.addText(v);
    else if (Array.isArray(v)) {
      this.seen.add(canon(v.length));
      for (const item of v) this.addJson(item);
    } else if (v && typeof v === "object") {
      for (const item of Object.values(v)) this.addJson(item);
    }
  }

  /** The numbers in this text that no read returned, as they were written. */
  unverified(text: string): string[] {
    // "1. " and "2) " at the head of a line number the lines, they say nothing.
    const body = text.replace(/^\s*\d+[.)]\s+/gm, "");
    const missing = new Set<string>();
    for (const { raw, value } of numbersIn(body)) {
      if (Number.isInteger(value) && value <= SMALL) continue;
      if (!this.seen.has(canon(value))) missing.add(raw);
    }
    return [...missing];
  }
}
