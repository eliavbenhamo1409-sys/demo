import { Group, Mesh, type BufferGeometry, type Object3D } from "three";
import type { MachineModel, MapObject } from "../types";
import type { TierOf } from "./batch";
import type { Tracker } from "./dispose";
import { arc, box, drumX, drumY, drumZ, merge, prismX, prismZ, rounded, strut, type Profile } from "./shapes";
import type { SceneLooks } from "./stage";

interface Parts {
  body: BufferGeometry[];
  detail: BufferGeometry[];
}

/** A double-head saw: a long bed on legs, two heads with their blade hoods, rollers between them, a console. */
function saw(w: number, d: number, h: number): Parts {
  const body: BufferGeometry[] = [];
  const detail: BufferGeometry[] = [];
  const length = w - 0.2;
  const bedZ = -d * 0.1;
  const bedTop = h * 0.4;
  const bedDepth = d * 0.26;
  const beam = 0.34;

  body.push(rounded(length, beam, bedDepth, 0.03, 0, bedTop - beam, bedZ));
  const legs = 6;
  for (let i = 0; i < legs; i++) {
    const x = -length / 2 + 0.2 + (i * (length - 0.4)) / (legs - 1);
    detail.push(box(0.14, bedTop - beam, bedDepth * 0.8, x, 0, bedZ));
    detail.push(box(0.2, 0.03, bedDepth * 0.9, x, 0, bedZ));
  }
  detail.push(box(length * 0.97, 0.035, 0.05, 0, bedTop, bedZ - bedDepth * 0.42));
  detail.push(box(length * 0.97, 0.035, 0.05, 0, bedTop, bedZ + bedDepth * 0.42));

  const fence = 0.2;
  detail.push(box(length * 0.94, fence, 0.04, 0, bedTop + 0.04, bedZ - bedDepth * 0.28));

  const rollers = 13;
  for (let i = 0; i < rollers; i++) {
    const x = -length * 0.32 + (i * length * 0.64) / (rollers - 1);
    detail.push(drumZ(0.032, bedDepth * 0.66, x, bedTop + 0.05, bedZ + bedDepth * 0.04, 10));
  }

  const hood = arc(0, 0, 0.5, -0.25, Math.PI + 0.25, 16);
  for (const [side, hx] of [
    [1, -length / 2 + 0.75],
    [-1, length / 2 - 0.95],
  ] as const) {
    body.push(rounded(1.0, 0.36, bedDepth * 1.35, 0.03, hx, bedTop + 0.03, bedZ));
    body.push(rounded(0.66, h * 0.3, bedDepth * 0.66, 0.05, hx, bedTop + 0.36, bedZ - bedDepth * 0.28));
    const hoodY = bedTop + 0.9;
    const hoodProfile: Profile = hood.map(([z, y]) => [z + bedZ + bedDepth * 0.12, y + hoodY]);
    body.push(prismX(hoodProfile, 0.2, hx));
    detail.push(prismX(hoodProfile.map(([z, y]) => [z, y - 0.02]), 0.03, hx));
    detail.push(drumX(0.17, 0.52, hx + side * 0.34, hoodY + 0.02, bedZ - bedDepth * 0.12, 16));
    detail.push(drumX(0.1, 0.1, hx + side * 0.65, hoodY + 0.02, bedZ - bedDepth * 0.12, 16));
    for (const offset of [-0.3, 0.3]) {
      detail.push(drumY(0.022, 0.5, hx + offset, bedTop + 0.1, bedZ + bedDepth * 0.5, 8));
      detail.push(drumY(0.05, 0.05, hx + offset, bedTop + 0.56, bedZ + bedDepth * 0.5, 10));
    }
  }

  // The table goods leave on, in front of the bed.
  const tableZ = bedZ + bedDepth / 2 + d * 0.2;
  body.push(box(length * 0.62, 0.07, d * 0.26, 0, bedTop * 0.86, tableZ));
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) detail.push(box(0.06, bedTop * 0.86, 0.06, (x * length * 0.28), 0, tableZ + z * d * 0.1));
  }

  const consoleX = length / 2 - 0.3;
  const consoleZ = d / 2 - 0.35;
  detail.push(drumY(0.04, 1.05, consoleX, 0, consoleZ, 10));
  detail.push(box(0.34, 0.03, 0.3, consoleX, 0, consoleZ));
  body.push(rounded(0.46, 0.32, 0.12, 0.02, consoleX, 1.05, consoleZ).rotateX(-0.3).translate(0, 0.32, 0.3));
  return { body, detail };
}

