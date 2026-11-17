/**
 * מינימל 2's way around: six areas a manager thinks in, each holding its pages. A page is an address the app already has;
 * three of them are a second view of an existing address (`?view=`), so no route was added and any other style opening
 * the same link still lands on the page that owns the thing.
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
  label: string;
  href: string;
}

export interface AreaDef {
  id: string;
  label: string;
  /** What is inside, in the words of its pages: read under the area's name while it is folded. */
  about: string;
  icon: LineName;
  pages: PageDef[];
}

export const VIEW_PARAM = "view";

export const AREAS: AreaDef[] = [
  { id: "overview", label: "סקירת מנהל", about: "תמונת מצב ופעילות", icon: "layout-dashboard", pages: [{ id: "overview", label: "סקירת מנהל", href: "/" }] },
  {
    id: "attention",
    label: "דורש טיפול",
    about: "תקלות, אישורים וחוסרים",
    icon: "list-checks",
    pages: [
      { id: "faults", label: "תקלות", href: "/faults" },
      { id: "approvals", label: "אישורים", href: "/closing?view=approvals" },
      { id: "shortages", label: "חוסרים", href: "/inventory?view=shortages" },
    ],
  },
  {
    id: "sales",
    label: "הזמנות ומכירות",
    about: "הזמנות, מסירות ולקוחות",
    icon: "receipt-text",
    pages: [
      { id: "orders", label: "הזמנות", href: "/orders" },
      { id: "customers", label: "לקוחות", href: "/orders?view=customers" },
    ],
  },
  {
    id: "warehouse",
    label: "מחסן ומלאי",
    about: "מוצרים, תנועות ומיקום",
    icon: "warehouse",
    pages: [
      { id: "stock", label: "מלאי", href: "/inventory" },
      { id: "movements", label: "תנועות", href: "/movements" },
      { id: "map", label: "מפת מחסן 3D", href: "/3d" },
    ],
  },
  { id: "buying", label: "רכש וספקים", about: "ספקים ושיוך מוצרים", icon: "truck", pages: [{ id: "suppliers", label: "רכש וספקים", href: "/suppliers" }] },
  {
    id: "control",
    label: "בקרה ודוחות",
    about: "סגירת יום, תיעוד וצוות",
    icon: "calendar-check",
    pages: [
      { id: "closing", label: "סגירת יום", href: "/closing" },
      { id: "documentation", label: "תיעוד", href: "/documentation" },
      { id: "team", label: "צוות", href: "/team" },
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
