import { DynamicDrawUsage, InstancedMesh, Matrix4, Vector3, Quaternion, type BufferGeometry, type Object3D } from "three";
import type { Tracker } from "./dispose";
import { TIERS, type Look, type Tier } from "./looks";

export type TierOf = (owner: string) => Tier;

const STRIDE = 16;
const FIRST_CAPACITY = 32;

const position = new Vector3();
const scale = new Vector3();
const matrix = new Matrix4();
const UPRIGHT = new Quaternion();

/**
 * One geometry and one look, drawn once per tier in use. Owners are object ids: flush sorts each instance into the
 * mesh of its owner's tier, which is how a selection moves instances without touching the geometry.
 */
export class Batch {
  private matrices = new Float32Array(FIRST_CAPACITY * STRIDE);
  private owners: string[] = [];
  private readonly meshes = new Map<Tier, InstancedMesh>();
  count = 0;

  constructor(
    private readonly parent: Object3D,
    private readonly geometry: BufferGeometry,
    private readonly look: Look,
    private readonly tracker: Tracker,
    private readonly shadows: { cast: boolean; receive: boolean } = { cast: true, receive: true },
  ) {}

  clear(): void {
    this.count = 0;
  }

  add(owner: string, x: number, y: number, z: number, sx: number, sy: number, sz: number): number {
    const index = this.push(owner);
    this.place(index, x, y, z, sx, sy, sz);
    return index;
  }

  addMatrix(owner: string, source: Matrix4): number {
    const index = this.push(owner);
    this.matrices.set(source.elements, index * STRIDE);
    return index;
  }

  place(index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    matrix.compose(position.set(x, y, z), UPRIGHT, scale.set(sx, sy, sz));
    this.matrices.set(matrix.elements, index * STRIDE);
  }

  flush(tierOf: TierOf): void {
    const counts = new Map<Tier, number>(TIERS.map((tier) => [tier, 0]));
    const tiers: Tier[] = [];
    for (let i = 0; i < this.count; i++) {
      const tier = tierOf(this.owners[i]);
      tiers.push(tier);
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    for (const tier of TIERS) this.prepare(tier, counts.get(tier) ?? 0);

    const written = new Map<Tier, number>(TIERS.map((tier) => [tier, 0]));
    for (let i = 0; i < this.count; i++) {
      const tier = tiers[i];
      const mesh = this.meshes.get(tier);
      if (!mesh) continue;
      const slot = written.get(tier) ?? 0;
      mesh.instanceMatrix.array.set(this.matrices.subarray(i * STRIDE, (i + 1) * STRIDE), slot * STRIDE);
      written.set(tier, slot + 1);
    }
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  private push(owner: string): number {
    if ((this.count + 1) * STRIDE > this.matrices.length) {
      const grown = new Float32Array(this.matrices.length * 2);
      grown.set(this.matrices);
      this.matrices = grown;
    }
    this.owners[this.count] = owner;
    return this.count++;
  }

  private prepare(tier: Tier, needed: number): void {
    let mesh = this.meshes.get(tier);
    if (needed === 0 && !mesh) return;
    if (!mesh || mesh.instanceMatrix.count < needed) mesh = this.grow(tier, needed, mesh);
    mesh.count = needed;
    mesh.visible = needed > 0;
  }

  private grow(tier: Tier, needed: number, old: InstancedMesh | undefined): InstancedMesh {
    if (old) {
      old.removeFromParent();
      this.tracker.free(old);
    }
    let capacity = FIRST_CAPACITY;
    while (capacity < needed) capacity *= 2;
    const mesh = this.tracker.add(new InstancedMesh(this.geometry, this.look.materials[tier], capacity));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = this.shadows.cast;
    mesh.receiveShadow = this.shadows.receive;
    this.parent.add(mesh);
    this.meshes.set(tier, mesh);
    return mesh;
  }
}
