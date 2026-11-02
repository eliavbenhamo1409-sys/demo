# The factory dataset

A year of an aluminium profiles and sheets factory, November 2025 to November 2026: about ₪42M of sales, ₪8M on the shelf,
204 products, 30 racks and 5 floor areas. It replaces `demo_factory.sql`, `demo_history.sql` and `shelf_stock.sql`, which
described a much smaller warehouse. The 20 first products and the live orders from 1001 keep their ids.

The scripts ran in this order through the Supabase MCP, each as one transaction. They run as the `postgres` role, and
`session_replication_role = replica` keeps the triggers out of the way, so nothing here may run against a warehouse in use.

| Script | What it does |
| --- | --- |
| `01_catalog.sql` | Workers, suppliers and 184 new products. A family gives a product its category, description and alloy note. |
| `02_year.sql` | Orders day by day, then the ledger built backwards from today's shelf, so every balance lands exactly on `products.qty`. Sales and stock are scaled to their targets inside the script. |
| `03_shelves.sql` | Puts every unit on a shelf and sets `movements.place` and `orders.promised_on`. Clear `shelf_stock` first. |
| `04_paper_and_floor.sql` | Receipts, supplier names, faults, item requests and the owner's exit passes. |
| `05_day_closings.sql` | Freezes every day of the year, with the stock of that night rebuilt from the ledger. |
| `06_trucks_before_orders.sql` | Moves a delivery ahead of the orders that needed it, so no running balance dips under zero inside a day. |
| `receipts.mjs` | Draws one photographed paper per document and uploads it to the path its row names. Needs `playwright-core`. Anon can add to the bucket but not replace, so a redraw needs a new `storage_path`. |

Generated rows carry an id prefix, which is how they are taken out and rebuilt: `de1` movements, `de2` orders, `de3` order
lines, `de4` faults, `de6` documents, `de7` item requests, `de8` exit passes. After deleting them, recount with
`recount_reserved`.

Checks worth repeating after any change: replaying each product's movements lands on `products.qty` and never goes under
zero, `products.reserved` equals the open order lines, and `shelf_stock` never adds up to more than `products.qty`.

The product photos came from `agent/demo-render`. The receipts name a made-up issuer, נ.ל. אלומיניום פרופילים ולוחות בע״מ.
