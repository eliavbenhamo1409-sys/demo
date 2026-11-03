"use client";

/**
 * One stock movement in a SidePanel, told in order: who did it, from or to whom, where it went, its receipt and its order.
 * The row comes with the call, because a movement older than the store's latest has nowhere else to come from.
 * What the fault and order drawers tell the same way lives here too. Opened via useUi().openMovement(row).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useFloorObjects } from "@/components/map3d/use-floor-objects";
import { Button, Fields, MovementQty, Notice, SidePanel, Timeline, type FieldItem, type TimelineItem } from "@/components/ui";
import { useDocumentUrls } from "@/lib/documents";
import { fmtDateTime, fmtFull, fmtName, fmtPrice, fmtQty, fmtRelative, fmtUnit, MOVEMENT_LABEL, ORDER_STATUS_LABEL, orderRef } from "@/lib/format";
import { placeWords } from "@/lib/map3d/place";
import { useData, type Movement } from "@/lib/store";
import { supabase } from "@/lib/supabase/client";
import { Figure } from "./ProductPanel";
import { useUi } from "./ui-state";

/** What each kind of movement calls its quantity. A count is what was found on the shelf, not a change. */
const QTY_LABEL: Record<Movement["type"], string> = { in: "נכנסו", out: "יצאו", adjust: "נספרו", fault: "כמות" };

/** The history of anything in a drawer: a white group of steps, the oldest first. */
export function History({ items }: { items: TimelineItem[] }) {
  return (
    <section className="sa-group flex flex-col gap-[var(--space-2)]" aria-labelledby="panel-history-title">
      <h3 id="panel-history-title" className="sa-section-title">היסטוריה</h3>
      <Timeline className="sa-story" items={items} />
    </section>
  );
}

/** The photographed receipt under a history step. The photo is private, so it appears once its signed link is ready. */
export function ReceiptPhoto({ path }: { path: string }) {
  const src = useDocumentUrls([path])[path];
  if (!src) return null;
  return (
    <div className="sa-timeline-detail">
      <a className="sa-fault-photo" href={src} target="_blank" rel="noreferrer" aria-label="פתיחת הקבלה">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="צילום הקבלה" loading="lazy" />
      </a>
    </div>
  );
}

