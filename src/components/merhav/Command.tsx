"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { cx, Icon, type IconName } from "@/components/ui";
import type { ActionItem } from "@/components/ui/ActionMenu";
import { useData } from "@/lib/store";
import { useTwin } from "./twin/Twin";

export interface CommandHit {
  kind: "product" | "order" | "supplier" | "supplier_item";
  id: string;
  title: string;
  sub: string;
}

export interface CommandSearch {
  query: string;
  onQuery: (query: string) => void;
  hits: CommandHit[];
  pick: (hit: CommandHit | undefined) => void;
}

const HIT_ICON: Record<CommandHit["kind"], IconName> = { product: "package", order: "inbox", supplier: "truck", supplier_item: "tag" };

/** The same words as the rail. */
const PAGE_WORD: Record<string, string> = { "/3d": "מחסן", "/suppliers": "קטלוג" };

const GROUP = { hit: null, action: "פעולות", page: "עמודים" } as const;

type Row =
  | { type: "hit"; hit: CommandHit }
  | { type: "action"; item: ActionItem }
  | { type: "page"; label: string; href: string };

interface CommandProps {
  open: boolean;
  onOpen: (seed?: string) => void;
  onClose: () => void;
  search: CommandSearch;
  actions: ActionItem[];
  onAction: (key: string) => void;
  pages: { label: string; href: string }[];
}

const inField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"]'));

/** Whatever is open keeps the keyboard. A row that unfolds in place is not open in this sense, so it asks for a popup. */
const holdsKeys = () => document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"]') !== null;

/** On foot through the model, the letters are steps. */
const onFoot = () => document.querySelector(".m3d-walkhint") !== null;

/** The model answers only where it can be seen beside the plate: never behind a shut door, never under a phone's whole plate. */
const modelInView = (world: HTMLElement | null) => world !== null && getComputedStyle(world).visibility === "visible" && !window.matchMedia("(max-width: 899px)").matches;

/**
 * The search is nowhere until it is wanted: anywhere in the admin, just start typing. One plate holds what the words
 * find and what can be done, and walking through the results lights their shelves on the model as you go.
 */
