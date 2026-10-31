"use client";

/**
 * Reactive data layer for Super Admin.
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

export type Product = Tables<"products">;
export type Movement = Tables<"movements">;
export type Supplier = Tables<"suppliers">;
export type SupplierItem = Tables<"supplier_items">;
export type Fault = Tables<"faults">;
export type Worker = Tables<"workers">;
export type MovementType = Movement["type"];

type TableName = "products" | "movements" | "suppliers" | "supplier_items" | "faults" | "workers";

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
  status: "loading" | "ready" | "error";
  error: string | null;
  live: boolean; // realtime channel subscribed
  loadedAt: number | null;
};

const RECENT_MOVEMENTS = 400;

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
};

function sortFor(table: TableName, rows: Row[]): Row[] {
  if (table === "movements" || table === "faults") {
    return [...rows].sort((a, b) =>
      String((b as Movement).created_at).localeCompare(String((a as Movement).created_at)),
    );
  }
  if (table === "products") {
    return [...rows].sort((a, b) => (a as Product).name.localeCompare((b as Product).name, "he"));
  }
  if (table === "suppliers" || table === "workers") {
    return [...rows].sort((a, b) => (a as Supplier).name.localeCompare((b as Supplier).name, "he"));
  }
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
  status: "loading",
  error: null,
  live: false,
  loadedAt: null,
};

/* ─────────────────────────── derived types ─────────────────────────── */

export type AttentionKind = "out" | "low" | "fault" | "mapping";
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
export type FaultInput = {
  productId?: string | null;
  description: string;
  workerId?: string | null;
  qty?: number | null; // if given, also logs a 'fault' movement
  photoPath?: string | null; // storage path in the fault-photos bucket
};

type Api = {
  state: State;
  reload: () => Promise<void>;
  // lookups
  product: (id: string | null | undefined) => Product | undefined;
  supplier: (id: string | null | undefined) => Supplier | undefined;
  worker: (id: string | null | undefined) => Worker | undefined;
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
  createProduct: (input: TablesInsert<"products">) => Promise<Product>;
  updateProduct: (id: string, patch: TablesUpdate<"products">) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  createSupplier: (input: TablesInsert<"suppliers">) => Promise<Supplier>;
  updateSupplier: (id: string, patch: TablesUpdate<"suppliers">) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  createWorker: (input: TablesInsert<"workers">) => Promise<Worker>;
  updateWorker: (id: string, patch: TablesUpdate<"workers">) => Promise<void>;
  createSupplierItem: (input: TablesInsert<"supplier_items">) => Promise<SupplierItem>;
  mapSupplierItem: (id: string, productId: string) => Promise<void>; // sets product + approved
  /** Translate a supplier's product name to the catalogue (exact match on the normalized name). */
  resolveSupplierName: (supplierId: string | null | undefined, name: string) => NameResolution;
  /** Dictionary entries of one supplier that match a partial name, most-used first. */
  suggestSupplierNames: (supplierId: string | null | undefined, query: string, limit?: number) => SupplierItem[];
  approveSupplierItem: (id: string) => Promise<void>;
  unapproveSupplierItem: (id: string) => Promise<void>;
  deleteSupplierItem: (id: string) => Promise<void>;
  /** Full movement history of one product (not capped). */
  fetchProductHistory: (productId: string) => Promise<Movement[]>;
};

const Ctx = createContext<Api | null>(null);

