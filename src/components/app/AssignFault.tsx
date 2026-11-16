"use client";

/**
 * שיוך לעובד — hands an open fault to a worker with an instruction, from its row on /faults.
 * The database stamps who and when, and the assignment itself wakes the fault-push function,
 * so the worker's phone rings when it allowed notifications; this dialog only says whether it will.
 */
import { useMemo, useState, type ReactElement } from "react";
import { Icon, Input, Modal, Notice, Select } from "@/components/ui";
import { fmtName, fmtQty } from "@/lib/format";
import { DEFAULT_OBJECTS } from "@/lib/map3d/layout";
import { isTempId, useData, type Fault } from "@/lib/store";
import { errorMessage } from "./forms/useForm";
import { useUi } from "./ui-state";
import "./assign-fault.css";

export function AssignFault({ fault, reachable, onClose }: { fault: Fault; reachable: ReadonlySet<string> | null; onClose: () => void }): ReactElement {
  const { state, product, worker, assignFault } = useData();
  const { notify } = useUi();
  const [workerId, setWorkerId] = useState(fault.assigned_to ?? "");
  const [instruction, setInstruction] = useState(fault.instruction ?? "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // How many open faults each worker already holds, and whose phone will ring, seen before choosing.
  const options = useMemo(() => {
    const held = new Map<string, number>();
    for (const f of state.faults) if (f.status === "open" && f.assigned_to) held.set(f.assigned_to, (held.get(f.assigned_to) ?? 0) + 1);
    return state.workers
      .filter((w) => w.active || w.id === fault.assigned_to)
      .map((w) => {
        const n = held.get(w.id) ?? 0;
        // Plain text, so the list's search reads it.
        const parts = [w.name, n > 0 ? `${fmtQty(n)} בטיפול` : null, reachable?.has(w.id) ? "התראות" : null];
        return { value: w.id, label: parts.filter(Boolean).join(" · ") };
      });
  }, [state.faults, state.workers, fault.assigned_to, reachable]);

  const chosen = worker(workerId);
  const told = instruction.trim();
  const same = Boolean(fault.assigned_to) && workerId === fault.assigned_to;
  const unchanged = same && told === (fault.instruction ?? "");
  const p = product(fault.product_id);
  const place = p ? fmtName(p.name) : fault.asset ? DEFAULT_OBJECTS.find((o) => o.id === fault.asset)?.name ?? fault.asset : null;
  const rings = chosen && reachable ? reachable.has(chosen.id) : null;

  const confirm = async () => {
    if (busy) return;
    setTried(true);
    if (!chosen || !told) return;
    if (unchanged) {
      onClose();
      return;
    }
    // A fault still saving has no id for the database to find.
    if (isTempId(fault.id)) {
      setError("התקלה עדיין נשמרת, אפשר לנסות שוב בעוד רגע");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await assignFault(fault.id, chosen.id, told);
      notify({ tone: "success", title: same ? `ההוראה ל${chosen.name} עודכנה` : `הועברה ל${chosen.name}`, text: told });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={fault.assigned_to ? "שיוך מחדש" : "שיוך לעובד"}
      confirmLabel={!chosen ? "שיוך" : unchanged ? "סגירה" : same ? "עדכון ההוראה" : `שליחה ל${chosen.name}`}
      onConfirm={() => void confirm()}
      onClose={onClose}
      busy={busy}
      className="sa-assign"
    >
      <div className="sa-assign-fault">
        <p className="sa-assign-title">{fault.description}</p>
        {place ? <p className="sa-assign-place">{place}</p> : null}
      </div>
      <div className="sa-field">
        <span className="sa-label">עובד</span>
        <Select options={options} value={workerId} onChange={setWorkerId} shown={chosen?.name} placeholder="בחירת עובד" searchPlaceholder="חיפוש לפי שם" block />
        {tried && !chosen ? (
          <span className="sa-error" role="alert">חסר עובד</span>
        ) : rings !== null ? (
          <span className={rings ? "sa-assign-ring is-on" : "sa-assign-ring"}>
            <Icon name="bell" size={14} />
            {rings ? "תישלח התראה לטלפון" : "בלי התראות בטלפון · המשימה תחכה במסך הראשי"}
          </span>
        ) : null}
      </div>
      <Input
        label="הוראה לעובד"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void confirm();
          }
        }}
        placeholder="מה לעשות"
        hint="תופיע בטלפון של העובד"
        error={tried && !told ? "חסרה הוראה" : undefined}
        disabled={busy}
      />
      {error ? <Notice tone="danger" title="לא נשמר">{error}</Notice> : null}
    </Modal>
  );
}
