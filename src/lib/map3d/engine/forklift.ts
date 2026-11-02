import { Group, Mesh, TorusGeometry, type BufferGeometry, type Object3D } from "three";
import type { MapObject } from "../types";
import type { Tracker } from "./dispose";
import { arc, box, drumX, drumY, merge, prismX, rounded, strut, tyre, type Profile } from "./shapes";
import type { SceneLooks } from "./stage";

const WHEELBASE = 1.5;
const FRONT_TYRE = 0.33;
const REAR_TYRE = 0.26;
const TRACK = 0.95;
/** Forks point to -z. The front axle stands at z = -0.75, so the machine balances on its own origin. */
const FRONT_AXLE = -WHEELBASE / 2;
const REAR_AXLE = WHEELBASE / 2;
const MAST_TILT = -0.05;
/** Where it stands and how far off square, as a driver leaves it. */
const PARKED_ANGLE = 0.32;
const CLEARANCE = 1.6;

function hull(): BufferGeometry {
  const profile: Profile = [
    [FRONT_AXLE - 0.46, 0.78],
    [FRONT_AXLE - 0.46, 0.5],
    ...arc(FRONT_AXLE, FRONT_TYRE, 0.42, Math.PI * 0.88, Math.PI * 0.08, 10),
    [FRONT_AXLE + 0.46, 0.2],
    [REAR_AXLE - 0.36, 0.2],
    ...arc(REAR_AXLE, REAR_TYRE, 0.34, Math.PI, Math.PI * 0.05, 10),
    [REAR_AXLE + 0.5, 0.22],
    [REAR_AXLE + 0.62, 0.34],
    [REAR_AXLE + 0.66, 0.5],
    [REAR_AXLE + 0.66, 0.9],
    [REAR_AXLE + 0.58, 1.02],
    [REAR_AXLE + 0.36, 1.08],
    [FRONT_AXLE + 1.58, 1.08],
    [FRONT_AXLE + 1.5, 1.0],
    [FRONT_AXLE + 1.46, 0.82],
    [FRONT_AXLE + 0.2, 0.66],
    [FRONT_AXLE - 0.1, 0.72],
  ];
  return prismX(profile, 1.08);
}

function overheadGuard(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const roof = 2.12;
  const [front, rear] = [FRONT_AXLE + 0.32, REAR_AXLE + 0.42];
  const half = 0.5;
  for (const side of [-1, 1]) {
    const x = side * half;
    parts.push(strut([x, 0.74, FRONT_AXLE - 0.32], [x, roof, front], 0.065, 0.075));
    parts.push(strut([x, 1.0, rear], [x, roof, rear], 0.065, 0.075));
    parts.push(box(0.07, 0.05, rear - front + 0.07, x, roof, (front + rear) / 2));
  }
  parts.push(box(2 * half + 0.07, 0.05, 0.07, 0, roof, front));
  parts.push(box(2 * half + 0.07, 0.05, 0.07, 0, roof, rear));
  const slats = 7;
  for (let i = 0; i < slats; i++) parts.push(box(0.03, 0.03, rear - front, -half + 0.13 + (i * (2 * half - 0.26)) / (slats - 1), roof + 0.012, (front + rear) / 2));
  return parts;
}

function mast(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const height = 2.22;
  for (const side of [-1, 1]) {
    parts.push(box(0.05, height, 0.14, side * 0.36));
    parts.push(box(0.1, height, 0.02, side * 0.34, 0, -0.06));
    parts.push(box(0.1, height, 0.02, side * 0.34, 0, 0.06));
    parts.push(box(0.05, height - 0.1, 0.09, side * 0.26, 0.06));
    parts.push(box(0.014, height - 0.3, 0.03, side * 0.13, 0.2, -0.015));
  }
  parts.push(box(0.76, 0.1, 0.12, 0, height - 0.1));
  parts.push(box(0.76, 0.14, 0.12, 0, 0.1));
  parts.push(box(0.76, 0.08, 0.1, 0, height * 0.54));
  parts.push(drumY(0.05, height - 0.28, 0, 0.16, 0.02, 14));
  parts.push(drumX(0.055, 0.5, 0, height - 0.02, -0.02, 14));
  return parts;
}

