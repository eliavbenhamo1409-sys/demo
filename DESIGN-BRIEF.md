# ניהול מלאי — build brief (read fully before writing code)

Hebrew, RTL, nine pages only: **סקירה** (`/`), **מלאי** (`/inventory`), **3D** (`/3d`), **הזמנות** (`/orders`), **תנועות** (`/movements`), **תקלות** (`/faults`), **תיעוד** (`/documentation`), **מילון ספקים** (`/suppliers`), **צוות** (`/team`). Do not add pages; new workflows go into tabs or side panels of these. **תיעוד** and **צוות** have no sidebar row: they open from the settings dialog (`SETTINGS_PAGES` in `AppShell.tsx`).
Stack: Next.js 16 App Router (`src/app`), React 19, TypeScript strict, Tailwind v4 (`src/app/globals.css`), Supabase JS.
All pages are **client components** driven by `useData()` from `src/lib/store.tsx` (realtime + optimistic writes) and `useUi()` from `src/components/app/ui-state.tsx`.
**No demo/mock data anywhere.** If a table is empty, render a quiet `EmptyState` that says what to do. Never hardcode names, numbers or rows.

## One site, three systems
This app is the one deployment: the manager's dashboard at `/` behind the login, the worker app at `/worker` and the agents' catalogue at `/catalog`, both open. `ShellGate` and `AuthGate` route between them, and `SystemSwitch` at the very bottom of every page moves between the three. The worker keeps `.wk-*` and `src/components/worker`, the catalogue keeps `.cg-*` under `.cg-root`, its own look (see `src/app/catalog/catalog.css`) and its own data in `src/lib/catalog`. A class name shared by two systems reaches both, so scope it.

## The design system (source of truth)
- `src/design/tokens.css` — CSS variables (colours, spacing, radii, heights, fonts). Use `var(--…)` or the Tailwind theme aliases in `globals.css` (e.g. `text-ink-2`, `bg-surface`, `border-line`).
- `src/design/components.css` — ready `sa-*` classes for every component. **Use these classes**; add Tailwind only for layout.
- `src/components/ui/` — the typed components, re-exported from `index.ts`.
- These files are shared: `src/design/*`, `src/lib/theme.tsx` and `src/components/ui/*` are copied to `worker/`, so a change goes to both apps.
- `agent/` is a third app, the catalogue site field agents sell from. It uses the same Supabase project but has its own look, so none of the shared files are copied to it.
- The admin's classic light theme sits one step deeper than the shared tokens (canvas, greys, rules). That override lives in `src/app/globals.css`, not in `tokens.css`, so the worker keeps its own values.
- Font: in the default aluminium style (`minimal`, `minimal-dark`) the face is the platform's own through `system-ui`: San Francisco on a Mac or iPhone, Segoe on Windows, Roboto on Android, and no web font loads. Every digit in the product is tabular through `body`, so a figure never jumps and needs no class. `--font-mono` is the same family: `.sa-mono` only keeps a code left to right. No code font, anywhere; it is what made the product look like a terminal. The classic style keeps IBM Plex Sans Hebrew, self-hosted in `public/fonts/plex/`.
- `src/design/minimal.css` — the aluminium style's component overrides, scoped to `[data-theme^="minimal"]`, so light and dark share every shape and differ only in tokens. Tokens for it live in `tokens.css` after the `:root` block.
- Small data pictures live in `src/components/app/Viz.tsx` (`StockBar`, `StockMeter`, `SparkBars`, `CountUp`, `ProductThumb`), admin only.

