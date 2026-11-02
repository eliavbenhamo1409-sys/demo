"use client";

/**
 * Worker-app helpers layered on top of the shared data store:
 * the remembered worker, recent customers, delivery-note photo uploads and open orders.
 * Nothing here touches store.tsx.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { QueryData } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { useData, type DocumentInput } from "@/lib/store";

const WORKER_KEY = "worker.id";
const CUSTOMERS_KEY = "worker.customers";
const MAX_CUSTOMERS = 8;

/** Private storage bucket for photographed goods-in and goods-out receipts. */
const DELIVERY_NOTES_BUCKET = "delivery-notes";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode etc. — the choice just won't persist */
  }
  listeners.forEach((cb) => cb());
}
/** Read a localStorage key as external-store state (null until mounted on the client). */
function useStoredValue(key: string): { value: string | null; hydrated: boolean } {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return { value, hydrated };
}

/** The worker chosen on this phone (validated against the live workers list). */
export function useCurrentWorker() {
  const { state, worker } = useData();
  const { value: id, hydrated } = useStoredValue(WORKER_KEY);
  const choose = useCallback((workerId: string | null) => {
    write(WORKER_KEY, workerId);
  }, []);
  const current = worker(id);
  return {
    worker: current && current.active ? current : undefined,
    ready: hydrated && state.status !== "loading",
    workers: state.workers.filter((w) => w.active),
    choose,
  };
}

function parseCustomers(raw: string | null): string[] {
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Customers recently typed in the deliver flow, most recent first. */
export function useRecentCustomers() {
  const { value: raw } = useStoredValue(CUSTOMERS_KEY);
  const list = parseCustomers(raw);
  const remember = useCallback((name: string) => {
    const n = name.trim();
    if (!n) return;
    const prev = parseCustomers(read(CUSTOMERS_KEY));
    const next = [n, ...prev.filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, MAX_CUSTOMERS);
    write(CUSTOMERS_KEY, JSON.stringify(next));
  }, []);
  return { recent: list, remember };
}

/** Upload a receipt photo under in/ or out/; resolves to the storage path, or throws. */
async function uploadReceiptPhoto(file: File, kind: DocumentInput["kind"]): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase().storage.from(DELIVERY_NOTES_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * One upload per photo: `start` runs when the worker moves on, and `save` waits for it
 * (trying once more on failure) before archiving the document, so a slow connection
 * doesn't cost the photo. `save` resolves to the document id, or null when it couldn't be kept.
 */
export function useReceiptUpload(kind: DocumentInput["kind"]) {
  const { createDocument } = useData();
  const job = useRef<{ file: File; path: Promise<string>; documentId?: string } | null>(null);

  const start = useCallback((file: File) => {
    if (job.current?.file === file) return job.current;
    const path = uploadReceiptPhoto(file, kind);
    path.catch(() => undefined); // awaited, and retried, by save
    job.current = { file, path };
    return job.current;
  }, [kind]);

  const save = useCallback(async (file: File, details: Omit<DocumentInput, "kind" | "storagePath">) => {
    try {
      const first = start(file);
      const storagePath = await first.path.catch(() => {
        job.current = null;
        return start(file).path;
      });
      const current = job.current!;
      current.documentId ??= (await createDocument({ ...details, kind, storagePath })).id;
      return current.documentId;
    } catch {
      return null;
    }
  }, [kind, start, createDocument]);

  return { start, save };
}

const openOrdersQuery = () => supabase().from("orders").select("*, order_lines(*), agents(name)").eq("status", "open").order("created_at", { ascending: true });

/** An agent's order waiting to leave the warehouse, with its lines and agent. */
export type OpenOrder = QueryData<ReturnType<typeof openOrdersQuery>>[number];

/** The open orders as of opening the screen, oldest first. Read once: the database refuses a stale one. */
export function useOpenOrders() {
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  useEffect(() => {
    let alive = true;
    void openOrdersQuery().then(({ data }) => {
      if (alive && data) setOrders(data);
    });
    return () => {
      alive = false;
    };
  }, []);
  /** Read the list again, after the database refused an order that someone else closed. */
  const refresh = useCallback(async () => {
    const { data } = await openOrdersQuery();
    if (data) setOrders(data);
  }, []);
  return { orders, refresh };
}

/** The order left the warehouse: the database posts its movements and releases the hold, or throws its own message. */
export async function deliverOrder(orderId: string, workerId: string, documentId: string | null): Promise<void> {
  const { error } = await supabase().rpc("deliver_order", {
    target_order: orderId,
    by_worker: workerId,
    ...(documentId ? { receipt: documentId } : {}),
  });
  if (error) throw new Error(error.message);
}

/** Storage bucket for fault photos (public read). Must exist in the Supabase project. */
export const FAULT_PHOTOS_BUCKET = "fault-photos";

/** Upload a fault photo; resolves to the storage path, or throws. */
export async function uploadFaultPhoto(file: File, workerId: string): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${workerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase().storage.from(FAULT_PHOTOS_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Public URL of a fault photo stored by `uploadFaultPhoto`. */
export function faultPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase().storage.from(FAULT_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}
