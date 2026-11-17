/**
 * The server's only way to the database. It holds no database key of its own: every call carries the public key
 * and a ticket the database itself issued to a signed-in manager (or to its own morning scan), and the database
 * decides what that ticket may read.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** The ticket is missing, unknown or expired: the person signs in again, nothing is retried here. */
export class TicketError extends Error {}

const TICKET = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isTicket = (v: unknown): v is string => typeof v === "string" && TICKET.test(v);

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!SUPABASE_URL || !PUBLIC_KEY) throw new Error("Supabase is not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (body?.code === "28000") throw new TicketError(body.message ?? "ticket");
    throw new Error(`${fn} failed (${res.status}): ${body?.message ?? ""}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CatalogView {
  view: string;
  about: string | null;
  columns: string[];
}

export interface Handshake {
  allowed: boolean;
  refusal: "off" | "budget" | "rate" | null;
  model: string;
  /** Israel time, YYYY-MM-DD HH:MM. */
  now: string;
  weekday: number;
  budget: { limit_usd: number; spent_usd: number; left_usd: number; questions_today: number };
  catalog: CatalogView[] | null;
}

export interface SqlResult {
  rows?: Record<string, unknown>[];
  row_count?: number;
  truncated?: boolean;
  as_of?: string;
  ms?: number;
  error?: string;
}
