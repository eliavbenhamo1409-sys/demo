import { fmtPrice, fmtQty } from "@/lib/format";
import type { MapModel, ObjectStock } from "@/lib/map3d/model";
import type { MapObject } from "@/lib/map3d/types";
import type { LabelView } from "./Labels";
import type { PastStock } from "./ObjectCard";
import { minimumShare, percentText } from "./measure";
import { STATE_NUM, STATE_WORD } from "./words";

interface LabelInput {
  objects: readonly MapObject[];
  model: MapModel;
  past: PastStock | null;
  /** The label reads ₪ instead of a quantity. */
  money: boolean;
  /** Objects with an open fault. */
  faults: ReadonlySet<string>;
}

const FAULT_WORD = "תקלה";

const countText = (n: number) => `${fmtQty(n)} מוצרים`;

function pastView(base: LabelView, stock: ObjectStock | undefined, past: PastStock): LabelView {
  const present = stock?.items.filter((i) => past.get(i.product.id)?.kind !== "absent") ?? [];
  if (present.length === 0) return base;
  const known = present.flatMap((i) => {
    const qty = past.get(i.product.id);
    return qty?.kind === "known" ? [qty.qty] : [];
  });
  // An unknown quantity draws as an empty shelf, so the label is what tells it from a real zero.
  if (known.length < present.length) return { ...base, quiet: false, text: "לא ידוע" };
  return { ...base, quiet: false, text: present.length > 1 ? countText(present.length) : fmtQty(known[0]) };
}

/** The tightest product in a place speaks for it, the same percent the rail shows. */
function tightest(items: NonNullable<ObjectStock["items"]>): number | null {
  const shares = items.map((item) => minimumShare(item.product)).filter((share) => share !== null);
  return shares.length > 0 ? Math.min(...shares) : null;
}

function stockView(base: LabelView, stock: ObjectStock | undefined, money: boolean, fault: boolean): LabelView {
  const items = stock?.items ?? [];
  if (items.length === 0) return base;
  const state = stock?.worst ?? "ok";
  const needs = state !== "ok";
  const attention = needs || fault;
  const more = needs ? STATE_WORD[state] : fault ? FAULT_WORD : items.length > 1 ? countText(items.length) : undefined;
  // Only what needs a hand speaks up; the rest of the map stays in the background.
  const shared = { ...base, quiet: !attention, attention, more };
  if (money) return { ...shared, quiet: false, text: stock && stock.value > 0 ? fmtPrice(stock.value) : undefined };
  // A state with no percent behind it speaks as a word: the figure and its colour always come from the same product.
  if (state === "out" || state === "short") return { ...shared, text: STATE_WORD[state], textClass: STATE_NUM[state], more: items.length > 1 ? countText(items.length) : undefined };
  const share = tightest(items);
  return { ...shared, text: share !== null ? percentText(share) : undefined, textClass: STATE_NUM[state] };
}

/** One selector for every figure on the map: all of them come from the same model the rail reads. */
export function labelViews({ objects, model, past, money, faults }: LabelInput): LabelView[] {
  return objects.map((object) => {
    const base: LabelView = { id: object.id, code: object.id, quiet: true, attention: false };
    if (object.kind === "zone") return { ...base, code: object.name, flat: true, minor: true };
    if (object.kind === "machine") {
      const fault = !past && faults.has(object.id);
      return { ...base, more: object.name, attention: fault, word: fault ? FAULT_WORD : undefined, wordClass: "m3d-num-out" };
    }
    const stock = model.byObject.get(object.id);
    const shown = past ? pastView(base, stock, past) : stockView(base, stock, money, faults.has(object.id));
    return object.kind === "floor" && shown.quiet ? { ...shown, minor: true } : shown;
  });
}
