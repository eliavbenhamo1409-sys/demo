"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import type { LabelAnchor, MapEngine, MapObject } from "@/lib/map3d/types";

export interface LabelView {
  id: string;
  code: string;
  /** The figure, or a count of products. */
  text?: string;
  textClass?: string;
  word?: string;
  wordClass?: string;
  /** Read on hover and on selection only. */
  more?: string;
  /** Lies on the floor, so it stands on no stem. */
  flat?: boolean;
  /** Stands low: shown in plan, on hover and when the map keeps it in front. */
  minor?: boolean;
  quiet: boolean;
  attention: boolean;
}

/** The signed figure of a movement that just happened. */
export interface LabelFlash {
  text: string;
  className?: string;
}

interface LabelsProps {
  engine: MapEngine | null;
  objects: readonly MapObject[];
  views: readonly LabelView[];
  flashes: ReadonlyMap<string, LabelFlash>;
  selectedId: string | null;
  hoverId: string | null;
  /** What the map keeps in front; the other labels recede with their objects. */
  emphasis: ReadonlySet<string> | null;
  plan: boolean;
  onPick: (id: string) => void;
}


/** React owns the content, the engine only moves each node. Labels leave the tab order: the rail is the keyboard path. */
export function Labels({ engine, objects, views, flashes, selectedId, hoverId, emphasis, plan, onPick }: LabelsProps) {
  const nodes = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!engine) return;
    const anchors: LabelAnchor[] = [];
    for (const o of objects) {
      const el = nodes.current.get(o.id);
      if (el) anchors.push({ el, x: o.x, y: o.kind === "zone" ? 0 : o.h, z: o.z });
    }
    engine.setLabels(anchors);
  }, [engine, objects]);

  return (
    <div className={cx("m3d-labels", plan && "is-plan")} aria-hidden="true">
      {views.map((v) => {
        const flash = flashes.get(v.id);
        return (
          <div
            key={v.id}
            ref={(el) => {
              if (el) nodes.current.set(v.id, el);
              else nodes.current.delete(v.id);
            }}
            className={cx(
              "m3d-label",
              v.quiet && !flash && "is-quiet",
              v.flat && "is-flat",
              v.minor && "is-minor",
              emphasis?.has(v.id) && "is-kept",
              v.attention && "is-attention",
              v.id === selectedId && "is-selected",
              v.id === hoverId && "is-hover",
              emphasis && !emphasis.has(v.id) && "is-faded",
              flash && "is-flash",
            )}
          >
            <button type="button" tabIndex={-1} className="m3d-tag" onClick={() => onPick(v.id)}>
              <span className="m3d-tag-code ltr">{v.code}</span>
              {v.more ? <span className="m3d-tag-more">{v.more}</span> : null}
              {v.text ? <span className={cx("ltr", v.textClass)}>{v.text}</span> : null}
              {flash ? <span className={cx("ltr", flash.className)}>{flash.text}</span> : null}
              {v.word ? <span className={v.wordClass}>{v.word}</span> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
