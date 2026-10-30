/** Hebrew-first formatting helpers. Numbers stay Latin digits, LTR, mono. */

const nf = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 3 });

export function fmtQty(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(v)) return "—";
  return nf.format(v);
}

export function fmtSigned(n: number, type: "in" | "out" | "fault" | "adjust"): string {
  if (type === "in") return `+${fmtQty(n)}`;
  if (type === "out") return `−${fmtQty(n)}`;
  return fmtQty(n);
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

export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
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

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[parts.length - 1][0];
}
