import { fmtPrice, fmtQty } from "@/lib/format";
import { shelfAnchor } from "@/lib/map3d/layout";
import { shelfLines, shortName, type MapModel, type ObjectStock, type ShelfBlock } from "@/lib/map3d/model";
import { shelfWords } from "@/lib/map3d/place";
import type { MapObject, PickHit } from "@/lib/map3d/types";
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
  /** The rack on screen close up: every shelf of it speaks, and no other rack is drawn. */
  open: MapObject | null;
  /** A shelf under the pointer or chosen in the rail. */
  shelf: PickHit | null;
}

const FAULT_WORD = "תקלה";

const countText = (n: number) => `${fmtQty(n)} מוצרים`;

function pastView(base: LabelView, stock: ObjectStock | undefined, past: PastStock): LabelView {
  const present = stock?.items.filter((i) => past.get(i.product.id)?.kind !== "absent") ?? [];
  if (present.length === 0) return base;
  const seen = [...new Set(present.map((i) => i.product.id))];
  const known = seen.flatMap((id) => {
    const qty = past.get(id);
    return qty?.kind === "known" ? [qty.qty] : [];
  });
  // An unknown quantity draws as an empty shelf, so the label is what tells it from a real zero.
  if (known.length < seen.length) return { ...base, quiet: false, text: "לא ידוע" };
  return { ...base, quiet: false, text: seen.length > 1 ? countText(seen.length) : fmtQty(known[0]) };
}

/** The tightest product in a place speaks for it, the same percent the rail shows. */
function tightest(items: NonNullable<ObjectStock["items"]>): number | null {
  const shares = items.map((item) => minimumShare(item.product)).filter((share) => share !== null);
  return shares.length > 0 ? Math.min(...shares) : null;
}

/** Every product on the shelves has its own: no one figure speaks for a rack that holds several. */
const shelved = (stock: ObjectStock) => stock.blocks.every((block) => block.level !== null);

function stockView(base: LabelView, stock: ObjectStock | undefined, money: boolean, fault: boolean): LabelView {
  const items = stock?.items ?? [];
  if (!stock || items.length === 0) return base;
  const state = stock.worst;
  const needs = state !== "ok";
  const onShelves = shelved(stock);
  const attention = (needs && !onShelves) || fault;
  const more = needs && !onShelves ? STATE_WORD[state] : fault ? FAULT_WORD : stock.products > 1 ? countText(stock.products) : undefined;
  // Only what needs a hand speaks up; the rest of the map stays in the background.
  const shared = { ...base, quiet: !attention, attention, more };
  if (money) return { ...shared, quiet: false, text: stock.value > 0 ? fmtPrice(stock.value) : undefined };
  if (onShelves) return shared;
  // A state with no percent behind it speaks as a word: the figure and its colour always come from the same product.
  if (state === "out" || state === "short") return { ...shared, text: STATE_WORD[state], textClass: STATE_NUM[state], more: stock.products > 1 ? countText(stock.products) : undefined };
  const share = tightest(items);
  return { ...shared, text: share !== null ? percentText(share) : undefined, textClass: STATE_NUM[state] };
}

/** The product's own figure, the same one the ledger shows, on the shelf it stands on. */
function figureOf(block: ShelfBlock): Pick<LabelView, "text" | "textClass"> {
  const { state, product } = block;
  const share = minimumShare(product);
  if (state === "out" || state === "short") return { text: STATE_WORD[state], textClass: STATE_NUM[state] };
  return { text: share !== null ? percentText(share) : undefined, textClass: STATE_NUM[state] };
}

function blockHit(block: ShelfBlock): PickHit {
  return { objectId: block.objectId, level: block.level, side: block.side, through: block.through ?? undefined };
}

/** Products sharing a shelf stand one behind the other, so their tags stand side by side along it. */
function blockAnchor(object: MapObject, block: ShelfBlock, blocks: readonly ShelfBlock[]) {
  const at = shelfAnchor(object, block.level ?? 0, block.side, block.through ?? block.level ?? 0);
  const sharing = blocks.filter((other) => other.level === block.level && other.side === block.side);
  const width = block.side === null ? object.w : object.w / 2;
  return { ...at, x: at.x + (sharing.indexOf(block) - (sharing.length - 1) / 2) * (width / sharing.length) };
}

function touches(block: ShelfBlock, shelf: PickHit | null): boolean {
  if (!shelf || shelf.objectId !== block.objectId || shelf.level === null || block.level === null) return false;
  const inside = shelf.level >= block.level && shelf.level <= (block.through ?? block.level);
  return inside && (block.side === null || !shelf.side || block.side === shelf.side);
}

/** A tag on the front of each shelf that has something to say: all of them close up, what needs a hand from afar. */
function shelfViews({ objects, model, open, shelf }: LabelInput): LabelView[] {
  const views: LabelView[] = [];
  for (const object of objects) {
    if (object.kind !== "rack") continue;
    if (open && open.id !== object.id) continue;
    const blocks = model.byObject.get(object.id)?.blocks ?? [];
    const close = open?.id === object.id;

    for (const block of blocks) {
      if (block.level === null) continue;
      const needs = block.state !== "ok";
      const pointed = touches(block, shelf);
      if (!close && !needs && !pointed) continue;
      const words = shelfWords(block.level, block.side, block.through);
      views.push({
        id: block.key,
        code: "",
        name: close || pointed ? shortName(block.product.name) : undefined,
        shelf: close || pointed ? (words ?? undefined) : undefined,
        qty: close || pointed ? `${fmtQty(block.qty)} ${block.product.unit}` : undefined,
        ...figureOf(block),
        at: blockAnchor(object, block, blocks),
        hit: blockHit(block),
        quiet: !needs,
        attention: needs,
        onShelf: true,
      });
    }

    if (!close) continue;
    for (const line of shelfLines(object, blocks)) {
      if (line.blocks.length > 0) continue;
      views.push({
        id: `${object.id}@empty/${line.level}/${line.side ?? ""}`,
        code: "",
        shelf: `${shelfWords(line.level, line.side)} פנוי`,
        at: shelfAnchor(object, line.level, line.side),
        hit: { objectId: object.id, level: line.level, side: line.side },
        quiet: true,
        attention: false,
        onShelf: true,
      });
    }
  }
  return views;
}

/** One selector for every figure on the map: all of them come from the same model the rail reads. */
export function labelViews(input: LabelInput): LabelView[] {
  const { objects, model, past, money, faults, open } = input;
  const views = objects
    // In a close view the rest of the floor isn't drawn, so its tags have nothing to stand on.
    .filter((object) => !open || object.id === open.id)
    .map((object) => {
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
  return past || money ? views : [...views, ...shelfViews(input)];
}
