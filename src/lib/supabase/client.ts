import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

let client: SupabaseClient<Database> | null = null;
let throwaways = 0;

function projectEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, key };
}

/** Browser-side Supabase client (singleton). */
export function supabase(): SupabaseClient<Database> {
  if (client) return client;
  const { url, key } = projectEnv();
  client = createClient<Database>(url, key, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}

/** Where supabase() stores its session: supabase-js's default key for this project. */
export function authStorageKey(): string {
  return `sb-${new URL(projectEnv().url).hostname.split(".")[0]}-auth-token`;
}

/**
 * A new in-memory client for the login steps: it saves nothing, so the real client holds no
 * session until login is done. Each one gets its own key because supabase-js warns about two sharing one.
 */
export function throwawayClient(): SupabaseClient<Database> {
  const { url, key } = projectEnv();
  throwaways += 1;
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `login-${throwaways}`,
    },
  });
}
