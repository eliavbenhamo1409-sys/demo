/**
 * Finds where the writing sits in a photographed document, so the reading
 * animation marks the real text on the page rather than a decoration.
 * Runs on a small copy of the photo in a few milliseconds; it reads nothing
 * and its result never reaches the data, it only draws.
 */

/** A patch of text, as fractions (0 to 1) of the photo's width and height. */
export type Region = { x: number; y: number; w: number; h: number };

const GRID_WIDTH = 220;
const WINDOW = 8;
const DARKER_BY = 14;
const WORD_GAP = 4;
const MAX_REGIONS = 36;

/** Marks the pixels clearly darker than their surroundings, so shadows and paper tint don't count as ink. */
function inkMask(gray: Float32Array, w: number, h: number): Uint8Array {
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const top = Math.max(0, y - WINDOW);
    const bottom = Math.min(h, y + WINDOW + 1);
    for (let x = 0; x < w; x++) {
      const left = Math.max(0, x - WINDOW);
      const right = Math.min(w, x + WINDOW + 1);
      const area = (right - left) * (bottom - top);
      const total = sum[bottom * (w + 1) + right] - sum[top * (w + 1) + right] - sum[bottom * (w + 1) + left] + sum[top * (w + 1) + left];
      if (gray[y * w + x] < total / area - DARKER_BY) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/** Joins letters into words: fills short horizontal gaps. */
function closeGaps(mask: Uint8Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    let lastInk = -1;
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (lastInk >= 0 && x - lastInk > 1 && x - lastInk <= WORD_GAP) mask.fill(1, y * w + lastInk + 1, y * w + x);
      lastInk = x;
    }
  }
}

/** Connected patches of ink, each as its bounding box in grid cells. */
function patches(mask: Uint8Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number; size: number }[] {
  const seen = new Uint8Array(w * h);
  const found: { x0: number; y0: number; x1: number; y1: number; size: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const box = { x0: w, y0: h, x1: 0, y1: 0, size: 0 };
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const at = stack.pop() as number;
      const x = at % w;
      const y = (at - x) / w;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
      box.size++;
      for (const next of [x > 0 ? at - 1 : -1, x < w - 1 ? at + 1 : -1, y > 0 ? at - w : -1, y < h - 1 ? at + w : -1]) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    found.push(box);
  }
  return found;
}

/** Text regions in the picture, top to bottom. Empty when nothing looks like writing. */
export function findTextRegions(source: CanvasImageSource, width: number, height: number): Region[] {
  const w = GRID_WIDTH;
  const h = Math.max(1, Math.round((GRID_WIDTH * height) / width));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];

  const mask = inkMask(gray, w, h);
  closeGaps(mask, w, h);
  return patches(mask, w, h)
    .map((b) => ({ ...b, bw: b.x1 - b.x0 + 1, bh: b.y1 - b.y0 + 1 }))
    .filter((b) => b.bh >= 2 && b.bh <= h * 0.07 && b.bw >= 6 && b.bw <= w * 0.92 && b.bw / b.bh >= 1.5 && b.size / (b.bw * b.bh) >= 0.3)
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_REGIONS)
    .sort((a, b) => a.y0 - b.y0)
    .map((b) => ({ x: (b.x0 - 1) / w, y: (b.y0 - 1) / h, w: (b.bw + 2) / w, h: (b.bh + 2) / h }));
}
