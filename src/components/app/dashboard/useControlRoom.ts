"use client";

import { useMemo } from "react";
import { orderTotal, useData, type Movement, type Order } from "@/lib/store";
import { midnight, useMovementsInRange } from "@/lib/movements-range";
import { fullMonth, lastMonths, monthFigures, rolling, shelfWorthAt, worthOf, WINDOW_DAYS } from "@/lib/control-room";
import { shelfWorth } from "@/lib/snapshot";

const clock = () => Date.now();

const DAY = 86_400_000;

const movedAt = (m: Movement) => Date.parse(m.created_at);
const placedAt = (o: Order) => Date.parse(o.created_at);

/** Everything the views share for a period of `count` months. The stock keeps no history, so the year's movements are all read once. */
export function useControlRoom(count: number) {
  const { state, product, linesOf } = useData();
  const { rows, isLoading, failed, retry } = useMovementsInRange(null, null);

  return useMemo(() => {
    const now = clock();
    const months = lastMonths(count, now);
    const from = months[0].from;
    const out = rows.filter((m) => m.type === "out");
    const goodsIn = rows.filter((m) => m.type === "in");
    const worth = (m: Movement) => worthOf(m, product);

    const shelfNow = shelfWorth(state.products);
    // Every month ends where the next begins; the running month ends at the live shelf.
    const shelfMonths = shelfWorthAt(rows, state.products, months.map((m) => Math.min(m.to, now)));
    shelfMonths[shelfMonths.length - 1] = shelfNow.total;
    const windows = Array.from({ length: 12 }, (_, i) => now - (11 - i) * WINDOW_DAYS * DAY);
    const shelfWindows = shelfWorthAt(rows, state.products, windows);
    shelfWindows[shelfWindows.length - 1] = shelfNow.total;

    const open = state.orders.filter((o) => o.status === "open");

    return {
      now,
      from,
      to: now,
      today: midnight(0, new Date(now)),
      months,
      labels: months.map((m) => m.label),
      titles: months.map((m) => (m.partial ? `${fullMonth(m)}, עד היום` : fullMonth(m))),
      partial: months.map((m) => m.partial),
      monthly: monthFigures(rows, months, product),
      rows,
      /** The last 12 windows of 30 days: the last is the figure, the one before it what it is measured against. */
      sales: rolling(out, movedAt, worth, now),
      receipts: rolling(goodsIn, movedAt, worth, now),
      placed: rolling(state.orders, placedAt, () => 1, now),
      faulted: rolling(state.faults, (f) => Date.parse(f.created_at), () => 1, now),
      /** How many orders stood open at the end of each window. */
      openWindows: windows.map((t) => state.orders.filter((o) => placedAt(o) <= t && (!o.closed_at || Date.parse(o.closed_at) > t)).length),
      shelf: shelfNow,
      shelfMonths,
      shelfWindows,
      open,
      openWorth: open.reduce((sum, o) => sum + (orderTotal(linesOf(o.id)) ?? 0), 0),
      isLoading: isLoading || state.status === "loading",
      failed,
      retry,
    };
  }, [count, rows, state.products, state.orders, state.faults, state.status, product, linesOf, isLoading, failed, retry]);
}

export type Room = ReturnType<typeof useControlRoom>;
