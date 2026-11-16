"use client";

/**
 * Notifications for a fault handed to a worker.
 *
 * The phone: subscribes with the fault-push function's public key and files the subscription under the worker
 * chosen on it (push_register), so a fault handed to that worker arrives as a notification (see
 * supabase/functions/fault-push and public/worker-sw.js). An iPhone delivers web push only to a site added to
 * the home screen (iOS 16.4 and later), so there the first step is that.
 * The manager: which workers have a phone that will ring (push_workers).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase/client";

const SW_URL = "/worker-sw.js";
const SW_SCOPE = "/worker";
const KEY_CACHE = "push.key";

export type PushStatus =
  /** not known yet */
  | "checking"
  /** this browser has no web push (an in-app browser, an old phone) */
  | "unsupported"
  /** an iPhone in Safari: notifications work once the site is opened from the home screen */
  | "install"
  /** can ask */
  | "off"
  /** the person said no; only the phone's settings can undo it */
  | "blocked"
  | "on";

function functionUrl(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fault-push`;
}

function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function canPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function noPush(): PushStatus {
  return isAppleMobile() && !isStandalone() ? "install" : "unsupported";
}

function cachedKey(): string | null {
  try {
    return window.localStorage.getItem(KEY_CACHE);
  } catch {
    return null;
  }
}

/** Asked once per visit: every return to the home would otherwise ask again. */
let keyRequest: Promise<string> | null = null;

function fetchKey(): Promise<string> {
  keyRequest ??= (async () => {
    const res = await fetch(functionUrl());
    const body = (await res.json().catch(() => null)) as { publicKey?: string } | null;
    if (!res.ok || !body?.publicKey) throw new Error("שירות ההתראות לא זמין כרגע");
    try {
      window.localStorage.setItem(KEY_CACHE, body.publicKey);
    } catch {
      /* private mode: it is fetched again next time */
    }
    return body.publicKey;
  })().catch((e: unknown) => {
    keyRequest = null;
    throw e;
  });
  return keyRequest;
}

/** Subscriptions already filed in this visit, as endpoint|worker, so a return to the home sends nothing. */
const filed = new Set<string>();

function keyBytes(text: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const bin = window.atob((text + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A subscription made with an older sender key would be refused by the push service, so it is made again. */
function madeWith(sub: PushSubscription, key: string): boolean {
  const used = sub.options?.applicationServerKey;
  if (!used) return true;
  const a = new Uint8Array(used);
  const b = keyBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const ENABLE_LIMIT_MS = 20_000;

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("לא הצליח להפעיל. לנסות שוב")), ms);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (e: unknown) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function register(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, updateViaCache: "none" });
}

async function file(sub: PushSubscription, workerId: string): Promise<void> {
  const mark = `${sub.endpoint}|${workerId}`;
  if (filed.has(mark)) return;
  const keys = sub.toJSON().keys ?? {};
  const { error } = await supabase().rpc("push_register", {
    p_worker: workerId,
    p_endpoint: sub.endpoint,
    p_p256dh: keys.p256dh ?? "",
    p_auth: keys.auth ?? "",
    p_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
  filed.add(mark);
}

/** The phone's side: where notifications stand for the worker chosen on it, and the tap that turns them on. */
export function usePush(workerId: string | null) {
  const [status, setStatus] = useState<PushStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  // Once the worker has pressed, what they did decides; a slower check started earlier never overrides it.
  const acted = useRef(false);

  useEffect(() => {
    if (!workerId) return;
    let live = true;
    acted.current = false;
    const settle = (next: PushStatus) => {
      if (live && !acted.current) setStatus(next);
    };
    void (async () => {
      if (!canPush()) return settle(noPush());
      // Known without the network, so the first-time banner opens at once.
      if (Notification.permission === "denied") settle("blocked");
      else if (Notification.permission === "default") settle("off");
      try {
        const reg = await register();
        registration.current = reg;
        // Fetched now, so the tap that subscribes has it at hand: Safari keeps the permission question to the tap itself.
        const key = await fetchKey().catch(() => cachedKey());
        if (Notification.permission !== "granted") return;
        let sub = await reg.pushManager.getSubscription();
        if (sub && key && !madeWith(sub, key)) {
          await sub.unsubscribe();
          sub = null;
        }
        if (!sub) return settle("off");
        // Keeps this phone filed under whoever is chosen on it now.
        await file(sub, workerId);
        settle("on");
      } catch {
        if (Notification.permission === "granted") settle("off");
      }
    })();
    return () => {
      live = false;
    };
  }, [workerId]);

  /** Asks the phone, subscribes and files it; answers where notifications stand after, or null when it failed. */
  const enable = useCallback(async (): Promise<PushStatus | null> => {
    if (!workerId || busy) return null;
    acted.current = true;
    if (!canPush()) {
      const next = noPush();
      setStatus(next);
      return next;
    }
    setBusy(true);
    setError(null);
    try {
      // Asked first, before anything that waits on the network.
      const answer = await Notification.requestPermission();
      if (answer !== "granted") {
        const next = answer === "denied" ? "blocked" : "off";
        setStatus(next);
        return next;
      }
      // The push service can stall on a weak line; the worker gets the button back instead of a spinner that never ends.
      // A subscription that lands after the limit is filed on the next visit.
      await within(
        (async () => {
          if (!registration.current) registration.current = await register();
          const reg = await navigator.serviceWorker.ready;
          const key = cachedKey() ?? (await fetchKey());
          let sub = await reg.pushManager.getSubscription();
          if (sub && !madeWith(sub, key)) {
            await sub.unsubscribe();
            sub = null;
          }
          sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
          await file(sub, workerId);
        })(),
        ENABLE_LIMIT_MS,
      );
      setStatus("on");
      return "on";
    } catch (e) {
      setError(e instanceof Error && /[֐-׿]/.test(e.message) ? e.message : "ההתראות לא הופעלו");
      return null;
    } finally {
      setBusy(false);
    }
  }, [workerId, busy]);

  /** Before another worker takes the phone, so the one leaving stops getting its notifications here. */
  const release = useCallback(async () => {
    try {
      const reg = registration.current ?? (canPush() ? await navigator.serviceWorker.getRegistration(SW_SCOPE) : undefined);
      const sub = await reg?.pushManager.getSubscription();
      filed.clear();
      if (sub) await supabase().rpc("push_unregister", { p_endpoint: sub.endpoint });
    } catch {
      /* the next worker chosen here takes the subscription over anyway */
    }
  }, []);

  return { status, busy, error, enable, release };
}

const PROMPTED_KEY = "push.prompted";
/** Closed in this visit, for a phone whose storage refuses writes; the banner still closes. */
const promptedNow = new Set<string>();
const promptedListeners = new Set<() => void>();

function subscribePrompted(cb: () => void) {
  promptedListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    promptedListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function promptedStored(): string {
  try {
    return window.localStorage.getItem(PROMPTED_KEY) ?? "";
  } catch {
    return "";
  }
}

function promptedSnapshot(): string {
  return `${promptedStored()}|${[...promptedNow].join(",")}`;
}

/**
 * The first time a worker opens the app on this phone with notifications off, one banner in the middle of the screen
 * offers them. Closing it, or answering the phone's question, is remembered per worker; the footer row stays the way back.
 */
export function usePushPrompt(workerId: string | null, status: PushStatus) {
  const seen = useSyncExternalStore(subscribePrompted, promptedSnapshot, () => null);
  const asked = seen === null || !workerId || seen.split(/[|,]/).includes(workerId);
  const dismiss = useCallback(() => {
    if (!workerId) return;
    promptedNow.add(workerId);
    const ids = new Set(promptedStored().split(",").filter(Boolean));
    ids.add(workerId);
    try {
      window.localStorage.setItem(PROMPTED_KEY, [...ids].join(","));
    } catch {
      /* private mode: it may offer once more on a later visit */
    }
    promptedListeners.forEach((cb) => cb());
  }, [workerId]);
  return { open: !asked && (status === "off" || status === "install" || status === "blocked"), dismiss };
}

/** The manager's side: workers with a phone that will ring, checked every minute and when the tab comes back. Null until known. */
export function usePushWorkers(): ReadonlySet<string> | null {
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const { data, error } = await supabase().rpc("push_workers");
      if (live && !error) setIds(new Set((data ?? []).map((row) => row.worker_id)));
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onShow = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return ids;
}

/** The worker's קיבלתי: the database stamps its own time and clears it again if the fault is handed on. */
export async function acknowledgeFault(id: string): Promise<void> {
  const { data, error } = await supabase().from("faults").update({ acknowledged_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("לא נשמר");
}
