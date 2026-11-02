import { Group } from "three";
import type { CreateMapEngine, Insets, MapEngine, MapObject, PickHit, ScenePalette, StockSlot, ViewMode } from "../types";
import { ContactShadows } from "./contact";
import { Tracker } from "./dispose";
import { readEase } from "./ease";
import { Emphasis } from "./emphasis";
import { Forklift } from "./forklift";
import { Labels } from "./labels";
import { Machines } from "./machines";
import { Overlays } from "./overlays";
import { Picker } from "./pick";
import { PointerInput } from "./pointer";
import { Racks } from "./racks";
import { Rig } from "./rig";
import { box } from "./shapes";
import { Shell } from "./shell";
import { Stage } from "./stage";
import { Stock } from "./stock";

const wallsFor = (view: ViewMode) => (view === "top" ? "down" : view === "walk" ? "up" : "auto");

export const createMapEngine: CreateMapEngine = (container, events, options) => {
  const tracker = new Tracker();
  const ease = readEase();
  const { reducedMotion } = options;
  const stage = new Stage(container, tracker, options.coarse);
  const { renderer } = stage;
  const canvas = renderer.domElement;
  const unitBox = tracker.add(box(1, 1, 1));

  const model = new Group();
  stage.add(model);
  const emphasis = new Emphasis(ease, reducedMotion);
  const shell = new Shell(stage, tracker, ease, reducedMotion);
  const contact = new ContactShadows(model, tracker);
  const racks = new Racks(model, stage.set, tracker, unitBox);
  const machines = new Machines(model, stage.set, tracker);
  const forklift = new Forklift(model, stage.set, tracker, ease);
  const stock = new Stock(stage, tracker, ease, reducedMotion, emphasis.tierOf, unitBox);
  const overlays = new Overlays(model, tracker, ease, reducedMotion);
  const picker = new Picker();
  const labels = new Labels();

  let raf = 0;
  let disposed = false;
  let contextLost = false;
  let frames = 0;
  let width = 0;
  let height = 0;
  let objects: readonly MapObject[] = [];
  let layoutMark = "";
  let editing = false;
  let view: ViewMode = "orbit";
  let viewBeforeEdit: ViewMode = "orbit";
  let selection: PickHit | null = null;
  let calls = 0;
  let shadowCalls = 0;
  let triangles = 0;

  const invalidate = () => {
    if (raf === 0 && !disposed && !contextLost) raf = requestAnimationFrame(tick);
  };

  const rig = new Rig(canvas, stage.floor, tracker, ease, options, invalidate);
  const pointer = new PointerInput(canvas, tracker, rig, picker, events);

  // The shadow pass counts in the same info: the slab draws first, so what is on the clock here is that pass alone.
  shell.slab.onBeforeRender = () => {
    shadowCalls = renderer.info.render.calls;
  };

  function tiers(): void {
    racks.flush(emphasis.tierOf);
    machines.flush(emphasis.tierOf);
    stock.flush();
  }

  function syncSize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    rig.resize(w, h);
  }

  function placeLabels(): void {
    if (width > 0 && height > 0) labels.update(rig.camera, width, height, renderer.getPixelRatio());
  }

  function draw(): void {
    if (width === 0 || height === 0 || contextLost) return;
    shadowCalls = 0;
    renderer.render(stage.scene, rig.camera);
    frames++;
    calls = renderer.info.render.calls - shadowCalls;
    triangles = renderer.info.render.triangles;
    placeLabels();
  }

  function frame(now: number): void {
    syncSize();
    let busy = rig.step(now);

    if (shell.step(now, rig.camera.position)) {
      stage.invalidateShadows();
      busy = true;
    }
    if (stock.step(now)) {
      stage.invalidateShadows();
      busy = true;
    }
    if (forklift.step(now)) {
      rig.setObjects(objects, [forklift.footprint]);
      stage.invalidateShadows();
      busy = true;
    }
    busy = overlays.step(now) || busy;

    const fade = emphasis.step(now);
    if (fade !== "idle") {
      stage.looks.write(emphasis.amounts);
      if (fade === "settled") tiers();
      else busy = true;
    }

    draw();
    if (busy) invalidate();
  }

  function tick(): void {
    raf = 0;
    frame(performance.now());
  }

  tracker.listen(canvas, "webglcontextlost", () => {
    contextLost = true;
    cancelAnimationFrame(raf);
    raf = 0;
  });
  tracker.listen(canvas, "webglcontextrestored", () => {
    contextLost = false;
    stage.restoreStudio();
    stage.invalidateShadows();
    invalidate();
  });

  // setSize clears the canvas and this fires after rAF, so the frame is drawn here and not on the next one.
  const resizeObserver = new ResizeObserver(() => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    frame(performance.now());
  });
  resizeObserver.observe(container);
  syncSize();
  stage.invalidateShadows();

  const engine: MapEngine = {
    setPalette(next: ScenePalette) {
      stage.setPalette(next);
      shell.setPalette(next);
      contact.setStrength(next.contact);
      overlays.setPalette(next);
      stage.invalidateShadows();
      invalidate();
    },

    setLayout(list) {
      const mark = JSON.stringify(list);
      if (mark === layoutMark) return;
      layoutMark = mark;
      objects = list;
      forklift.setObjects(list, { minX: stage.floor.min.x, minZ: stage.floor.min.z, maxX: stage.floor.max.x, maxZ: stage.floor.max.z });
      rig.setObjects(list, [forklift.footprint]);
      pointer.setObjects(list);
      picker.setObjects(list);
      shell.setObjects(list);
      contact.setObjects(list);
      racks.setObjects(list);
      machines.setObjects(list);
      stock.setObjects(list);
      overlays.setObjects(list);
      tiers();
      stage.invalidateShadows();
      invalidate();
    },

    setStock(slots: readonly StockSlot[], animateOptions) {
      if (!stock.setSlots(slots, animateOptions?.animate === true, performance.now())) return;
      stage.invalidateShadows();
      invalidate();
    },

    setView(next) {
      view = next;
      rig.setView(next, performance.now());
      shell.setMode(wallsFor(next));
      invalidate();
    },

    flyTo(target) {
      const object = target ? objects.find((candidate) => candidate.id === target.objectId) : undefined;
      const now = performance.now();
      if (object) rig.flyTo(object, target?.shelf === true, now);
      else if (!target) rig.home(now);
      shell.setMode(wallsFor(view));
      invalidate();
    },

    setSelection(next) {
      selection = next;
      overlays.setSelection(selection, performance.now());
      invalidate();
    },

    setEmphasis(ids) {
      if (!emphasis.set(ids, performance.now())) return;
      tiers();
      invalidate();
    },

    setFootprints(items) {
      overlays.setFootprints(items);
      invalidate();
    },

    setRoutes(routes) {
      overlays.setRoutes(routes);
      invalidate();
    },

    trace(route) {
      overlays.trace(route, performance.now());
      invalidate();
    },

    setForklift(objectId, forkliftOptions) {
      if (!forklift.goTo(objectId, forkliftOptions?.animate === true && !reducedMotion, performance.now())) return;
      rig.setObjects(objects, [forklift.footprint]);
      stage.invalidateShadows();
      invalidate();
    },

    setInsets(insets: Insets) {
      rig.setInsets(insets, performance.now());
      invalidate();
    },

    setLabels(list) {
      labels.set(list);
      syncSize();
      placeLabels();
    },

    setEditing(on) {
      if (on === editing) return;
      editing = on;
      pointer.editing = on;
      if (on) viewBeforeEdit = rig.walking ? "orbit" : "top";
      engine.setView(on ? "top" : viewBeforeEdit);
    },

    renderNow() {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      frame(performance.now());
    },

    stats() {
      const { memory } = renderer.info;
      return { calls, triangles, geometries: memory.geometries, textures: memory.textures, frames };
    },

    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      tracker.removeListeners();
      resizeObserver.disconnect();
      rig.dispose();
      tracker.freeAll();
      renderer.dispose();
      canvas.remove();
      renderer.forceContextLoss();
    },
  };

  return engine;
};
