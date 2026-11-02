"use client";

/** The floor: how the warehouse works and what went wrong. When it is busy, who carries it, which faults repeat, which still wait. */
import { useMemo, type ReactElement } from "react";
import Link from "next/link";
import { normalizeName, useData, type Fault, type Movement, type Worker } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { EmptyState } from "@/components/ui";
import { daysAgo, fmtAge, fmtName, fmtQty, fmtRelative } from "@/lib/format";
import { change, faultDays, floorHeat, HEAT_DAYS, HEAT_HOURS, rolling, type Share } from "@/lib/control-room";
import { Bars, ChartCard, Columns, Heat } from "./Charts";
import { Tile } from "./Tile";
import type { Room } from "./useControlRoom";

/** Sunday first, as getDay() counts and as the heat map's rows run. */
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const HOURS = HEAT_HOURS.map(String);

const TOP_FAULTS = 6;

/** As many rows as the two cards beside this one stand tall. */
const OPEN_ROWS = 5;

/** A fault this many days old is the one figure here that really is bad. */
const LATE_DAYS = 7;

const movedAt = (m: Movement) => Date.parse(m.created_at);
const reportedAt = (f: Fault) => Date.parse(f.created_at);

/** A count has no halves: the axis keeps its gridlines and names only the whole steps. */
const wholeTick = (v: number) => (Number.isInteger(v) ? fmtQty(v) : "");

/** The weekday with the most movements and its share of them all. Saturday counts here, though the heat map has no row for it. */
function busiestDay(rows: Movement[]): { name: string; share: number } | null {
  const days = DAY_NAMES.map(() => 0);
  for (const m of rows) days[new Date(m.created_at).getDay()] += 1;
  const top = Math.max(...days);
  return top > 0 ? { name: DAY_NAMES[days.indexOf(top)], share: Math.round((top / rows.length) * 100) } : null;
}

type Load = { key: string; name: string; moves: number; received: number; issued: number };

/** Movements per worker, the busiest first. One with no known worker goes under ללא עובד. */
function workerLoads(rows: Movement[], worker: (id: string | null) => Worker | undefined): Load[] {
  const loads = new Map<string, Load>();
  for (const m of rows) {
    const who = worker(m.worker_id);
    const key = who?.id ?? "none";
    const load = loads.get(key) ?? { key, name: who?.name ?? "ללא עובד", moves: 0, received: 0, issued: 0 };
    load.moves += 1;
    if (m.type === "in") load.received += 1;
    else if (m.type === "out") load.issued += 1;
    loads.set(key, load);
  }
  return [...loads.values()].sort((a, b) => b.moves - a.moves);
}

/** The reports of a period by what they say, the most repeated first. Workers type these, so spacing never splits one fault in two. */
function commonFaults(faults: Fault[], from: number, to: number): Share[] {
  const counts = new Map<string, Share>();
  for (const f of faults) {
    const t = reportedAt(f);
    if (t < from || t >= to) continue;
    const key = normalizeName(f.description);
    const row = counts.get(key);
    if (row) row.value += 1;
    else counts.set(key, { key, label: f.description.trim(), value: 1 });
  }
  return [...counts.values()].sort((a, b) => b.value - a.value).slice(0, TOP_FAULTS);
}

/** The faults still open, the longest waiting first. One on a product opens it; any other leads to the faults page. */
function OpenFaults({ faults, now }: { faults: Fault[]; now: number }): ReactElement {
  const { product } = useData();
  const { openProduct } = useUi();
  const shown = faults.length > OPEN_ROWS ? faults.slice(0, OPEN_ROWS - 1) : faults;

  return (
    <ChartCard title="תקלות פתוחות" subtitle="הוותיקות קודם" flush>
      {faults.length === 0 ? (
        <EmptyState title="אין תקלות פתוחות" />
      ) : (
        <ul className="dash-task-list">
          {shown.map((f) => {
            const item = product(f.product_id);
            const body = (
              <>
                <i aria-hidden="true" />
                <span className="dash-task-text">
                  <span className="dash-task-title">{f.description}</span>
                  {item ? <span className="dash-task-meta">{fmtName(item.name)}</span> : null}
                </span>
                <span className={daysAgo(f.created_at, now) >= LATE_DAYS ? "dash-task-when is-loud" : "dash-task-when"}>{fmtAge(f.created_at, now)}</span>
              </>
            );
            return <li key={f.id}>{item ? <button type="button" className="dash-task" onClick={() => openProduct(item.id)}>{body}</button> : <Link href="/faults" className="dash-task">{body}</Link>}</li>;
          })}
          {shown.length < faults.length ? (
            <li>
              <Link href="/faults" className="dash-task">
                <i aria-hidden="true" />
                <span className="dash-task-text"><span className="dash-task-title">עוד {fmtQty(faults.length - shown.length)} תקלות</span></span>
              </Link>
            </li>
          ) : null}
        </ul>
      )}
    </ChartCard>
  );
}