/** A machining centre: an enclosure with doors, a spindle housing behind them, a chip conveyor, a cabinet, a pendant. */
function cnc(w: number, d: number, h: number): Parts {
  const body: BufferGeometry[] = [];
  const detail: BufferGeometry[] = [];
  const width = w * 0.7;
  const depth = d * 0.72;
  const cx = -w * 0.11;
  const cz = d * 0.06;
  const front = cz + depth / 2;
  const plinth = 0.14;
  const wallTop = h * 0.76;

  detail.push(box(width * 0.98, plinth, depth * 0.98, cx, 0, cz));
  body.push(rounded(width, wallTop - plinth, depth, 0.05, cx, plinth, cz));
  body.push(rounded(width * 0.62, h - wallTop + 0.02, depth * 0.6, 0.06, cx - width * 0.08, wallTop - 0.02, cz - depth * 0.14));
  body.push(rounded(width * 0.98, 0.1, depth * 0.98, 0.04, cx, wallTop - 0.04, cz));

  const doorY = plinth + 0.34;
  const doorH = wallTop - plinth - 0.62;
  const doorW = width * 0.3;
  for (const side of [-1, 1]) {
    const x = cx + side * (doorW / 2 + 0.03);
    detail.push(box(doorW, doorH, 0.03, x, doorY, front + 0.005));
    body.push(box(doorW * 0.74, doorH * 0.62, 0.03, x, doorY + doorH * 0.26, front + 0.022));
    detail.push(drumY(0.014, 0.42, cx + side * 0.09, doorY + doorH * 0.32, front + 0.07, 8));
  }
  detail.push(box(width * 0.66, 0.05, 0.05, cx, doorY + doorH + 0.03, front + 0.01));
  detail.push(box(width * 0.66, 0.05, 0.05, cx, doorY - 0.06, front + 0.01));

  // The conveyor rises from the floor at the side of the machine and tips into a bin.
  const convL = cx + width / 2;
  const conveyor: Profile = [
    [convL - 0.1, 0.1],
    [convL + 0.7, 0.1],
    [w / 2 - 0.1, 1.1],
    [w / 2 - 0.1, 1.32],
    [w / 2 - 0.38, 1.32],
    [convL + 0.5, 0.42],
    [convL - 0.1, 0.42],
  ];
  body.push(prismZ(conveyor, 0.54, cz + depth * 0.14));
  detail.push(box(0.5, 0.6, 0.66, w / 2 - 0.27, 0, cz + depth * 0.14));

  const cabinetW = width * 0.42;
  body.push(rounded(cabinetW, h * 0.84, d * 0.16, 0.03, cx + width * 0.24, 0, cz - depth / 2 - d * 0.08));
  detail.push(box(0.03, h * 0.7, 0.012, cx + width * 0.24, h * 0.07, cz - depth / 2 - d * 0.16 + d * 0.16 + 0.002));
  detail.push(box(width * 0.3, 0.46, d * 0.14, cx - width * 0.26, 0, cz - depth / 2 - d * 0.07));

  const armX = cx + width / 2 + 0.05;
  detail.push(strut([armX, wallTop - 0.1, front - 0.3], [armX + 0.18, wallTop - 0.3, front + 0.28], 0.07));
  body.push(rounded(0.52, 0.42, 0.11, 0.02, armX + 0.2, wallTop - 0.72, front + 0.32).rotateX(-0.14).translate(0, 0.1, 0.1));
  return { body, detail };
}

