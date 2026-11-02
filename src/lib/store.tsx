"use client";

/**
 * Reactive data layer for the inventory app.
 *
 * - Loads every table once (factory-scale data), keeps it in React state.
 * - Subscribes to Supabase Realtime (postgres_changes) so every client stays
 *   in sync without refreshes.
 * - Mutations are optimistic: state changes immediately, then the row is
 *   written; on failure the change is rolled back and the error is thrown.
 * - Derived data (attention list, stats, weekly series) is memoised here so
 *   pages stay thin.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import { FAULT_PHOTOS_BUCKET } from "@/lib/fault-photos";
import { fmtQty } from "@/lib/format";
import type { StockState } from "@/lib/map3d/types";

export type Product = Tables<"products">;
export type Movement = Tables<"movements">;
export type Supplier = Tables<"suppliers">;
export type SupplierItem = Tables<"supplier_items">;
export type Fault = Tables<"faults">;
export type Worker = Tables<"workers">;
export type ItemRequest = Tables<"item_requests">;
export type DocumentRecord = Tables<"documents">;
export type Agent = Tables<"agents">;
export type Order = Tables<"orders">;
export type OrderLine = Tables<"order_lines">;
export type MovementType = Movement["type"];

type TableName = "products" | "movements" | "suppliers" | "supplier_items" | "faults" | "workers" | "item_requests" | "documents" | "agents" | "orders" | "order_lines";

type Row = { id: string };

/** Minimal untyped view of the Supabase client for table-generic write helpers. */
type LooseResult = { error: { message: string } | null };
type LooseClient = {
  from: (table: TableName) => {
    insert: (row: object) => { select: (cols: string) => { single: () => Promise<LooseResult & { data: Row | null }> } };
    update: (patch: object) => { eq: (col: string, value: string) => Promise<LooseResult> };
    delete: () => { eq: (col: string, value: string) => Promise<LooseResult> };
  };
};

type State = {
  products: Product[];
  movements: Movement[]; // most recent first, capped (see RECENT_MOVEMENTS)
  suppliers: Supplier[];
  supplierItems: SupplierItem[];
  faults: Fault[];
  workers: Worker[];
  itemRequests: ItemRequest[]; // most recent first
  documents: DocumentRecord[]; // most recent first
  agents: Agent[];
  orders: Order[]; // most recent first
  orderLines: OrderLine[];
  status: "loading" | "ready" | "error";
  error: string | null;
  live: boolean; // realtime channel subscribed
  loadedAt: number | null;
};

export const RECENT_MOVEMENTS = 400;

/** The most rows the API returns for one request. */
const API_PAGE = 1000;

const NOT_APPLIED = "הפעולה לא בוצעה. ייתכן שאין הרשאה";

const NO_LINES: OrderLine[] = [];

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** Reads a table that outgrows one API page, so an open order never loses its lines to the limit. */
async function allPages<T>(read: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<PageResult<T>> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await read(rows.length, rows.length + API_PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < API_PAGE) return { data: rows, error: null };
  }
}

type Action =
  | { type: "loaded"; data: Omit<State, "status" | "error" | "live" | "loadedAt"> }
  | { type: "error"; error: string }
  | { type: "live"; live: boolean }
  | { type: "upsert"; table: TableName; row: Row }
  | { type: "remove"; table: TableName; id: string }
  | { type: "replaceId"; table: TableName; tempId: string; row: Row };

const KEY: Record<TableName, keyof State> = {
  products: "products",
  movements: "movements",
  suppliers: "suppliers",
  supplier_items: "supplierItems",
  faults: "faults",
  workers: "workers",
  item_requests: "itemRequests",
  documents: "documents",
  agents: "agents",
  orders: "orders",
  order_lines: "orderLines",
};

function sortFor(table: TableName, rows: Row[]): Row[] {
  if (table === "movements" || table === "faults" || table === "item_requests" || table === "documents" || table === "orders") {
    return [...rows].sort((a, b) =>
      String((b as Movement).created_at).localeCompare(String((a as Movement).created_at)),
    );
  }
  if (table === "products") {
    return [...rows].sort((a, b) => (a as Product).name.localeCompare((b as Product).name, "he"));
  }
  if (table === "suppliers" || table === "workers" || table === "agents") {
    return [...rows].sort((a, b) => (a as Supplier).name.localeCompare((b as Supplier).name, "he"));
  }
  // The same order a load gives, so a line that arrives live doesn't reshuffle its order.
  if (table === "order_lines") return [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loaded":
      return { ...state, ...action.data, status: "ready", error: null, loadedAt: Date.now() };
    case "error":
      return { ...state, status: "error", error: action.error };
    case "live":
      return { ...state, live: action.live };
    case "upsert": {
      const key = KEY[action.table];
      const list = state[key] as Row[];
      const idx = list.findIndex((r) => r.id === action.row.id);
      let next: Row[];
      if (idx === -1) next = [action.row, ...list];
      else {
        next = list.slice();
        next[idx] = { ...list[idx], ...action.row };
      }
      next = sortFor(action.table, next);
      if (action.table === "movements" && next.length > RECENT_MOVEMENTS) next = next.slice(0, RECENT_MOVEMENTS);
      return { ...state, [key]: next };
    }
    case "remove": {
      const key = KEY[action.table];
      const list = state[key] as Row[];
      if (!list.some((r) => r.id === action.id)) return state;
      return { ...state, [key]: list.filter((r) => r.id !== action.id) };
    }
    case "replaceId": {
      const key = KEY[action.table];
      const list = state[key] as Row[];
      const without = list.filter((r) => r.id !== action.tempId && r.id !== action.row.id);
      return { ...state, [key]: sortFor(action.table, [action.row, ...without]) };
    }
    default:
      return state;
  }
}

