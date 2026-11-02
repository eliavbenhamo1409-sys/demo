/** Hebrew-first formatting helpers. Numbers stay Latin digits, LTR, mono. */

const nf = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 3 });

export function fmtQty(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(v)) return "—";
  return nf.format(v);
}

const priceFmt = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });

/** "₪1,240.5", up to two decimals. */
export function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `₪${priceFmt.format(n)}`;
}

export function fmtSigned(n: number, type: "in" | "out" | "fault" | "adjust"): string {
  if (type === "in") return `+${fmtQty(n)}`;
  if (type === "out") return `−${fmtQty(n)}`;
  return fmtQty(n);
}

/** Keeps "1250×2500" in its written order inside a Hebrew line, where the bidi rules would flip it. */
export function fmtName(name: string): string {
  return name.replace(/×/g, "\u200e×\u200e");
}

const pad = (n: number) => String(n).padStart(2, "0");

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

const todayFmt = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" });

export function fmtToday(): string {
  return todayFmt.format(new Date());
}

export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}

/** "01.11.2026 · 09:24", for lists that span years. */
export function fmtFull(iso: string): string {
  return `${fmtDate(iso)}.${new Date(iso).getFullYear()} · ${fmtTime(iso)}`;
}

export function isToday(iso: string): boolean {
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

/** "לפני 4 דקות" / "לפני שעתיים" / "אתמול, 16:40" / "28.10 · 16:40" */
export function fmtRelative(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "עכשיו";
  if (min === 1) return "לפני דקה";
  if (min < 60) return `לפני ${min} דקות`;
  const h = Math.floor(min / 60);
  if (h === 1) return "לפני שעה";
  if (h === 2) return "לפני שעתיים";
  if (h < 24 && isToday(iso)) return `לפני ${h} שעות`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const d = new Date(iso);
  if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) {
    return `אתמול, ${fmtTime(iso)}`;
  }
  return fmtDateTime(iso);
}

/** Calendar days back from now: 0 is today, 1 is yesterday. */
export function daysAgo(iso: string, now: number): number {
  const d = new Date(iso), n = new Date(now);
  return Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
}

/** "היום" / "אתמול" / "28.10", and "28.10.25" once the date is in another year. */
export function fmtDayWord(iso: string, now: number = Date.now()): string {
  const days = daysAgo(iso, now);
  if (days === 0) return "היום";
  if (days === 1) return "אתמול";
  const year = new Date(iso).getFullYear();
  return year === new Date(now).getFullYear() ? fmtDate(iso) : `${fmtDate(iso)}.${String(year).slice(2)}`;
}

/** "היום 20:48" / "אתמול 09:24" / "28.10 09:24": a day in a word, so a list never repeats today's date. */
export function fmtDay(iso: string, now: number = Date.now()): string {
  return `${fmtDayWord(iso, now)} ${fmtTime(iso)}`;
}

/** How long something has waited, in plain words: "לפני 3 שעות" / "אתמול" / "לפני 5 ימים" / "לפני שבועיים". */
export function fmtAge(iso: string, now: number = Date.now()): string {
  const days = daysAgo(iso, now);
  if (days < 1) return fmtRelative(iso, now);
  if (days === 1) return "אתמול";
  if (days === 2) return "לפני יומיים";
  if (days < 7) return `לפני ${days} ימים`;
  if (days < 14) return "לפני שבוע";
  if (days < 21) return "לפני שבועיים";
  if (days < 30) return `לפני ${Math.floor(days / 7)} שבועות`;
  if (days < 60) return "לפני חודש";
  if (days < 90) return "לפני חודשיים";
  return `לפני ${Math.floor(days / 30)} חודשים`;
}

/** Time only when today, else short date + time. For table "when" columns. */
export function fmtWhen(iso: string): string {
  return isToday(iso) ? fmtTime(iso) : fmtDateTime(iso);
}

export const MOVEMENT_LABEL: Record<"in" | "out" | "fault" | "adjust", string> = {
  in: "קליטה",
  out: "הוצאה",
  fault: "תקלה",
  adjust: "תיקון ספירה",
};

export const ORDER_STATUS_LABEL: Record<"open" | "delivered" | "cancelled", string> = {
  open: "פתוחה",
  delivered: "נמסרה",
  cancelled: "בוטלה",
};
