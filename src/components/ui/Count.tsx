import type { ReactElement } from "react";
import { fmtQty } from "@/lib/format";

/** A figure and its noun, one form or many. */
export function Count({ n, one, many }: { n: number; one: string; many: string }): ReactElement {
  return <><span className="sa-num">{fmtQty(n)}</span> {n === 1 ? one : many}</>;
}

/** The one result line, for when something is hidden. */
export function Showing({ shown, total }: { shown: number; total: number }): ReactElement {
  return <span>מציג <span className="sa-num">{fmtQty(shown)}</span> מתוך <span className="sa-num">{fmtQty(total)}</span></span>;
}
