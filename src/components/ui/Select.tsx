"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";

/** `pinned` keeps an option visible while searching, e.g. an "add new" action. */
export interface SelectOption { value: string; label: ReactNode; pinned?: boolean }

export interface SelectProps {
  options: (string | SelectOption)[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  label?: string;
  /** What the closed control shows, when it should be shorter than the option's own label. */
  shown?: ReactNode;
  placeholder?: string;
  allLabel?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  searchable?: boolean;
  disabled?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  inline?: boolean;
  activeIndex?: number;
  minWidth?: number;
  maxWidth?: number;
  block?: boolean;
  className?: string;
}

type Item = { value: string; label: ReactNode; isAll?: boolean; pinned?: boolean };

function labelText(label: ReactNode): string {
  if (typeof label === "string" || typeof label === "number") return String(label);
  return "";
}

/** Searchable select; `allLabel` adds an empty "all" option first. */
export function Select({
  options, value: valueProp, defaultValue, onChange, label, shown, placeholder = "בחירה", allLabel, searchPlaceholder = "חיפוש לפי שם",
  emptyLabel = "לא נמצאו תוצאות", searchable = true, disabled, open: openProp, defaultOpen, inline, activeIndex: activeProp,
  minWidth, maxWidth, block, className,
}: SelectProps): ReactElement {
  const [openState, setOpenState] = useState(!!defaultOpen);
  const [valueState, setValueState] = useState(defaultValue ?? "");
  const [query, setQuery] = useState("");
  const [activeState, setActive] = useState<number>(-1);
  const active = activeProp ?? activeState;
  const open = openProp !== undefined ? openProp : openState;
  const value = valueProp !== undefined ? valueProp : valueState;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listId = `sa-sel-${uid}-list`;
  const labelId = `sa-sel-${uid}-label`;

  const normalized = useMemo<Item[]>(
    () => options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label, pinned: o.pinned })),
    [options],
  );
  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? normalized.filter((o) => o.pinned || (labelText(o.label) || o.value).toLowerCase().includes(q)) : normalized;
    return allLabel ? [{ value: "", label: allLabel, isAll: true }, ...filtered] : filtered;
  }, [normalized, query, allLabel]);

  const current = normalized.find((it) => it.value === value && value !== "") ?? null;

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (next) {
      // Highlight the current value (or the first option) when opening.
      const idx = normalized.findIndex((it) => it.value === value && value !== "");
      setActive(idx >= 0 ? idx + (allLabel ? 1 : 0) : 0);
    } else {
      setQuery("");
      setActive(-1);
    }
  }, [normalized, value, allLabel]);

  const select = useCallback((v: string) => {
    // A button fires no input event, so a real change announces itself as a native <select> would.
    // It goes before onChange: that may open another panel, which must start clean.
    if (v !== value) rootRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
    setValueState(v);
    setOpen(false);
    onChange?.(v);
    triggerRef.current?.focus();
  }, [value, onChange, setOpen]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open, setOpen]);

  // Focus the search box when opening.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // Keep the active option visible.
  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => (items.length ? (a + 1) % items.length : -1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => (items.length ? (a <= 0 ? items.length - 1 : a - 1) : -1));
        break;
      case "Home":
        e.preventDefault();
        setActive(items.length ? 0 : -1);
        break;
      case "End":
        e.preventDefault();
        setActive(items.length ? items.length - 1 : -1);
        break;
      case "Enter":
        e.preventDefault();
        if (active >= 0 && active < items.length) select(items[active].value);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const activeId = active >= 0 && active < items.length ? `sa-sel-${uid}-opt-${active}` : undefined;

  const sel = (
    <div
      ref={rootRef}
      className={cx("sa-select", className)}
      style={{ minWidth: block ? 0 : minWidth, maxWidth, width: block ? "100%" : undefined }}
      onKeyDown={onKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={label ? `${labelId} sa-sel-${uid}-value` : undefined}
        className={cx("sa-select-trigger", open && "is-open")}
        onClick={() => setOpen(!open)}
      >
        <span id={`sa-sel-${uid}-value`} className={cx("sa-select-value", !current && "is-placeholder")}>
          {current ? (shown ?? current.label) : placeholder}
        </span>
        <Icon name="chevron-down" size={14} className="sa-select-chevron" />
      </button>
      {open ? (
        <div className={cx("sa-menu", inline && "is-static")}>
          {searchable ? (
            <div className="sa-menu-search">
              <Icon name="search" size={14} />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onInput={(e) => e.stopPropagation()} // searching the list changes nothing in the form
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={listId}
                aria-activedescendant={activeId}
                role="combobox"
                aria-expanded={true}
                aria-autocomplete="list"
                autoComplete="off"
              />
            </div>
          ) : null}
          <div className="sa-menu-list" role="listbox" id={listId} ref={listRef} aria-labelledby={label ? labelId : undefined} tabIndex={-1}>
            {items.length === 0 ? (
              <div className="sa-menu-empty">{emptyLabel}</div>
            ) : (
              items.map((it, idx) => {
                const selected = it.value === value;
                return (
                  <button
                    key={`${it.value}-${idx}`}
                    id={`sa-sel-${uid}-opt-${idx}`}
                    data-index={idx}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    className={cx("sa-menu-item", idx === active && "is-active", selected && "is-selected", it.isAll && "is-all")}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => select(it.value)}
                  >
                    <span className="sa-truncate">{it.label}</span>
                    {selected ? <Icon name="check" size={14} strokeWidth={2.5} className="sa-menu-check" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );

  if (label) {
    return (
      <div className="sa-field">
        <span className="sa-label" id={labelId}>{label}</span>
        {sel}
      </div>
    );
  }
  return sel;
}
