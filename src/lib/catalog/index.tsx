"use client";

/**
 * Data for the catalogue site: what can be promised right now, and this agent's orders.
 *
 * - Stock arrives live over Realtime, so two agents never quote different numbers.
 * - Orders are written only through the database's create_order and cancel_order;
 *   the database decides whether the stock is still there.
 * - The agent and the order being built stay on the phone, in localStorage.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase/client";
import type { Tables } from "@/lib/database.types";

const PRODUCT_COLUMNS = "id, sku, barcode, name, category, unit, qty, reserved, description, price, image_path" as const;

export type Product = Pick<
  Tables<"products">,
  "id" | "sku" | "barcode" | "name" | "category" | "unit" | "qty" | "reserved" | "description" | "price" | "image_path"
>;
export type Agent = Tables<"agents">;
export type OrderLine = Tables<"order_lines">;
/** The product comes with each line, so an order keeps its names after a product leaves the catalogue. */
export type Order = Tables<"orders"> & { order_lines: (OrderLine & { products: Pick<Tables<"products">, "name" | "unit" | "image_path"> | null })[] };

export type DraftLine = { productId: string; qty: number };
/**
 * `request` names this exact order, so a retry of the same lines can't place it twice.
 * `tried` remembers the last send: its response can be lost after the order landed.
 */
type Draft = { request: string; lines: DraftLine[]; tried?: { request: string; key: string } };

export type Shortage = { product_id: string | null; name: string | null; wanted: number; available: number };

/** The database refused the order: someone else took the stock first. */
export class ShortageError extends Error {
  constructor(public lines: Shortage[]) {
    super("חסר במלאי");
  }
}

/** An order that didn't go: `message` says why and what to do next, `retry` whether sending again can help. */
export class OrderRefused extends Error {
  constructor(public title: string, message: string, public retry: boolean) {
    super(message);
  }
}

const AGENT_KEY = "agent.id";
const DRAFT_KEY = "agent.draft";

const PHOTOS_BUCKET = "product-photos";

/** What is free to promise. Below zero means stock physically dropped under what orders hold. */
export function available(p: Product): number {
  return Math.max(0, p.qty - p.reserved);
}

/** A path in the photos bucket, or a site path for the demo photos that ship with the app. */
export function photoUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("/")) return path;
  return supabase().storage.from(PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* ─────────────────────────── phone storage ─────────────────────────── */

const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  // Held in memory too, so a phone that refuses storage still works until it reloads.
  memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key) memory.delete(e.key);
    cb();
  };
  listeners.add(cb);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function useStored(key: string): string | null {
  return useSyncExternalStore(subscribe, () => read(key), () => null);
}

const emptySubscribe = () => () => undefined;

