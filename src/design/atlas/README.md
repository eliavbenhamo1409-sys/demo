# ATLAS 2028 (מרחב 4) — how this style is built

The owner's brief is `BRIEF-ATLAS-2028.md` beside this file. This note is the engineering side: where things are, what a page may
use, and the rules every page keeps.

## Wiring
- Style ids `atlas` / `atlas-dark`, label מרחב 4, admin only (`src/lib/theme.tsx` paints `/worker` and `/catalog` as `minimal`).
- `src/components/atlas/use-atlas.ts` holds the one `import()` of `Shell.tsx`; `first-paint.css` is the only file anyone else downloads.
  Never import anything from `src/components/atlas` or `src/design/atlas` statically from outside `src/components/atlas`.
- `Shell.tsx` renders the three zones on one grid: `.at-spine` (zone A, right, `Spine.tsx`, five words from `areas.ts`), `.at-work`
  (zone B, the scroll container; CSS container name `work`), `.at-side` (zone C, left, only while `data-side` is set).
  `OWN` lists the pages this style composes itself (`pages/<Page>.tsx` + `src/design/atlas/<page>.css`); every other route keeps the
  shared page, dressed by the tokens (`foundation.css`).
- The model is מרחב's `TwinProvider` (`src/components/merhav/twin/Twin.tsx`), one engine under the whole admin, with the door kind
  `frame`: a page cuts one box with `<ModelFrame>` (`Frame.tsx`, `[data-twin-frame]`) and Twin fits the model into it. `STAGE` in
  `Shell.tsx` says how each route stands on the model: `hero` (a frame on the page, סקירה), `full` (the model is the page, מחסן),
  `aside` (a window over the docked drawer shows the chosen thing's place: `Focus.tsx` for orders, faults and movements,
  מרחב's `PanelFocus` for products), `none`.
- The shared drawers (`.app-panelHost`) dock on the left as zone C, no scrim, 240ms. A page's own side is `<Side label>` from
  `side.tsx`, one per page, a portal into zone C; an open drawer stands over it.
- `--mh-rail` is set to the spine's width so the world spans everything beside it. Fonts: `at-heebo` (Hebrew) and `at-inter`
  (Latin and numbers), self-hosted in `fonts/` (OFL).

## What a page may use
- Data: `useData()` from `@/lib/store` (products, orders, faults, movements, suppliers, supplierItems, workers, itemRequests,
  `product(id)`, `supplier(id)`, `worker(id)`, `linesOf(orderId)`, `stats`, `attention`, the mutations), `useUi()` from
  `@/components/app/ui-state` (openProduct / openOrder / openFault / openMovement / openAction), `@/lib/format`, `@/lib/snapshot`,
  `@/lib/movements-range`.
- The model: `useTwin()` from `@/components/merhav/twin/Twin` (spotProduct, spotObjects, aimProduct, itemsOf, placeOf, holdCamera,
  listen, setPageRoutes, setPastSlots, setAnchors, model, objects, engine). Pointing at a row spots its place; clean up on unmount.
- Parts: `parts.tsx` (`Head`, `Summary`, `StateWord`, `Meter`), `HomeButton.tsx` (the way back after turning the model by hand; render it inside the page's `ModelFrame`, never in the world, whose corner lies under the side), the shared `@/components/ui` (Button, Icon, SearchBar, Select, Tabs,
  EmptyState, Notice), `ProductThumb` from `@/components/app/Viz`.
- Classes that are global once the style is loaded: `.at-head/.at-title/.at-line/.at-head-end`, `.at-sum`, `.at-tools`,
  `.at-table-wrap/.at-table` (th 44, td 56 with a second line, `td.is-num` LTR tabular), `.at-cell/.at-cell-text/.at-cell-title/
  .at-cell-sub`, `.at-state`, `.at-meter`, `.at-tone-ok/-warn/-out/-short/-quiet/-in`, `.at-side-head`. A page adds its own with a
  prefix of its own (`.at-mv-`, `.at-or-`, `.at-fa-`, `.at-su-`, `.at-wh-`).

## The rules every page keeps
- One screen, one purpose; the eye knows what is first, second, third. What adds no understanding goes. A figure has one home per view: the tabs' counts are not repeated in the summary line, a table's foot appears only while something is filtered or more rows wait.
- One word for one thing across pages: the state column is מצב, an order's lines are פריטים, a low product is מתחת למינימום, an open fault reads in red everywhere (amber is for a warning, red for a fault or a shortage), routine goods out are neutral ink with a minus, not red.
- 70% mineral white and white, 20% ink, 8% jade, 2% amber and red, and those only where something needs a hand. Colour always
  with a word, never alone; never a filled row for a bad state; `--short` is the one loud mark.
- Type from the tokens: titles 32/40 at 500, sections 20/28, items 15–16, body 14–15, meta 13; numbers tabular inside `.ltr`.
  At most four levels in one area; a number grows only when it is the figure that matters.
- Spacing 4, 8, 12, 16, 24, 32, 48. Rules 1px. Radii 6–10 on working parts, larger only on what floats. No shadow on a panel.
- Tables ruled between rows only; hover almost invisible; the chosen row on soft jade. Numbers aligned, units consistent.
- One primary key per area. Inputs 40–44 high, white, one divider, jade focus. Tabs are text with one exact underline.
- Motion 120 / 150 / 240 ms on `--ease`; nothing loops, flashes or glows. Every move explains a change of state.
- Everything keeps working: filters, URL state, tabs, actions and the drawers of the shared page stay as they are. No data is
  invented, no sample rows. No document numbers on screen (the owner's rule): a receipt goes by its date, supplier or customer.
- RTL throughout: logical properties, codes such as `C-2/4R` inside `.ltr`.
- A phone (max-width 899px) stacks the zones (`responsive.css`): secondary columns hide, actions stay large.