function carriage(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const width = 1.04;
  const z = -0.15;
  parts.push(box(width, 0.09, 0.05, 0, 0.1, z));
  parts.push(box(width, 0.09, 0.05, 0, 0.58, z));
  parts.push(box(width, 0.05, 0.04, 0, 1.3, z));
  const bars = 7;
  for (let i = 0; i < bars; i++) parts.push(box(0.04, 0.74, 0.03, -width / 2 + 0.02 + (i * (width - 0.04)) / (bars - 1), 0.62, z));
  const blade: Profile = [
    [z, 0.72],
    [z - 0.05, 0.72],
    [z - 0.05, 0.06],
    [z - 1.14, 0.02],
    [z - 1.16, 0.012],
    [z - 1.14, 0.006],
    [z - 0.02, 0.006],
    [z, 0.03],
  ];
  for (const side of [-1, 1]) parts.push(prismX(blade, 0.1, side * 0.3));
  return parts;
}

function bodyParts(): BufferGeometry[] {
  const dashZ = FRONT_AXLE - 0.34;
  const axle = (x: number, z: number, r: number) => drumX(r * 0.56, 0.12, x * 1.002, r, z, 18);
  return [
    hull(),
    rounded(0.84, 0.62, 0.22, 0.05, 0, 0.72, dashZ).rotateX(0.16).translate(0, -0.12, -0.06),
    rounded(0.98, 0.1, 0.5, 0.03, 0, 1.0, REAR_AXLE + 0.1),
    axle(TRACK / 2 + 0.05, FRONT_AXLE, FRONT_TYRE),
    axle(-TRACK / 2 - 0.05, FRONT_AXLE, FRONT_TYRE),
    axle(TRACK / 2 + 0.03, REAR_AXLE, REAR_TYRE),
    axle(-TRACK / 2 - 0.03, REAR_AXLE, REAR_TYRE),
  ];
}

function darkParts(): BufferGeometry[] {
  const seatZ = FRONT_AXLE + 1.08;
  const wheel = new TorusGeometry(0.16, 0.014, 8, 24).rotateX(Math.PI / 2 + 0.5).translate(0, 1.28, FRONT_AXLE + 0.22);
  const mastZ = FRONT_AXLE - 0.54;
  return [
    tyre(FRONT_TYRE, 0.24, TRACK / 2, FRONT_TYRE, FRONT_AXLE),
    tyre(FRONT_TYRE, 0.24, -TRACK / 2, FRONT_TYRE, FRONT_AXLE),
    tyre(REAR_TYRE, 0.18, TRACK / 2 - 0.02, REAR_TYRE, REAR_AXLE),
    tyre(REAR_TYRE, 0.18, -TRACK / 2 + 0.02, REAR_TYRE, REAR_AXLE),
    rounded(0.5, 0.11, 0.48, 0.04, 0, 1.08, seatZ),
    rounded(0.48, 0.56, 0.1, 0.04, 0, 1.14, seatZ + 0.27).rotateX(0.14).translate(0, -0.2, 0.02),
    strut([0, 0.94, FRONT_AXLE - 0.2], [0, 1.26, FRONT_AXLE + 0.2], 0.035),
    wheel,
    ...overheadGuard(),
    ...[...mast(), ...carriage()].map((part) => part.rotateX(MAST_TILT).translate(0, 0, mastZ)),
  ];
}

/** Picks a clear spot on the floor: a parked machine must not stand inside anything a layout puts there. */
function parking(objects: readonly MapObject[], floor: { minX: number; minZ: number; maxX: number; maxZ: number }): readonly [number, number] {
  const free = (x: number, z: number) =>
    objects.every((o) => o.kind === "zone" || Math.abs(x - o.x) > o.w / 2 + CLEARANCE || Math.abs(z - o.z) > o.d / 2 + CLEARANCE);
  for (let x = 35; x < floor.maxX - 2; x += 1) {
    for (let z = 12; z > floor.minZ + 2; z -= 1) if (free(x, z)) return [x, z];
  }
  return [floor.minX + 3, floor.maxZ - 3];
}

/** Graphite, modelled and parked. It has no data behind it, so it never moves. */
export class Forklift {
  private readonly group = new Group();

  constructor(parent: Object3D, looks: SceneLooks, tracker: Tracker) {
    const add = (parts: BufferGeometry[], material: Mesh["material"]) => {
      const mesh = new Mesh(tracker.add(merge(parts)), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    };
    add(bodyParts(), looks.forkliftBody.base);
    add(darkParts(), looks.forkliftDark.base);
    this.group.rotation.y = PARKED_ANGLE;
    parent.add(this.group);
  }

  /** Returns the box a person walking the floor must go around. */
  place(objects: readonly MapObject[], floor: { minX: number; minZ: number; maxX: number; maxZ: number }): { x: number; z: number; w: number; d: number } {
    const [x, z] = parking(objects, floor);
    this.group.position.set(x, 0, z);
    return { x, z, w: 2, d: 4.6 };
  }
}
