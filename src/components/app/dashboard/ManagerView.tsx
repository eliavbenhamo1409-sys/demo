"use client";

/** The first view: what the manager wants to know when the day starts. How the month went, what was promised, what the shelf is worth, what waits on a person. */
import { useMemo, type ReactElement } from "react";
import { useData } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { EmptyState } from "@/components/ui";
import { fmtAge, fmtName, fmtPrice, fmtQty } from "@/lib/format";
import { change, customerShares, openAges, topAndRest, type Share } from "@/lib/control-room";
import { Area, ChartCard, Columns, Ring, type Hue, type Slice } from "./Charts";
import { Money, Tile } from "./Tile";
import type { Room } from "./useControlRoom";

const SLOTS: Hue[] = [1, 2, 3, 4, 5];

/** The five biggest in the palette's order and the rest in grey. */
export const toSlices = (shares: Share[]): Slice[] =>
  shares.map((s, i) => ({ key: s.key, label: s.label, value: s.value, hue: s.key === "__rest" ? "other" : SLOTS[i] ?? "other" }));

const AGE_HUES: Hue[] = [2, 5, 3, 4];

const money = (n: number) => fmtPrice(Math.round(n));

type Task = { key: string; title: string; meta: string; when?: string; loud?: boolean; open: () => void };

