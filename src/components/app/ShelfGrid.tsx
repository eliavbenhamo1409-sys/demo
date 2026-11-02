"use client";

import { useState } from "react";
import { cx, Tabs } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import { fitsHalf, shortName, type ObjectStock, type ShelfBlock } from "@/lib/map3d/model";
import { formatPlace, levelsOf, resolvePlace, SIDE_WORD } from "@/lib/map3d/place";
import type { MapObject, ShelfSide } from "@/lib/map3d/types";
import type { Product } from "@/lib/store";
import "./place.css";

const WIDTHS = [
  { value: "whole", label: "מדף שלם" },
  { value: "half", label: "חצי מדף" },
];

function covers(block: ShelfBlock, level: number, side: ShelfSide | null): boolean {
  return block.items.some((item) => item.level === level && (item.side === null || side === null || item.side === side));
}

/** What stands in a spot, in a few words. */
function spotText(blocks: readonly ShelfBlock[], product: Pick<Product, "id"> | undefined, level: number, side: ShelfSide | null): string {
  const here = blocks.filter((block) => covers(block, level, side));
  if (here.length === 0) return "פנוי";
  const own = here.find((block) => block.product.id === product?.id);
  if (own) {
    const qty = own.items.filter((item) => item.level === level && (side === null || item.side === null || item.side === side)).reduce((sum, item) => sum + item.qty, 0);
    return `כבר כאן · ${fmtQty(qty)} ${own.product.unit}`;
  }
  return here.map((block) => shortName(block.product.name)).join(" · ");
}

interface ShelfGridProps {
  object: MapObject;
  /** What is being placed: it decides whether half a shelf is on offer. */
  product?: Pick<Product, "id" | "name" | "category" | "unit">;
  stock: ObjectStock | undefined;
  /** The chosen place, if it is on this rack. */
  value: string;
  onPick: (place: string) => void;
}

/** The rack as it stands, top shelf first: the options to choose from, with what each one holds. */
export function ShelfGrid({ object, product, stock, value, onPick }: ShelfGridProps) {
  const halves = !product || fitsHalf(product, object);
  const chosen = resolvePlace(value, [object]);
  const [half, setHalf] = useState(chosen?.side !== null && chosen?.side !== undefined);
  const blocks = stock?.blocks ?? [];
  const levels = Array.from({ length: levelsOf(object) }, (_, i) => levelsOf(object) - 1 - i);

  const spot = (level: number, side: ShelfSide | null, title: string) => {
    const selected = chosen?.level === level && chosen.side === side;
    return (
      <button key={side ?? "whole"} type="button" className={cx("sa-spot", selected && "is-selected")} aria-pressed={selected} onClick={() => onPick(formatPlace(object.id, level, side))}>
        <span className="sa-spot-title">{title}</span>
        <span className="sa-spot-sub">{spotText(blocks, product, level, side)}</span>
      </button>
    );
  };

  return (
    <div className="sa-shelfgrid">
      {halves ? <Tabs tabs={WIDTHS} value={half && halves ? "half" : "whole"} onChange={(next) => setHalf(next === "half")} /> : null}
      {levels.map((level) => (
        <div key={level} className="sa-shelfrow" role="group" aria-label={`מדף ${level + 1}`}>
          {half && halves ? (
            <>
              <span className="sa-shelfrow-no sa-num">{level + 1}</span>
              {spot(level, "right", SIDE_WORD.right)}
              {spot(level, "left", SIDE_WORD.left)}
            </>
          ) : (
            spot(level, null, `מדף ${level + 1}`)
          )}
        </div>
      ))}
    </div>
  );
}