## Design language (what "premium" means here)
The product is sold to factories for ₪150,000. It must read as a serious instrument, never as a template or a toy, and it must be a pleasure to look at for hours. Two styles, each in light and dark, chosen in the settings dialog (`src/lib/theme.tsx`: ids `light`, `dark`, `minimal`, `minimal-dark`). The aluminium style, id `minimal`, is the default; a saved choice stays:
- **Classic** (`light` / `dark`): the older language at the end of this section, graphite ink on warm paper.
- **Aluminium** (`minimal` / `minimal-dark`): designed the way Apple designs its own tools, for the people in an aluminium factory. On 2026-11-02 the owner said the ruled ledger looked like a system from the eighties, so the code font, the black rules, the filled table heads and the flat grey desk are gone for good. Do not bring them back.
  - **The audience:** a warehouse manager and a factory owner, not a designer. They read at arm's length, for hours, often on their feet. So: big type, near-black text, plain Hebrew, big targets, nothing that appears only on hover, and every state a word as well as a colour. A screen must answer "what needs me now" before anything else. Beauty never costs legibility: the owner has twice rejected pale and thin.
  - **Depth, not lines:** white sheets float on a cool silver desk (`#eeeef3`; dark: `#1c1c1e` on black). A card is a soft shadow (`--shadow-card`) with continuous corners and no border. Boxes are never drawn. A row rule is one light line that starts at the text, as on an iPhone. The sidebar and the drawer float clear of the window edge. Glass (`--bg-glass`) is for the toolbar only, where content really passes under it.
  - **Colour:** blue `#0071e3` is what you can press: the primary button, where you are in the sidebar, links, focus, a set filter. Green, orange and red say what the stock is doing, as a word, a figure or a bar of data, and they are vivid. Coloured text uses the `-text` tokens, which clear 4.5:1 on white. Goods in are green, goods out red on the figure. `--short` stays a step louder than `--danger-text`, and nothing else uses it.
  - **Data is the picture:** `StockBar` splits a whole like an iPhone's storage bar, `StockMeter` is a battery whose middle mark is the minimum, `SparkBars` is the week beside a figure, the weekly chart stacks goods in over goods out, and every product row leads with its own photo. A picture only where it shows real data. Everything works with empty data.
  - **Type:** the page title is 34/44 700, a card title 18/600, the name in a row 16/600, the figure that matters 18/600, a KPI 46/54 700. Figures may tighten by -0.02em; Hebrew letter-spacing stays 0. Small text never goes below 13px, and `--text-quiet` is only for what is empty, unset or still to come.
  - **Controls:** tabs and choices are one segmented control whose thumb slides. A secondary button is a quiet fill, not an outlined box. A field is a white well that lights up blue. `--control-md` is 40, a row 64.
  - **Corners:** `corner-shape: squircle` where the browser has it, so radii are larger there (`--radius-md` 14, `--radius-lg` 26). Corners nest: an inner radius is the outer one minus the gap.
  - **Motion:** one curve (`--ease`) and three lengths (`--dur-1/2/3`). A press answers at once (0.97, 0ms) and lets go softly. A page's surfaces arrive once, one after another. Bars grow and figures climb when data arrives, once, and never loop. Modals rise, menus drop, a drawer leaves the way it came. State is fill, never weight, so neighbours never move. `prefers-reduced-motion` turns it all off.

Rules that hold in both styles:
- **No tiles.** No letter marks ("מ" in a square), no coloured squares behind icons, no initials in discs, no status pills, no chips with fills. The product name is set in type, with nothing beside it.
- **Calm.** Urgency comes from position, not volume. No red borders, warning triangles, solid red pills or red notification discs. The one exception is a form field with a validation error: red border and red message, because the worker must find it.
- **Icons are thin, bare and grey, and help the eye find a word; they never replace it.** They sit beside navigation, the actions menu and its items, stat labels, movement types, attention groups, search results and buttons that act. No icons on card titles or empty states, and no tile behind them.
- **No sparkle.** No glow, shimmer, gradients on surfaces, AI-star icons or flashing. No uppercase, no tracked-out labels, no dashed borders. The worker document scan stays as it is.
- **A sign appears only when it says something.** No "מחובר" on every screen, only a word when the connection is off. No keyboard-hint chips. No dead buttons.
- **Copy is short.** Title, at most one short line. Buttons name what they do. No "דחוף" drama. No sentences that explain the obvious.

The classic style keeps its older limits: graphite primary button, 1px rules, radii of 3 to 6px, 0.1s linear motion, page title 24/32, weight 600 at most.

Layout: content max-width 1340px, padding `--space-8` / `--space-10`. Overview: four cards, then the worklist beside the week, then open orders, then recent movements.

Page anatomy, one for all nine: every page is `.sa-page`. `PageHead` has one height everywhere: the title on the button line, one quiet fact no tab states (its line stays reserved, so nothing below moves), actions at the end with at most one primary. Then `Toolbar` or the first surface, then surfaces `--space-5` apart. `Toolbar` puts tabs at the start and the search at the far end at 320, on every page. Creating is a plus icon. A footer appears only when something is hidden (`Showing`).

The **3D** page is the warehouse at a glance, and the one page with no column limit: the rail at the inline start holds the page head, three summary figures, the tabs and a ruled ledger of every product (place, quantity, percent of its minimum, the shared `StockMeter`), what needs a hand first and every column named. The stage takes the rest to the bottom edge on `--scene-canvas`. The scene is soft and serious: matte sage and neutral forms in real proportions, no ink lines, no wire, nothing toylike. A rule on the floor marks what needs a hand, and the tags use the same percent as the ledger. `products.qty` is the only quantity: how full a rack looks is its `fill` (half a rack is the minimum), every number is DOM from the store, never a canvas texture, and quantities never sum across products. Every ₪ is a sale price and says במחירון. Machines, zones and the forklift are geometry with no status. Motion comes only from a new `movements.id`. The past view is read only and hides status and ₪. `--scene-*` tokens live in `src/components/map3d/map3d.css`, never in `src/design`, and `three` is reached only through `import()` inside an effect.

