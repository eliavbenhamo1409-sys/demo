/**
 * Routes along the floor: A* on a 0.5 m grid, inside the walls and around what stands there. Moves
 * follow the grid and a corner costs extra, so a line reads like a route on a plan.
 * An end is an object's code or a point. Zones are lines on the floor, so a route may cross one.
 */

import { FOOTPRINT, insideFootprint } from "./layout";
import type { MapObject, MapPoint } from "./types";

const CELL = 0.5;
/** A route keeps this far from walls and objects, so it never runs along a face. */
const CLEARANCE = 0.5;
/** A corner is worth a detour of this many cells. */
const TURN_COST = 6;

const ORIGIN_X = Math.min(...FOOTPRINT.map(([x]) => x));
const ORIGIN_Z = Math.min(...FOOTPRINT.map(([, z]) => z));
const COLUMNS = Math.round((Math.max(...FOOTPRINT.map(([x]) => x)) - ORIGIN_X) / CELL) + 1;
const ROWS = Math.round((Math.max(...FOOTPRINT.map(([, z]) => z)) - ORIGIN_Z) / CELL) + 1;
const CELLS = COLUMNS * ROWS;

/** Each cell is entered from one of four directions: right, left, down, up. Opposites differ in the last bit. */
const STEPS = [1, -1, COLUMNS, -COLUMNS];
const DIRECTIONS = STEPS.length;

const xOf = (cell: number) => ORIGIN_X + (cell % COLUMNS) * CELL;
const zOf = (cell: number) => ORIGIN_Z + Math.floor(cell / COLUMNS) * CELL;

let walls: Uint8Array | null = null;

/** Set where the clearance from the walls fails. The outer ring is always set, so a step never wraps a row. */
function wallCells(): Uint8Array {
  if (walls) return walls;
  walls = new Uint8Array(CELLS);
  for (let cell = 0; cell < CELLS; cell++) {
    walls[cell] = insideFootprint(xOf(cell), zOf(cell), 2 * CLEARANCE, 2 * CLEARANCE) ? 0 : 1;
  }
  return walls;
}

function forEachCellIn(object: MapObject, margin: number, visit: (cell: number) => void): void {
  const left = object.x - object.w / 2 - margin;
  const right = object.x + object.w / 2 + margin;
  const near = object.z - object.d / 2 - margin;
  const far = object.z + object.d / 2 + margin;
  const firstColumn = Math.max(Math.floor((left - ORIGIN_X) / CELL), 0);
  const lastColumn = Math.min(Math.ceil((right - ORIGIN_X) / CELL), COLUMNS - 1);
  const firstRow = Math.max(Math.floor((near - ORIGIN_Z) / CELL), 0);
  const lastRow = Math.min(Math.ceil((far - ORIGIN_Z) / CELL), ROWS - 1);
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      const cell = column + row * COLUMNS;
      const x = xOf(cell);
      const z = zOf(cell);
      if (x > left && x < right && z > near && z < far) visit(cell);
    }
  }
}

const grids = new WeakMap<readonly MapObject[], Uint8Array>();

function blockedCells(objects: readonly MapObject[]): Uint8Array {
  const cached = grids.get(objects);
  if (cached) return cached;
  const blocked = wallCells().slice();
  for (const object of objects) {
    if (object.kind === "zone") continue;
    forEachCellIn(object, CLEARANCE, (cell) => {
      blocked[cell] = 1;
    });
  }
  grids.set(objects, blocked);
  return blocked;
}

