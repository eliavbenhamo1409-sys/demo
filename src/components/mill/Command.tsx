"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Icon, type IconName } from "@/components/ui";
import { ProductThumb } from "@/components/app/Viz";
import { fmtName, fmtPrice, fmtQty } from "@/lib/format";
import { productPhotoUrl } from "@/lib/product-photos";
import { available, stockState, useData, type Product } from "@/lib/store";
import { Figure } from "./Figure";
import { Scale, stockScale } from "./Scale";

export interface CommandHit {
  kind: "product" | "order" | "supplier" | "supplier_item";
  id: string;
  title: string;
  sub: string;
}

export interface CommandSearch {
  query: string;
  onQuery: (q: string) => void;
  hits: CommandHit[];
  pick: (hit: CommandHit) => void;
}

export interface CommandEntry {
  key: string;
  label: string;
  icon?: IconName;
  run: () => void;
}

interface Row {
  key: string;
  group: string;
  title: string;
  sub?: string;
  icon?: IconName;
  product?: Product;
  run: () => void;
}

const GROUP: Record<CommandHit["kind"], string> = { product: "מוצרים", order: "הזמנות", supplier: "ספקים", supplier_item: "שמות אצל ספקים" };
const ICON: Record<CommandHit["kind"], IconName> = { product: "package", order: "inbox", supplier: "truck", supplier_item: "tag" };

const hasText = (label: string, q: string) => label.toLowerCase().includes(q);

function Preview({ product: p }: { product: Product }): ReactElement {
  const free = available(p);
  const src = productPhotoUrl(p.image_path);
  const state = stockState(p);
  return (
    <aside className="ml-cmd-preview" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" /> : null}
      <div>
        <div className="ml-cmd-preview-figure"><Figure value={p.qty} /></div>
        <div className="ml-cmd-sub">{p.unit}</div>
      </div>
      <Scale {...stockScale(free, p.min_qty)} tone={state} width="100%" />
      <dl>
        <dt>זמין</dt><dd className="ltr">{fmtQty(free)}</dd>
        <dt>משוריין</dt><dd className="ltr">{fmtQty(p.reserved)}</dd>
        <dt>מיקום</dt><dd>{p.location ?? "—"}</dd>
        {p.price !== null ? <><dt>מחיר</dt><dd className="ltr">{fmtPrice(p.price)}</dd></> : null}
      </dl>
    </aside>
  );
}

/** One surface in place of a search box, an actions menu and a keyboard way around: empty it offers what can be done, typed it finds. */
export function Command({ search, actions, pages, onClose }: { search: CommandSearch; actions: CommandEntry[]; pages: CommandEntry[]; onClose: () => void }): ReactElement {
  const { product } = useData();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { query, onQuery, hits, pick } = search;

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const entry = (group: string, e: CommandEntry): Row => ({ key: e.key, group, title: e.label, icon: e.icon, run: e.run });
    if (!q) return [...actions.map((e) => entry("פעולות", e)), ...pages.map((e) => entry("מעבר", e))];
    return [
      ...hits.map<Row>((h) => ({
        key: `${h.kind}:${h.id}`,
        group: GROUP[h.kind],
        title: h.kind === "product" ? fmtName(h.title) : h.title,
        sub: h.sub,
        icon: ICON[h.kind],
        product: h.kind === "product" ? product(h.id) : undefined,
        run: () => pick(h),
      })),
      ...actions.filter((e) => hasText(e.label, q)).map((e) => entry("פעולות", e)),
      ...pages.filter((e) => hasText(e.label, q)).map((e) => entry("מעבר", e)),
    ];
  }, [query, hits, actions, pages, product, pick]);

  const shown = Math.min(active, Math.max(rows.length - 1, 0));
  const current = rows[shown];

  const move = useCallback(
    (by: number) => {
      if (rows.length === 0) return;
      const next = (shown + by + rows.length) % rows.length;
      setActive(next);
      listRef.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
    },
    [rows.length, shown],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      current?.run();
    }
  };

  let lastGroup = "";
  return (
    <>
      <div className="ml-cmd-scrim" onClick={onClose} aria-hidden="true" />
      <div className={current?.product ? "ml-cmd has-preview" : "ml-cmd"} role="dialog" aria-modal="true" aria-label="חיפוש ופעולות" onKeyDown={onKeyDown}>
        <div className="ml-cmd-main">
          <label className="ml-cmd-field">
            <Icon name="search" size={20} strokeWidth={1.5} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                onQuery(e.target.value);
                setActive(0);
              }}
              placeholder={'מוצר, מק"ט, הזמנה או ספק'}
              aria-label="חיפוש"
              role="combobox"
              aria-expanded="true"
              aria-controls="ml-cmd-list"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="ml-cmd-list" id="ml-cmd-list" role="listbox" ref={listRef}>
            {rows.length === 0 ? <div className="ml-cmd-none">לא נמצאו תוצאות</div> : null}
            {rows.map((row, i) => {
              const head = row.group !== lastGroup ? row.group : null;
              lastGroup = row.group;
              return (
                <div key={row.key}>
                  {head ? <div className="ml-cmd-group">{head}</div> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === shown}
                    data-row={i}
                    className={i === shown ? "ml-cmd-item is-active" : "ml-cmd-item"}
                    onMouseMove={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={row.run}
                  >
                    {row.product ? <ProductThumb product={row.product} small /> : row.icon ? <Icon name={row.icon} size={18} strokeWidth={1.5} /> : null}
                    <span className="ml-cmd-text">
                      <span className="ml-cmd-title">{row.title}</span>
                      {row.sub ? <span className="ml-cmd-sub"><bdi>{row.sub}</bdi></span> : null}
                    </span>
                    {row.product ? <span className="ml-cmd-fig ltr">{fmtQty(row.product.qty)}</span> : null}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        {current?.product ? <Preview product={current.product} /> : null}
      </div>
    </>
  );
}
