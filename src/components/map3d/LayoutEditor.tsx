"use client";

import { useState } from "react";
import { parseNum } from "@/components/app/forms/useForm";
import { useUi } from "@/components/app/ui-state";
import { Button, Input, Modal, Notice, Select } from "@/components/ui";
import { FOOTPRINT, insideFootprint, RACK_LEVELS, validateObjects } from "@/lib/map3d/layout";
import type { MapModel } from "@/lib/map3d/model";
import { placeKey } from "@/lib/map3d/place";
import type { MapObject, MapObjectKind } from "@/lib/map3d/types";
import type { Layout } from "@/lib/map3d/use-layout";
import { RailSection } from "./parts";

type Patch = Partial<Pick<MapObject, "id" | "name" | "x" | "z" | "w" | "d" | "h" | "levels">>;

const PRESETS: Record<MapObjectKind, { label: string; prefix: string; shape: Pick<MapObject, "kind" | "w" | "d" | "h" | "levels" | "model"> }> = {
  rack: { label: "מתקן", prefix: "R-", shape: { kind: "rack", w: 6.4, d: 3.4, h: 5.4, levels: RACK_LEVELS } },
  floor: { label: "אחסון רצפה", prefix: "F-0", shape: { kind: "floor", w: 6, d: 3, h: 1.1 } },
  machine: { label: "מכונה", prefix: "M-0", shape: { kind: "machine", w: 5, d: 3, h: 2.4, model: "generic" } },
  zone: { label: "אזור", prefix: "Z-0", shape: { kind: "zone", w: 8, d: 4, h: 0.2 } },
};

const KINDS = Object.keys(PRESETS) as MapObjectKind[];

const SNAP = 0.5;
const CLEARANCE = 0.5;

function nextCode(objects: readonly MapObject[], prefix: string): string {
  const taken = new Set(objects.map((o) => placeKey(o.id)));
  for (let n = 1; ; n++) {
    const code = `${prefix}${n}`;
    if (!taken.has(placeKey(code))) return code;
  }
}

/** The first patch of bare floor that fits, on the same grid a drag snaps to. */
function freeSpot(objects: readonly MapObject[], w: number, d: number): { x: number; z: number } | null {
  const width = Math.max(...FOOTPRINT.map(([x]) => x));
  const depth = Math.max(...FOOTPRINT.map(([, z]) => z));
  for (let z = SNAP; z < depth; z += SNAP) {
    for (let x = SNAP; x < width; x += SNAP) {
      if (!insideFootprint(x, z, w + 2 * CLEARANCE, d + 2 * CLEARANCE)) continue;
      const clear = objects.every((o) => Math.abs(o.x - x) >= (o.w + w) / 2 + CLEARANCE || Math.abs(o.z - z) >= (o.d + d) / 2 + CLEARANCE);
      if (clear) return { x, z };
    }
  }
  return null;
}

