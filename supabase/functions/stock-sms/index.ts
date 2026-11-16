/**
 * stock-sms — a product that falls under its minimum or runs out reaches the manager's phone as an SMS.
 *
 *   POST {}  → waits a moment so one delivery is one message, takes what the database queued in stock_alerts, sends it
 *   GET      → { configured }  whether the Twilio secrets are set
 *
 * The database decides what is news (trigger products_stock_sms) and who hears it (super_admins.stock_sms), so a caller
 * can only make queued alerts go out sooner, never choose a text or a number. Deployed with verify_jwt off on purpose,
 * like fault-push: pg_net calls it with no session.
 *
 * Secrets (Edge Functions → Secrets), the same values as Authentication → Phone → Twilio:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM, a sender number or name)
 */
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { compose, rank, segments, TEST_TEXT, type Item, type Level } from "./text.ts";

const BASE = Deno.env.get("SUPABASE_URL")!;
const SECRET = (() => {
  try {
    return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default as string | undefined;
  } catch {
    return undefined;
  }
})() ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(BASE, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

/**
 * A worker's exit saves its lines one request after another, about half a second each; waiting this long makes them
 * one message and still reaches the phone within seconds.
 */
const GATHER_MS = 8_000;
/** Messages a phone gets in one Israeli day; past it the alerts are recorded and the screens carry them. */
const DAILY = 10;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Twilio = { sid: string; token: string; service?: string; from?: string };

/** Read on every call, so secrets added in the dashboard count from the next message. */
function twilio(): Twilio | null {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim();
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim();
  const service = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID")?.trim() || undefined;
  const from = Deno.env.get("TWILIO_FROM")?.trim() || undefined;
  return sid && token && (service || from) ? { sid, token, service, from } : null;
}

/** Phones are kept as auth.users keeps them: 972… with no plus. */
function e164(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

async function sendSms(t: Twilio, phone: string, body: string): Promise<{ id: string } | { error: string }> {
  const form = new URLSearchParams({ To: e164(phone), Body: body });
  if (t.service) form.set("MessagingServiceSid", t.service);
  else form.set("From", t.from!);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.sid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${t.sid}:${t.token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && typeof out?.sid === "string") return { id: out.sid };
    return { error: `${res.status} ${out?.code ?? ""} ${out?.message ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 300) };
  } catch (e) {
    return { error: String(e).slice(0, 300) };
  }
}

type Taken = {
  id: number;
  level: Level | "test";
  from_level: string | null;
  product_id: string | null;
  name: string | null;
  unit: string | null;
  qty: number | string | null;
  reserved: number | string | null;
  min_qty: number | string | null;
  now: Level | "ok" | null;
};
type Phone = { phone: string; today: number };
type Outcome = "sent" | "resolved" | "not_configured" | "failed" | "limit" | "no_phone";

async function run() {
  // A call with nothing waiting (a second call of the same burst, or a stranger) ends here, before the wait.
  const waiting = await db.from("stock_alerts").select("id", { count: "exact", head: true }).is("taken_at", null);
  if (waiting.error) throw new Error(waiting.error.message);
  if (!waiting.count) return { sent: 0, reason: "nothing waiting" };

  await new Promise((resolve) => setTimeout(resolve, GATHER_MS));

  const { data, error } = await db.rpc("stock_sms_take");
  if (error) throw new Error(error.message);
  const alerts = (data?.alerts ?? []) as Taken[];
  const phones = (data?.phones ?? []) as Phone[];
  if (alerts.length === 0) return { sent: 0, reason: "taken by another call" };

  const outcomes = new Map<number, { outcome: Outcome; detail?: string }>();
  // Per product, the level it stands at now, if that is still worse than before the change; a product that recovered says nothing.
  const items = new Map<string, Item & { ids: number[] }>();
  const tests: number[] = [];
  for (const a of alerts) {
    if (a.level === "test") {
      tests.push(a.id);
      continue;
    }
    const before = items.get(a.product_id ?? "");
    if (before) {
      before.ids.push(a.id);
      continue;
    }
    if (!a.product_id || !a.now || a.now === "ok" || rank(a.now) <= rank(a.from_level)) {
      outcomes.set(a.id, { outcome: "resolved", detail: a.now ?? "product deleted" });
      continue;
    }
    items.set(a.product_id, {
      level: a.now,
      name: a.name ?? "",
      unit: a.unit ?? "",
      qty: Number(a.qty ?? 0),
      reserved: Number(a.reserved ?? 0),
      min_qty: Number(a.min_qty ?? 0),
      ids: [a.id],
    });
  }

  const messages: { body: string; ids: number[] }[] = [];
  if (tests.length > 0) messages.push({ body: TEST_TEXT, ids: tests });
  if (items.size > 0) messages.push({ body: compose([...items.values()]), ids: [...items.values()].flatMap((i) => i.ids) });

  const t = twilio();
  const outbox: { phone: string; body: string; alert_ids: number[]; status: string; provider_id: string | null; error: string | null }[] = [];
  for (const m of messages) {
    if (phones.length === 0) {
      for (const id of m.ids) outcomes.set(id, { outcome: "no_phone" });
      continue;
    }
    const results: { status: Outcome; error?: string }[] = [];
    for (const p of phones) {
      let status: Outcome;
      let provider: string | null = null;
      let failure: string | null = null;
      if (!t) status = "not_configured";
      else if (p.today >= DAILY) status = "limit";
      else {
        const r = await sendSms(t, p.phone, m.body);
        if ("id" in r) {
          status = "sent";
          provider = r.id;
          p.today += 1;
        } else {
          status = "failed";
          failure = r.error;
          console.error("sms refused", r.error);
        }
      }
      outbox.push({ phone: p.phone, body: m.body, alert_ids: m.ids, status, provider_id: provider, error: failure });
      results.push({ status, error: failure ?? undefined });
    }
    // Told once one phone got it; otherwise the reason to fix first.
    const order: Outcome[] = ["sent", "failed", "limit", "not_configured"];
    const best = order.find((o) => results.some((r) => r.status === o)) ?? "failed";
    const detail = best === "failed" ? results.find((r) => r.status === "failed")?.error : undefined;
    for (const id of m.ids) outcomes.set(id, { outcome: best, detail });
  }

  if (outbox.length > 0) {
    const { error: outboxError } = await db.from("sms_outbox").insert(outbox);
    if (outboxError) console.error("outbox", outboxError.message);
  }
  const groups = new Map<string, number[]>();
  for (const [id, o] of outcomes) {
    const key = JSON.stringify([o.outcome, o.detail ?? null]);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const [key, ids] of groups) {
    const [outcome, detail] = JSON.parse(key) as [Outcome, string | null];
    const { error: markError } = await db.from("stock_alerts").update({ outcome, detail }).in("id", ids);
    if (markError) console.error("mark", markError.message);
  }

  return {
    sent: outbox.filter((o) => o.status === "sent").length,
    messages: messages.map((m) => ({ alerts: m.ids.length, segments: segments(m.body) })),
    outcomes: [...outcomes.values()].reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.outcome]: (acc[o.outcome] ?? 0) + 1 }), {}),
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") return json({ configured: twilio() !== null });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    return json(await run());
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
