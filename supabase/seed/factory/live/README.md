# Live days

Fills the days between the last activity in the live database and now, forward from the live state, in the
year's rhythm: agents' orders by trade (a port of `03_orders.sql`), deliveries with a photographed receipt,
supplier trucks on each supplier's calendar, morning cycle counts, a few faults. First run 2026-11-16: the
days 2026-11-03 to 14:11 that day, ids with `-1116-` in their second block.

Unlike the year's scripts, nothing here turns triggers off. Every movement goes in one at a time, oldest
first, through `movements_guard`, `movements_apply` and `movements_shelves`, so stock, shelves and supplier
names follow by themselves. That is why each delivery's receipt photo must be in `delivery-notes` before the
SQL runs.

Run from a scratch folder (the scripts write `state.json`, `plan.json`, `receipts/` and `apply.sql` there):

1. `node fetch.mjs` reads the live state through the public REST API.
2. `node plan.mjs <cutoff ISO> <seed>` with `K1=1.6 K2=14` plans the days and checks that no shelf goes under
   zero. `--score` prints one line of metrics instead; try a few hundred seeds and keep one where today has
   deliveries and trucks, stock worth stays within a few percent, and the week figures move less than 30%.
3. `node render.mjs --upload` draws one paper per document and uploads it (anon may add, never replace, so a
   redraw needs a new path).
4. `node sql.mjs` writes `apply.sql`, compact enough for `execute_sql` (about 36 KB for two weeks). It stops
   by itself if stock moved since step 1, and rolls back unless every product lands where the plan put it.
5. Rebuild the frozen `day_closings` of the filled days with the loop of `08_day_closings.sql`, writing only
   those days.

Before a new run, edit in `plan.mjs`: `FIRST` (the first day to fill), the next visit dates of the suppliers
that come every few weeks (`COMES`), the faults and `closeOld`, and the batch marker in `sid()` (both files).
Orders that are the owner's own tests (not `de2` ids) are never delivered. To take one batch out, delete by
its marker, then recount with `recount_reserved`; stock does not go back by itself.