/** A working copy of the layout. Nothing leaves it until save; the code deciding what is valid is the code that reads a saved layout. */
export function useLayoutEditor(layout: Layout) {
  const { notify } = useUi();
  const [draft, setDraft] = useState<MapObject[] | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(layout.objects);

  const stop = () => {
    setDraft(null);
    setEditId(null);
    setAsking(false);
    setError(null);
  };

  /** False when the result would not be a valid layout. */
  const replace = (next: MapObject[]): boolean => {
    const valid = validateObjects(next);
    if (valid) setDraft(valid);
    return valid !== null;
  };

  const patch = (id: string, change: Patch): boolean => {
    if (!draft) return false;
    const accepted = replace(draft.map((o) => (o.id === id ? { ...o, ...change } : o)));
    if (accepted && change.id) setEditId(change.id);
    return accepted;
  };

  const add = (kind: MapObjectKind) => {
    if (!draft) return;
    const { label, prefix, shape } = PRESETS[kind];
    const spot = freeSpot(draft, shape.w, shape.d);
    if (!spot) {
      setError("אין מקום פנוי על הרצפה");
      return;
    }
    const id = nextCode(draft, prefix);
    if (replace([...draft, { ...shape, ...spot, id, name: `${label} ${id}` }])) {
      setEditId(id);
      setError(null);
    }
  };

  const remove = (id: string) => {
    if (!draft) return;
    setDraft(draft.filter((o) => o.id !== id));
    setEditId(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const refused = await layout.save(draft, layout.version);
    setSaving(false);
    if (refused) {
      setError(refused);
      return;
    }
    notify({ tone: "success", title: "הפריסה נשמרה" });
    stop();
  };

  return {
    draft,
    editId,
    dirty,
    asking,
    saving,
    error,
    setEditId,
    patch,
    add,
    remove,
    save,
    stop,
    start: () => setDraft(layout.objects.map((o) => ({ ...o }))),
    leave: () => (dirty ? setAsking(true) : stop()),
    keepEditing: () => setAsking(false),
  };
}

export type LayoutEditorState = ReturnType<typeof useLayoutEditor>;

/** Takes the toolbar's place while editing, at the same height, so nothing below moves. */
export function EditBar({ editor }: { editor: LayoutEditorState }) {
  return (
    <div className="m3d-bar m3d-editbar">
      <h2 className="sa-section-title">עריכת פריסה</h2>
      <div className="m3d-editbar-actions">
        <Button variant="secondary" disabled={editor.saving} onClick={editor.leave}>ביטול</Button>
        <Button variant="primary" isLoading={editor.saving} disabled={!editor.dirty} onClick={() => void editor.save()}>שמירה</Button>
      </div>
      {editor.asking ? (
        <Modal title="לצאת בלי לשמור?" tone="danger" confirmLabel="יציאה" cancelLabel="המשך" onConfirm={editor.stop} onClose={editor.keepEditing} />
      ) : null}
    </div>
  );
}

export function LayoutPanel({ editor, model }: { editor: LayoutEditorState; model: MapModel }) {
  const objects = editor.draft ?? [];
  const object = objects.find((o) => o.id === editor.editId);
  const options = objects.map((o) => ({ value: o.id, label: `${o.id} · ${o.name}` }));

  return (
    <div className="m3d-card">
      {editor.error ? <Notice tone="danger">{editor.error}</Notice> : null}
      <RailSection title="הוספה">
        <div className="m3d-actions">
          {KINDS.map((kind) => (
            <Button key={kind} variant="secondary" size="sm" icon="plus" onClick={() => editor.add(kind)}>{PRESETS[kind].label}</Button>
          ))}
        </div>
      </RailSection>
      <Select label="עריכת אובייקט" options={options} value={editor.editId ?? ""} onChange={editor.setEditId} placeholder="בחירה במפה או ברשימה" block />
      {object ? (
        <ObjectForm key={object.id} object={object} holdsStock={(model.byObject.get(object.id)?.items.length ?? 0) > 0} editor={editor} />
      ) : null}
    </div>
  );
}

function ObjectForm({ object, holdsStock, editor }: { object: MapObject; holdsStock: boolean; editor: LayoutEditorState }) {
  const [code, setCode] = useState(object.id);
  const [codeBad, setCodeBad] = useState(false);
  const [name, setName] = useState(object.name);
  const [asking, setAsking] = useState(false);
  const { id } = object;

  const commitCode = () => {
    if (code.trim() === id) return;
    if (!editor.patch(id, { id: code.trim() })) setCodeBad(true);
  };

  return (
    <div className="m3d-form">
      <Input
        label="קוד"
        mono
        value={code}
        disabled={holdsStock}
        hint={holdsStock ? "יש כאן מוצרים, הקוד נשאר" : undefined}
        error={codeBad ? "הקוד תפוס או לא תקין" : undefined}
        onChange={(e) => { setCode(e.target.value); setCodeBad(false); }}
        onBlur={commitCode}
      />
      <Input label="שם" value={name} onChange={(e) => { setName(e.target.value); editor.patch(id, { name: e.target.value }); }} />
      <div className="m3d-form-sizes">
        <NumberField label="רוחב, מ׳" value={object.w} onCommit={(w) => editor.patch(id, { w })} />
        <NumberField label="עומק, מ׳" value={object.d} onCommit={(d) => editor.patch(id, { d })} />
        <NumberField label="גובה, מ׳" value={object.h} onCommit={(h) => editor.patch(id, { h })} />
        <NumberField label="מרחק x" value={object.x} onCommit={(x) => editor.patch(id, { x })} />
        <NumberField label="מרחק z" value={object.z} onCommit={(z) => editor.patch(id, { z })} />
        {object.kind === "rack" ? (
          <NumberField label="מפלסים" value={object.levels ?? RACK_LEVELS} onCommit={(levels) => editor.patch(id, { levels })} />
        ) : null}
      </div>
      <Button variant="danger" size="sm" icon="trash" disabled={holdsStock} onClick={() => setAsking(true)}>הסרה</Button>
      {holdsStock ? <p className="sa-hint m-0">אי אפשר להסיר מקום שיש בו מוצרים</p> : null}
      {asking ? (
        <Modal title={`להסיר את ${id}?`} tone="danger" confirmLabel="הסרה" cancelLabel="ביטול" onConfirm={() => editor.remove(id)} onClose={() => setAsking(false)} />
      ) : null}
    </div>
  );
}

/** Keeps what is being typed; the map only ever gets a value the layout accepts. */
function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  return (
    <Input
      label={label}
      mono
      inputMode="decimal"
      value={text ?? String(value)}
      error={bad ? "לא מתאים" : undefined}
      onChange={(e) => {
        setText(e.target.value);
        setBad(!onCommit(parseNum(e.target.value)));
      }}
      onBlur={() => {
        setText(null);
        setBad(false);
      }}
    />
  );
}
