"use client";

import { useEffect, useState, type ReactElement } from "react";
import "./thumb-zoom.css";

const THUMBS = "img.sa-thumb, .sa-attention-thumb img, .sa-fault-thumb img";
const LONG_SIDE = 336;
const MARGIN = 12;
/** A mouse crossing a list opens nothing. */
const OPEN_DELAY = 80;
/** The step between two rows, so a mouse running down a column keeps the card open. */
const CLOSE_DELAY = 70;

type Zoom = { src: string; open: boolean; top: number; left: number; width: number; height: number };

const inside = (at: number, size: number, room: number) => Math.min(Math.max(at, MARGIN), room - size - MARGIN);

/** The photo in its own proportions, growing from the thumbnail's start corner over the row, always whole on screen. */
function zoomOf(thumb: HTMLImageElement): Zoom {
  const box = thumb.getBoundingClientRect();
  const long = Math.min(LONG_SIDE, window.innerWidth - MARGIN * 2, window.innerHeight - MARGIN * 2);
  const ratio = thumb.naturalWidth / thumb.naturalHeight;
  const width = ratio >= 1 ? long : long * ratio;
  const height = ratio >= 1 ? long / ratio : long;
  return {
    src: thumb.currentSrc || thumb.src,
    open: true,
    top: inside(box.top - height / 4, height, window.innerHeight),
    left: inside(box.right - width, width, window.innerWidth),
    width,
    height,
  };
}

/** The thumbnail under the mouse. A row's stretched button lies over its thumbnail, so there it is the next thing down. */
function thumbAt(x: number, y: number): HTMLImageElement | null {
  const [top, below] = document.elementsFromPoint(x, y);
  const hit = top instanceof HTMLButtonElement ? below : top;
  // A photo that failed or hasn't loaded has nothing to show large.
  return hit instanceof HTMLImageElement && hit.matches(THUMBS) && hit.naturalWidth > 0 ? hit : null;
}

/**
 * Rest the mouse on a thumbnail and the photo opens large. One card for every list, so a table or a drawer can't clip it.
 * It takes no clicks: the row under it stays what the mouse is on. Phones have no hover, and tapping a row opens the product.
 */
export function ThumbZoom(): ReactElement | null {
  const [zoom, setZoom] = useState<Zoom | null>(null);

  useEffect(() => {
    let timer = 0;
    let thumb: HTMLImageElement | null = null;
    let open = false;

    const show = (target: HTMLImageElement) => {
      open = true;
      setZoom(zoomOf(target));
    };
    // Leaves `thumb` as it is: a card closed by a click or a scroll stays closed until the mouse leaves that thumbnail.
    const close = () => {
      window.clearTimeout(timer);
      if (!open) return;
      open = false;
      setZoom((z) => z && { ...z, open: false });
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      const next = thumbAt(e.clientX, e.clientY);
      if (next === thumb) return;
      thumb = next;
      window.clearTimeout(timer);
      if (next && open) show(next);
      else if (next) timer = window.setTimeout(() => show(next), OPEN_DELAY);
      else if (open) timer = window.setTimeout(close, CLOSE_DELAY);
    };

    const root = document.documentElement;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    document.addEventListener("scroll", close, true);
    root.addEventListener("pointerleave", close);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      document.removeEventListener("scroll", close, true);
      root.removeEventListener("pointerleave", close);
    };
  }, []);

  if (!zoom) return null;
  const { src, open, ...box } = zoom;
  return (
    <span className={open ? "sa-thumb-zoom is-open" : "sa-thumb-zoom"} style={box} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" decoding="sync" />
    </span>
  );
}
