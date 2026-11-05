/**
 * Every line on this page follows the rule of the leader on the model: straight out, one clean diagonal, straight in.
 * All of it is plain arithmetic on numbers already measured, so nothing here touches the page. Product side is x = width,
 * supplier side is x = 0: the page reads right to left, so our own names stand on the right of the lines.
 */

const round = (n: number) => Math.round(n * 10) / 10;

/** How far a wire runs out of the product's port before it may turn. */
const BEND = 28;
/** What keeps a turn clear of the supplier's port. */
const CLEAR = 36;
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

/**
 * One product to its names: a yard ladder, so no two wires of a product ever cross and each one can be followed by eye.
 * When the diagonal runs out of channel it carries on as one straight spine, so a product with many names stays as
 * exact as a product with two.
 */
export function ladder(width: number, top: number, ports: readonly Port[]): WireShape[] {
  const room = Math.max(width - BEND - CLEAR, 0);
  const turn = width - BEND;
  return ports.map(({ y, seated }) => {
    const drop = y - top;
    const run = Math.min(drop, room);
    const foot = round(turn - run);
    if (!seated) {
      // Short of the turn, so it can never read as joined to a sibling's wire on the same line.
      const end = Math.max(round(foot - GAP), 0);
      return { y, d: `M0 ${y}H${end}`, loose: end };
    }
    if (drop === 0) return { y, d: `M0 ${y}H${width}`, loose: null };
    const spine = drop > room ? `V${round(top + room)}` : "";
    return { y, d: `M0 ${y}H${foot}${spine}L${turn} ${top}H${width}`, loose: null };
  });
}
