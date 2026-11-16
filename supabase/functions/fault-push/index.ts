/**
 * fault-push — a fault handed to a worker reaches that worker's phone as a notification.
 *
 *   GET                 → { publicKey }  the key a phone subscribes with
 *   POST { fault_id }   → sends the fault's current assignment, once (the database calls this through pg_net)
 *   POST ?ack=<id.sig>  → the notification's "קיבלתי" button, signed for that one assignment
 *
 * Everything is read from the database with the secret key, so a caller can only ask for what
 * the database already says should happen: a send that went out is stamped and never repeated.
 * Deployed with verify_jwt off on purpose; the keys live in push_keys, closed to every browser role.
 */
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { b64u, encryptPayload, generateVapidKeys, vapidHeader, type VapidKeys } from "./webpush.ts";

const BASE = Deno.env.get("SUPABASE_URL")!;
const SECRET = (() => {
  try {
    return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default as string | undefined;
  } catch {
    return undefined;
  }
})() ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(BASE, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

/** Who sends, as push services ask; the site itself. */
const SUBJECT = "https://worker-nine-rose.vercel.app";
/** Only real push services, so a planted address can't turn this into a way to call anything else. */
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|google\.com|mozilla\.com|apple\.com|windows\.com)(:\d+)?\//;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const enc = new TextEncoder();

type Keys = VapidKeys & { ackSecret: string };
let cached: Keys | null = null;

/** The sender's keys, made once on first use and kept in the database, so every instance signs with the same pair. */
async function keys(): Promise<Keys> {
  if (cached) return cached;
  const read = async () => {
    const { data, error } = await db.from("push_keys").select("public_key, private_jwk, ack_secret").eq("id", 1).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };
  let row = await read();
  if (!row) {
    const fresh = await generateVapidKeys();
    const ackSecret = b64u(crypto.getRandomValues(new Uint8Array(32)));
    // Two cold starts at once both try; the first insert wins and both read it back.
    await db.from("push_keys").upsert({ id: 1, public_key: fresh.publicKey, private_jwk: fresh.privateJwk, ack_secret: ackSecret }, { onConflict: "id", ignoreDuplicates: true });
    row = await read();
  }
  if (!row) throw new Error("push keys missing");
  cached = { publicKey: row.public_key, privateJwk: row.private_jwk, ackSecret: row.ack_secret };
  return cached;
}

type Assignment = { id: string; assigned_to: string | null; assigned_at: string | null };

/** A signature for one assignment: a new hand or a new instruction changes assigned_at, and an old button stops working. */
async function signature(secret: string, f: Assignment): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${f.id}|${f.assigned_to}|${f.assigned_at}`)));
  return b64u(mac).slice(0, 32);
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function send(faultId: string) {
  // Claiming the send first means a second call for the same assignment finds nothing to do.
  const { data: f, error } = await db
    .from("faults")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", faultId)
    .is("notified_at", null)
    .eq("status", "open")
    .not("assigned_to", "is", null)
    .select("id, description, instruction, assigned_to, assigned_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!f) return { sent: 0, reason: "nothing to send" };

  const { data: subs, error: subsError } = await db.from("push_subscriptions").select("endpoint, p256dh, auth").eq("worker_id", f.assigned_to);
  if (subsError) throw new Error(subsError.message);

  const k = await keys();
  const payload = enc.encode(JSON.stringify({
    title: "משימה מהמנהל",
    body: [f.instruction, f.description].filter(Boolean).join("\n"),
    url: `/worker/task/${f.id}`,
    tag: `fault-${f.id}`,
    ack: `${BASE}/functions/v1/fault-push?ack=${f.id}.${await signature(k.ackSecret, f)}`,
  }));

  let sent = 0;
  const gone: string[] = [];
  const refused: number[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    if (!PUSH_HOSTS.test(s.endpoint)) {
      gone.push(s.endpoint);
      return;
    }
    try {
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          Authorization: await vapidHeader(s.endpoint, k, SUBJECT),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Urgency: "high",
        },
        body: await encryptPayload(payload, s.p256dh, s.auth),
      });
      if (res.ok) sent += 1;
      // The phone unsubscribed or the browser was reset: that address will never answer again.
      else if (res.status === 404 || res.status === 410) gone.push(s.endpoint);
      else {
        refused.push(res.status);
        console.error("push refused", res.status, new URL(s.endpoint).host, (await res.text().catch(() => "")).slice(0, 300));
      }
    } catch (e) {
      refused.push(0);
      console.error("push failed", new URL(s.endpoint).host, String(e));
    }
  }));

  if (gone.length > 0) await db.from("push_subscriptions").delete().in("endpoint", gone);
  // Nothing reached a phone, so the fault doesn't claim a notification it never got.
  if (sent === 0) await db.from("faults").update({ notified_at: null }).eq("id", f.id).eq("assigned_at", f.assigned_at);
  return { sent, devices: subs?.length ?? 0, removed: gone.length, refused };
}

async function acknowledge(param: string) {
  const [id, sig] = param.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, reason: "bad request" }, 400);
  const { data: f, error } = await db.from("faults").select("id, assigned_to, assigned_at, status, acknowledged_at").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!f || !f.assigned_to || f.status !== "open") return json({ ok: false, reason: "closed or unassigned" }, 409);
  if (!same(sig, await signature((await keys()).ackSecret, f))) return json({ ok: false, reason: "handed on since" }, 409);
  if (!f.acknowledged_at) {
    const { error: ackError } = await db.from("faults").update({ acknowledged_at: new Date().toISOString() }).eq("id", id).is("acknowledged_at", null);
    if (ackError) throw new Error(ackError.message);
  }
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") return json({ publicKey: (await keys()).publicKey });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const ack = new URL(req.url).searchParams.get("ack");
    if (ack) return await acknowledge(ack);
    const body = await req.json().catch(() => ({}));
    if (typeof body?.fault_id !== "string") return json({ error: "fault_id required" }, 400);
    return json(await send(body.fault_id));
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
