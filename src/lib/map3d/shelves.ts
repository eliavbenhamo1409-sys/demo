"use client";

/**
 * What stands on each shelf. Its own fetch and channel, out of the store as the layout is: a failed table in reload()
 * flips the whole admin to error. One shared subscription, so the rail, a panel over it and the worker's flow can all read it.
 */

import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Tables } from "@/lib/database.types";

export type ShelfRow = Pick<Tables<"shelf_stock">, "product_id" | "place" | "qty" | "placed_at">;

/** How many receipts of a product went to a place. */
export interface UsualPlace {
  product_id: string;
  place: string;
  times: number;
  last_at: string;
}

export interface Shelves {
  /** Oldest first. Null: not read yet, or the table isn't there, and products.location is all the map has. */
  rows: readonly ShelfRow[] | null;
  usual: readonly UsualPlace[];
}

const EMPTY: Shelves = { rows: null, usual: [] };

let current = EMPTY;
let reads = 0;
const listeners = new Set<() => void>();

function publish(next: Shelves): void {
  current = next;
  for (const listener of listeners) listener();
}

async function load(): Promise<void> {
  const ticket = ++reads;
  const sb = supabase();
  const [shelves, usual] = await Promise.all([
    sb.from("shelf_stock").select("product_id, place, qty, placed_at").order("placed_at").order("place"),
    // A view, so it isn't in the generated Tables.
    sb.from("usual_places" as never).select("product_id, place, times, last_at"),
  ]);
  // A read that lost the race, or one that failed: the last good shelves stay on screen.
  if (ticket !== reads || shelves.error) return;
  publish({ rows: shelves.data, usual: usual.error ? [] : (usual.data as unknown as UsualPlace[]) });
}

let stop: (() => void) | null = null;

function connect(): () => void {
  void load();
  const sb = supabase();
  const channel = sb
    .channel("shelf-stock")
    .on("postgres_changes", { event: "*", schema: "public", table: "shelf_stock" }, () => void load())
    .subscribe((status) => {
      // Covers anything saved before the join, and after a reconnect.
      if (status === "SUBSCRIBED") void load();
    });
  return () => void sb.removeChannel(channel);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  stop ??= connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stop?.();
    stop = null;
  };
}

/** Puts stock on a shelf or moves it from one to another. The total doesn't change, so this is no movement. */
export async function placeStock(productId: string, target: string, qty: number, source: string | null): Promise<void> {
  const { error } = await supabase().rpc("place_stock", { product: productId, target, amount: qty, ...(source ? { source } : {}) });
  if (error) throw new Error(error.message);
  await load();
}

export function useShelves(): Shelves {
  const shelves = useSyncExternalStore(subscribe, () => current, () => EMPTY);
  // A hidden tab can miss events; coming back is a good moment to read again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return shelves;
}
