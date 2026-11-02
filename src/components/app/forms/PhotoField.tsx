"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";

/** A thumbnail with its two actions, or a quiet button. The file input's change marks the drawer dirty on its own. */
export function PhotoField({ label, optional, addLabel, error, src, fileName, disabled, onPick, onRemove }: {
  label: string;
  optional?: boolean;
  addLabel: string;
  error?: string;
  src: string | null;
  /** A file not saved yet; a browser that can't draw it (HEIC on desktop) still shows which one it is. */
  fileName?: string;
  disabled: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const openPicker = () => fileInput.current?.click();
  // By src, so the next photo gets its own chance. Left to itself the browser draws a broken-image glyph.
  const [undrawable, setUndrawable] = useState<string | null>(null);
  const drawable = src !== undrawable;
  return (
    <div className="sa-field" role="group" aria-label={label}>
      <span className="sa-label">
        <span>{label}</span>
        {optional ? <span className="sa-label-opt">לא חובה</span> : null}
      </span>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // or the same file picked again after הסרה fires nothing
          if (file) onPick(file);
        }}
      />
      {src ? (
        <div className="flex items-center gap-[var(--space-3)]">
          <span className={drawable ? "sa-doc-thumb w-[96px] shrink-0" : "sa-doc-thumb is-empty w-[96px] shrink-0"}>
            {drawable ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" onError={() => setUndrawable(src)} />
            ) : (
              <span className="sa-doc-nophoto">אין תצוגה</span>
            )}
          </span>
          <div className="min-w-0">
            {fileName ? <span className="sa-hint sa-truncate block px-[var(--space-3)]">{fileName}</span> : null}
            <div className="flex gap-[var(--space-1)]">
              <Button variant="ghost" size="sm" disabled={disabled} onClick={openPicker}>החלפה</Button>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>הסרה</Button>
            </div>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" icon="plus" className="self-start" disabled={disabled} onClick={openPicker}>{addLabel}</Button>
      )}
      {error ? <span className="sa-error" role="alert">{error}</span> : null}
    </div>
  );
}
