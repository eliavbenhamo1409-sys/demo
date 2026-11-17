"use client";

import { useMemo } from "react";
import { useData } from "@/lib/store";
import { openFaults, pendingNames, pendingRequests, shortagesOf, type Shortage, type Waiting } from "./work";

/** Every product that is missing something, in the order to deal with it. The rail, the overview and חוסרים all read this one list. */
export function useShortages(): Shortage[] {
  const { state, linesOf } = useData();
  return useMemo(() => shortagesOf(state.products, state.orders, linesOf), [state.products, state.orders, linesOf]);
}

/** How much waits, by kind. One count for every screen that shows it. */
export function useWaiting(): Waiting {
  const { state, product } = useData();
  const shortages = useShortages().length;
  return useMemo(() => {
    const faults = openFaults(state.faults).length;
    const approvals = pendingRequests(state.itemRequests).length + pendingNames(state.supplierItems, product).length;
    return { faults, approvals, shortages, total: faults + approvals + shortages };
  }, [state.faults, state.itemRequests, state.supplierItems, product, shortages]);
}
