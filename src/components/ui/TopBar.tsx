"use client";

import type * as React from "react";
import { SearchBar } from "./SearchBar";

export interface TopBarProps {
  actions?: React.ReactNode;
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  className?: string;
  /** Controlled search text (optional; the shell uses it for live results). */
  searchValue?: string;
  /** Fires on every keystroke. */
  onSearchChange?: (q: string) => void;
  /** Rendered inside the search wrapper (e.g. a results popover). */
  searchSlot?: React.ReactNode;
  onSearchFocus?: () => void;
  /** Keyboard handler for the search region (arrows / Enter / Escape). */
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Extra nodes at the very end of the bar (e.g. a connection note). */
  end?: React.ReactNode;
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Top bar: global search and main actions. */
export function TopBar({
  actions,
  onSearch,
  searchPlaceholder = "חיפוש מוצר, הזמנה, לקוח או פעולה",
  className,
  searchValue,
  onSearchChange,
  searchSlot,
  onSearchFocus,
  onSearchKeyDown,
  end,
}: TopBarProps) {
  return (
    <header className={cx("sa-topbar", className)}>
      <div className="relative flex-1 min-w-0 max-w-[520px]" onKeyDown={onSearchKeyDown}>
        <SearchBar
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={onSearchChange}
          onSubmit={onSearch}
          onFocus={onSearchFocus}
        />
        {searchSlot}
      </div>
      <div className="sa-topbar-end">
        {end}
        {actions}
      </div>
    </header>
  );
}
