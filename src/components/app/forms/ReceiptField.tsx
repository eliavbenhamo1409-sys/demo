"use client";

/**
 * What stands behind goods leaving: a photographed receipt, archived like the worker's. A super admin
 * can give a reason instead and confirm it with a code to the phone; nobody else sees that way out.
 */
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { useSuperAdminPhone } from "@/lib/exit-pass";
import type { DocumentInput } from "@/lib/store";
import { useReceiptUpload } from "@/lib/worker-store";
import { PhotoField } from "./PhotoField";

export function useExitProof() {
  const phone = useSuperAdminPhone();
  const upload = useReceiptUpload("out");
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [without, setWithout] = useState(false);
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string>();
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  return {
    /** Set only for a super admin, who alone sees the way out without a receipt. */
    phone, photo, without, why, error,
    pick: (file: File) => {
      setPhoto({ file, url: URL.createObjectURL(file) });
      setError(undefined);
    },
    remove: () => setPhoto(null),
    choose: (next: boolean) => {
      setWithout(next);
      setError(undefined);
    },
    explain: (text: string) => {
      setWhy(text);
      setError(undefined);
    },
    /** Marks what's missing, and says whether the form may go on. */
    check: () => {
      const missing = without ? (why.trim() ? undefined : "חסרה סיבה") : photo ? undefined : "חסר צילום קבלה";
      setError(missing);
      return !missing;
    },
    /** Archives the receipt and gives its id. Nothing may leave without it, so a failed upload throws. */
    save: async (details: Omit<DocumentInput, "kind" | "storagePath">) => {
      const id = photo ? await upload.save(photo.file, details) : null;
      if (!id) throw new Error("הקבלה לא עלתה. אפשר לנסות שוב.");
      return id;
    },
  };
}

export type ExitProof = ReturnType<typeof useExitProof>;

export function ReceiptField({ proof, disabled = false }: { proof: ExitProof; disabled?: boolean }) {
  if (proof.without && proof.phone) {
    return (
      <div className="flex flex-col gap-[var(--space-2)]">
        <Input
          label="סיבה"
          required
          autoFocus
          hint={`קוד יישלח לנייד שמסתיים ב-${proof.phone.slice(-4)}`}
          value={proof.why}
          readOnly={disabled}
          error={proof.error}
          onChange={(e) => proof.explain(e.target.value)}
        />
        <Button variant="link" className="self-start" disabled={disabled} onClick={() => proof.choose(false)}>צילום קבלה</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <PhotoField
        label="קבלה"
        addLabel="צילום קבלה"
        error={proof.error}
        src={proof.photo?.url ?? null}
        fileName={proof.photo?.file.name}
        disabled={disabled}
        onPick={proof.pick}
        onRemove={proof.remove}
      />
      {proof.phone ? <Button variant="link" className="self-start" disabled={disabled} onClick={() => proof.choose(true)}>בלי קבלה</Button> : null}
    </div>
  );
}