export function FloorView({ room }: { room: Room }): ReactElement {
  const { state, stats, worker } = useData();

  const moved = useMemo(() => room.rows.filter((m) => movedAt(m) >= room.from && movedAt(m) < room.to), [room.rows, room.from, room.to]);
  const weeks = useMemo(() => rolling(room.rows, movedAt, () => 1, room.now, 12, 7), [room.rows, room.now]);
  const heat = useMemo(() => floorHeat(room.rows, room.from, room.to), [room.rows, room.from, room.to]);
  const busiest = useMemo(() => busiestDay(moved), [moved]);
  const loads = useMemo(() => workerLoads(moved, worker), [moved, worker]);

  // state.faults is newest first.
  const open = useMemo(() => state.faults.filter((f) => f.status === "open").reverse(), [state.faults]);
  const common = useMemo(() => commonFaults(state.faults, room.from, room.to), [state.faults, room.from, room.to]);
  // room.monthly counts fault movements, and a report with no quantity makes none, so the months come from the reports themselves.
  const faultMonths = useMemo(() => room.months.map((m) => state.faults.filter((f) => reportedAt(f) >= m.from && reportedAt(f) < m.to).length), [state.faults, room.months]);
  const handling = useMemo(() => {
    const days = faultDays(state.faults, room.from, room.to);
    const before = faultDays(state.faults, room.from - (room.to - room.from), room.from);
    return { days, delta: days !== null && before !== null ? change([before, days]) : null };
  }, [state.faults, room.from, room.to]);

  const latest = room.rows[0];

  return (
    <>
      <div className="dash-kpis">
        <Tile label="תנועות היום" icon="activity" hue={1} value={fmtQty(stats.movementsToday)} note={latest ? `האחרונה ${fmtRelative(latest.created_at, room.now)}` : "אין תנועות"} href="/movements?period=today" />
        <Tile label="תנועות בשבוע" icon="layers" hue={1} value={fmtQty(weeks[11])} delta={change(weeks)} note="7 ימים" spark={weeks} href="/movements?period=week" />
        <Tile label="תקלות פתוחות" icon="tool" hue={4} value={fmtQty(stats.openFaults)} note={open.length > 0 ? `הוותיקה ${fmtAge(open[0].created_at, room.now)}` : undefined} href="/faults" />
        <Tile label="תקלות חדשות" icon="inbox" hue={4} value={fmtQty(room.faulted[11])} delta={change(room.faulted)} upIsGood={false} note="30 יום" spark={room.faulted} href="/faults" />
        <Tile
          label="זמן טיפול בתקלה"
          icon="clock"
          hue={3}
          value={handling.days === null ? "—" : handling.days.toFixed(1)}
          unit={handling.days === null ? undefined : "ימים"}
          delta={handling.delta}
          upIsGood={false}
          note={handling.days === null ? "אין תקלות שטופלו" : "ממוצע בתקופה"}
          href="/faults?tab=resolved"
        />
        <Tile label="יום עמוס" icon="calendar" hue={2} value={busiest?.name ?? "—"} note={busiest ? `${busiest.share}% מהתנועות` : "אין תנועות"} />
      </div>

      <div className="dash-grid">
        <ChartCard title="מתי המחסן עובד" subtitle="תנועות לפי יום ושעה" className="is-wide" table={{ head: ["יום", ...HOURS], rows: heat.map((hours, i) => [DAY_NAMES[i], ...hours.map(fmtQty)]) }}>
          {moved.length === 0 ? <EmptyState title="אין תנועות" /> : <Heat rows={HEAT_DAYS} columns={HOURS} values={heat} unit="תנועות" label="תנועות לפי יום בשבוע ושעה" />}
        </ChartCard>

        <ChartCard title="עובדים" subtitle="תנועות בתקופה" table={{ head: ["עובד", "תנועות", "קליטה", "הוצאה"], rows: loads.map((l) => [l.name, fmtQty(l.moves), fmtQty(l.received), fmtQty(l.issued)]) }}>
          {loads.length === 0 ? (
            <EmptyState title="אין תנועות" />
          ) : (
            <Bars rows={loads.map((l) => ({ key: l.key, label: l.name, value: l.moves, sub: `קליטה ${fmtQty(l.received)} · הוצאה ${fmtQty(l.issued)}` }))} hue={1} format={fmtQty} label="תנועות לפי עובד" />
          )}
        </ChartCard>

        <ChartCard title="תקלות לפי חודש" subtitle="דיווחים בתקופה" table={{ head: ["חודש", "תקלות"], rows: room.labels.map((label, i) => [label, fmtQty(faultMonths[i])]) }}>
          {faultMonths.every((n) => n === 0) ? (
            <EmptyState title="אין תקלות" />
          ) : (
            <Columns labels={room.labels} titles={room.titles} partial={room.partial} label="תקלות לפי חודש" format={fmtQty} axis={wholeTick} series={[{ key: "faults", label: "תקלות", hue: 4, values: faultMonths }]} />
          )}
        </ChartCard>

        <ChartCard title="תקלות נפוצות" subtitle="לפי מספר דיווחים" table={{ head: ["תקלה", "דיווחים"], rows: common.map((c) => [c.label, fmtQty(c.value)]) }}>
          {common.length === 0 ? <EmptyState title="אין תקלות" /> : <Bars rows={common} hue={4} format={fmtQty} label="התקלות שחוזרות הכי הרבה" />}
        </ChartCard>

        <OpenFaults faults={open} now={room.now} />
      </div>
    </>
  );
}
