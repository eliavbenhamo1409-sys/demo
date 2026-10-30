"use client";

import type * as React from "react";
import { SearchBar } from "./SearchBar";
import { Button } from "./Button";
import { Avatar } from "./Avatar";

export interface TopBarProps {
  actions?: React.ReactNode;
  user?: { name: string };
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  kbd?: string | false;
  className?: string;
  /** Controlled search text (optional; the shell uses it for live results). */
  searchValue?: string;
  /** Fires on every keystroke. */
  onSearchChange?: (q: string) => void;
  /** Rendered inside the search wrapper (e.g. a results popover). */
  searchSlot?: React.ReactNode;
  /** Keyboard handler for the search region (arrows / Enter / Escape). */
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Extra nodes at the very end of the bar (e.g. a live indicator). */
  end?: React.ReactNode;
  onBell?: () => void;
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Top bar: global search, main actions, notifications, user. */
export function TopBar({
  actions,
  user,
  onSearch,
  searchPlaceholder = "חיפוש מוצר, מק״ט או ספק",
  kbd,
  className,
  searchValue,
  onSearchChange,
  searchSlot,
  onSearchKeyDown,
  end,
  onBell,
}: TopBarProps) {
  return (
    <header className={cx("sa-topbar", className)}>
      <div className="relative flex-1 min-w-0 max-w-[520px]" onKeyDown={onSearchKeyDown}>
        <SearchBar
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={onSearchChange}
          onSubmit={onSearch}
          kbd={kbd}
        />
        {searchSlot}
      </div>
      <div className="sa-topbar-end">
        {actions}
        {actions ? <span className="sa-sep" aria-hidden /> : null}
        <Button variant="ghost" iconOnly icon="bell" aria-label="התראות" onClick={onBell} />
        {user ? (
          <div className="sa-user" style={{ padding: "0 var(--space-1)" }}>
            <span className="sa-user-name">{user.name}</span>
            <Avatar name={user.name} size="sm" />
          </div>
        ) : null}
        {end}
      </div>
    </header>
  );
}