## Data model (Supabase, `src/lib/database.types.ts`)
products(id, sku, barcode, name, category, unit, qty, reserved, min_qty, location, primary_supplier_id, notes, in_catalog, description, price, image_path, created_at, updated_at) — qty is what is physically on the shelf; reserved is what open orders hold, kept only by the order functions, and no client ever writes it. Available is qty − reserved (`available(p)` in the store), negative when the shelf fell below what is held. Photos live in the public bucket `product-photos`, managed by the signed-in admin (`src/lib/product-photos.ts`).
movements(id, type in|out|fault|adjust, product_id, qty, worker_id, supplier_id, reference, note, created_at) — a DB trigger keeps products.qty in sync; the store does the same optimistically.
faults(id, product_id, movement_id, description, reported_by, status open|resolved, created_at, resolved_at)
suppliers(id, name, contact, phone, email, notes)
supplier_items(id, supplier_id, external_name, external_sku, product_id, status approved|pending)
workers(id, name, role, active)
agents(id, name, phone, active, created_at) — insert and update for the signed-in admin only; never deleted, an agent is deactivated like a worker.
orders(id, number, request_id, agent_id, customer, customer_phone, note, status open|delivered|cancelled, created_at, closed_at) — number is the human order number, from 1001.
order_lines(id, order_id, product_id, qty, unit_price, movement_id) — unit_price is the price when ordered and may be null; movement_id is set on delivery.

**Orders are written only through RPCs.** `orders` and `order_lines` are read-only to clients. The catalogue site places an order with `create_order`, which holds its stock. The admin closes one with `deliver_order` (one out movement per line, the order closed, the hold released) or `cancel_order` (the order closed, the hold released, the stock never moved). Each is atomic and raises a Hebrew message; show it as it is.

`useData()` returns: `state.{products,movements,suppliers,supplierItems,faults,workers,agents,orders,orderLines,status,error,live}`, lookups `product(id)`, `supplier(id)`, `worker(id)`, `agent(id)`, `order(id)`, `linesOf(orderId)`, derived `attention` (sorted AttentionEntry[]), `stats`, `weekly` (7 DayPoint), and writes: receive, issue, adjust, reportFault, resolveFault, reopenFault, createProduct, updateProduct, deleteProduct, createSupplier, updateSupplier, deleteSupplier, createWorker, updateWorker, createAgent, updateAgent, deliverOrder, cancelOrder, createSupplierItem, mapSupplierItem, approveSupplierItem, unapproveSupplierItem, deleteSupplierItem, fetchProductHistory. All writes return promises and throw `Error(message)` on failure — show the error in a `Notice tone="danger"` next to the form, and `notify({tone:"success", …})` on success. The store also exports `available(p)` and `orderTotal(lines)`.

`useUi()` returns: `panel`, `openAction(kind, ctx)`, `openProduct(id, tab?)`, `openOrder(id)`, `close()`, `toasts`, `notify`, `dismiss`. Hosts: `src/components/app/ActionDrawer.tsx` (all action forms), `src/components/app/ProductPanel.tsx` (product details+history) and `src/components/app/OrderPanel.tsx` (one order and how it closes) are rendered by `AppShell`.

Formatting helpers in `src/lib/format.ts`: fmtQty, fmtPrice, fmtSigned, fmtTime, fmtDate, fmtDateTime, fmtRelative, fmtWhen, MOVEMENT_LABEL, ORDER_STATUS_LABEL.

## Copy rules
Hebrew only in UI; codes/SKUs Latin. No exclamation marks. One concept, one word, in both apps:
- **Processes:** קליטת סחורה (קליטה), הוצאת סחורה (הוצאה), דיווח תקלה, תיקון ספירה. The worker's own first person stays on its home rows and questions: קיבלתי סחורה, מסרתי סחורה ללקוח, למי מסרת.
- **Objects:** שורה is one line of a document. מספר תעודה is the document's number. מוצר חדש for an item the warehouse doesn't have. מק"ט, ספק, התאמה, חריגה stay. The archive tabs קבלות הכנסה and קבלות הוצאה are the owner's words.
- **The manager:** the worker reads אצל המנהל on a line, העברה למנהל on the button, יועבר למנהל before saving, הועבר למנהל after. The admin reads ממתין.
- **Orders:** הזמנה is what a סוכן places for a לקוח. משוריין is stock an open order holds. זמין is what can still be promised: on the shelf minus משוריין. When משוריין passes the shelf, the gap reads חסר and the product is חסר להזמנות. An order is פתוחה until it closes as נמסרה (the goods left, the button is סימון כנמסרה) or בוטלה (the button is ביטול הזמנה).
- **Buttons are action nouns, gender neutral:** שמירה, אישור, ביטול, מחיקה, הסרה, ניסיון נוסף. A button that opens a form names the thing with a plus (ספק חדש); the button that commits adds it (הוספת ספק).
- **Sentences never address a man:** אפשר להסיר את הסינון. Empty: אין {noun}. No match: לא נמצאו {noun}. Placeholders: חיפוש לפי..., no ellipsis.

## Quality bar
`npm run typecheck` (tsc --noEmit) and `npm run lint` must pass with zero errors. No `any`. No unused code. Components must work with empty data.