function nearestFree(blocked: Uint8Array, x: number, z: number): number[] {
  let best = -1;
  let bestDistance = Infinity;
  for (let cell = 0; cell < CELLS; cell++) {
    if (blocked[cell]) continue;
    const distance = (xOf(cell) - x) ** 2 + (zOf(cell) - z) ** 2;
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best < 0 ? [] : [best];
}

/** The free cells a route can use at one end: the ring around an object, the middle of a zone, the cell at a point. */
function endCells(blocked: Uint8Array, objects: readonly MapObject[], end: string | MapPoint): number[] {
  if (typeof end !== "string") return nearestFree(blocked, end[0], end[1]);
  const object = objects.find((candidate) => candidate.id === end);
  if (!object) return [];
  if (object.kind === "zone") return nearestFree(blocked, object.x, object.z);
  const ring: number[] = [];
  forEachCellIn(object, CLEARANCE + CELL, (cell) => {
    if (!blocked[cell]) ring.push(cell);
  });
  return ring;
}

/** A binary min-heap on two parallel arrays, because a route can push thousands of nodes. */
class Queue {
  private keys: number[] = [];
  private nodes: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, node: number): void {
    const { keys, nodes } = this;
    let i = keys.length;
    keys.push(key);
    nodes.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      nodes[i] = nodes[parent];
      i = parent;
    }
    keys[i] = key;
    nodes[i] = node;
  }

  pop(): number {
    const { keys, nodes } = this;
    const top = nodes[0];
    const key = keys.pop() as number;
    const node = nodes.pop() as number;
    const size = keys.length;
    if (size === 0) return top;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= size) break;
      if (child + 1 < size && keys[child + 1] < keys[child]) child += 1;
      if (keys[child] >= key) break;
      keys[i] = keys[child];
      nodes[i] = nodes[child];
      i = child;
    }
    keys[i] = key;
    nodes[i] = node;
    return top;
  }
}

/** Cells from a start to a goal, or null. A node is a cell and the direction it was entered from. */
function search(blocked: Uint8Array, starts: readonly number[], goals: readonly number[]): number[] | null {
  const isGoal = new Uint8Array(CELLS);
  let minColumn = COLUMNS;
  let maxColumn = 0;
  let minRow = ROWS;
  let maxRow = 0;
  for (const cell of goals) {
    isGoal[cell] = 1;
    const column = cell % COLUMNS;
    const row = Math.floor(cell / COLUMNS);
    minColumn = Math.min(minColumn, column);
    maxColumn = Math.max(maxColumn, column);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }
  const estimate = (cell: number) => {
    const column = cell % COLUMNS;
    const row = Math.floor(cell / COLUMNS);
    return Math.max(minColumn - column, column - maxColumn, 0) + Math.max(minRow - row, row - maxRow, 0);
  };
  // Equal totals go to the node nearest the goal, which keeps open floor from being searched in full.
  const priority = (cost: number, left: number) => (cost + left) * 1024 + left;

  const costs = new Int32Array(CELLS * DIRECTIONS).fill(0x7fffffff);
  const parents = new Int32Array(CELLS * DIRECTIONS).fill(-1);
  const closed = new Uint8Array(CELLS * DIRECTIONS);
  const queue = new Queue();
  for (const cell of starts) {
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      const node = cell * DIRECTIONS + direction;
      costs[node] = 0;
      queue.push(priority(0, estimate(cell)), node);
    }
  }

  while (queue.size > 0) {
    const node = queue.pop();
    if (closed[node]) continue;
    closed[node] = 1;
    const cell = Math.floor(node / DIRECTIONS);
    const direction = node % DIRECTIONS;
    if (isGoal[cell]) {
      const path: number[] = [];
      for (let at = node; at !== -1; at = parents[at]) path.push(Math.floor(at / DIRECTIONS));
      return path.reverse();
    }
    for (let next = 0; next < DIRECTIONS; next++) {
      if (next === (direction ^ 1)) continue;
      const neighbour = cell + STEPS[next];
      if (blocked[neighbour]) continue;
      const nextNode = neighbour * DIRECTIONS + next;
      const cost = costs[node] + 1 + (next === direction ? 0 : TURN_COST);
      if (cost >= costs[nextNode]) continue;
      costs[nextNode] = cost;
      parents[nextNode] = node;
      queue.push(priority(cost, estimate(neighbour)), nextNode);
    }
  }
  return null;
}

/** The corners of a path, ends included. */
function cornersOf(path: readonly number[]): MapPoint[] {
  const points: MapPoint[] = [];
  path.forEach((cell, i) => {
    const before = path[i - 1];
    const after = path[i + 1];
    if (before === undefined || after === undefined || cell - before !== after - cell) points.push([xOf(cell), zOf(cell)]);
  });
  return points;
}

/** The corners from one end to the other. Empty when there is no route or the ends touch, so there is nothing to draw. */
export function routeBetween(objects: readonly MapObject[], from: string | MapPoint, to: string | MapPoint): MapPoint[] {
  const blocked = blockedCells(objects);
  const starts = endCells(blocked, objects, from);
  const goals = endCells(blocked, objects, to);
  if (starts.length === 0 || goals.length === 0) return [];
  const points = cornersOf(search(blocked, starts, goals) ?? []);
  return points.length < 2 ? [] : points;
}
