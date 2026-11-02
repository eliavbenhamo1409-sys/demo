"use client";

/**
 * לוח בקרה — the overview in the bokeh style: the same page, a different picture. Where the other styles answer the owner
 * in a few big figures, this one shows the months behind them, one view for each thing a manager asks about.
 * One row of controls above everything it scopes: the view, and how far back. Both live in the URL, like the other pages' tabs.
 */
import { Suspense, useCallback, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Notice, PageHead, Tabs } from "@/components/ui";
import { fmtToday } from "@/lib/format";
import { BuyingView } from "./BuyingView";
import { FloorView } from "./FloorView";
import { ManagerView } from "./ManagerView";
import { SalesView } from "./SalesView";
import { StockView } from "./StockView";
import { TileSkeleton } from "./Tile";
import { useControlRoom } from "./useControlRoom";
import "./dashboard.css";

const VIEWS = [
  { value: "manager", label: "מנהל" },
  { value: "sales", label: "מכירות" },
  { value: "stock", label: "מלאי" },
  { value: "buying", label: "רכש" },
  { value: "floor", label: "תפעול" },
];

const VIEW_OF = { manager: ManagerView, sales: SalesView, stock: StockView, buying: BuyingView, floor: FloorView };

const PERIODS = [
  { value: "3", label: "3 חודשים" },
  { value: "6", label: "6 חודשים" },
  { value: "12", label: "שנה" },
];

function Inner(): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (VIEWS.find((v) => v.value === params.get("view"))?.value ?? VIEWS[0].value) as keyof typeof VIEW_OF;
  const period = PERIODS.find((p) => p.value === params.get("months"))?.value ?? "12";

  const set = useCallback(
    (key: string, value: string, fallback: string) => {
      const sp = new URLSearchParams(params.toString());
      if (value === fallback) sp.delete(key);
      else sp.set(key, value);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const room = useControlRoom(Number(period));
  const View = VIEW_OF[view];

  return (
    <div className="sa-page dash">
      <PageHead title="לוח בקרה" sub={fmtToday()} />
      <div className="dash-controls">
        <Tabs tabs={VIEWS} value={view} onChange={(v) => set("view", v, VIEWS[0].value)} />
        <Tabs tabs={PERIODS} value={period} onChange={(v) => set("months", v, "12")} className="dash-period" />
      </div>

      {room.failed ? (
        <Notice tone="danger" title="התנועות לא נטענו" action="ניסיון נוסף" onAction={room.retry}>
          הגרפים מחושבים רק לפי מה שנטען
        </Notice>
      ) : null}

      {room.isLoading ? (
        <div className="dash-kpis">{Array.from({ length: 6 }, (_, i) => <TileSkeleton key={i} />)}</div>
      ) : (
        <View room={room} />
      )}
    </div>
  );
}

export function ControlRoom(): ReactElement {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
