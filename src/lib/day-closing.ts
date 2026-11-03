"use client";

/**
 * סגירת יום: reads one warehouse day. An ended day comes from the closing the nightly job stored,
 * so it stays what it was; today comes from the same database function and follows the store.
 * A manager's signature sits beside that record and never changes it.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useData } from "@/lib/store";

export type MovedLine = { type: "in" | "out"; product_id: string; name: string; unit: string; party: string | null; qty: number; worth: number | null; no_receipt: number };
export type DayOrder = { id: string; number: number; customer: string; agent: string; created_at: string; promised_on: string | null; lines: number };
export type DayRequest = { id: string; name: string; qty: number; customer: string | null; worker: string | null; created_at: string };
export type DayFault = { id: string; description: string; product: string | null; worker: string | null; created_at: string };
export type DayName = { id: string; name: string; supplier: string; created_at: string };
export type DayStock = { product_id: string; name: string; unit: string; qty: number; reserved: number; min_qty: number; state: "short" | "out" | "low" };
export type DayAction = {
  kind: "request_approved" | "request_rejected" | "name_approved" | "count" | "no_receipt" | "fault_resolved" | "order_delivered";
  at: string;
  title: string;
  detail: string | null;
  qty: number | null;
  unit: string | null;
};
export type DaySummary = {
  day: string;
  moved: MovedLine[];
  orders: DayOrder[];
  requests: DayRequest[];
  faults: DayFault[];
  names: DayName[];
  /** Null on a day whose stock was never recorded: it ended before closings began. */
  stock: DayStock[] | null;
  actions: DayAction[];
};
/** What stood open at the signature. */
export type DayOpenItems = { faults: number; requests: number; names: number };
export type DaySignoff = { day: string; signed_by: string; note: string | null; open_items: DayOpenItems; signed_at: string };

/** Lets a burst of realtime rows settle into one read. */
const QUIET_MS = 400;

const israelDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" });
const dayWords = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long" });

/** The date it is now in Israel, where the database draws the line between days. */
export const israelToday = (): string => israelDate.format(new Date());

/** Noon, so no clock change can carry a day over to the next date. */
const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);

export const isDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(noon(value));

export const shiftDay = (day: string, offset: number): string => new Date(noon(day) + offset * 86_400_000).toISOString().slice(0, 10);

export const fmtClosingDay = (day: string): string => dayWords.format(noon(day));

/** The last hour of a day in Israel, whichever way the clocks stand: what an ended day's ages are counted from, so they stay as they were. */
export const dayEnd = (day: string): number => Date.parse(`${day}T20:59:00Z`);

/** The database takes a signature for today and yesterday only. */
export const canSign = (day: string): boolean => day >= shiftDay(israelToday(), -1);

async function readDay(day: string, live: boolean): Promise<DaySummary> {
  const sb = supabase();
  if (!live) {
    const { data, error } = await sb.from("day_closings").select("summary").eq("day", day).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data.summary as unknown as DaySummary;
  }
  const { data, error } = await sb.rpc("day_summary", { target: day });
  if (error) throw new Error(error.message);
  return data as unknown as DaySummary;
}

export function useDaySummary(day: string) {
  const { state } = useData();
  const live = day === israelToday();
  const [loaded, setLoaded] = useState<{ day: string; summary: DaySummary } | null>(null);
  const [failedDay, setFailedDay] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Today moves with the warehouse, so whatever the store hears reads it again. An ended day never changes.
  const watched = live ? state : null;

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      readDay(day, live).then(
        (summary) => {
          if (!current) return;
          setLoaded({ day, summary });
          setFailedDay(null);
        },
        () => {
          if (current) setFailedDay(day);
        },
      );
    }, QUIET_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [day, live, attempt, watched?.movements, watched?.orders, watched?.faults, watched?.itemRequests, watched?.supplierItems, watched?.products]);

  const summary = loaded?.day === day ? loaded.summary : null;
  const retry = useCallback(() => {
    setFailedDay(null);
    setAttempt((n) => n + 1);
  }, []);

  return { summary, failed: !summary && failedDay === day, retry };
}

/** Who signed a day: undefined until read, null while nobody has. `sign` throws the database's own message. */
export function useDaySignoff(day: string) {
  const [loaded, setLoaded] = useState<{ day: string; signoff: DaySignoff | null } | null>(null);
  const [failedDay, setFailedDay] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void supabase().from("day_signoffs").select("*").eq("day", day).maybeSingle().then(({ data, error }) => {
      if (!current) return;
      if (error) {
        setFailedDay(day);
        return;
      }
      setLoaded({ day, signoff: data as unknown as DaySignoff | null });
      setFailedDay(null);
    });
    return () => {
      current = false;
    };
  }, [day, attempt]);

  const signoff = loaded?.day === day ? loaded.signoff : undefined;
  const retry = useCallback(() => {
    setFailedDay(null);
    setAttempt((n) => n + 1);
  }, []);

  const sign = useCallback(
    async (why?: string) => {
      const { data, error } = await supabase().rpc("sign_day", { target: day, why });
      if (error) {
        // Another manager may have signed first: read the day again, so the card says so.
        retry();
        throw new Error(error.message);
      }
      setLoaded({ day, signoff: data as unknown as DaySignoff });
    },
    [day, retry],
  );

  return { signoff, failed: signoff === undefined && failedDay === day, retry, sign };
}

/** The first day that has a closing; nothing to go back to before it. */
export function useFirstClosedDay(): string | null {
  const [first, setFirst] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void supabase().from("day_closings").select("day").order("day").limit(1).then(({ data }) => {
      if (current) setFirst(data?.[0]?.day ?? null);
    });
    return () => {
      current = false;
    };
  }, []);
  return first;
}