const tempId = () => `tmp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

function dayKey(iso: string): string {
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

  const reload = useCallback(async () => {
    const [products, movements, suppliers, supplierItems, faults, workers] = await Promise.all([
      sb.from("products").select("*").order("name"),
      sb.from("movements").select("*").order("created_at", { ascending: false }).limit(RECENT_MOVEMENTS),
      sb.from("suppliers").select("*").order("name"),
      sb.from("supplier_items").select("*").order("created_at", { ascending: false }),
      sb.from("faults").select("*").order("created_at", { ascending: false }),
      sb.from("workers").select("*").order("name"),
    ]);
    const err = [products, movements, suppliers, supplierItems, faults, workers].find((r) => r.error)?.error;
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
      },
    });
  }, [sb]);

  // initial load + realtime
  useEffect(() => {
    let cancelled = false;
    reload().catch((e) => !cancelled && dispatch({ type: "error", error: String(e?.message ?? e) }));

    const tables: TableName[] = ["products", "movements", "suppliers", "supplier_items", "faults", "workers"];
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
  const product = useCallback((id: string | null | undefined) => (id ? productMap.get(id) : undefined), [productMap]);
  const supplier = useCallback((id: string | null | undefined) => (id ? supplierMap.get(id) : undefined), [supplierMap]);
  const worker = useCallback((id: string | null | undefined) => (id ? workerMap.get(id) : undefined), [workerMap]);

  /* ───────── derived ───────── */
  const attention = useMemo<AttentionEntry[]>(() => {
    const out: AttentionEntry[] = [];
    for (const p of state.products) {
      if (p.qty <= 0) {
        out.push({
          id: `out:${p.id}`, kind: "out", severity: "danger", label: "אזל",
          title: `${p.name} — אזל מהמלאי`, meta: [p.sku, p.location ?? ""].filter(Boolean),
          at: p.updated_at, productId: p.id,
        });
      } else if (p.min_qty > 0 && p.qty < p.min_qty) {
        out.push({
          id: `low:${p.id}`, kind: "low", severity: "warning", label: "מינימום",
          title: `${p.name} — ${p.qty} מתוך מינימום ${p.min_qty}`, meta: [p.sku, p.location ?? ""].filter(Boolean),
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
        id: `map:${i.id}`, kind: "mapping", severity: "warning", label: "לא מאושר",
        title: `${i.external_name}${s ? ` · ${s.name}` : ""}`,
        meta: [i.external_sku ?? "", i.product_id ? "ממופה, ממתין לאישור" : "ללא מיפוי"].filter(Boolean),
        at: i.created_at, supplierItemId: i.id, productId: i.product_id ?? undefined,
      });
    }
    const rank = { danger: 0, warning: 1 } as const;
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.at.localeCompare(a.at));
  }, [state.products, state.faults, state.supplierItems, productMap, workerMap, supplierMap]);

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
    const low = state.products.filter((p) => p.qty > 0 && p.min_qty > 0 && p.qty < p.min_qty).length;
    const out = state.products.filter((p) => p.qty <= 0).length;
    const openFaults = state.faults.filter((f) => f.status === "open").length;
    const pendingMappings = state.supplierItems.filter((i) => i.status === "pending").length;
    return {
      products: state.products.length, low, out, movementsToday, movementsYesterday, inToday, outToday,
      openFaults, pendingMappings, exceptions: out + low + openFaults + pendingMappings,
    };
  }, [state.products, state.movements, state.faults, state.supplierItems]);

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
        external_name: input.externalName?.trim() || null,
      };
      if (type === "in") bumpProduct(input.productId, input.qty);
      if (type === "out") bumpProduct(input.productId, -input.qty);
      if (type === "adjust") bumpProduct(input.productId, null, input.qty);
      try {
        const row = (await insert("movements", {
          type, product_id: input.productId, qty: input.qty,
          worker_id: input.workerId ?? null, supplier_id: input.supplierId ?? null,
          reference: input.reference || null, note: input.note || null,
          external_name: input.externalName?.trim() || null,
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
    state, reload, product, supplier, worker, attention, stats, weekly,

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
        photo_path: input.photoPath ?? null,
      };
      return (await insert("faults", {
        product_id: input.productId ?? null, movement_id: movementId, description: input.description,
        reported_by: input.workerId ?? null, photo_path: input.photoPath ?? null,
      }, optimistic)) as Fault;
    },
    resolveFault: (id) => update("faults", id, { status: "resolved", resolved_at: new Date().toISOString() }),
    reopenFault: (id) => update("faults", id, { status: "open", resolved_at: null }),

    createProduct: async (input) => {
      const now = new Date().toISOString();
      const optimistic: Product = {
        id: tempId(), sku: input.sku, name: input.name, category: input.category ?? null, unit: input.unit ?? "יח׳",
        qty: input.qty ?? 0, min_qty: input.min_qty ?? 0, location: input.location ?? null,
        primary_supplier_id: input.primary_supplier_id ?? null, notes: input.notes ?? null, created_at: now, updated_at: now,
        barcode: input.barcode?.trim() || null, // the DB assigns an EAN-13 when empty
      };
      return (await insert("products", input, optimistic)) as Product;
    },
    updateProduct: (id, patch) => update("products", id, patch),
    deleteProduct: (id) => remove("products", id),

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

    fetchProductHistory: async (productId) => {
      const { data, error } = await sb.from("movements").select("*").eq("product_id", productId).order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  }), [state, reload, product, supplier, worker, attention, stats, weekly, logMovement, insert, update, remove, sb, productMap]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useData(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}