const initial: State = {
  products: [],
  movements: [],
  suppliers: [],
  supplierItems: [],
  faults: [],
  workers: [],
  itemRequests: [],
  documents: [],
  agents: [],
  orders: [],
  orderLines: [],
  status: "loading",
  error: null,
  live: false,
  loadedAt: null,
};

/** What can still be promised: the shelf minus what open orders hold. Negative when the shelf fell below the holds. */
export function available(p: Pick<Product, "qty" | "reserved">): number {
  return p.qty - p.reserved;
}

/** One reading of a product's stock, for the attention list and the map alike. */
export function stockState(p: Pick<Product, "qty" | "reserved" | "min_qty">): StockState {
  const free = available(p);
  if (free < 0) return "short";
  if (p.qty <= 0) return "out";
  if (p.min_qty > 0 && free < p.min_qty) return "low";
  return "ok";
}

/** The order's value, or null while a line has no price. */
export function orderTotal(lines: OrderLine[]): number | null {
  if (lines.length === 0) return null;
  let total = 0;
  for (const l of lines) {
    if (l.unit_price === null) return null;
    total += l.qty * l.unit_price;
  }
  return total;
}

/* ─────────────────────────── derived types ─────────────────────────── */

export type AttentionKind = "out" | "low" | "short" | "fault" | "mapping" | "request";
export type AttentionEntry = {
  id: string;
  kind: AttentionKind;
  severity: "danger" | "warning";
  /** The word in the solid badge. */
  label: string;
  title: string;
  meta: string[];
  at: string; // ISO, for sorting
  productId?: string;
  faultId?: string;
  photoPath?: string;
  supplierItemId?: string;
  requestId?: string;
};

export type DayPoint = { day: string; label: string; in: number; out: number; total: number };

export type Stats = {
  products: number;
  low: number;
  out: number;
  movementsToday: number;
  movementsYesterday: number;
  inToday: number;
  outToday: number;
  openFaults: number;
  pendingMappings: number;
  pendingRequests: number;
  openOrders: number;
  reservedProducts: number;
  short: number;
  exceptions: number;
};

/* ─────────────────────────── mutations API ─────────────────────────── */

export type ReceiveInput = {
  productId: string;
  qty: number;
  supplierId?: string | null;
  workerId?: string | null;
  reference?: string | null;
  note?: string | null;
  /** The product name as written on the supplier's delivery note. With a supplier, this feeds the dictionary. */
  externalName?: string | null;
  externalSku?: string | null;
  /** The archived photo this line was read from. */
  documentId?: string | null;
};
export type IssueInput = Omit<ReceiveInput, "supplierId" | "externalName" | "externalSku">;

/** Result of translating a supplier's wording into the factory catalogue. */
export type NameResolution =
  | { status: "approved"; item: SupplierItem; product: Product }
  | { status: "pending"; item: SupplierItem; product: Product | null }
  | { status: "unknown"; item: null; product: null };