/** A press brake: two C frames, the ram and the bed between their throats, cylinders on top, a back gauge, a pedal. */
function press(w: number, d: number, h: number): Parts {
  const body: BufferGeometry[] = [];
  const detail: BufferGeometry[] = [];
  const back = -d * 0.42;
  const nose = d * 0.3;
  const throatLow = h * 0.4;
  const throatHigh = h * 0.56;
  const frame: Profile = [
    [back, 0],
    [nose, 0],
    [nose, throatLow],
    [back * 0.1, throatLow],
    [back * 0.1, throatHigh],
    [nose, throatHigh],
    [nose, h * 0.94],
    [nose - 0.12, h],
    [back, h],
  ];
  const frameX = w / 2 - 0.34;
  for (const side of [-1, 1]) {
    body.push(prismX(frame, 0.13, side * frameX));
    detail.push(drumY(0.13, h * 0.26, side * frameX, h * 0.82, nose * 0.34, 16));
    detail.push(rounded(0.42, 0.05, 0.42, 0.012, side * frameX, h * 0.8, nose * 0.34));
    detail.push(box(0.32, 0.03, d * 0.4, side * frameX, 0, nose * 0.1));
  }

  const beamWidth = w - 0.5;
  const beamZ = nose * 0.72;
  const beamDepth = 0.17;
  body.push(box(beamWidth, throatLow - 0.02, beamDepth, 0, 0.02, beamZ));
  detail.push(box(beamWidth * 0.94, 0.05, 0.1, 0, throatLow, beamZ));
  detail.push(box(beamWidth * 0.9, 0.05, 0.05, 0, throatLow + 0.05, beamZ));

  const ramBase = throatHigh - 0.12;
  body.push(box(beamWidth, h * 0.94 - ramBase - 0.02, beamDepth, 0, ramBase + 0.02, beamZ));
  detail.push(box(beamWidth * 0.9, 0.05, 0.03, 0, ramBase - 0.05, beamZ));

  body.push(rounded(beamWidth * 0.9, h * 0.15, 0.4, 0.03, 0, h * 0.85, back * 0.56));
  detail.push(box(beamWidth * 0.96, 0.05, 0.05, 0, throatLow + 0.1, back * 0.42));
  for (const side of [-1, 1]) detail.push(box(0.05, throatLow + 0.1, 0.05, side * beamWidth * 0.46, 0, back * 0.42));

  for (const side of [-1, 1]) {
    detail.push(box(0.09, 0.05, d / 2 - beamZ - 0.04, side * w * 0.26, throatLow - 0.05, (d / 2 + beamZ) / 2 + 0.02));
    detail.push(box(0.05, throatLow - 0.05, 0.05, side * w * 0.26, 0, d / 2 - 0.07));
  }

  detail.push(rounded(0.34, 0.11, 0.26, 0.02, 0, 0, d / 2 - 0.2));
  const consoleX = w / 2 - 0.05;
  detail.push(box(0.06, 0.06, 0.5, consoleX, h * 0.72, nose * 0.5));
  body.push(rounded(0.44, 0.34, 0.1, 0.02, consoleX - 0.12, h * 0.58, nose * 0.5 + 0.28));
  return { body, detail };
}

/** A plain enclosure with a service door, for a machine no one has modelled. */
function generic(w: number, d: number, h: number): Parts {
  const body = [rounded(w * 0.92, h * 0.9, d * 0.92, 0.05, 0, h * 0.06, 0), rounded(w * 0.7, h * 0.08, d * 0.7, 0.03, 0, h * 0.92, 0)];
  const detail = [
    box(w * 0.88, h * 0.06, d * 0.88),
    box(w * 0.4, h * 0.62, 0.025, -w * 0.12, h * 0.16, d * 0.46),
    box(w * 0.2, h * 0.34, 0.025, w * 0.26, h * 0.44, d * 0.46),
  ];
  return { body, detail };
}

const MODELS: Record<MachineModel, (w: number, d: number, h: number) => Parts> = { saw, cnc, press, generic };

interface Built {
  mark: string;
  group: Group;
  body: Mesh;
  detail: Mesh;
}

/** One group per machine, its two tones merged. Choosing a machine swaps its materials; nothing else needs to move. */
export class Machines {
  private readonly built = new Map<string, Built>();

  constructor(
    private readonly parent: Object3D,
    private readonly looks: SceneLooks,
    private readonly tracker: Tracker,
  ) {}

  setObjects(objects: readonly MapObject[]): void {
    const machines = objects.filter((object) => object.kind === "machine");
    for (const [id, built] of this.built) {
      if (machines.some((machine) => machine.id === id)) continue;
      this.remove(built);
      this.built.delete(id);
    }
    for (const machine of machines) {
      const mark = `${machine.model ?? "generic"}/${machine.w}/${machine.d}/${machine.h}`;
      let built = this.built.get(machine.id);
      if (built && built.mark !== mark) {
        this.remove(built);
        built = undefined;
      }
      if (!built) {
        built = this.build(machine, mark);
        this.built.set(machine.id, built);
      }
      built.group.position.set(machine.x, 0, machine.z);
    }
  }

  flush(tierOf: TierOf): void {
    for (const [id, built] of this.built) {
      const tier = tierOf(id);
      built.body.material = this.looks.machine.materials[tier];
      built.detail.material = this.looks.machineDetail.materials[tier];
    }
  }

  private build(machine: MapObject, mark: string): Built {
    const { body, detail } = MODELS[machine.model ?? "generic"](machine.w, machine.d, machine.h);
    const group = new Group();
    const mesh = (parts: BufferGeometry[], material: Mesh["material"]) => {
      const part = new Mesh(this.tracker.add(merge(parts)), material);
      part.castShadow = true;
      part.receiveShadow = true;
      part.frustumCulled = false;
      group.add(part);
      return part;
    };
    const built = { mark, group, body: mesh(body, this.looks.machine.base), detail: mesh(detail, this.looks.machineDetail.base) };
    this.parent.add(group);
    return built;
  }

  private remove({ group, body, detail }: Built): void {
    group.removeFromParent();
    this.tracker.free(body.geometry);
    this.tracker.free(detail.geometry);
  }
}
