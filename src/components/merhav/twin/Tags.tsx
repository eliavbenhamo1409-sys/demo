"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { cx } from "@/components/ui";
import type { LabelAnchor, StockState } from "@/lib/map3d/types";
import { useTwin } from "./Twin";

const WORD: Record<Exclude<StockState, "ok">, string> = { low: "מתחת למינימום", out: "אזל", short: "חסר" };

/**
 * Only what is really wrong stands up from the floor, so a warehouse with a few low shelves stays calm: those keep their
 * line on the floor and show a tag under the pointer. React owns each tag, the engine only moves it.
 */
export function Tags(): ReactElement | null {
  const { engine, model, world, flashes, setAnchors, listen } = useTwin();
  const router = useRouter();
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(
    () =>
      listen({
        onHover: (hit) => setHovered(hit?.objectId ?? null),
        onPick: (hit) => {
          if (hit) router.push(`/3d?at=${encodeURIComponent(hit.objectId)}`);
        },
      }),
    [listen, router],
  );

  const needing = useMemo(
    // A movement that lands while you watch stands up over its rack for a moment, whatever state the rack is in.
    () => [...model.byObject.values()].filter((stock) => stock.worst === "out" || stock.worst === "short" || (stock.worst !== "ok" && stock.object.id === hovered) || flashes.has(stock.object.id)),
    [model, hovered, flashes],
  );
  const shown = needing.map((stock) => stock.object.id).join();

  useEffect(() => {
    if (!engine) return;
    const anchors: LabelAnchor[] = [];
    for (const { object } of needing) {
      const el = nodes.current.get(object.id);
      if (el) anchors.push({ el, x: object.x, y: object.h, z: object.z });
    }
    setAnchors(anchors);
    return () => setAnchors([]);
    // Anchors follow which places are tagged, not each new array of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, shown, setAnchors]);

  if (!world) return null;
  return createPortal(
    <div className="mh-tags" aria-hidden="true">
      {needing.map(({ object, worst }) => {
        const flash = flashes.get(object.id);
        return (
          <button
            key={object.id}
            type="button"
            tabIndex={-1}
            ref={(el) => {
              if (el) nodes.current.set(object.id, el);
              else nodes.current.delete(object.id);
            }}
            className={cx("mh-tag", `is-${worst}`)}
            onClick={() => router.push(`/3d?at=${encodeURIComponent(object.id)}`)}
          >
            <span className="mh-tag-body">
              <span className="mh-tag-code ltr">{object.id}</span>
              {worst !== "ok" ? <span className="mh-tag-word">{WORD[worst]}</span> : null}
              {flash ? <span className={cx("ltr", flash.className)}>{flash.text}</span> : null}
            </span>
          </button>
        );
      })}
    </div>,
    world,
  );
}