/** trim, lowercase, collapse whitespace — same rule as the DB's normalize_name(). */
export function normalizeName(t: string | null | undefined): string {
  return (t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
/** A receipt line the worker could not settle alone; it waits for the manager. */
export type ItemRequestInput = {
  kind: ItemRequest["kind"];
  externalName: string;
  proposedName?: string | null;
  qty: number;
  customer?: string | null;
  reference?: string | null;
  note?: string | null;
  workerNote?: string | null;
  workerId?: string | null;
  documentId?: string | null;
};
/** A photographed receipt, kept in the documents archive. */
export type DocumentInput = {
  kind: DocumentRecord["kind"];
  storagePath: string; // path in the delivery-notes bucket
  supplierId?: string | null;
  customer?: string | null;
  reference?: string | null;
  workerId?: string | null;
};
export type DocumentPatch = Pick<TablesUpdate<"documents">, "supplier_id" | "customer" | "reference">;
export type FaultPatch = { description: string; product_id: string | null };
export type FaultInput = {
  productId?: string | null;
  description: string;
  workerId?: string | null;
  qty?: number | null; // if given, also logs a 'fault' movement
  photoPath?: string | null; // storage path in the fault-photos bucket
  asset?: string | null; // the map object at fault, such as a machine
};

type Api = {
  state: State;
  reload: () => Promise<void>;
  // lookups
  product: (id: string | null | undefined) => Product | undefined;
  supplier: (id: string | null | undefined) => Supplier | undefined;
  worker: (id: string | null | undefined) => Worker | undefined;
  agent: (id: string | null | undefined) => Agent | undefined;
  order: (id: string | null | undefined) => Order | undefined;
  linesOf: (orderId: string) => OrderLine[];
  // derived
  attention: AttentionEntry[];
  stats: Stats;
  weekly: DayPoint[];
  // writes
  receive: (input: ReceiveInput) => Promise<Movement>;
  issue: (input: IssueInput) => Promise<Movement>;
  adjust: (productId: string, qty: number, workerId?: string | null, note?: string | null) => Promise<Movement>;
  reportFault: (input: FaultInput) => Promise<Fault>;
  resolveFault: (id: string) => Promise<void>;
  reopenFault: (id: string) => Promise<void>;
  updateFault: (fault: Fault, patch: FaultPatch) => Promise<void>;
  /** Removes the report and its photo for good; its movement and the stock stay. */
  deleteFault: (fault: Fault) => Promise<void>;
  createProduct: (input: TablesInsert<"products">) => Promise<Product>;
  updateProduct: (id: string, patch: TablesUpdate<"products">) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  createSupplier: (input: TablesInsert<"suppliers">) => Promise<Supplier>;
  updateSupplier: (id: string, patch: TablesUpdate<"suppliers">) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  createWorker: (input: TablesInsert<"workers">) => Promise<Worker>;
  updateWorker: (id: string, patch: TablesUpdate<"workers">) => Promise<void>;
  createAgent: (input: TablesInsert<"agents">) => Promise<Agent>;
  updateAgent: (id: string, patch: TablesUpdate<"agents">) => Promise<void>;
  /** Posts the order's out movements, closes it and releases its hold, atomically in the DB. */
  deliverOrder: (id: string, workerId?: string | null) => Promise<void>;
  /** Closes the order and releases its hold; the stock never moved. */
  cancelOrder: (id: string) => Promise<void>;
  createSupplierItem: (input: TablesInsert<"supplier_items">) => Promise<SupplierItem>;
  mapSupplierItem: (id: string, productId: string) => Promise<void>; // sets product + approved
  /** Translate a supplier's product name to the catalogue (exact match on the normalized name). */
  resolveSupplierName: (supplierId: string | null | undefined, name: string) => NameResolution;
  /** Dictionary entries of one supplier that match a partial name, most-used first. */
  suggestSupplierNames: (supplierId: string | null | undefined, query: string, limit?: number) => SupplierItem[];
  approveSupplierItem: (id: string) => Promise<void>;
  unapproveSupplierItem: (id: string) => Promise<void>;
  deleteSupplierItem: (id: string) => Promise<void>;
  createItemRequest: (input: ItemRequestInput) => Promise<ItemRequest>;
  /** Link the request to a product and issue its quantity, atomically in the DB. */
  approveItemRequest: (id: string, productId: string) => Promise<void>;
  rejectItemRequest: (id: string) => Promise<void>;
  createDocument: (input: DocumentInput) => Promise<DocumentRecord>;
  updateDocument: (id: string, patch: DocumentPatch) => Promise<void>;
  /** Removes the receipt and its photo for good; its movements and the stock stay. */
  deleteDocument: (doc: DocumentRecord) => Promise<void>;
  /** Movements saved from one document (not capped). */
  fetchDocumentMovements: (documentId: string) => Promise<Movement[]>;
  /** Full movement history of one product (not capped). */
  fetchProductHistory: (productId: string) => Promise<Movement[]>;
  /** Every movement in a range of epoch ms, `to` excluded and null meaning open; `state.movements` holds only the latest. */
  fetchMovements: (from: number | null, to: number | null) => Promise<Movement[]>;
};

const Ctx = createContext<Api | null>(null);

const tempId = () => `tmp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** True while a row only exists optimistically (its DB id has not come back yet). */
export function isTempId(id: string): boolean {
  return id.startsWith("tmp_");
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const sb = useMemo(() => supabase(), []);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const fetchMovements = useCallback<Api["fetchMovements"]>(
    async (from, to) => {
      const rows: Movement[] = [];
      for (;;) {
        let query = sb.from("movements").select("*");
        if (from !== null) query = query.gte("created_at", new Date(from).toISOString());
        if (to !== null) query = query.lt("created_at", new Date(to).toISOString());
        const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(rows.length, rows.length + API_PAGE - 1);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < API_PAGE) return rows;
      }
    },
    [sb],
  );

  const reload = useCallback(async () => {
    const [products, movements, suppliers, supplierItems, faults, workers, itemRequests, documents, agents, orders, orderLines] = await Promise.all([
      sb.from("products").select("*").order("name"),
      sb.from("movements").select("*").order("created_at", { ascending: false }).limit(RECENT_MOVEMENTS),
      sb.from("suppliers").select("*").order("name"),
      sb.from("supplier_items").select("*").order("created_at", { ascending: false }),
      sb.from("faults").select("*").order("created_at", { ascending: false }),
      sb.from("workers").select("*").order("name"),
      sb.from("item_requests").select("*").order("created_at", { ascending: false }),
      sb.from("documents").select("*").order("created_at", { ascending: false }),
      sb.from("agents").select("*").order("name"),
      allPages<Order>((from, to) => sb.from("orders").select("*").order("created_at", { ascending: false }).order("id").range(from, to)),
      allPages<OrderLine>((from, to) => sb.from("order_lines").select("*").order("id").range(from, to)),
    ]);
    const err = [products, movements, suppliers, supplierItems, faults, workers, itemRequests, documents, agents, orders, orderLines].find((r) => r.error)?.error;
    if (err) {
      dispatch({ type: "error", error: err.message });
      return;
    }
    dispatch({
      type: "loaded",
      data: {
        products: products.data ?? [],
        movements: movements.data ?? [],
        suppliers: suppliers.data ?? [],
        supplierItems: supplierItems.data ?? [],
        faults: faults.data ?? [],
        workers: workers.data ?? [],
        itemRequests: itemRequests.data ?? [],
        documents: documents.data ?? [],
        agents: agents.data ?? [],
        orders: orders.data ?? [],
        orderLines: orderLines.data ?? [],
      },
    });
  }, [sb]);

  // initial load + realtime
  useEffect(() => {
    let cancelled = false;
    reload().catch((e) => !cancelled && dispatch({ type: "error", error: String(e?.message ?? e) }));

    const tables: TableName[] = ["products", "movements", "suppliers", "supplier_items", "faults", "workers", "item_requests", "documents", "agents", "orders", "order_lines"];
    let channel = sb.channel("super-admin-db");
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: RealtimePostgresChangesPayload<Row>) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as Partial<Row>)?.id;
            if (id) dispatch({ type: "remove", table, id });
          } else {
            dispatch({ type: "upsert", table, row: payload.new as Row });
          }
        },
      );
    }
    channel.subscribe((status) => {
      dispatch({ type: "live", live: status === "SUBSCRIBED" });
      // after a reconnect, re-sync to catch anything missed
      if (status === "SUBSCRIBED" && stateRef.current.loadedAt) reload().catch(() => {});
    });

    // light background re-sync as a safety net (quiet, no UI flash)
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload().catch(() => {});
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      sb.removeChannel(channel);
    };
  }, [sb, reload]);

  /* ───────── lookups ───────── */
  const productMap = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products]);
  const supplierMap = useMemo(() => new Map(state.suppliers.map((s) => [s.id, s])), [state.suppliers]);
  const workerMap = useMemo(() => new Map(state.workers.map((w) => [w.id, w])), [state.workers]);
  const agentMap = useMemo(() => new Map(state.agents.map((a) => [a.id, a])), [state.agents]);
  const orderMap = useMemo(() => new Map(state.orders.map((o) => [o.id, o])), [state.orders]);
  const linesByOrder = useMemo(() => {
    const map = new Map<string, OrderLine[]>();
    for (const line of state.orderLines) {
      const lines = map.get(line.order_id);
      if (lines) lines.push(line);
      else map.set(line.order_id, [line]);
    }
    return map;
  }, [state.orderLines]);
  const product = useCallback((id: string | null | undefined) => (id ? productMap.get(id) : undefined), [productMap]);
  const supplier = useCallback((id: string | null | undefined) => (id ? supplierMap.get(id) : undefined), [supplierMap]);
  const worker = useCallback((id: string | null | undefined) => (id ? workerMap.get(id) : undefined), [workerMap]);
  const agent = useCallback((id: string | null | undefined) => (id ? agentMap.get(id) : undefined), [agentMap]);
  const order = useCallback((id: string | null | undefined) => (id ? orderMap.get(id) : undefined), [orderMap]);
  const linesOf = useCallback((orderId: string) => linesByOrder.get(orderId) ?? NO_LINES, [linesByOrder]);

  /* ───────── derived ───────── */
  const attention = useMemo<AttentionEntry[]>(() => {
    const out: AttentionEntry[] = [];
    for (const p of state.products) {
      const free = available(p);
      const stock = stockState(p);
      if (stock === "short") {
        out.push({
          id: `short:${p.id}`, kind: "short", severity: "danger", label: "חסר",
          title: p.name,
          meta: [`חסרים ${fmtQty(-free)} ${p.unit} להזמנות`, p.sku, p.location ?? ""].filter(Boolean),
          at: p.updated_at, productId: p.id,
        });
      } else if (stock === "out") {
        out.push({
          id: `out:${p.id}`, kind: "out", severity: "danger", label: "אזל",
          title: p.name, meta: [p.sku, p.location ?? ""].filter(Boolean),
          at: p.updated_at, productId: p.id,
        });
      } else if (stock === "low") {
        out.push({
          id: `low:${p.id}`, kind: "low", severity: "warning", label: "מינימום",
          title: p.name,
          meta: [`חסרים ${fmtQty(p.min_qty - free)} ${p.unit}`, p.sku, p.location ?? ""].filter(Boolean),
          at: p.updated_at, productId: p.id,
        });
      }
    }
    for (const f of state.faults) {
      if (f.status !== "open") continue;
      const p = f.product_id ? productMap.get(f.product_id) : undefined;
      const w = f.reported_by ? workerMap.get(f.reported_by) : undefined;
      out.push({
        id: `fault:${f.id}`, kind: "fault", severity: "danger", label: "תקלה",
        title: p ? `${f.description} — ${p.name}` : f.description,
        meta: [w ? `דווח ע"י ${w.name}` : ""].filter(Boolean),
        at: f.created_at, faultId: f.id, productId: f.product_id ?? undefined, photoPath: f.photo_path ?? undefined,
      });
    }
    const pending = state.supplierItems.filter((i) => i.status === "pending");
    for (const i of pending) {
      const s = supplierMap.get(i.supplier_id);
      out.push({
        id: `map:${i.id}`, kind: "mapping", severity: "warning", label: "ממתין",
        title: `${i.external_name}${s ? ` · ${s.name}` : ""}`,
        meta: [i.external_sku ?? "", i.product_id ? "התאמה ממתינה לאישור" : "ללא התאמה"].filter(Boolean),
        at: i.created_at, supplierItemId: i.id, productId: i.product_id ?? undefined,
      });
    }
    for (const r of state.itemRequests) {
      if (r.status !== "pending") continue;
      const w = r.worker_id ? workerMap.get(r.worker_id) : undefined;
      const isNew = r.kind === "new_product";
      out.push({
        id: `request:${r.id}`, kind: "request", severity: "warning", label: isNew ? "מוצר חדש" : "לא זוהה",
        title: `${r.proposed_name?.trim() || r.external_name} × ${fmtQty(r.qty)}`,
        meta: [r.customer ? `ללקוח ${r.customer}` : "", w ? `נשלח ע"י ${w.name}` : ""].filter(Boolean),
        at: r.created_at, requestId: r.id,
      });
    }
    const rank = { danger: 0, warning: 1 } as const;
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.at.localeCompare(a.at));
  }, [state.products, state.faults, state.supplierItems, state.itemRequests, productMap, workerMap, supplierMap]);

  const stats = useMemo<Stats>(() => {
    const today = dayKey(new Date().toISOString());
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = dayKey(y.toISOString());
    let movementsToday = 0, movementsYesterday = 0, inToday = 0, outToday = 0;
    for (const m of state.movements) {
      const k = dayKey(m.created_at);
      if (k === today) {
        movementsToday++;
        if (m.type === "in") inToday += m.qty;
        if (m.type === "out") outToday += m.qty;
      } else if (k === yesterday) movementsYesterday++;
    }
    const short = state.products.filter((p) => available(p) < 0).length;
    const low = state.products.filter((p) => p.qty > 0 && available(p) >= 0 && p.min_qty > 0 && available(p) < p.min_qty).length;
    const out = state.products.filter((p) => p.qty <= 0).length;
    // An empty shelf that orders still hold is one exception, listed once as short.
    const outAndShort = state.products.filter((p) => p.qty <= 0 && available(p) < 0).length;
    const openFaults = state.faults.filter((f) => f.status === "open").length;
    const pendingMappings = state.supplierItems.filter((i) => i.status === "pending").length;
    const pendingRequests = state.itemRequests.filter((r) => r.status === "pending").length;
    const openOrders = state.orders.filter((o) => o.status === "open").length;
    const reservedProducts = state.products.filter((p) => p.reserved > 0).length;
    return {
      products: state.products.length, low, out, movementsToday, movementsYesterday, inToday, outToday,
      openFaults, pendingMappings, pendingRequests, openOrders, reservedProducts, short,
      exceptions: out - outAndShort + short + low + openFaults + pendingMappings + pendingRequests,
    };
  }, [state.products, state.movements, state.faults, state.supplierItems, state.itemRequests, state.orders]);

  const weekly = useMemo<DayPoint[]>(() => {
    const days: DayPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dayKey(d.toISOString());
      days.push({ day: k, label: i === 0 ? "היום" : DAY_LABELS[d.getDay()], in: 0, out: 0, total: 0 });
    }
    const idx = new Map(days.map((d, i) => [d.day, i]));
    for (const m of state.movements) {
      const i = idx.get(dayKey(m.created_at));
      if (i === undefined) continue;
      if (m.type === "in") days[i].in += 1;
      else if (m.type === "out") days[i].out += 1;
      days[i].total += 1;
    }
    return days;
  }, [state.movements]);

  /* ───────── write helpers ───────── */

  const loose = useMemo(() => sb as unknown as LooseClient, [sb]);

  const insert = useCallback(
    async <T extends TableName>(table: T, row: TablesInsert<T>, optimistic: Row): Promise<Row> => {
      dispatch({ type: "upsert", table, row: optimistic });
      const { data, error } = await loose.from(table).insert(row).select("*").single();
      if (error || !data) {
        dispatch({ type: "remove", table, id: optimistic.id });
        throw new Error(error?.message ?? "השמירה נכשלה");
      }
      dispatch({ type: "replaceId", table, tempId: optimistic.id, row: data });
      return data;
    },
    [loose],
  );

  const update = useCallback(
    async <T extends TableName>(table: T, id: string, patch: TablesUpdate<T>) => {
      const list = stateRef.current[KEY[table]] as Row[];
      const before = list.find((r) => r.id === id);
      dispatch({ type: "upsert", table, row: { ...(before ?? {}), ...(patch as object), id } as Row });
      const { error } = await loose.from(table).update(patch as object).eq("id", id);
      if (error) {
        if (before) dispatch({ type: "upsert", table, row: before });
        throw new Error(error.message);
      }
    },
    [loose],
  );

  const remove = useCallback(
    async (table: TableName, id: string) => {
      const list = stateRef.current[KEY[table]] as Row[];
      const before = list.find((r) => r.id === id);
      dispatch({ type: "remove", table, id });
      const { error } = await loose.from(table).delete().eq("id", id);
      if (error) {
        if (before) dispatch({ type: "upsert", table, row: before });
        throw new Error(error.message);
      }
    },
    [loose],
  );

  /** Waits for the database: a row policy refuses with no error and zero rows, so the rows are counted. */
  const removeWithPhoto = useCallback(
    async (table: "documents" | "faults", id: string, bucket: string, path: string | null) => {
      const { data, error } = await sb.from(table).delete().eq("id", id).select("id");
      if (error || !data?.length) throw new Error(error?.message ?? NOT_APPLIED);
      dispatch({ type: "remove", table, id });
      if (!path) return;
      const { error: photoError } = await sb.storage.from(bucket).remove([path]);
      if (photoError) throw new Error("הרשומה נמחקה, אך התמונה נשארה באחסון");
    },
    [sb],
  );

  const bumpProduct = useCallback((productId: string, delta: number | null, set?: number) => {
    const p = stateRef.current.products.find((x) => x.id === productId);
    if (!p) return;
    const qty = set !== undefined ? set : Math.max(0, p.qty + (delta ?? 0));
    const next: Product = { ...p, qty, updated_at: new Date().toISOString() };
    dispatch({ type: "upsert", table: "products", row: next });
  }, []);

  const logMovement = useCallback(
    async (type: MovementType, input: ReceiveInput & { supplierId?: string | null }) => {
      const now = new Date().toISOString();
      const optimistic: Movement = {
        id: tempId(), type, product_id: input.productId, qty: input.qty,
        worker_id: input.workerId ?? null, supplier_id: input.supplierId ?? null,
        reference: input.reference ?? null, note: input.note ?? null, created_at: now,
        external_name: input.externalName?.trim() || null, document_id: input.documentId ?? null,
      };
      if (type === "in") bumpProduct(input.productId, input.qty);
      if (type === "out") bumpProduct(input.productId, -input.qty);
      if (type === "adjust") bumpProduct(input.productId, null, input.qty);
      try {
        const row = (await insert("movements", {
          type, product_id: input.productId, qty: input.qty,
          worker_id: input.workerId ?? null, supplier_id: input.supplierId ?? null,
          reference: input.reference || null, note: input.note || null,
          external_name: input.externalName?.trim() || null, document_id: input.documentId ?? null,
        }, optimistic)) as Movement;
        return row;
      } catch (e) {
        // roll back the optimistic quantity
        if (type === "in") bumpProduct(input.productId, -input.qty);
        if (type === "out") bumpProduct(input.productId, input.qty);
        throw e;
      }
    },
    [insert, bumpProduct],
  );

  const api = useMemo<Api>(() => ({
    state, reload, product, supplier, worker, agent, order, linesOf, attention, stats, weekly,

    receive: async (input) => {
      const row = await logMovement("in", input);
      const name = input.externalName?.trim();
      if (input.supplierId && name) {
        const key = normalizeName(name);
        const existing = stateRef.current.supplierItems.find((i) => i.supplier_id === input.supplierId && normalizeName(i.external_name) === key);
        if (!existing) {
          // first time we see this wording: remember it, flagged for the manager's approval
          const now = new Date().toISOString();
          const optimistic: SupplierItem = {
            id: tempId(), supplier_id: input.supplierId, external_name: name, external_sku: input.externalSku?.trim() || null,
            product_id: input.productId, status: "pending", created_at: now, updated_at: now,
            normalized_name: key, times_seen: 1, last_seen_at: now, approved_at: null,
          };
          await insert("supplier_items", {
            supplier_id: input.supplierId, external_name: name, external_sku: input.externalSku?.trim() || null,
            product_id: input.productId, status: "pending", times_seen: 1, last_seen_at: now,
          }, optimistic).catch(() => undefined); // the movement already landed; a dictionary hiccup must not fail the receive
        } else {
          // the DB trigger bumps times_seen; mirror it so the UI is immediate
          const patch: Partial<SupplierItem> = { times_seen: existing.times_seen + 1, last_seen_at: new Date().toISOString() };
          if (!existing.product_id) patch.product_id = input.productId;
          dispatch({ type: "upsert", table: "supplier_items", row: { ...existing, ...patch } });
          if (!existing.product_id) await update("supplier_items", existing.id, { product_id: input.productId }).catch(() => undefined);
        }
      }
      return row;
    },
    issue: (input) => logMovement("out", input),
    adjust: (productId, qty, workerId, note) => logMovement("adjust", { productId, qty, workerId, note }),

    reportFault: async (input) => {
      let movementId: string | null = null;
      if (input.productId && input.qty && input.qty > 0) {
        const m = await logMovement("fault", { productId: input.productId, qty: input.qty, workerId: input.workerId, note: input.description });
        movementId = m.id;
      }
      const optimistic: Fault = {
        id: tempId(), product_id: input.productId ?? null, movement_id: movementId, description: input.description,
        reported_by: input.workerId ?? null, status: "open", created_at: new Date().toISOString(), resolved_at: null,
        photo_path: input.photoPath ?? null, asset: input.asset ?? null,
      };
      return (await insert("faults", {
        product_id: input.productId ?? null, movement_id: movementId, description: input.description,
        reported_by: input.workerId ?? null, photo_path: input.photoPath ?? null,
        // Only when set, so a report still lands where the column's migration hasn't run.
        ...(input.asset ? { asset: input.asset } : {}),
      }, optimistic)) as Fault;
    },
    resolveFault: (id) => update("faults", id, { status: "resolved", resolved_at: new Date().toISOString() }),
    reopenFault: (id) => update("faults", id, { status: "open", resolved_at: null }),
    updateFault: async (fault, patch) => {
      await update("faults", fault.id, patch);
      if (!fault.movement_id) return;
      // the movement repeats the report; it needs a product, so clearing the report's keeps the old one
      const { error } = await sb.from("movements").update({ note: patch.description, ...(patch.product_id ? { product_id: patch.product_id } : {}) }).eq("id", fault.movement_id);
      if (error) throw new Error(error.message);
    },
    deleteFault: (fault) => removeWithPhoto("faults", fault.id, FAULT_PHOTOS_BUCKET, fault.photo_path),

    createProduct: async (input) => {
      const now = new Date().toISOString();
      const optimistic: Product = {
        id: tempId(), sku: input.sku, name: input.name, category: input.category ?? null, unit: input.unit ?? "יח׳",
        qty: input.qty ?? 0, min_qty: input.min_qty ?? 0, location: input.location ?? null,
        primary_supplier_id: input.primary_supplier_id ?? null, notes: input.notes ?? null, created_at: now, updated_at: now,
        barcode: input.barcode?.trim() || null, // the DB assigns an EAN-13 when empty
        reserved: 0, in_catalog: input.in_catalog ?? true, description: input.description ?? null,
        price: input.price ?? null, image_path: input.image_path ?? null,
      };
      return (await insert("products", input, optimistic)) as Product;
    },
    updateProduct: (id, patch) => update("products", id, patch),
    deleteProduct: async (id) => {
      await remove("products", id);
      // Mirror the DB's `on delete set null` so orphaned supplier names show up for re-mapping right away.
      for (const item of stateRef.current.supplierItems) {
        if (item.product_id === id) {
          const orphan: SupplierItem = { ...item, product_id: null };
          dispatch({ type: "upsert", table: "supplier_items", row: orphan });
        }
      }
    },

    createSupplier: async (input) => {
      const optimistic: Supplier = {
        id: tempId(), name: input.name, contact: input.contact ?? null, phone: input.phone ?? null,
        email: input.email ?? null, notes: input.notes ?? null, created_at: new Date().toISOString(),
      };
      return (await insert("suppliers", input, optimistic)) as Supplier;
    },
    updateSupplier: (id, patch) => update("suppliers", id, patch),
    deleteSupplier: (id) => remove("suppliers", id),

    createWorker: async (input) => {
      const optimistic: Worker = { id: tempId(), name: input.name, role: input.role ?? "עובד", active: input.active ?? true, created_at: new Date().toISOString() };
      return (await insert("workers", input, optimistic)) as Worker;
    },
    updateWorker: (id, patch) => update("workers", id, patch),

    createAgent: async (input) => {
      const optimistic: Agent = { id: tempId(), name: input.name, phone: input.phone ?? null, active: input.active ?? true, created_at: new Date().toISOString() };
      return (await insert("agents", input, optimistic)) as Agent;
    },
    updateAgent: async (id, patch) => {
      const { data, error } = await sb.from("agents").update(patch).eq("id", id).select("*");
      const row = data?.[0];
      if (error || !row) throw new Error(error?.message ?? NOT_APPLIED);
      dispatch({ type: "upsert", table: "agents", row });
    },
    deliverOrder: async (id, workerId) => {
      const { error } = await sb.rpc("deliver_order", { target_order: id, by_worker: workerId ?? undefined });
      if (error) throw new Error(error.message);
      await reload();
    },
    cancelOrder: async (id) => {
      const { error } = await sb.rpc("cancel_order", { target_order: id });
      if (error) throw new Error(error.message);
      await reload();
    },

    createSupplierItem: async (input) => {
      const now = new Date().toISOString();
      const optimistic: SupplierItem = {
        id: tempId(), supplier_id: input.supplier_id, external_name: input.external_name, external_sku: input.external_sku ?? null,
        product_id: input.product_id ?? null, status: input.status ?? "pending", created_at: now, updated_at: now,
        normalized_name: normalizeName(input.external_name), times_seen: 0, last_seen_at: null,
        approved_at: input.status === "approved" ? now : null,
      };
      return (await insert("supplier_items", input, optimistic)) as SupplierItem;
    },
    mapSupplierItem: (id, productId) => update("supplier_items", id, { product_id: productId, status: "approved", approved_at: new Date().toISOString() }),
    approveSupplierItem: (id) => update("supplier_items", id, { status: "approved", approved_at: new Date().toISOString() }),
    unapproveSupplierItem: (id) => update("supplier_items", id, { status: "pending", approved_at: null }),
    resolveSupplierName: (supplierId, name) => {
      const key = normalizeName(name);
      if (!supplierId || !key) return { status: "unknown", item: null, product: null };
      const item = stateRef.current.supplierItems.find((i) => i.supplier_id === supplierId && normalizeName(i.external_name) === key);
      if (!item) return { status: "unknown", item: null, product: null };
      const prod = item.product_id ? productMap.get(item.product_id) ?? null : null;
      if (item.status === "approved" && prod) return { status: "approved", item, product: prod };
      return { status: "pending", item, product: prod };
    },
    suggestSupplierNames: (supplierId, query, limit = 8) => {
      if (!supplierId) return [];
      const q = normalizeName(query);
      return stateRef.current.supplierItems
        .filter((i) => i.supplier_id === supplierId && (!q || normalizeName(i.external_name).includes(q) || (i.external_sku ?? "").toLowerCase().includes(q)))
        .sort((a, b) => b.times_seen - a.times_seen || a.external_name.localeCompare(b.external_name, "he"))
        .slice(0, limit);
    },
    deleteSupplierItem: (id) => remove("supplier_items", id),

    createItemRequest: async (input) => {
      const row = {
        kind: input.kind, external_name: input.externalName, proposed_name: input.proposedName ?? null, qty: input.qty,
        customer: input.customer ?? null, reference: input.reference || null, note: input.note || null,
        worker_note: input.workerNote || null, worker_id: input.workerId ?? null, document_id: input.documentId ?? null,
      };
      const optimistic: ItemRequest = {
        ...row, id: tempId(), status: "pending", normalized_name: normalizeName(input.externalName),
        product_id: null, movement_id: null, created_at: new Date().toISOString(), resolved_at: null,
      };
      return (await insert("item_requests", row, optimistic)) as ItemRequest;
    },
    approveItemRequest: async (id, productId) => {
      const { error } = await sb.rpc("approve_item_request", { request_id: id, target_product_id: productId });
      if (error) throw new Error(error.message);
      await reload();
    },
    rejectItemRequest: (id) => update("item_requests", id, { status: "rejected", resolved_at: new Date().toISOString() }),

    createDocument: async (input) => {
      const row = {
        kind: input.kind, storage_path: input.storagePath, supplier_id: input.supplierId ?? null,
        customer: input.customer || null, reference: input.reference || null, worker_id: input.workerId ?? null,
      };
      const optimistic: DocumentRecord = { ...row, id: tempId(), created_at: new Date().toISOString() };
      return (await insert("documents", row, optimistic)) as DocumentRecord;
    },
    updateDocument: async (id, patch) => {
      const { data, error } = await sb.from("documents").update(patch).eq("id", id).select("*");
      const row = data?.[0];
      if (error || !row) throw new Error(error?.message ?? NOT_APPLIED);
      dispatch({ type: "upsert", table: "documents", row });
      // the receipt's movements repeat its supplier and reference; realtime brings them into state
      const { error: movementsError } = await sb.from("movements").update({ supplier_id: row.supplier_id, reference: row.reference }).eq("document_id", id);
      if (movementsError) throw new Error(movementsError.message);
    },
    deleteDocument: (doc) => removeWithPhoto("documents", doc.id, DOCUMENTS_BUCKET, doc.storage_path),
    fetchDocumentMovements: async (documentId) => {
      const { data, error } = await sb.from("movements").select("*").eq("document_id", documentId).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },

    fetchProductHistory: async (productId) => {
      const { data, error } = await sb.from("movements").select("*").eq("product_id", productId).order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return data ?? [];
    },

    fetchMovements,
  }), [state, reload, product, supplier, worker, agent, order, linesOf, attention, stats, weekly, logMovement, insert, update, remove, removeWithPhoto, sb, productMap, fetchMovements]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useData(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}
