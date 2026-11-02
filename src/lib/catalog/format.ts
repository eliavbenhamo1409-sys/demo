/** Hebrew-first formatting. Numbers stay Latin digits, in Jost. */

const nf = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 3 });

export function fmtQty(n: number): string {
  return nf.format(n);
}

/** "₪12" for whole shekels, "₪8.90" otherwise. */
export function fmtPrice(n: number): string {
  const whole = Number.isInteger(n);
  return `₪${n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Keeps "60×40×40" in its written order inside a Hebrew line, where the bidi rules would flip it. */
export function fmtName(name: string): string {
  return name.replace(/×/g, "\u200e×\u200e");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "02.11.2026" */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Today on this phone, the way the database writes a day: "2026-11-02". */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "05.11.2026", for a day with no hour in it. */
export function fmtDay(day: string): string {
  return day.split("-").reverse().join(".");
}

const weekdayFmt = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** "יום חמישי, 5 בנובמבר": a promise to a customer is made in days of the week. */
export function fmtPromise(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : weekdayFmt.format(date);
}

export const ORDER_STATUS_LABEL = {
  open: "פתוחה",
  delivered: "נמסרה",
  cancelled: "בוטלה",
} as const;
