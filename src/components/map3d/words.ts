import { fmtQty } from "@/lib/format";
import type { Cover } from "@/lib/map3d/metrics";
import type { StockState } from "@/lib/map3d/types";

const DAY = 86_400_000;

/** The store's words for a state, so a label and the worklist read the same. */
export const STATE_WORD: Record<StockState, string> = { ok: "", low: "מינימום", out: "אזל", short: "חסר" };

/** Colour lives on the number itself. */
export const STATE_NUM: Record<StockState, string | undefined> = {
  ok: undefined,
  low: "m3d-num-low",
  out: "m3d-num-out",
  short: "m3d-num-short",
};

/** How long ago a shelf was counted: a date would leave the sum to the reader. */
export function countedAgo(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / DAY);
  if (days < 1) return "היום";
  return days === 1 ? "אתמול" : `לפני ${fmtQty(days)} ימים`;
}

export function coverText(cover: Cover): string {
  switch (cover.kind) {
    case "days":
      return cover.days < 1 ? "פחות מיום" : cover.days === 1 ? "יום אחד" : `${fmtQty(cover.days)} ימים`;
    case "over":
      return `מעל ${fmtQty(cover.days)} ימים`;
    case "state":
      return STATE_WORD[cover.state] || "—";
    case "thin":
      return "אין מספיק נתונים";
  }
}
