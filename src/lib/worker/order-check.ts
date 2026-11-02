/**
 * Sets a receipt against the order it leaves under. The order says what should
 * leave, the receipt what did, and where they differ the worker says what really left.
 *
 * A line the dictionary is sure of counts as that product. One that only resembles a
 * product on the order waits for the worker, as everywhere, and that product's row
 * isn't asked about until the line is answered: the two may be the same goods.
 */

import type { Candidate } from "@/lib/worker/match";

type OrderedLine = { id: string; product_id: string; qty: number };
/** What the comparison reads of a delivery line. `read` is the receipt's own figure, before the stepper rounds it. */
type DeliveryLine = { productId: string | null; qty: number; read?: number; candidates?: Candidate[]; route?: string };

/** same: nothing to ask. qty: both sides have it, in different amounts. missing: only the order has it. waiting: see above. */
export type RowState = "same" | "qty" | "missing" | "waiting";

export type OrderRow = {
  /** The order line's id. */
  id: string;
  productId: string;
  ordered: number;
  /** What the receipt says; null when it isn't on the receipt. */
  read: number | null;
  /** What really left; undefined until the worker answers. */
  left: number | undefined;
  state: RowState;
};

/** The worker's word per order line. It holds for the figure it answered: a new reading asks again. */
export type Answers = Record<string, { left: number; read: number | null }>;

/** One difference, as the database keeps it. See post_order. */
export type OrderChange = { product_id: string | null; name: string | null; read: number | null; delivered: number; manager: boolean };

/** `wasRead` is false when the reading failed: there is nothing to compare, so every line stands as ordered until the worker changes it. */
export function compareOrder(order: OrderedLine[], lines: DeliveryLine[], answers: Answers, wasRead: boolean): OrderRow[] {
  const resembled = new Set(lines.filter((l) => !l.productId && !l.route).flatMap((l) => l.candidates?.map((c) => c.productId) ?? []));
  return order.map((l) => {
    const found = lines.filter((x) => x.productId === l.product_id);
    const read = found.length ? found.reduce((sum, x) => sum + (x.read ?? x.qty), 0) : null;
    const given = answers[l.id];
    const answer = given && given.read === read ? given.left : undefined;
    const state: RowState = !wasRead || read === l.qty ? "same" : read !== null ? "qty" : resembled.has(l.product_id) ? "waiting" : "missing";
    return { id: l.id, productId: l.product_id, ordered: l.qty, read, left: answer ?? (state === "same" ? l.qty : undefined), state };
  });
}

/** A row the worker still has to answer. */
export const rowOpen = (r: OrderRow) => r.left === undefined && r.state !== "waiting";

/** Every row that differs stays on record, even when the worker says the goods left as ordered: the receipt still said otherwise. */
export function rowChanges(rows: OrderRow[], wasRead: boolean): OrderChange[] {
  return rows.flatMap((r) => (r.state !== "waiting" && (r.left !== r.ordered || (wasRead && r.read !== r.ordered))
    ? [{ product_id: r.productId, name: null, read: r.read, delivered: r.left ?? r.ordered, manager: false }]
    : []));
}

/** How many exceptions, as a phrase. */
export const changeWords = (n: number) => (n === 1 ? "חריגה אחת" : `${n} חריגות`);
