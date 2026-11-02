import { Color, MeshStandardMaterial, type MeshStandardMaterialParameters } from "three";
import type { Tracker } from "./dispose";

/**
 * Selection is by subtraction. An object that recedes moves to a tier: one more set of materials sharing the base
 * program, so a fade only writes uniforms and never compiles. `dim` holds everything at rest, `rise` and `fall` carry
 * the two objects that trade places when the selection moves.
 */
export type Tier = "base" | "dim" | "rise" | "fall";

export const TIERS: readonly Tier[] = ["base", "dim", "rise", "fall"];

/** How far toward the canvas a receded material travels. */
export const RECEDE = 0.62;

export type Amounts = Readonly<Record<Tier, number>>;

/**
 * `tier`: the object moves between materials. `whole`: nothing here can be chosen, so the one material fades with the
 * dim amount. `fixed`: never recedes, as the floor keeps the plan anchored.
 */
export type Recede = "tier" | "whole" | "fixed";

interface LookOptions extends MeshStandardMaterialParameters {
  recede?: Recede;
}

export class Look {
  readonly materials: Record<Tier, MeshStandardMaterial>;
  private readonly color: Color;
  readonly recede: Recede;

  constructor({ recede = "tier", ...params }: LookOptions, tracker: Tracker) {
    const base = tracker.add(new MeshStandardMaterial(params));
    const clone = () => (recede === "tier" ? tracker.add(base.clone()) : base);
    this.materials = { base, dim: clone(), rise: clone(), fall: clone() };
    this.color = base.color.clone();
    this.recede = recede;
  }

  get base(): MeshStandardMaterial {
    return this.materials.base;
  }

  setColor(value: string): void {
    this.color.set(value);
  }

  /** A uniform, on every tier, so a change of theme compiles nothing. */
  setMetal(value: number): void {
    for (const tier of TIERS) this.materials[tier].metalness = value;
  }

  write(amounts: Amounts, canvas: Color, alone: number): void {
    if (this.recede === "fixed") this.base.color.copy(this.color);
    else if (this.recede === "whole") this.base.color.copy(this.color).lerp(canvas, RECEDE * amounts.dim);
    else {
      const recede = RECEDE + (1 - RECEDE) * alone;
      for (const tier of TIERS) this.materials[tier].color.copy(this.color).lerp(canvas, recede * amounts[tier]);
      this.materials.dim.visible = alone < 1;
    }
  }
}

const AT_REST: Amounts = { base: 0, dim: 0, rise: 0, fall: 0 };

export class Looks {
  private readonly looks: Look[] = [];
  private readonly canvas = new Color("#eef0ec");
  private amounts: Amounts = AT_REST;
  private alone = 0;

  constructor(private readonly tracker: Tracker) {}

  add(options: LookOptions): Look {
    const look = new Look(options, this.tracker);
    this.looks.push(look);
    return look;
  }

  setCanvas(value: string): void {
    this.canvas.set(value);
  }

  /** At 1 what has receded has reached the canvas and leaves, so a rack's close view holds no cut pieces of its neighbours. */
  setAlone(alone: number): boolean {
    if (alone === this.alone) return false;
    this.alone = alone;
    return true;
  }

  /** Writes every colour again, after a palette change or on each step of a fade. */
  write(amounts: Amounts = this.amounts): void {
    this.amounts = amounts;
    for (const look of this.looks) look.write(amounts, this.canvas, this.alone);
  }
}
