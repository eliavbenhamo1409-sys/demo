/**
 * Every line on this page follows the rule of the leader on the model: straight out, one clean diagonal, straight in.
 * All of it is plain arithmetic on numbers already measured, so nothing here touches the page. Product side is x = width,
 * supplier side is x = 0: the page reads right to left, so our own names stand on the right of the lines.
 */

const round = (n: number) => Math.round(n * 10) / 10;

/** How far a wire runs out of the product's port before it may turn. */
const BEND = 28;
/** What keeps a turn clear of the supplier's port. */
const CLEAR = 20;
/** The gap a waiting wire stops short of: not seated yet. */
const GAP = 22;

export interface Port {
  y: number;
  seated: boolean;
}

export interface WireShape {
  y: number;
  d: string;
  /** Where the loose end of a waiting wire stands. */
  loose: number | null;
}

/** One product to its names: a yard ladder, so no two wires of a product ever cross and each one can be followed by eye. */
export function ladder(width: number, top: number, ports: readonly Port[]): WireShape[] {
  const room = Math.max(width - BEND - CLEAR, 0);
  return ports.map(({ y, seated }) => {
    const drop = y - top;
    const run = Math.min(drop, room);
    const foot = round(width - BEND - run);
    if (!seated) {
      // Short of the turn, so it can never read as joined to a sibling's wire on the same line.
      const end = Math.max(round(foot - GAP), 0);
      return { y, d: `M0 ${y}H${end}`, loose: end };
    }
    const d = drop === 0 ? `M0 ${y}H${width}` : `M0 ${y}H${foot}L${width - BEND} ${top}H${width}`;
    return { y, d, loose: null };
  });
}

/* ───────── the panel: the whole catalogue as one wiring diagram ───────── */

export interface Link {
  category: string;
  supplierId: string;
  names: number;
}

export const linkKey = (category: string, supplierId: string) => `${category}|${supplierId}`;

export interface Jack {
  key: string;
  y: number;
}

export interface Trunk extends Link {
  key: string;
  d: string;
  /** How strong the line is drawn: the share of the busiest link. */
  weight: number;
}

export interface Panel {
  categories: Jack[];
  suppliers: Jack[];
  trunks: Trunk[];
  height: number;
}

const LINE = 32;
const EDGE = 26;
const PASSES = 8;

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1);

/** Each side settles opposite the groups it talks to, so lines run side by side instead of across. */
function settle(categories: readonly string[], suppliers: readonly string[], links: readonly Link[]): { categories: string[]; suppliers: string[] } {
  let cats = [...categories];
  let sups = [...suppliers];
  const pull = (own: string, side: "category" | "supplierId", other: "category" | "supplierId", at: ReadonlyMap<string, number>) =>
    mean(links.filter((l) => l[side] === own).flatMap((l) => Array<number>(l.names).fill(at.get(l[other]) ?? 0)));
  for (let pass = 0; pass < PASSES; pass += 1) {
    const catAt = new Map(cats.map((c, i) => [c, i]));
    const supScore = new Map(sups.map((s) => [s, pull(s, "supplierId", "category", catAt)]));
    sups = [...sups].sort((a, b) => (supScore.get(a) ?? 0) - (supScore.get(b) ?? 0));
    const supAt = new Map(sups.map((s, i) => [s, i]));
    const catScore = new Map(cats.map((c) => [c, pull(c, "category", "supplierId", supAt)]));
    cats = [...cats].sort((a, b) => (catScore.get(a) ?? 0) - (catScore.get(b) ?? 0));
  }
  return { categories: cats, suppliers: sups };
}

/**
 * Both sides stand on one grid, so a line runs dead straight or drops by whole rows: never a jog of a few pixels. The
 * shorter side keeps its order and takes the rows that cost its lines the least.
 */
function seat(keys: readonly string[], rows: number, cost: (key: string, row: number) => number): number[] {
  const first = (keys.length > 0 ? [0] : []).flatMap(() => Array.from({ length: rows }, (_, row) => cost(keys[0], row)));
  const table: number[][] = [first];
  const from: number[][] = [first.map(() => -1)];
  for (let i = 1; i < keys.length; i += 1) {
    const line = Array<number>(rows).fill(Number.POSITIVE_INFINITY);
    const back = Array<number>(rows).fill(-1);
    let best = Number.POSITIVE_INFINITY;
    let at = -1;
    for (let row = i; row < rows; row += 1) {
      if (table[i - 1][row - 1] < best) {
        best = table[i - 1][row - 1];
        at = row - 1;
      }
      line[row] = best + cost(keys[i], row);
      back[row] = at;
    }
    table.push(line);
    from.push(back);
  }
  const seats = Array<number>(keys.length).fill(0);
  let row = (table[keys.length - 1] ?? []).reduce((low, value, i, all) => (value < all[low] ? i : low), 0);
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    seats[i] = row;
    row = from[i][row];
  }
  return seats;
}

export function panel(categories: readonly string[], suppliers: readonly string[], links: readonly Link[], width: number): Panel {
  const order = settle(categories, suppliers, links);
  const rows = Math.max(order.categories.length, order.suppliers.length, 1);
  const longCategories = order.categories.length >= order.suppliers.length;
  const long = longCategories ? order.categories : order.suppliers;
  const short = longCategories ? order.suppliers : order.categories;
  const longAt = new Map(long.map((key, i) => [key, i]));
  const across = (key: string, row: number) =>
    links.reduce((sum, l) => sum + ((longCategories ? l.supplierId : l.category) === key ? l.names * Math.abs(row - (longAt.get(longCategories ? l.category : l.supplierId) ?? 0)) : 0), 0);
  const shortSeats = seat(short, rows, across);
  const yOf = (row: number) => LINE * row + LINE / 2 + 0.5;
  const longJacks = long.map((key, i) => ({ key, y: yOf(i) }));
  const shortJacks = short.map((key, i) => ({ key, y: yOf(shortSeats[i]) }));
  const catJacks = longCategories ? longJacks : shortJacks;
  const supJacks = longCategories ? shortJacks : longJacks;
  const catY = new Map(catJacks.map((j) => [j.key, j.y]));
  const supY = new Map(supJacks.map((j) => [j.key, j.y]));
  const busiest = Math.max(...links.map((l) => l.names), 1);

  const free = Math.max(width - EDGE * 2, 0);
  const mid = Math.round(width / 2);
  const trunks = links.map((link) => {
    const from = catY.get(link.category) ?? 0;
    const to = supY.get(link.supplierId) ?? 0;
    const run = Math.min(Math.abs(to - from), free);
    const d = run === 0 ? `M${width} ${from}H0` : `M${width} ${from}H${round(mid + run / 2)}L${round(mid - run / 2)} ${to}H0`;
    return { ...link, key: linkKey(link.category, link.supplierId), d, weight: link.names / busiest };
  });

  return { categories: catJacks, suppliers: supJacks, trunks, height: rows * LINE };
}
