# Super Admin — build brief (read fully before writing code)

Hebrew, RTL, three pages only: **סקירה** (`/`), **מלאי** (`/inventory`), **מילון ספקים** (`/suppliers`).
Stack: Next.js 16 App Router (`src/app`), React 19, TypeScript strict, Tailwind v4 (`src/app/globals.css`), Supabase JS.
All pages are **client components** driven by `useData()` from `src/lib/store.tsx` (realtime + optimistic writes) and `useUi()` from `src/components/app/ui-state.tsx`.
**No demo/mock data anywhere.** If a table is empty, render a quiet `EmptyState` that says what to do. Never hardcode names, numbers or rows.

## The design system (source of truth)
- `src/design/tokens.css` — CSS variables (colours, spacing, radii, heights, fonts). Use `var(--…)` or the Tailwind theme aliases in `globals.css` (e.g. `text-ink-2`, `bg-surface`, `border-line`).
- `src/design/components.css` — ready `sa-*` classes for every component (button, badge, input, select, menu, tabs, card, table, stat, attention, panel, fields, timeline, movement, mapping, sidebar, nav, topbar, stepper, empty, notice, modal, qty, skeleton). **Use these classes**; add Tailwind only for layout.
- `src/design/reference-index.d.ts.txt` — the **props contract** for every component. Implement the TSX components in `src/components/ui/<Name>.tsx` with exactly these props (plus `className`), named exports, and re-export all from `src/components/ui/index.ts`.
- `src/design/reference-bundle.js.txt` — the reference implementation (plain React). Port its markup/classes/behaviour faithfully to typed TSX; it is the spec for class names and interaction (menus, keyboard, focus, Escape).
- Font: Heebo via `@font-face` in tokens.css (file at `/fonts/Heebo.ttf`). Mono for every number/SKU/time (`.sa-mono`, `.sa-num`, `direction: ltr`).

## Design direction (what "premium" means here)
Base rules: ink before colour; colour only for state (accent=out/selected/focus, success=in/ok, warning=needs attention, danger=fault/out-of-stock); 1px lines + generous whitespace build hierarchy; near-black primary button once per area; no gradients, no emoji, no decorative icons, no pastel badges.
Elevate beyond the strict spec (user asked for "a ₪150k product"):
- Page title large and light-weight (28–32px, weight 600–700, tight tracking), one short subline in `text-secondary`.
- Content area max-width 1280px, padding `--space-8` vertical / `--space-10` horizontal, 12-col grid gap `--space-4`; cards align to a shared hairline grid.
- Overview layout (desktop): left/main 8 cols: 3 Stats row → "דורש טיפול" card → recent movements table. Right rail 4 cols: a "תנועות השבוע" bar chart card (pure SVG/CSS, 7 bars, today's bar in `--accent`, others in muted; hover tooltip with count and in/out split) and a compact "פעולות" list card (קליטת סחורה / הוצאת סחורה / דיווח תקלה / מוצר חדש) each row = icon tile + title + sub + a secondary button. Below 1100px the rail stacks under the main column.
- Motion: 0.1s control transitions; panel slide-in 0.3s cubic-bezier(0.16,1,0.3,1) over a scrim; skeleton rows while loading; nothing bounces.
- Hover row actions appear on hover/focus-within; row click opens the SidePanel; Escape closes; focus returns.
- Everything keyboard reachable; every icon-only button has `aria-label`; tables have `caption` (visually hidden OK).

## Data model (Supabase, `src/lib/database.types.ts`)
products(id, sku, name, category, unit, qty, min_qty, location, primary_supplier_id, notes, created_at, updated_at)
movements(id, type in|out|fault|adjust, product_id, qty, worker_id, supplier_id, reference, note, created_at) — a DB trigger keeps products.qty in sync; the store does the same optimistically.
faults(id, product_id, movement_id, description, reported_by, status open|resolved, created_at, resolved_at)
suppliers(id, name, contact, phone, email, notes)
supplier_items(id, supplier_id, external_name, external_sku, product_id, status approved|pending)
workers(id, name, role, active)

`useData()` returns: `state.{products,movements,suppliers,supplierItems,faults,workers,status,error,live}`, lookups `product(id)`, `supplier(id)`, `worker(id)`, derived `attention` (sorted AttentionEntry[]), `stats`, `weekly` (7 DayPoint), and writes: receive, issue, adjust, reportFault, resolveFault, reopenFault, createProduct, updateProduct, deleteProduct, createSupplier, updateSupplier, deleteSupplier, createWorker, updateWorker, createSupplierItem, mapSupplierItem, approveSupplierItem, unapproveSupplierItem, deleteSupplierItem, fetchProductHistory. All writes return promises and throw `Error(message)` on failure — show the error in a `Notice tone="danger"` next to the form, and `notify({tone:"success", …})` on success.

`useUi()` returns: `panel`, `openAction(kind, ctx)`, `openProduct(id, tab?)`, `close()`, `toasts`, `notify`, `dismiss`. Hosts: `src/components/app/ActionDrawer.tsx` (all action forms) and `src/components/app/ProductPanel.tsx` (product details+history) are rendered by `AppShell`.

Formatting helpers in `src/lib/format.ts`: fmtQty, fmtSigned, fmtTime, fmtDate, fmtDateTime, fmtRelative, fmtWhen, MOVEMENT_LABEL, initials.

## Copy rules
Hebrew only in UI; codes/SKUs Latin in mono. Imperative verbs on buttons naming the action ("קלוט", "הוצא", "שמור", "אשר", "מחק מוצר"). Terms: קליטה, הוצאה, תקלה, חריגה, מק"ט, מק"ט חיצוני, ספק, התאמה. No exclamation marks.

## Quality bar
`npm run typecheck` (tsc --noEmit) and `npm run lint` must pass with zero errors. No `any`. No unused code. Components must work with empty data.
