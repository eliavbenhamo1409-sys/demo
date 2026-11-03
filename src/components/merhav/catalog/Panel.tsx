"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useCoarsePointer } from "@/components/map3d/use-device";
import { cx } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import { panel, type Jack, type Link } from "./geometry";

export interface Lens {
  category: string | null;
  supplier: string | null;
}

/** A link that just changed: its line draws once. The count starts the drawing again for the same link. */
export interface Trace {
  link: string;
  count: number;
}

interface Group {
  key: string;
  label: string;
  count: number;
}

interface PanelProps {
  categories: readonly Group[];
  suppliers: readonly Group[];
  links: readonly Link[];
  lens: Lens;
  onLens: (next: Lens) => void;
  trace: Trace | null;
}

type Side = keyof Lens;

const OPEN: Lens = { category: null, supplier: null };
const OTHER: Record<Side, Side> = { category: "supplier", supplier: "category" };

/** A row a finger can press: 44 for its label and the air the row keeps between labels. */
const FINGER_LINE = 48;

/**
 * The whole catalogue as one wiring diagram: our groups on one side, the suppliers on the other, one line wherever they
 * talk. Pointing holds a group or a line for a moment, pressing holds it: the same lens either way, and the list under
 * the panel follows a press. Whatever is held turns the numbers across from it into its share.
 */
export function CatalogPanel({ categories, suppliers, links, lens, onLens, trace }: PanelProps): ReactElement {
  const field = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [spot, setSpot] = useState<Lens | null>(null);
  const coarse = useCoarsePointer();

  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    const read = () => setWidth(node.clientWidth);
    read();
    const watcher = new ResizeObserver(read);
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);

  const shape = useMemo(() => panel(categories.map((c) => c.key), suppliers.map((s) => s.key), links, width, coarse ? FINGER_LINE : undefined), [categories, suppliers, links, width, coarse]);
  const catGroups = useMemo(() => new Map(categories.map((c) => [c.key, c])), [categories]);
  const supGroups = useMemo(() => new Map(suppliers.map((s) => [s.key, s])), [suppliers]);

  const held = spot ?? lens;
  const active = held.category !== null || held.supplier !== null;
  const lit = (category: string, supplier: string) => (!held.category || held.category === category) && (!held.supplier || held.supplier === supplier);
  const pair = (side: Side, key: string, other: string) => shape.trunks.find((t) => (side === "category" ? t.category === key && t.supplierId === other : t.supplierId === key && t.category === other));
  const talks = (side: Side, key: string) => !active || shape.trunks.some((t) => (side === "category" ? t.category === key : t.supplierId === key) && lit(t.category, t.supplierId));

  const labels = (side: Side, jacks: readonly Jack[], groups: ReadonlyMap<string, Group>) => (
    <div className="mh-cat-panel-side">
      {jacks.map((jack) => {
        const group = groups.get(jack.key);
        const on = lens[side] === jack.key;
        const across = held[OTHER[side]];
        const share = across ? pair(side, jack.key, across) : undefined;
        const hold = () => setSpot({ ...OPEN, [side]: jack.key });
        return (
          <button
            key={jack.key}
            type="button"
            aria-pressed={on}
            title={group?.label}
            className={cx("mh-cat-panel-label", on && "is-on", !talks(side, jack.key) && "is-far")}
            style={{ top: jack.y }}
            onPointerEnter={hold}
            onPointerLeave={() => setSpot(null)}
            onFocus={hold}
            onBlur={() => setSpot(null)}
            onClick={() => onLens({ ...lens, [side]: on ? null : jack.key })}
          >
            <span className="mh-cat-panel-word">{group?.label}</span>
            <span className={cx("mh-cat-panel-n ltr", share && "is-share")}>{fmtQty(share?.names ?? group?.count ?? 0)}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <section className="mh-cat-panel" aria-label="שמות לפי קטגוריה וספק">
      <div className="mh-cat-panel-head">
        <span>קטגוריה · שמות</span>
        <span>שמות · ספק</span>
      </div>
      <div className="mh-cat-panel-body" style={{ height: shape.height, "--line": `${shape.line}px` } as CSSProperties}>
        {labels("category", shape.categories, catGroups)}

        <div ref={field} className="mh-cat-panel-field">
          {width > 0 ? (
            <svg width={width} height={shape.height} aria-hidden="true">
              {shape.trunks.map((trunk) => (
                <path
                  key={trunk.key}
                  d={trunk.d}
                  pathLength={1}
                  className={cx("mh-cat-trunk", active && (lit(trunk.category, trunk.supplierId) ? "is-lit" : "is-far"))}
                  style={{ "--weight": 0.45 + 0.55 * Math.sqrt(trunk.weight) } as CSSProperties}
                />
              ))}
              {shape.trunks.filter((trunk) => trunk.key === trace?.link).map((trunk) => <path key={trace?.count} d={trunk.d} pathLength={1} className="mh-cat-trace" />)}
              {shape.categories.map((jack) => <circle key={jack.key} className={cx("mh-cat-jack", !talks("category", jack.key) && "is-far")} cx={width} cy={jack.y} r={2.5} />)}
              {shape.suppliers.map((jack) => <circle key={jack.key} className={cx("mh-cat-jack", !talks("supplier", jack.key) && "is-far")} cx={0} cy={jack.y} r={2.5} />)}
              {/* A line this thin can't be hit by hand, so each carries a wider one that nobody sees. */}
              {shape.trunks.map((trunk) => {
                const on = lens.category === trunk.category && lens.supplier === trunk.supplierId;
                return (
                  <path
                    key={trunk.key}
                    d={trunk.d}
                    className="mh-cat-trunk-grip"
                    onPointerEnter={() => setSpot({ category: trunk.category, supplier: trunk.supplierId })}
                    onPointerLeave={() => setSpot(null)}
                    onClick={() => onLens(on ? OPEN : { category: trunk.category, supplier: trunk.supplierId })}
                  />
                );
              })}
            </svg>
          ) : null}
        </div>

        {labels("supplier", shape.suppliers, supGroups)}
      </div>
    </section>
  );
}
