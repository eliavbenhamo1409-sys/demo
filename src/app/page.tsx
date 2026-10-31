"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useData, type AttentionEntry, type Movement as MovementRow } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { WeeklyChart } from "@/components/app/WeeklyChart";
import {
  Attention,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Movement,
  Square,
  Stat,
  Table,
  type AttentionItem,
  type TableColumn,
} from "@/components/ui";
import { fmtQty, fmtRelative, fmtSigned, fmtWhen } from "@/lib/format";
import { faultPhotoUrl } from "@/lib/fault-photos";

const MAX_ATTENTION = 6;
const RECENT = 12;

export default function OverviewPage() {
  const { state, stats, attention, weekly, product, worker, resolveFault } = useData();
  const { openAction, openProduct, openTasks, notify } = useUi();
  const [busyFault, setBusyFault] = useState<string | null>(null);
  const isLoading = state.status === "loading";

  /* ───────── subline ───────── */
  const subline = useMemo(() => {
    const parts: string[] = [];
    if (stats.products > 0) parts.push(`${fmtQty(stats.products)} מוצרים`);
    if (stats.movementsToday > 0) parts.push(`${fmtQty(stats.movementsToday)} תנועות היום`);
    if (state.loadedAt) parts.push(`עודכן ${fmtRelative(new Date(state.loadedAt).toISOString())}`);
    return parts.join(" · ");
  }, [stats.products, stats.movementsToday, state.loadedAt]);

  /* ───────── stats ───────── */
  const stockNote =
    stats.out > 0 && stats.low > 0
      ? `${fmtQty(stats.out)} אזלו · ${fmtQty(stats.low)} מתחת למינימום`
      : stats.out > 0
        ? `${fmtQty(stats.out)} אזלו מהמלאי`
        : stats.low > 0
          ? `${fmtQty(stats.low)} מתחת למינימום`
          : stats.products > 0
            ? "כל המוצרים מעל המינימום"
            : undefined;

  const delta =
    stats.movementsYesterday > 0
      ? Math.round(((stats.movementsToday - stats.movementsYesterday) / stats.movementsYesterday) * 100)
      : undefined;

  const exceptionsNote =
    stats.exceptions > 0
      ? [
          stats.openFaults > 0 ? `${fmtQty(stats.openFaults)} תקלות` : "",
          stats.pendingMappings > 0 ? `${fmtQty(stats.pendingMappings)} התאמות` : "",
          stats.out + stats.low > 0 ? `${fmtQty(stats.out + stats.low)} מלאי` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "אין חריגות פתוחות";

  /* ───────── attention ───────── */
  const urgentCount = useMemo(() => attention.filter((a) => a.severity === "danger").length, [attention]);
  const taskCount = attention.length - urgentCount;
  const onResolve = useCallback(
    async (entry: AttentionEntry) => {
      if (!entry.faultId || busyFault) return;
      setBusyFault(entry.faultId);
      try {
        await resolveFault(entry.faultId);
        notify({ tone: "success", title: "התקלה סומנה כטופלה", text: entry.title });
      } catch (e) {
        notify({ tone: "danger", title: "סימון התקלה נכשל", text: e instanceof Error ? e.message : undefined });
      } finally {
        setBusyFault(null);
      }
    },
    [resolveFault, notify, busyFault],
  );

  const attentionItems = useMemo<AttentionItem[]>(
    () =>
      attention.filter((a) => a.severity === "danger").slice(0, MAX_ATTENTION).map((a) => {
        const base: AttentionItem = {
          id: a.id,
          severity: a.severity,
          label: a.label,
          title: a.title,
          // SKUs / external codes are Latin → mono LTR; Hebrew meta (e.g. "ללא מיפוי") stays as text.
          meta: a.meta.map((m, i) => (i === 0 && a.kind !== "fault" && /^[\x20-\x7E]+$/.test(m) ? <span key={i} className="sa-mono ltr">{m}</span> : m)),
        };
        switch (a.kind) {
          case "out":
          case "low":
            return { ...base, action: "קלוט", onAction: () => openAction("receive", { productId: a.productId }) };
          case "fault": {
            const src = faultPhotoUrl(a.photoPath);
            return {
              ...base,
              thumb: src ? { src, alt: "תצלום התקלה" } : undefined,
              action: "טפל",
              onAction: () => void onResolve(a),
              secondary: a.productId ? "פרטים" : undefined,
              onSecondary: a.productId ? () => openProduct(a.productId as string) : undefined,
            };
          }
          case "mapping":
            return {
              ...base,
              action: "מפה",
              onAction: () => openAction("map-supplier-item", { supplierItemId: a.supplierItemId }),
              secondary: a.productId ? "פרטים" : undefined,
              onSecondary: a.productId ? () => openProduct(a.productId as string) : undefined,
            };
        }
      }),
    [attention, openAction, openProduct, onResolve],
  );

  /* ───────── recent movements ───────── */
  const recent = useMemo(() => state.movements.slice(0, RECENT), [state.movements]);

  const columns = useMemo<TableColumn<MovementRow>[]>(
    () => [
      { key: "created_at", title: "שעה", width: "96px", align: "ltr", mono: true, muted: true, render: (m) => fmtWhen(m.created_at) },
      { key: "type", title: "פעולה", width: "128px", render: (m) => <Movement type={m.type} /> },
      {
        key: "product_id",
        title: "מוצר",
        render: (m) => {
          const p = product(m.product_id);
          return (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-ink">{p?.name ?? "מוצר שנמחק"}</span>
              {p ? <span className="sa-mono ltr self-start text-[11px] leading-[14px] text-ink-3">{p.sku}</span> : null}
            </span>
          );
        },
      },
      {
        key: "qty",
        title: "כמות",
        width: "88px",
        align: "num",
        render: (m) => (
          <span className={m.type === "in" ? "sa-qty-in" : m.type === "out" ? "sa-qty-out" : undefined}>{fmtSigned(m.qty, m.type)}</span>
        ),
      },
      {
        key: "worker_id",
        title: "עובד",
        width: "160px",
        render: (m) => {
          const w = worker(m.worker_id);
          return w ? (
            <span className="inline-flex items-center gap-[var(--space-2)]">
              <Avatar name={w.name} size="sm" />
              <span className="truncate">{w.name}</span>
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          );
        },
      },
    ],
    [product, worker],
  );

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <header>
        <h1 className="sa-page-title" style={{ fontSize: 30, lineHeight: "36px", fontWeight: 600 }}>
          סקירה
        </h1>
        {subline ? <p className="sa-page-sub">{subline}</p> : null}
      </header>

      <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
          <div className="sa-stats">
            <Stat
              label="מצב מלאי"
              value={fmtQty(stats.products)}
              unit="מוצרים"
              icon="package"
              note={stockNote}
              tone={stats.out > 0 || stats.low > 0 ? "warning" : undefined}
            />
            <Stat
              label="תנועות היום"
              value={fmtQty(stats.movementsToday)}
              icon="activity"
              delta={delta}
              deltaUnit={delta != null ? "%" : undefined}
              note={stats.movementsYesterday > 0 ? "לעומת אתמול" : stats.movementsToday > 0 ? "אין תנועות אתמול" : undefined}
            />
            <Stat
              label="חריגות פתוחות"
              value={fmtQty(stats.exceptions)}
              icon="alert-circle"
              note={exceptionsNote}
              tone={stats.openFaults > 0 ? "danger" : stats.exceptions > 0 ? "warning" : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-[var(--space-4)] min-[1100px]:grid-cols-12 min-[1100px]:items-start">
          <Card
            className="min-w-0 min-[1100px]:col-span-7"
            title="דחוף"
            count={urgentCount}
            flush
            actions={
              <Button variant={taskCount > 0 ? "secondary" : "ghost"} size="sm" icon="layers" onClick={openTasks}>
                משימות
                {taskCount > 0 ? <Badge count>{fmtQty(taskCount)}</Badge> : null}
              </Button>
            }
            footer={
              urgentCount > MAX_ATTENTION ? (
                <span>
                  מציג <span className="sa-mono ltr">{MAX_ATTENTION}</span> מתוך <span className="sa-mono ltr">{fmtQty(urgentCount)}</span>
                </span>
              ) : undefined
            }
          >
            {urgentCount === 0 ? (
              <p className="sa-muted m-0 flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-4)] text-[13px]">
                <Square tone="success" /> אין חריגות דחופות
                {taskCount > 0 ? <span className="sa-faint">· {fmtQty(taskCount)} משימות ממתינות</span> : null}
              </p>
            ) : (
              <Attention items={attentionItems} />
            )}
          </Card>
          <WeeklyChart days={weekly} className="min-w-0 min-[1100px]:col-span-5" />
          </div>

          <Card title="תנועות אחרונות" flush>
            <Table<MovementRow>
              columns={columns}
              data={recent}
              isLoading={isLoading}
              skeletonRows={6}
              caption="התנועות האחרונות במלאי"
              onRowClick={(m) => openProduct(m.product_id, "history")}
              className="rounded-none border-0 shadow-none"
              empty={
                <EmptyState title="אין תנועות עדיין" hint="קליטה או הוצאה ראשונה תופיע כאן">
                  <Button variant="secondary" icon="arrow-down-left" onClick={() => openAction("receive")}>
                    קליטת סחורה
                  </Button>
                </EmptyState>
              }
              footer={
                recent.length > 0 ? (
                  <>
                    <span>
                      מציג <span className="sa-mono ltr">{fmtQty(recent.length)}</span> מתוך <span className="sa-mono ltr">{fmtQty(state.movements.length)}</span>
                    </span>
                    <Link href="/inventory?tab=movements" className="sa-btn sa-btn-link sa-btn-sm">
                      כל התנועות
                    </Link>
                  </>
                ) : undefined
              }
            />
          </Card>
      </div>
    </div>
  );
}
