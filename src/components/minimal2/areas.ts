/**
 * מינימל 2's way around: six areas a manager thinks in, a word each. The rail lists the areas and nothing under them;
 * an area's pages stand in one rectangle at the head of the page, so nothing is named twice. A page is an address the
 * app already has; three of them are a second view of an existing address (`?view=`), so no route was added and any
 * other style opening the same link still lands on the page that owns the thing.
 */
import type { LineName } from "./icons";

export type PageId =
  | "overview"
  | "faults"
  | "approvals"
  | "shortages"
  | "orders"
  | "customers"
  | "stock"
  | "movements"
  | "map"
  | "suppliers"
  | "closing"
  | "documentation"
  | "team";

export interface PageDef {
  id: PageId;
  /** The word on the page's place in its area's rectangle; for an area of one page, the page's own title. */
  label: string;
  /** One drawing a thing: the same one wherever the thing is named, in the rectangle and on the overview. */
  icon: LineName;
  href: string;
}

export interface AreaDef {
  id: string;
  label: string;
  icon: LineName;
  pages: PageDef[];
}

export const VIEW_PARAM = "view";

/** The area whose pages are what waits on the manager; the one count in the rail is theirs. */
export const TASKS = "tasks";

export const AREAS: AreaDef[] = [
  { id: "overview", label: "סקירה", icon: "layout-dashboard", pages: [{ id: "overview", label: "סקירת המפעל", icon: "layout-dashboard", href: "/" }] },
  {
    id: TASKS,
    label: "משימות לביצוע",
    icon: "list-checks",
    pages: [
      { id: "faults", label: "תקלות", icon: "wrench", href: "/faults" },
      { id: "approvals", label: "אישורים", icon: "clipboard-check", href: "/closing?view=approvals" },
      { id: "shortages", label: "חוסרים", icon: "package-x", href: "/inventory?view=shortages" },
    ],
  },
  {
    id: "sales",
    label: "מכירות",
    icon: "receipt-text",
    pages: [
      { id: "orders", label: "הזמנות", icon: "receipt-text", href: "/orders" },
      { id: "customers", label: "לקוחות", icon: "users", href: "/orders?view=customers" },
    ],
  },
  {
    id: "warehouse",
    label: "מחסן",
    icon: "warehouse",
    pages: [
      { id: "stock", label: "מלאי", icon: "package", href: "/inventory" },
      { id: "movements", label: "תנועות", icon: "arrow-left-right", href: "/movements" },
      { id: "map", label: "מפה", icon: "map-pin", href: "/3d" },
    ],
  },
  { id: "buying", label: "ספקים", icon: "truck", pages: [{ id: "suppliers", label: "ספקים", icon: "truck", href: "/suppliers" }] },
  {
    id: "control",
    label: "בקרה",
    icon: "calendar-check",
    pages: [
      { id: "closing", label: "סגירת יום", icon: "calendar-check", href: "/closing" },
      { id: "documentation", label: "תיעוד", icon: "file-text", href: "/documentation" },
      { id: "team", label: "צוות", icon: "user-round-check", href: "/team" },
    ],
  },
];

const PAGES: PageDef[] = AREAS.flatMap((a) => a.pages);

export const pageDef = (id: PageId): PageDef => PAGES.find((p) => p.id === id) ?? PAGES[0];

export const areaOf = (id: PageId): AreaDef => AREAS.find((a) => a.pages.some((p) => p.id === id)) ?? AREAS[0];

/** Which page an address is. Null for an address the app has no page for: it gets the shared 404, not סקירה under a wrong address. */
export function pageAt(pathname: string, view: string | null): PageId | null {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (pathname === "/") return "overview";
  if (under("/faults")) return "faults";
  if (under("/closing")) return view === "approvals" ? "approvals" : "closing";
  if (under("/inventory")) return view === "shortages" ? "shortages" : "stock";
  if (under("/orders")) return view === "customers" ? "customers" : "orders";
  if (under("/movements")) return "movements";
  if (under("/3d")) return "map";
  if (under("/suppliers")) return "suppliers";
  if (under("/documentation")) return "documentation";
  if (under("/team")) return "team";
  return null;
}
