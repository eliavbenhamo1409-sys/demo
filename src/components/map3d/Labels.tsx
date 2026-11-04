"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import type { Spot } from "@/lib/map3d/piles";
import type { LabelAnchor, MapEngine, MapObject, PickHit } from "@/lib/map3d/types";

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
  /** On the front of a shelf: the product, which shelf, and how much of it stands there. */
  onShelf?: boolean;
  name?: string;
  shelf?: string;
  qty?: string;
  /** Where it stands, when that isn't above its object: on a pile, the face the camera comes to face. */
  at?: Spot;
  /** What a click on it selects. */
  hit?: PickHit;
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
  /** The shelf tag the rail or the map has chosen. */
  selectedKey?: string | null;
  hoverId: string | null;
  /** What the map keeps in front; the other labels recede with their objects. */
  emphasis: ReadonlySet<string> | null;
  plan: boolean;
  onPick: (hit: PickHit) => void;
}


const pointKey = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
const spotKey = (at: Spot | undefined) => (at ? [pointKey(at), ...(at.faces ?? []).map(pointKey)].join(";") : "");

/** React owns the content, the engine only moves each node. Labels leave the tab order: the rail is the keyboard path. */
export function Labels({ engine, objects, views, flashes, selectedId, selectedKey, hoverId, emphasis, plan, onPick }: LabelsProps) {
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const spots = views.map((v) => `${v.id}:${spotKey(v.at)}`).join("|");

  useEffect(() => {
    if (!engine) return;
    const anchors: LabelAnchor[] = [];
    for (const v of views) {
      const el = nodes.current.get(v.id);
      if (!el) continue;
      if (v.at) anchors.push({ el, ...v.at });
      else {
        const o = objects.find((candidate) => candidate.id === v.id);
        if (o) anchors.push({ el, x: o.x, y: o.kind === "zone" ? 0 : o.h, z: o.z });
      }
    }
    engine.setLabels(anchors);
    // Anchors follow where the tags stand, not each new array of views.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, objects, spots]);

  return (
    <div className={cx("m3d-labels", plan && "is-plan")} aria-hidden="true">
      {views.map((v) => {
        const flash = flashes.get(v.id);
        return (
          <div
            key={v.id}
            data-key={v.id}
            ref={(el) => {
              if (el) nodes.current.set(v.id, el);
              else nodes.current.delete(v.id);
            }}
            className={cx(
              "m3d-label",
              v.quiet && !flash && "is-quiet",
              v.flat && "is-flat",
              v.minor && "is-minor",
              v.onShelf && "is-shelf",
              emphasis?.has(v.id) && "is-kept",
              v.attention && "is-attention",
              (v.id === selectedId || v.id === selectedKey) && "is-selected",
              v.id === hoverId && "is-hover",
              emphasis && !v.onShelf && !emphasis.has(v.id) && "is-faded",
              flash && "is-flash",
            )}
          >
            <button type="button" tabIndex={-1} className="m3d-tag" onClick={() => onPick(v.hit ?? { objectId: v.id, level: null })}>
              {v.code ? <span className="m3d-tag-code ltr">{v.code}</span> : null}
              {v.more ? <span className="m3d-tag-more">{v.more}</span> : null}
              {v.name ? <span className="m3d-tag-name">{v.name}</span> : null}
              {v.shelf ? <span className="m3d-tag-shelf">{v.shelf}</span> : null}
              {v.qty ? <span className="m3d-tag-qty">{v.qty}</span> : null}
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