function useHydrated(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function newRequest(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Older phones, and any page not served over https.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseDraft(raw: string | null): Draft | null {
  try {
    const parsed = raw ? (JSON.parse(raw) as Draft) : null;
    return parsed && typeof parsed.request === "string" && Array.isArray(parsed.lines) ? parsed : null;
  } catch {
    return null;
  }
}

const linesKey = (lines: DraftLine[]) => lines.map((l) => `${l.productId}:${l.qty}`).sort().join();

function saveLines(lines: DraftLine[], draft: Draft | null) {
  if (!lines.length) {
    write(DRAFT_KEY, null);
    return;
  }
  // New lines are a new order. Lines back to what was sent are that same order, so a retry can't place it twice.
  const tried = draft?.tried;
  const request = tried && tried.key === linesKey(lines) ? tried.request : newRequest();
  write(DRAFT_KEY, JSON.stringify({ request, lines, tried }));
}

/* ─────────────────────────── provider ─────────────────────────── */

type Api = {
  status: "loading" | "ready" | "error";
  error: string | null;
  /** False until the phone's storage has been read. */
  hydrated: boolean;
  products: Product[];
  agents: Agent[];
  orders: Order[];
  agent: Agent | undefined;
  chooseAgent: (id: string | null) => void;
  product: (id: string | null | undefined) => Product | undefined;
  reload: () => Promise<void>;
  lines: DraftLine[];
  /** How many units of this product are in the order being built. */
  inDraft: (productId: string) => number;
  addToDraft: (productId: string, qty: number) => void;
  setDraftQty: (productId: string, qty: number) => void;
  removeFromDraft: (productId: string) => void;
  /** Replaces the lines at once, for a change that touches several. */
  setDraftLines: (lines: DraftLine[]) => void;
  clearDraft: () => void;
  /** The order this draft already became, when the answer to its send was lost. */
  landed: Order | undefined;
  /** The lines changed after that send, so the order doesn't hold what the draft shows. */
  landedEarlier: boolean;
  /** Ends a draft whose order landed unseen. What was added or raised after that send stays as a new order. */
  settleLanded: () => void;
  placeOrder: (input: { customer: string; phone: string; note: string; promised: string }) => Promise<Tables<"orders">>;
  cancelOrder: (id: string) => Promise<void>;
};

const Ctx = createContext<Api | null>(null);

type State = Pick<Api, "products" | "agents" | "orders" | "status" | "error">;

type Action =
  | { type: "loaded"; products: Product[]; agents: Agent[] }
  | { type: "failed"; error: string }
  | { type: "orders"; orders: Order[] }
  | { type: "product"; product: Product }
  | { type: "removed"; id: string | undefined };

const initial: State = { products: [], agents: [], orders: [], status: "loading", error: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loaded":
      return { ...state, products: action.products, agents: action.agents, status: "ready", error: null };
    case "failed":
      // Once the catalogue is on screen a lost refresh stays quiet: only the first load can fail out loud.
      return state.status === "ready" ? state : { ...state, status: "error", error: action.error };
    case "orders":
      return { ...state, orders: action.orders };
    case "product":
      return { ...state, products: [...state.products.filter((p) => p.id !== action.product.id), action.product] };
    case "removed":
      return { ...state, products: state.products.filter((p) => p.id !== action.id) };
  }
}

const offline = (message: string) => /fetch|network|load failed/i.test(message);
const hebrew = (message: string) => /[֐-׿]/.test(message);

/** What the database said, as an agent needs to hear it. */
function refusal(message: string): OrderRefused {
  const title = "ההזמנה לא נשלחה";
  // The send may have landed with only its answer lost, so this can't promise that it didn't.
  if (offline(message)) return new OrderRefused("אין חיבור לאינטרנט", "לא ברור אם ההזמנה נקלטה. אפשר לשלוח שוב, היא לא תישלח פעמיים", true);
  if (message === "הסוכן לא פעיל") return new OrderRefused(message, "המנהל השבית את הסוכן הזה. צריך לפנות למנהל", false);
  if (message === "תאריך המסירה כבר עבר") return new OrderRefused(message, "צריך לבחור תאריך מהיום והלאה", false);
  return new OrderRefused(title, `${hebrew(message) ? `${message}. ` : ""}אפשר לנסות שוב, ואם זה חוזר לפנות למנהל`, true);
}

function cancelRefusal(message: string): string {
  if (offline(message)) return "אין חיבור, ההזמנה לא בוטלה. אפשר לנסות שוב";
  if (message === "ההזמנה כבר טופלה") return "המחסן כבר טיפל בהזמנה, אז אי אפשר לבטל אותה";
  return `${hebrew(message) ? message : "הביטול נכשל"}. אפשר לנסות שוב, ואם זה חוזר לפנות למנהל`;
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const sb = useMemo(() => supabase(), []);
  const hydrated = useHydrated();
  const [{ products, agents, orders, status, error }, dispatch] = useReducer(reducer, initial);

  const agentId = useStored(AGENT_KEY);
  const rawDraft = useStored(DRAFT_KEY);
  const draft = useMemo(() => parseDraft(rawDraft), [rawDraft]);
  const lines = useMemo(() => draft?.lines ?? [], [draft]);

  const loadOrders = useCallback(async () => {
    if (!agentId) {
      dispatch({ type: "orders", orders: [] });
      return;
    }
    const { data, error: failed } = await sb
      .from("orders")
      .select("*, order_lines(*, products(name, unit, image_path))")
      .eq("agent_id", agentId)
      .order("number", { ascending: false });
    if (failed) throw new Error(failed.message);
    dispatch({ type: "orders", orders: data ?? [] });
  }, [sb, agentId]);

  const reload = useCallback(async () => {
    const [p, a] = await Promise.all([
      sb.from("products").select(PRODUCT_COLUMNS).eq("in_catalog", true),
      sb.from("agents").select("*").eq("active", true).order("name"),
    ]);
    const failed = p.error ?? a.error;
    if (failed) {
      dispatch({ type: "failed", error: failed.message });
      return;
    }
    dispatch({ type: "loaded", products: p.data ?? [], agents: a.data ?? [] });
  }, [sb]);

  useEffect(() => {
    reload().catch((e: unknown) => dispatch({ type: "failed", error: e instanceof Error ? e.message : String(e) }));

    const channel = sb
      .channel("catalog")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, (payload) => {
        if (payload.eventType === "DELETE") {
          dispatch({ type: "removed", id: (payload.old as Partial<Product>).id });
          return;
        }
        const row = payload.new as Tables<"products">;
        if (!row.in_catalog) {
          dispatch({ type: "removed", id: row.id });
          return;
        }
        // Only what the catalogue needs: suppliers, shelves and internal notes stay out of its state.
        dispatch({
          type: "product",
          product: {
            id: row.id, sku: row.sku, barcode: row.barcode, name: row.name, category: row.category, unit: row.unit,
            qty: row.qty, reserved: row.reserved, description: row.description, price: row.price, image_path: row.image_path,
          },
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => {
        reload().catch(() => undefined);
      })
      .subscribe((state) => {
        // After a reconnect, catch whatever was missed.
        if (state === "SUBSCRIBED") reload().catch(() => undefined);
      });

    // A quiet safety net, like the other two apps.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload().catch(() => undefined);
    }, 60_000);

    return () => {
      clearInterval(timer);
      sb.removeChannel(channel);
    };
  }, [sb, reload]);

  useEffect(() => {
    loadOrders().catch(() => undefined);
    if (!agentId) return;
    const channel = sb
      .channel(`orders:${agentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `agent_id=eq.${agentId}` }, () => {
        loadOrders().catch(() => undefined);
      })
      .subscribe((state) => {
        // After a reconnect: an order closed meanwhile sends no second event.
        if (state === "SUBSCRIBED") loadOrders().catch(() => undefined);
      });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadOrders().catch(() => undefined);
    }, 60_000);
    return () => {
      clearInterval(timer);
      sb.removeChannel(channel);
    };
  }, [sb, agentId, loadOrders]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const agentRow = agents.find((a) => a.id === agentId);
  const tried = draft?.tried?.request;
  const landed = tried ? orders.find((o) => o.request_id === tried && o.status !== "cancelled") : undefined;
  const landedEarlier = landed !== undefined && draft?.request !== tried;

  const api = useMemo<Api>(() => {
    const qtyOf = (productId: string) => lines.find((l) => l.productId === productId)?.qty ?? 0;
    return {
      status, error, hydrated, products, agents, orders, reload,
      agent: agentRow,
      chooseAgent: (id) => {
        // An order being built belongs to the agent who was building it.
        if (id !== agentId) write(DRAFT_KEY, null);
        write(AGENT_KEY, id);
      },
      product: (id) => (id ? productMap.get(id) : undefined),
      lines,
      inDraft: qtyOf,
      addToDraft: (productId, qty) => {
        const existing = qtyOf(productId);
        saveLines(existing
          ? lines.map((l) => (l.productId === productId ? { ...l, qty: existing + qty } : l))
          : [...lines, { productId, qty }], draft);
      },
      setDraftQty: (productId, qty) => saveLines(lines.map((l) => (l.productId === productId ? { ...l, qty } : l)), draft),
      removeFromDraft: (productId) => saveLines(lines.filter((l) => l.productId !== productId), draft),
      setDraftLines: (next) => saveLines(next, draft),
      clearDraft: () => write(DRAFT_KEY, null),
      landed,
      landedEarlier,
      settleLanded: () => {
        const sent = new Map(landed?.order_lines.map((l) => [l.product_id, l.qty]));
        const rest = lines.flatMap((l) => {
          const left = l.qty - (sent.get(l.productId) ?? 0);
          return left > 0 ? [{ ...l, qty: left }] : [];
        });
        write(DRAFT_KEY, rest.length ? JSON.stringify({ request: newRequest(), lines: rest }) : null);
      },

      placeOrder: async ({ customer, phone, note, promised }) => {
        if (!agentRow || !draft) throw new OrderRefused("ההזמנה לא נשלחה", "אין שורות בהזמנה. צריך להוסיף מוצר", false);
        // The lines changed after a send whose answer never came. It may have landed, and a new request would then be a second order.
        const earlier = draft.tried && draft.tried.request !== draft.request ? draft.tried.request : null;
        if (earlier) {
          const { data: found, error: unread } = await sb.from("orders").select("id").eq("request_id", earlier).neq("status", "cancelled").maybeSingle();
          if (unread) throw refusal(unread.message);
          if (found) {
            await loadOrders().catch(() => undefined);
            throw new OrderRefused("ההזמנה כבר נקלטה", "השליחה הקודמת הגיעה למחסן. אפשר לראות אותה בהזמנות", false);
          }
        }
        write(DRAFT_KEY, JSON.stringify({ ...draft, tried: { request: draft.request, key: linesKey(draft.lines) } }));
        const { data, error: failed } = await sb.rpc("create_order", {
          request: draft.request,
          agent: agentRow.id,
          customer_name: customer,
          phone,
          order_note: note,
          items: draft.lines.map((l) => ({ product_id: l.productId, qty: l.qty })),
          promised,
        });
        if (failed) {
          if (failed.message === "חסר במלאי" && failed.details) {
            reload().catch(() => undefined);
            throw new ShortageError(JSON.parse(failed.details) as Shortage[]);
          }
          // The answer may be what was lost: if the order landed, `landed` shows it instead of this message.
          await loadOrders().catch(() => undefined);
          throw refusal(failed.message);
        }
        if (data.status === "cancelled") {
          // A retry found its earlier order, cancelled since. The agent is sending a new one.
          write(DRAFT_KEY, JSON.stringify({ request: newRequest(), lines: draft.lines }));
          throw new OrderRefused("ההזמנה הקודמת בוטלה", "אפשר לשלוח אותה שוב כהזמנה חדשה", true);
        }
        loadOrders().catch(() => undefined);
        return data;
      },
      cancelOrder: async (id) => {
        const { error: failed } = await sb.rpc("cancel_order", { target_order: id });
        await loadOrders().catch(() => undefined);
        if (failed) throw new Error(cancelRefusal(failed.message));
      },
    };
  }, [status, error, hydrated, products, agents, orders, reload, agentId, agentRow, landed, landedEarlier, productMap, lines, draft, sb, loadOrders]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCatalog(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCatalog must be used inside <CatalogProvider>");
  return ctx;
}
