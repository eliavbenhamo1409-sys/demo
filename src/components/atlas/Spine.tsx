"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import { AREAS, areaOf } from "./areas";

export interface SpineItem {
  key: string;
  label: string;
  href: string;
  count?: number;
}

interface SpineProps {
  items: SpineItem[];
  active: string;
  foot: ReactNode;
  offline: boolean;
  onSearch: () => void;
  onNew: () => void;
}

const count = (n: number | undefined, sum = false) => (n ? <span className={`at-count ltr${sum ? " is-sum" : ""}`}>{fmtQty(n)}</span> : null);

/**
 * Zone A. Forest ink, the name, the search, five words, and under the word of the area you are in its pages as quiet rows.
 * No icons and no capsules: a thin jade bar on the edge says where you are. At the foot a new action, the settings, the way out.
 */
export function Spine({ items, active, foot, offline, onSearch, onNew }: SpineProps): ReactElement {
  const counts: Record<string, number | undefined> = Object.fromEntries(items.map((i) => [i.key, i.count]));
  const area = areaOf(active);

  return (
    <aside className="at-spine">
      <div className="at-brand">ניהול מלאי</div>

      <button type="button" className="at-seek" onClick={onSearch}>
        <Icon name="search" size={18} />
        <span>חיפוש</span>
        <kbd aria-hidden="true">⌘K</kbd>
      </button>

      <nav className="at-nav" aria-label="ניווט ראשי">
        {AREAS.map((a) => {
          const inside = area?.key === a.key;
          const own = a.views.length === 0;
          const sum = a.views.reduce((n, v) => n + (counts[v.key] ?? 0), 0);
          return (
            <div key={a.key} className="at-area" data-here={inside || undefined}>
              <Link href={a.href} className="at-nav-row" aria-current={inside ? (own ? "page" : "true") : undefined}>
                <span>{a.label}</span>
                {own ? count(counts[a.key]) : count(sum, true)}
              </Link>
              {a.views.length > 0 ? (
                <div className="at-pages" aria-hidden={inside ? undefined : true}>
                  <div className="at-pages-body" inert={inside ? undefined : true}>
                    {a.views.map((v) => (
                      <Link key={v.key} href={v.href} className="at-page-row" aria-current={v.key === active ? "page" : undefined}>
                        <span>{v.label}</span>
                        {count(counts[v.key])}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="at-spine-foot">
        {offline ? <p className="at-offline" role="status" aria-live="polite">מתחבר</p> : null}
        <button type="button" className="at-new" onClick={onNew}>
          <Icon name="plus" size={18} />
          <span>פעולה חדשה</span>
        </button>
        {foot}
      </div>
    </aside>
  );
}

/** On a phone the spine has no room for an area's pages, so they stand over the page as one ruled row. Hidden on a desk by CSS. */
export function AreaBar({ items, active }: { items: SpineItem[]; active: string }): ReactElement | null {
  const area = areaOf(active);
  if (!area || area.views.length < 2) return null;
  const counts: Record<string, number | undefined> = Object.fromEntries(items.map((i) => [i.key, i.count]));
  return (
    <nav className="at-areabar" aria-label={area.label}>
      <div className="at-areabar-row">
        {area.views.map((v) => (
          <Link key={v.key} href={v.href} className="at-areabar-item" aria-current={v.key === active ? "page" : undefined}>
            <span>{v.label}</span>
            {counts[v.key] ? <span className="at-areabar-count ltr">{fmtQty(counts[v.key] ?? 0)}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
