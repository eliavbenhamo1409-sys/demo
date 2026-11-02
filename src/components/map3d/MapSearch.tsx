"use client";

import { useMemo, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Icon, SearchBar } from "@/components/ui";
import { placeKey } from "@/lib/map3d/place";
import { useData, type Product } from "@/lib/store";

const MAX_HITS = 8;

interface MapSearchProps {
  placeOf: (productId: string) => string | null;
  onPick: (product: Product) => void;
}

/** Finds a product by name, code or place, and hands it back to fly to. */
export function MapSearch({ placeOf, onPick }: MapSearchProps) {
  const { state } = useData();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const hits = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return [];
    const key = placeKey(text);
    return state.products
      .filter((p) => {
        if (p.name.toLowerCase().includes(text) || p.sku.toLowerCase().includes(text)) return true;
        const place = placeOf(p.id) ?? p.location;
        return Boolean(key && place && placeKey(place).includes(key));
      })
      .slice(0, MAX_HITS);
  }, [query, state.products, placeOf]);

  const onQuery = (q: string) => {
    setQuery(q);
    setActive(0);
    setOpen(q.trim().length > 0);
  };

  const pick = (product: Product | undefined) => {
    if (!product) return;
    onPick(product);
    onQuery("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[active]);
    }
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  };

  return (
    <div className="m3d-bar" onKeyDown={onKeyDown} onBlur={onBlur} onFocus={() => setOpen(query.trim().length > 0)}>
      <SearchBar kbd={false} value={query} onChange={onQuery} placeholder='חיפוש לפי שם, מק"ט או מיקום' />
      {open ? (
        <div className="m3d-results" role="listbox" aria-label="תוצאות חיפוש">
          {hits.length === 0 ? (
            <div className="sa-menu-empty">לא נמצאו מוצרים</div>
          ) : (
            <div className="sa-menu-list">
              {hits.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`sa-menu-item${i === active ? " is-active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                >
                  <Icon name="package" size={16} />
                  <span className="m3d-result-text">
                    <span className="app-resultTitle">{p.name}</span>
                    <span className="app-resultSub">
                      <span className="sa-mono ltr">{placeOf(p.id) ?? "ללא מיקום במפה"}</span> · <bdi>{p.sku}</bdi>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