/** What waits on a person right now, the most pressing first. It opens where the work is. */
function Tasks({ room }: { room: Room }): ReactElement {
  const { attention, linesOf, product } = useData();
  const { openOrder, openProduct } = useUi();

  const tasks = useMemo<Task[]>(() => {
    const list: Task[] = [];
    for (const a of attention) {
      if (a.kind === "fault" && a.productId) {
        list.push({ key: a.id, title: a.title, meta: "תקלה פתוחה", when: fmtAge(a.at, room.now), loud: true, open: () => openProduct(a.productId as string) });
      }
    }
    // The orders that have waited longest; state.orders is newest first.
    for (const o of [...room.open].reverse().slice(0, 3)) {
      const first = product(linesOf(o.id)[0]?.product_id);
      list.push({ key: o.id, title: `הזמנה ${o.number} · ${o.customer}`, meta: first ? fmtName(first.name) : "", when: fmtAge(o.created_at, room.now), open: () => openOrder(o.id) });
    }
    for (const a of attention) {
      if ((a.kind === "out" || a.kind === "low" || a.kind === "short") && a.productId) {
        list.push({ key: a.id, title: fmtName(a.title), meta: a.kind === "out" ? "אזל מהמלאי" : a.kind === "short" ? "חסר להזמנות" : "מתחת למינימום", open: () => openProduct(a.productId as string) });
      }
    }
    return list.slice(0, 7);
  }, [attention, room.open, room.now, linesOf, product, openOrder, openProduct]);

  return (
    <ChartCard title="משימות" subtitle="מה מחכה לטיפול" flush className="dash-tasks">
      {tasks.length === 0 ? (
        <EmptyState title="אין משימות" hint="הכל מטופל" />
      ) : (
        <ul className="dash-task-list">
          {tasks.map((t) => (
            <li key={t.key}>
              <button type="button" className="dash-task" onClick={t.open}>
                <i aria-hidden="true" />
                <span className="dash-task-text">
                  <span className="dash-task-title">{t.title}</span>
                  {t.meta ? <span className="dash-task-meta">{t.meta}</span> : null}
                </span>
                {t.when ? <span className={t.loud ? "dash-task-when is-loud" : "dash-task-when"}>{t.when}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function ManagerView({ room }: { room: Room }): ReactElement {
  const { state, stats, linesOf } = useData();
  const customers = useMemo(() => topAndRest(customerShares(state.orders, { linesOf }, room.from, room.to), 5), [state.orders, linesOf, room.from, room.to]);
  const ages = useMemo(() => openAges(state.orders, { linesOf }, room.now), [state.orders, linesOf, room.now]);
  const soldInPeriod = customers.reduce((sum, c) => sum + c.value, 0);

  return (
    <>
      <div className="dash-kpis">
        <Tile label="מכירות" icon="arrow-up-right" hue={1} value={<Money value={room.sales[11]} />} delta={change(room.sales)} upIsGood note="30 יום · במחירון" spark={room.sales} href="/movements?period=month" />
        <Tile label="הזמנות חדשות" icon="inbox" hue={5} value={<>{fmtQty(room.placed[11])}</>} delta={change(room.placed)} upIsGood note="30 יום" spark={room.placed} href="/orders" />
        <Tile label="קליטות" icon="truck" hue={2} value={<Money value={room.receipts[11]} />} delta={change(room.receipts)} note="30 יום · במחירון" spark={room.receipts} href="/movements?period=month" />
        <Tile label="שווי מלאי" icon="package" hue={3} value={<Money value={room.shelf.total} />} delta={change(room.shelfWindows)} note="במחירון" spark={room.shelfWindows} href="/inventory" />
        <Tile label="הזמנות פתוחות" icon="clipboard-check" hue={5} value={<>{fmtQty(room.open.length)}</>} note={<span className="ltr">{fmtPrice(Math.round(room.openWorth))}</span>} spark={room.openWindows} href="/orders" />
        <Tile label="תקלות פתוחות" icon="tool" hue={4} value={<>{fmtQty(stats.openFaults)}</>} note={`${fmtQty(room.faulted[11])} חדשות · 30 יום`} spark={room.faulted} href="/faults" />
      </div>

      <div className="dash-grid">
        <ChartCard title="מכירות מול קליטות" subtitle="לפי חודש · במחירון" className="is-wide" table={{ head: ["חודש", "מכירות", "קליטות"], rows: room.monthly.map((m) => [m.month.label, money(m.out), money(m.in)]) }}>
          <ul className="dash-keys">
            <li><i style={{ background: "var(--viz-1)" }} />מכירות</li>
            <li><i style={{ background: "var(--viz-2)" }} />קליטות</li>
          </ul>
          <Columns
            labels={room.labels}
            titles={room.titles}
            partial={room.partial}
            label="מכירות וקליטות לפי חודש"
            height={272}
            series={[
              { key: "out", label: "מכירות", hue: 1, values: room.monthly.map((m) => m.out) },
              { key: "in", label: "קליטות", hue: 2, values: room.monthly.map((m) => m.in) },
            ]}
          />
        </ChartCard>

        <Tasks room={room} />

        <ChartCard title="לקוחות מובילים" subtitle="לפי הזמנות שנמסרו" table={{ head: ["לקוח", "מכירות"], rows: customers.map((c) => [c.label, money(c.value)]) }}>
          {customers.length === 0 ? (
            <EmptyState title="אין הזמנות שנמסרו" />
          ) : (
            <Ring slices={toSlices(customers)} center={<Money value={soldInPeriod} />} centerLabel="סה״כ" label="חלק כל לקוח במכירות" />
          )}
        </ChartCard>

        <ChartCard title="שווי מלאי" subtitle="בסוף כל חודש · במחירון" table={{ head: ["חודש", "שווי"], rows: room.labels.map((label, i) => [label, money(room.shelfMonths[i])]) }}>
          <Area labels={room.labels} titles={room.titles} values={room.shelfMonths} name="שווי מלאי" hue={3} label="שווי המלאי בסוף כל חודש" height={208} />
        </ChartCard>

        <ChartCard title="הזמנות פתוחות לפי גיל" subtitle="כמה זמן הן ממתינות" table={{ head: ["ממתינה", "הזמנות", "שווי"], rows: ages.map((a) => [a.label, fmtQty(a.orders), money(a.worth)]) }}>
          {room.open.length === 0 ? (
            <EmptyState title="אין הזמנות פתוחות" />
          ) : (
            <Ring
              slices={ages.map((a, i) => ({ key: a.key, label: a.label, value: a.orders, hue: AGE_HUES[i] }))}
              center={<>{fmtQty(room.open.length)}</>}
              centerLabel="פתוחות"
              format={fmtQty}
              label="הזמנות פתוחות לפי גיל"
            />
          )}
        </ChartCard>
      </div>
    </>
  );
}

