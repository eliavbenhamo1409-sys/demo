import { BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Quaternion, Shape, Vector2, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type Profile = readonly (readonly [number, number])[];

/** Every box takes its centre on the floor and its base height: things in this model stand on something. */
export const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): BufferGeometry => new BoxGeometry(w, h, d).translate(x, y + h / 2, z);

export const rounded = (w: number, h: number, d: number, r: number, x = 0, y = 0, z = 0): BufferGeometry =>
  new RoundedBoxGeometry(w, h, d, 2, r).translate(x, y + h / 2, z);

export const drumY = (r: number, h: number, x = 0, y = 0, z = 0, segments = 20): BufferGeometry =>
  new CylinderGeometry(r, r, h, segments).translate(x, y + h / 2, z);

export const drumX = (r: number, length: number, x = 0, y = 0, z = 0, segments = 20): BufferGeometry =>
  new CylinderGeometry(r, r, length, segments).rotateZ(Math.PI / 2).translate(x, y, z);

export const drumZ = (r: number, length: number, x = 0, y = 0, z = 0, segments = 20): BufferGeometry =>
  new CylinderGeometry(r, r, length, segments).rotateX(Math.PI / 2).translate(x, y, z);

/** A bar of square section between two points. */
export function strut(from: readonly [number, number, number], to: readonly [number, number, number], width: number, depth = width): BufferGeometry {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const span = b.clone().sub(a);
  const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), span.clone().normalize());
  const middle = a.add(b).multiplyScalar(0.5);
  return new BoxGeometry(width, span.length(), depth).applyQuaternion(turn).translate(middle.x, middle.y, middle.z);
}

function shapeOf(profile: Profile): Shape {
  return new Shape(profile.map(([a, b]) => new Vector2(a, b)));
}

/** A side view (z, y) pushed along x. */
export function prismX(profile: Profile, width: number, x = 0): BufferGeometry {
  const extruded = new ExtrudeGeometry(shapeOf(profile), { depth: width, bevelEnabled: false, curveSegments: 1 });
  return extruded.rotateY(-Math.PI / 2).translate(x + width / 2, 0, 0);
}

/** A front view (x, y) pushed along z. */
export function prismZ(profile: Profile, depth: number, z = 0): BufferGeometry {
  const extruded = new ExtrudeGeometry(shapeOf(profile), { depth, bevelEnabled: false, curveSegments: 1 });
  return extruded.translate(0, 0, z - depth / 2);
}

/** Points along an arc in the plane of a profile, angles in radians. */
export function arc(cx: number, cy: number, r: number, from: number, to: number, steps: number): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = from + ((to - from) * i) / steps;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}

/** A tyre with rounded shoulders, its axle along x. */
export function tyre(radius: number, width: number, x = 0, y = 0, z = 0, segments = 28): BufferGeometry {
  const half = width / 2;
  const shoulder = width * 0.18;
  const bore = radius * 0.62;
  const points = [
    new Vector2(bore, -half),
    new Vector2(radius - shoulder, -half),
    new Vector2(radius - shoulder * 0.3, -half + shoulder * 0.3),
    new Vector2(radius, -half + shoulder),
    new Vector2(radius, half - shoulder),
    new Vector2(radius - shoulder * 0.3, half - shoulder * 0.3),
    new Vector2(radius - shoulder, half),
    new Vector2(bore, half),
  ];
  return new LatheGeometry(points, segments).rotateZ(Math.PI / 2).translate(x, y, z);
}

/** mergeGeometries refuses a mix of indexed and flat parts, and extrusions are always flat. */
export function merge(parts: readonly BufferGeometry[]): BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(flat, false);
  for (const part of parts) part.dispose();
  return merged;
}