/** Movements by id. The store holds only the latest, and an order or a fault can be years old. */
export function useMovementsById(ids: string[]): Movement[] {
  const key = ids.join(",");
  const [rows, setRows] = useState<Movement[]>([]);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void supabase().from("movements").select("*").in("id", key.split(",")).then(({ data }) => {
      if (alive && data) setRows(data);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return rows;
}

type NoteParts = { customer?: string; agent?: string; reason?: string; rest: string };

/** What the database folds into a movement's note: "ללקוח: … · סוכן: … · בלי קבלה: …", and whatever a person added. */
function readNote(note: string | null): NoteParts {
  const parts = (note ?? "").split(" · ");
  const read: NoteParts = { rest: "" };
  const rest: string[] = [];
  for (const [i, part] of parts.entries()) {
    if (part.startsWith("ללקוח: ")) read.customer = part.slice("ללקוח: ".length);
    else if (part.startsWith("סוכן: ")) read.agent = part.slice("סוכן: ".length);
    else if (part.startsWith("בלי קבלה: ")) {
      // The reason is free text and always comes last, so a dot inside it stays in it.
      read.reason = parts.slice(i).join(" · ").slice("בלי קבלה: ".length);
      break;
    } else if (part) rest.push(part);
  }
  read.rest = rest.join(" · ");
  return read;
}

type ExitStory = { by?: string; reason?: string; at?: string };

/** Who approved an exit with no receipt. Only a signed-in admin may read it; anyone else is refused, and the note still has the reason. */
function useExitStory(pass: string | null): ExitStory | null {
  const [story, setStory] = useState<ExitStory | null>(null);
  useEffect(() => {
    if (!pass) return;
    let alive = true;
    void supabase().rpc("exit_pass_story", { pass }).then(({ data }) => {
      if (alive && data) setStory(data as ExitStory);
    });
    return () => {
      alive = false;
    };
  }, [pass]);
  return story;
}

/** Says plainly that stock left with no receipt, why, and who approved it. */
export function ExitNotice({ movement: m }: { movement: Movement }) {
  const story = useExitStory(m.exit_pass);
  const reason = story?.reason ?? readNote(m.note).reason;
  return (
    <Notice tone="warning" title={m.type === "out" ? "הסחורה יצאה בלי קבלה" : "המלאי ירד בלי קבלה"}>
      {reason}
      {story?.by ? <span className="block">אישור: {[story.by, story.at ? fmtDateTime(story.at) : null].filter(Boolean).join(" · ")}</span> : null}
    </Notice>
  );
}

export function MovementPanel() {
  const { panel } = useUi();
  if (panel?.type !== "movement") return null;
  return <MovementPanelInner key={panel.movement.id} movement={panel.movement} />;
}

function MovementPanelInner({ movement: m }: { movement: Movement }) {
  const { state, product, supplier, worker, agent, order } = useData();
  const { close, openFault, openOrder, openProduct } = useUi();
  const floor = useFloorObjects();

  const p = product(m.product_id);
  const note = readNote(m.note);
  const doc = state.documents.find((d) => d.id === m.document_id);
  const fault = state.faults.find((f) => f.movement_id === m.id);
  const line = state.orderLines.find((l) => l.movement_id === m.id);
  const linked = line ? order(line.order_id) : undefined;

  const who = worker(m.worker_id)?.name;
  const vendor = supplier(m.supplier_id ?? doc?.supplier_id)?.name;
  const customer = linked?.customer ?? note.customer ?? doc?.customer;
  const seller = agent(linked?.agent_id)?.name ?? note.agent;

  const status = m.exit_pass
    ? { word: "בלי קבלה", tone: "warn" }
    : fault
      ? fault.status === "open" ? { word: "פתוחה", tone: "bad" } : { word: "טופלה", tone: "ok" }
      : doc ? { word: "עם קבלה", tone: "ok" } : null;

  const worth = p?.price != null && (m.type === "in" || m.type === "out") ? m.qty * p.price : null;
  const facts: FieldItem[] = [
    ...(p ? [{ label: "במלאי עכשיו", value: <><span className="sa-num">{fmtQty(p.qty)}</span> {fmtUnit(p.qty, p.unit)}</> }] : []),
    ...(worth !== null ? [{ label: "שווי במחירון", value: fmtPrice(worth), num: true }] : []),
    ...(m.external_name ? [{ label: "בתעודה", value: <bdi>{m.external_name}</bdi> }] : []),
    // A fault's note repeats its description, which the history links to.
    ...(note.rest && !fault ? [{ label: m.type === "adjust" ? "סיבה" : "הערה", value: note.rest }] : []),
  ];

  const reference = orderRef(m.reference);
  const steps: TimelineItem[] = [
    { id: "by", title: who ? `${MOVEMENT_LABEL[m.type]} ע"י ${who}` : MOVEMENT_LABEL[m.type], when: fmtFull(m.created_at) },
    ...(vendor ? [{ id: "supplier", title: `מהספק ${vendor}` }] : []),
    ...(customer ? [{ id: "customer", title: `ללקוח ${customer}`, by: seller ? `סוכן ${seller}` : undefined }] : []),
    ...(m.place
      ? [{
          id: "place",
          title: <>למיקום <Link className="sa-btn sa-btn-link" href={`/3d?at=${encodeURIComponent(m.place)}`} onClick={close}>{placeWords(m.place, floor)}</Link></>,
        }]
      : []),
    ...(doc
      ? [{
          id: "receipt",
          title: doc.kind === "in" ? "קבלת הכנסה" : "קבלת הוצאה",
          when: fmtFull(doc.created_at),
          by: worker(doc.worker_id)?.name,
          detail: <ReceiptPhoto path={doc.storage_path} />,
        }]
      : []),
    ...(linked
      ? [{
          id: "order",
          title: <button type="button" className="sa-btn sa-btn-link" onClick={() => openOrder(linked.id)}>הזמנה {linked.number}</button>,
          when: ORDER_STATUS_LABEL[linked.status],
        }]
      : reference ? [{ id: "order", title: reference }] : []),
    ...(fault
      ? [{
          id: "fault",
          title: <button type="button" className="sa-btn sa-btn-link" onClick={() => openFault(fault.id)}>{fault.description}</button>,
          when: fault.status === "open" ? "תקלה פתוחה" : "תקלה שטופלה",
        }]
      : []),
  ];

  return (
    <SidePanel
      className="sa-sheet"
      eyebrow={p ? <>{MOVEMENT_LABEL[m.type]} · <span className="sa-mono ltr">{p.sku}</span></> : MOVEMENT_LABEL[m.type]}
      title={p ? fmtName(p.name) : "מוצר שנמחק"}
      subtitle={
        <>
          {status ? <><span className={`sa-state is-${status.tone}`}>{status.word}</span> · </> : null}
          {fmtRelative(m.created_at)}
        </>
      }
      summary={
        <dl className="sa-figures">
          <Figure label={QTY_LABEL[m.type]} value={<MovementQty qty={m.qty} type={m.type} />} unit={fmtUnit(m.qty, p?.unit)} />
        </dl>
      }
      onClose={close}
      footer={
        p ? (
          <div>
            <Button variant="primary" onClick={() => openProduct(p.id)}>פתיחת המוצר</Button>
          </div>
        ) : undefined
      }
    >
      {m.exit_pass ? <ExitNotice movement={m} /> : null}
      {facts.length > 0 ? <Fields items={facts} /> : null}
      <History items={steps} />
    </SidePanel>
  );
}
