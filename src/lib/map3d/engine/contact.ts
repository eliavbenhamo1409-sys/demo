import { BufferAttribute, BufferGeometry, DataTexture, LinearFilter, Mesh, MeshBasicMaterial, RGBAFormat, type Object3D } from "three";
import type { MapObject } from "../types";
import type { Tracker } from "./dispose";

/** Metres the pool reaches past a footprint, and as far in it comes to its full strength. */
const REACH = 0.6;
/** Over the painted floor and under what is drawn on it. */
const POOL_Y = 0.036;
const TEXTURE_SIZE = 64;

const STANDS: ReadonlySet<MapObject["kind"]> = new Set(["rack", "machine"]);

const fade = (t: number) => t * t * (3 - 2 * t);

/** Opaque in the middle, gone at every edge. The colour stays zero, so a pool only ever darkens. */
function softSquare(): DataTexture {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const edge = (i: number) => fade(1 - Math.abs((i + 0.5) / TEXTURE_SIZE - 0.5) * 2);
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) data[(y * TEXTURE_SIZE + x) * 4 + 3] = Math.round(edge(x) * edge(y) * 255);
  }
  const texture = new DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, RGBAFormat);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A rail of four stops: the soft edges keep their width in metres however long the footprint runs. */
function stops(center: number, size: number): number[] {
  const near = center - size / 2;
  const far = center + size / 2;
  return [near - REACH, Math.min(near + REACH, center), Math.max(far - REACH, center), far + REACH];
}

const SLICE_UV = [0, 0.5, 0.5, 1];

/**
 * The dark a thing keeps close to the floor, which a sun this high never draws. It is what stands a rack on the slab
 * instead of hovering over it. One draw call; the shadow map stays as it is.
 */
export class ContactShadows {
  private readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;

  constructor(parent: Object3D, private readonly tracker: Tracker) {
    const material = tracker.add(new MeshBasicMaterial({ map: tracker.add(softSquare()), transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    this.mesh = new Mesh(tracker.add(new BufferGeometry()), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  setStrength(opacity: number): void {
    this.mesh.material.opacity = opacity;
    this.mesh.visible = opacity > 0;
  }

  setObjects(objects: readonly MapObject[]): void {
    const standing = objects.filter((o) => STANDS.has(o.kind));
    const positions = new Float32Array(standing.length * 16 * 3);
    const uvs = new Float32Array(standing.length * 16 * 2);
    const index: number[] = [];
    standing.forEach((o, n) => {
      const xs = stops(o.x, o.w);
      const zs = stops(o.z, o.d);
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 4; column++) {
          const at = n * 16 + row * 4 + column;
          positions.set([xs[column], POOL_Y, zs[row]], at * 3);
          uvs.set([SLICE_UV[column], SLICE_UV[row]], at * 2);
          if (row < 3 && column < 3) index.push(at, at + 4, at + 5, at, at + 5, at + 1);
        }
      }
    });
    const geometry = this.tracker.add(new BufferGeometry());
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    this.tracker.free(this.mesh.geometry);
    this.mesh.geometry = geometry;
  }
}
