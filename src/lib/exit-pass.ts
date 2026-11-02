"use client";

/**
 * Stock leaving with no receipt. Each write runs on the throwaway client that has just checked an
 * SMS code: that session is what the database reads as proof, one code clears one action, and the
 * app's own session never can.
 */
import { useEffect, useState } from "react";
import type { LoginClient } from "@/lib/login/auth";
import { supabase } from "@/lib/supabase/client";

/** The signed-in person's phone when they may use a code instead of a receipt, otherwise null. */
export function useSuperAdminPhone(): string | null {
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase().rpc("super_admin_phone").then(({ data }) => {
      if (alive) setPhone(data ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);
  return phone;
}

export type ExitWithoutReceipt = {
  /** `adjust` is a count that lowers the shelf, `qty` being the count. */
  kind: "out" | "adjust";
  productId: string;
  qty: number;
  why: string;
  workerId?: string | null;
  customer?: string | null;
  reference?: string | null;
};

export async function removeWithoutReceipt(client: LoginClient, input: ExitWithoutReceipt): Promise<void> {
  const { error } = await client.rpc("remove_without_receipt", {
    kind: input.kind,
    product: input.productId,
    amount: input.qty,
    why: input.why,
    by_worker: input.workerId ?? undefined,
    customer: input.customer ?? undefined,
    ref: input.reference ?? undefined,
  });
  if (error) throw new Error(error.message);
}

export async function deliverOrderWithoutReceipt(client: LoginClient, orderId: string, why: string): Promise<void> {
  const { error } = await client.rpc("deliver_order_no_receipt", { target_order: orderId, why });
  if (error) throw new Error(error.message);
}
