"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";

export interface SearchBarProps {
  value?: string;
  defaultValue?: string;
  onChange?: (q: string) => void;
  onSubmit?: (q: string) => void;
  placeholder?: string;
  /** Key that focuses the field; false for a local table filter. */
  kbd?: string | false;
  className?: string;
}

/** The one global search (top bar) — also the local table filter with `kbd={false}`. */
export function SearchBar({
  value: valueProp, defaultValue, onChange, onSubmit, placeholder = 'חיפוש לפי מוצר, מק"ט או ספק', kbd = "/", className,
}: SearchBarProps): ReactElement {
  const [valueState, setValueState] = useState(defaultValue ?? "");
  const value = valueProp !== undefined ? valueProp : valueState;
  const inputRef = useRef<HTMLInputElement>(null);

  const set = (q: string) => {
    setValueState(q);
    onChange?.(q);
  };

  // ⌘K / Ctrl+K (and the bare kbd key when it is a single character) focuses the field.
  useEffect(() => {
    if (kbd === false) return;
    const onKey = (e: KeyboardEvent) => {
      const el = inputRef.current;
      if (!el) return;
      const meta = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const bare = kbd.length === 1 && e.key === kbd && !e.metaKey && !e.ctrlKey && !e.altKey && !typing;
      if (meta || bare) {
        e.preventDefault();
        el.focus();
        el.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [kbd]);

  return (
    <div className={cx("sa-search", className)} role="search">
      <div className="sa-control has-icon" style={{ width: "100%" }}>
        <span className="sa-control-icon"><Icon name="search" /></span>
        <input
          ref={inputRef}
          type="search"
          className="sa-input"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit?.(value);
            if (e.key === "Escape") {
              set("");
              e.currentTarget.blur();
            }
          }}
        />
        {value ? (
          <button
            type="button"
            className="sa-btn sa-btn-ghost sa-btn-sm sa-btn-icon sa-control-end"
            aria-label="ניקוי"
            onClick={() => { set(""); inputRef.current?.focus(); }}
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
