"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Asks Twin to fit the model again: it reads the frame's box on every window resize. */
const refit = () => window.dispatchEvent(new Event("resize"));

/**
 * Where the model shows through the page. Nothing is painted on it and the pointer reaches the model; Twin (door "frame")
 * fits the model into its box and follows it through any change of size or place. One frame per page.
 */
/** Pixels the floor's empty corners may run under what stands around the box. */
export function ModelFrame({ className, style, bleed, children }: { className?: string; style?: CSSProperties; bleed?: number; children?: ReactNode }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    refit();
    const watcher = new ResizeObserver(refit);
    watcher.observe(el);
    // A frame on a page that scrolls moves with it, and the model follows: the workspace scrolls on a desk, the document on a
    // phone, and a capture listener on the document hears both.
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refit);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      watcher.disconnect();
      document.removeEventListener("scroll", onScroll, { capture: true });
      cancelAnimationFrame(frame);
      refit();
    };
  }, []);

  return (
    <div ref={ref} className={cx("at-frame", className)} style={style} data-twin-frame data-twin-bleed={bleed || undefined}>
      {children}
    </div>
  );
}
