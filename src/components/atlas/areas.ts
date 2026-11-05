/**
 * The spine of ATLAS: five words, and the pages each one holds. Every route the admin has stays reachable; the words are
 * the brief's (סקירה, מלאי, הזמנות, פעילות, ניהול). The keys are AppShell's activeKey() words.
 */
export interface View {
  key: string;
  label: string;
  href: string;
}

export interface Area {
  key: string;
  label: string;
  /** Where a press on the area's word lands: its first page. */
  href: string;
  /** The pages inside it, in reading order. An area with one page has none. */
  views: View[];
}

export const AREAS: readonly Area[] = [
  { key: "overview", label: "סקירה", href: "/", views: [] },
  {
    key: "stock",
    label: "מלאי",
    href: "/inventory",
    views: [
      { key: "inventory", label: "מוצרים", href: "/inventory" },
      { key: "map", label: "מחסן", href: "/3d" },
      { key: "movements", label: "תנועות", href: "/movements" },
    ],
  },
  { key: "orders", label: "הזמנות", href: "/orders", views: [] },
  {
    key: "activity",
    label: "פעילות",
    href: "/faults",
    views: [
      { key: "faults", label: "תקלות", href: "/faults" },
      { key: "closing", label: "סגירת יום", href: "/closing" },
      { key: "documentation", label: "תיעוד", href: "/documentation" },
    ],
  },
  {
    key: "manage",
    label: "ניהול",
    href: "/suppliers",
    views: [
      { key: "suppliers", label: "ספקים", href: "/suppliers" },
      { key: "team", label: "צוות", href: "/team" },
    ],
  },
];

/** The area that holds a page, by the page's key. */
export function areaOf(active: string): Area | undefined {
  return AREAS.find((a) => a.key === active || a.views.some((v) => v.key === active));
}

/** The word the spine uses for a page, for the browser tab. */
export function pageWord(active: string): string | undefined {
  for (const a of AREAS) {
    if (a.key === active) return a.label;
    const v = a.views.find((view) => view.key === active);
    if (v) return v.label;
  }
  return undefined;
}

/** Every page as the search lists it: the area's word, then the page's, so "מלאי · תנועות" is found by either. */
export function allPages(): { label: string; href: string }[] {
  return AREAS.flatMap((a) => (a.views.length ? a.views.map((v) => ({ label: `${a.label} · ${v.label}`, href: v.href })) : [{ label: a.label, href: a.href }]));
}
