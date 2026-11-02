import type { Easing } from "./ease";
import type { Amounts, Tier } from "./looks";

const FADE_MS = 180;

function sameIds(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): boolean {
  if (a === null || b === null) return a === b;
  return a.size === b.size && [...a].every((id) => b.has(id));
}

export type FadeStep = "idle" | "fading" | "settled";

/** Who recedes, and how far along the fade is. Which materials that means is the tiers' business. */
export class Emphasis {
  private kept: ReadonlySet<string> | null = null;
  private was: ReadonlySet<string> | null = null;
  private fading = false;
  private start = 0;
  private dimFrom = 0;
  private dimTo = 0;
  amounts: Amounts = { base: 0, dim: 0, rise: 1, fall: 0 };

  constructor(
    private readonly ease: Easing,
    private readonly reducedMotion: boolean,
  ) {}

  /** Returns whether anything will change. */
  set(ids: ReadonlySet<string> | null, now: number): boolean {
    const next = ids ? new Set(ids) : null;
    if (sameIds(next, this.kept)) return false;
    this.was = this.kept;
    this.kept = next;
    this.fading = true;
    this.start = now;
    this.dimFrom = this.amounts.dim;
    this.dimTo = next ? 1 : 0;
    return true;
  }

  readonly tierOf = (owner: string): Tier => {
    const dimNow = this.kept !== null && !this.kept.has(owner);
    if (!this.fading || this.was === null) return dimNow ? "dim" : "base";
    const dimBefore = !this.was.has(owner);
    if (this.kept === null) return dimBefore ? "dim" : "base";
    if (dimBefore && dimNow) return "dim";
    if (dimBefore) return "rise";
    return dimNow ? "fall" : "base";
  };

  step(now: number): FadeStep {
    if (!this.fading) return "idle";
    const t = this.reducedMotion ? 1 : Math.min((now - this.start) / FADE_MS, 1);
    const eased = this.ease(t);
    this.amounts = { base: 0, dim: this.dimFrom + (this.dimTo - this.dimFrom) * eased, rise: 1 - eased, fall: eased };
    if (t < 1) return "fading";
    this.fading = false;
    this.was = this.kept;
    return "settled";
  }
}
