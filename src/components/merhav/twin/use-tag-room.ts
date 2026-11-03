"use client";

import { useEffect } from "react";

/** The air kept between two tags, and between a tag and the edge of the band. */
const AIR = 3;
/** How much of a tag must stay over its rack's stem. */
const FOOT = 8;
/** How long the model rests before its tags settle. */
const REST_MS = 120;
const PASSES = 6;

interface Box {
  el: HTMLElement;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** How far it leans now. */
  at: number;
}

/**
 * On a phone or a tablet the model is narrower than a row of tags, so neighbours would stand on each other and hide each
 * other's words, and one by the edge would be cut. Once the model rests, tags that touch lean apart along their line, as
 * far as a tag can lean and still stand on its own rack. A desk has the room, and there a tag stays centred.
 */
export function useTagRoom(world: HTMLElement | null): void {
  useEffect(() => {
    if (!world) return;
    const narrow = window.matchMedia("(max-width: 1099px)");
    const leaning = new WeakMap<HTMLElement, number>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = () => {
      if (!narrow.matches) return;
      const edge = world.getBoundingClientRect();
      const boxes: Box[] = [];
      for (const el of world.querySelectorAll<HTMLElement>(".mh-tag-body, .m3d-tag")) {
        const box = el.getBoundingClientRect();
        if (box.width === 0) continue;
        const was = leaning.get(el) ?? 0;
        boxes.push({ el, left: box.left - was, right: box.right - was, top: box.top, bottom: box.bottom, at: 0 });
      }

      const lean = (box: Box, by: number) => {
        const reach = (box.right - box.left) / 2 - FOOT;
        const on = Math.min(Math.max(box.at + by, -reach), reach);
        box.at = Math.min(Math.max(on, edge.left + AIR - box.left), edge.right - AIR - box.right);
      };

      for (const box of boxes) lean(box, 0);
      for (let pass = 0; pass < PASSES; pass += 1) {
        boxes.sort((a, b) => a.left + a.at - (b.left + b.at));
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const [a, b] = [boxes[i], boxes[j]];
            const over = a.right + a.at + AIR - (b.left + b.at);
            if (over > 0 && a.top < b.bottom && b.top < a.bottom) {
              lean(a, -over / 2);
              lean(b, over / 2);
            }
          }
        }
      }

      for (const box of boxes) {
        const at = Math.round(box.at);
        if (at === (leaning.get(box.el) ?? 0)) continue;
        leaning.set(box.el, at);
        box.el.style.setProperty("--lean", `${at}px`);
      }
    };

    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, REST_MS);
    };

    // The engine writes every tag's place on each frame it moves, so a quiet tree is a model at rest.
    const watcher = new MutationObserver(later);
    watcher.observe(world, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] });
    later();
    return () => {
      clearTimeout(timer);
      watcher.disconnect();
    };
  }, [world]);
}
