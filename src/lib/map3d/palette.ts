import type { ScenePalette } from "./types";

/**
 * Reads the theme now on the page. Call it again when the theme changes: nothing here is cached.
 * Null while the page's stylesheet has not landed: an unset token reads as "", and Number("") is a sky and a sun of
 * zero, which draws the whole building black on a pale stage.
 */
export function readPalette(): ScenePalette | null {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  if (!token("--scene-sky") || !token("--scene-sun")) return null;
  return {
    canvas: token("--scene-canvas"),
    slab: token("--scene-slab"),
    grid: token("--scene-grid"),
    wall: token("--scene-wall"),
    wallTop: token("--scene-wall-top"),
    column: token("--scene-column"),
    door: token("--scene-door"),
    upright: token("--scene-upright"),
    shelf: token("--scene-shelf"),
    shelfEdge: token("--scene-shelf-edge"),
    machine: token("--scene-machine"),
    machineDetail: token("--scene-machine-detail"),
    lane: token("--scene-lane"),
    laneMark: token("--scene-lane-mark"),
    zone: token("--scene-zone"),
    zoneLine: token("--scene-zone-line"),
    ink: token("--text-primary"),
    focus: token("--focus"),
    // The classic themes have no green: their weekly chart runs on this grey.
    chart: token("--chart-bar") || token("--border-control"),
    in: token("--qty-in"),
    out: token("--danger-text"),
    warn: token("--warning"),
    groundShadow: Number(token("--scene-ground-shadow")),
    sky: Number(token("--scene-sky")),
    sun: Number(token("--scene-sun")),
    // Only the aluminium style sets these: unset, classic keeps its own light and no metal.
    sunColor: token("--scene-sun-color"),
    bounce: token("--scene-bounce"),
    studio: Number(token("--scene-studio")),
    metal: Number(token("--scene-metal")),
    contact: Number(token("--scene-contact")),
    forklift: token("--scene-forklift"),
    stock: {
      natural: token("--scene-stock-natural"),
      black: token("--scene-stock-black"),
      white: token("--scene-stock-white"),
      bronze: token("--scene-stock-bronze"),
      roll: token("--scene-stock-roll"),
      canister: token("--scene-stock-canister"),
      carton: token("--scene-stock-carton"),
    },
  };
}
