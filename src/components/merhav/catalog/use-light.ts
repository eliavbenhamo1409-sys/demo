"use client";

import { useMemo, useRef, type FocusEvent, type PointerEvent } from "react";

const HOST = "data-lit";
const ON = "data-on";

interface Light {
  onPointerOver: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
}

/**
 * Lights a path through the bay and lets the rest recede. It writes attributes straight onto the rows it needs, so
 * pointing at one line out of hundreds never re-renders the list: one event, a handful of attributes, CSS does the rest.
 */
export function useLight(): Light {
  const lit = useRef<Element[]>([]);
  const at = useRef<string | null>(null);
  const stop = useRef<(() => void) | null>(null);

  return useMemo(() => {
    const clear = (host: Element) => {
      for (const el of lit.current) el.removeAttribute(ON);
      lit.current = [];
      at.current = null;
      host.removeAttribute(HOST);
      stop.current?.();
      stop.current = null;
    };

    // The list moving under a still pointer is not pointing at anything.
    const release = (host: Element) => {
      if (stop.current) return;
      const onScroll = () => clear(host);
      window.addEventListener("scroll", onScroll, { passive: true });
      stop.current = () => window.removeEventListener("scroll", onScroll);
    };

    const mark = (el: Element | null | undefined, value: string) => {
      if (!el) return;
      el.setAttribute(ON, value);
      lit.current.push(el);
    };

    const name = (row: Element) => {
      const band = row.closest("[data-band]");
      mark(row, "on");
      mark(band, "name");
      mark(band?.querySelector(`[data-wire="${row.getAttribute("data-name")}"]`), "on");
    };

    const point = (target: EventTarget, host: Element) => {
      if (!(target instanceof Element)) return;
      const word = target.closest("[data-sup]");
      const row = target.closest("[data-name]");
      const band = target.closest("[data-band]");
      const next = word ? `w${word.getAttribute("data-sup")}` : row ? `n${row.getAttribute("data-name")}` : band ? `b${band.getAttribute("data-band")}` : null;
      if (next === at.current) return;
      clear(host);
      if (!next) return;
      at.current = next;
      host.setAttribute(HOST, "");
      release(host);
      if (word) for (const each of host.querySelectorAll(`[data-supplier="${word.getAttribute("data-sup")}"]`)) name(each);
      else if (row) name(row);
      else mark(band, "band");
    };

    return {
      onPointerOver: (e) => {
        if (e.pointerType !== "touch") point(e.target, e.currentTarget);
      },
      onPointerLeave: (e) => clear(e.currentTarget),
      // Only a keyboard walks the list by focus; a focus left behind by a press must not keep the bay dimmed.
      onFocus: (e) => {
        if (e.target.matches(":focus-visible")) point(e.target, e.currentTarget);
      },
      onBlur: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) clear(e.currentTarget);
      },
    };
  }, []);
}