export function Command({ open, onOpen, onClose, search, actions, onAction, pages }: CommandProps): ReactElement | null {
  const router = useRouter();
  const { linesOf } = useData();
  const { world, itemsOf, spotProduct, spotObjects, aimProduct } = useTwin();
  const scrim = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const { query, onQuery, hits, pick } = search;

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setIndex(0);
  }

  // Typing anywhere begins a search; a shortcut opens it empty. e.code, because a Hebrew keyboard reads ל on that key.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === "KeyK" || e.key.toLowerCase() === "k")) {
        if (open) {
          e.preventDefault();
          onClose();
        } else if (!holdsKeys()) {
          e.preventDefault();
          onOpen();
        }
        return;
      }
      if (open) {
        // Nothing on the plate takes focus from the field, but if the page ever does, the next key still lands here.
        if (document.activeElement !== input.current) input.current?.focus();
        return;
      }
      if (e.defaultPrevented || e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === " ") return;
      if (inField(e.target) || holdsKeys() || onFoot()) return;
      e.preventDefault();
      onOpen(e.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpen, onClose]);

  const rows = useMemo<Row[]>(() => {
    const named = pages.map((p) => ({ ...p, label: PAGE_WORD[p.href] ?? p.label, also: p.label }));
    const q = query.trim();
    if (q) {
      return [
        ...hits.map((hit): Row => ({ type: "hit", hit })),
        ...actions.filter((a) => a.label.includes(q)).map((item): Row => ({ type: "action", item })),
        ...named.filter((p) => p.label.includes(q) || p.also.includes(q)).map(({ label, href }): Row => ({ type: "page", label, href })),
      ];
    }
    return [...actions.map((item): Row => ({ type: "action", item })), ...named.map(({ label, href }): Row => ({ type: "page", label, href }))];
  }, [query, hits, actions, pages]);

  const at = Math.min(index, Math.max(rows.length - 1, 0));
  const current = rows[at];

  // Focus goes to the field before the next key can arrive, and back where it was when the plate closes.
  useLayoutEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => before?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open]);

  // A phone's keyboard covers the page without resizing it, so the plate measures what is really left.
  useEffect(() => {
    const view = window.visualViewport;
    if (!open || !view) return;
    const fit = () => scrim.current?.style.setProperty("--mh-seen", `${view.height}px`);
    fit();
    view.addEventListener("resize", fit);
    return () => view.removeEventListener("resize", fit);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (at === 0) list.current?.scrollTo({ top: 0 });
    else list.current?.querySelector(".is-at")?.scrollIntoView({ block: "nearest" });
  }, [open, at]);

  // The row you stand on answers on the model: its shelves light, and for a product the line runs out to it.
  const standing = open && current?.type === "hit" ? current.hit : null;
  const standingKind = standing?.kind;
  const standingId = standing?.id;
  useEffect(() => {
    if (!standingId || !modelInView(world)) return;
    if (standingKind === "product") {
      const row = list.current?.querySelector(".is-at")?.getBoundingClientRect();
      const edge = plate.current?.getBoundingClientRect().left;
      spotProduct(standingId);
      if (row && edge !== undefined) aimProduct(standingId, { x: edge, y: row.top + row.height / 2 });
      return () => {
        spotProduct(null);
        aimProduct(null);
      };
    }
    if (standingKind === "order") {
      spotObjects(linesOf(standingId).flatMap((line) => itemsOf(line.product_id).map((item) => item.objectId)));
      return () => spotObjects(null);
    }
  }, [standingKind, standingId, world, spotProduct, spotObjects, aimProduct, itemsOf, linesOf]);

  const run = (row: Row | undefined) => {
    if (!row) return;
    if (row.type === "hit") pick(row.hit);
    else if (row.type === "action") onAction(row.item.key);
    else router.push(row.href);
    onClose();
  };

  const step = (by: number) => setIndex(rows.length ? (at + by + rows.length) % rows.length : 0);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run(current);
    }
  };

  if (!open) return null;

  const lead = (i: number) => {
    const group = GROUP[rows[i].type];
    const before = i > 0 ? GROUP[rows[i - 1].type] : null;
    return group && group !== before ? <p key={`group-${group}`} className="mh-command-group" role="presentation">{group}</p> : null;
  };

  return createPortal(
    <div ref={scrim} className="mh-command-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={plate}
        className="mh-command"
        role="dialog"
        aria-modal="true"
        aria-label="חיפוש"
        onKeyDown={onKey}
        onMouseDown={(e) => {
          // The field keeps the focus whatever is pressed, so the keys never get lost on the plate.
          if (e.target !== input.current) e.preventDefault();
        }}
      >
        <div className="mh-command-field">
          <Icon name="search" size={20} />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              onQuery(e.target.value);
              setIndex(0);
            }}
            placeholder='מוצר, מק"ט, הזמנה או ספק'
            role="combobox"
            aria-expanded="true"
            aria-controls="mh-command-list"
            aria-autocomplete="list"
            aria-activedescendant={current ? `mh-command-${at}` : undefined}
            autoComplete="off"
            enterKeyHint="go"
          />
          <button type="button" className="mh-command-close" onClick={onClose}>סגירה</button>
        </div>
        <div ref={list} id="mh-command-list" className="mh-command-list" role="listbox">
          {rows.length === 0 ? <p className="mh-command-empty">לא נמצאו תוצאות</p> : null}
          {rows.map((row, i) => {
            const selected = i === at;
            const common = {
              id: `mh-command-${i}`,
              role: "option",
              tabIndex: -1,
              "aria-selected": selected,
              className: cx("mh-command-row", selected && "is-at"),
              // Move, not enter: a list that scrolls under a resting pointer must not take the row from the keys.
              onMouseMove: () => setIndex(i),
              onClick: () => run(row),
            } as const;
            if (row.type === "hit") {
              return [
                lead(i),
                <button key={`${row.hit.kind}:${row.hit.id}`} type="button" {...common}>
                  <Icon name={HIT_ICON[row.hit.kind]} size={16} />
                  <span className="mh-command-title">{row.hit.title}</span>
                  <span className="mh-command-sub"><bdi>{row.hit.sub}</bdi></span>
                </button>,
              ];
            }
            if (row.type === "action") {
              return [
                lead(i),
                <button key={row.item.key} type="button" {...common}>
                  <Icon name={row.item.icon ?? "plus"} size={16} />
                  <span className="mh-command-title">{row.item.label}</span>
                </button>,
              ];
            }
            return [
              lead(i),
              <button key={row.href} type="button" {...common}>
                <span className="mh-command-title">{row.label}</span>
              </button>,
            ];
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
