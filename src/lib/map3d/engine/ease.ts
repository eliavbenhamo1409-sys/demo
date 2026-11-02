export type Easing = (t: number) => number;

/** Falls back to the value of the --ease token, should the page not define it. */
const FALLBACK: readonly [number, number, number, number] = [0.32, 0.72, 0, 1];

function controlPoints(): readonly [number, number, number, number] {
  const token = getComputedStyle(document.documentElement).getPropertyValue("--ease");
  const values = token.match(/-?\d*\.?\d+/g)?.map(Number);
  return values?.length === 4 ? [values[0], values[1], values[2], values[3]] : FALLBACK;
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const axis = (a: number, b: number, s: number) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  const slope = (a: number, b: number, s: number) => 3 * (1 - s) * (1 - s) * a + 6 * (1 - s) * s * (b - a) + 3 * s * s * (1 - b);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const error = axis(x1, x2, s) - t;
      const gradient = slope(x1, x2, s);
      if (Math.abs(error) < 1e-5 || gradient === 0) break;
      s -= error / gradient;
    }
    return axis(y1, y2, s);
  };
}

/** The product's one curve, read from its token so a flight moves like a drawer. */
export function readEase(): Easing {
  return cubicBezier(...controlPoints());
}
