"use client";

/**
 * The SMS code that stands in for a receipt. It runs on a throwaway client, so the fresh session
 * proves this one action and the app's own session stays as it was.
 */
import { useEffect, useEffectEvent, useRef, useState, type ReactElement } from "react";
import { isAuthError } from "@supabase/supabase-js";
import { Button, Input, Modal, Notice } from "@/components/ui";
import { isWrongCode, loginErrorMessage, sendCode, verifyCode, type LoginClient } from "@/lib/login/auth";
import { throwawayClient } from "@/lib/supabase/client";
import { CODE_LENGTH, CodeSlots } from "../LoginScreen";
import { errorMessage } from "./useForm";

const RESEND_SECONDS = 60;

export function CodeDialog({ phone, title, action, onDone, onClose }: {
  /** International with no plus, as the database gives it. */
  phone: string;
  title: string;
  /** The one thing this code clears, on the client holding its session. */
  action: (client: LoginClient) => Promise<void>;
  onDone: () => void;
  onClose: () => void;
}): ReactElement {
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [wait, setWait] = useState(0);
  const clientRef = useRef<LoginClient | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const verifiedRef = useRef(false);
  const busyRef = useRef(false);
  const startedRef = useRef(false);

  const client = () => (clientRef.current ??= throwawayClient());

  /** One call at a time; whatever it throws becomes the notice. */
  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice(isAuthError(error) ? loginErrorMessage(error) : errorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const send = () => run(async () => {
    await sendCode(client(), `+${phone}`, false);
    verifiedRef.current = false; // the new code is the one to check
    setCode("");
    setResendAt(Date.now() + RESEND_SECONDS * 1000);
    setWait(RESEND_SECONDS);
    codeRef.current?.focus();
  });

  const sendFirst = useEffectEvent(() => void send());

  useEffect(() => {
    codeRef.current?.focus();
    // Once per dialog: a repeat run in development would cost a second SMS.
    if (startedRef.current) return;
    startedRef.current = true;
    sendFirst();
  }, []);

  // Counts from the clock: timers stall while the person reads the SMS in another app.
  useEffect(() => {
    if (!resendAt) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      setWait(left);
      if (left === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  useEffect(() => () => {
    void clientRef.current?.auth.dispose();
    clientRef.current = null;
  }, []);

  const enterCode = (token: string) => run(async () => {
    const proved = client();
    // A code works once, so a retry after a failed action must not check it again.
    if (!verifiedRef.current) {
      try {
        await verifyCode(proved, `+${phone}`, token);
      } catch (error) {
        if (isWrongCode(error)) {
          setCode("");
          codeRef.current?.focus();
        }
        throw error;
      }
      verifiedRef.current = true;
    }
    await action(proved);
    await proved.auth.signOut({ scope: "local" });
    onDone();
  });

  const typeCode = (typed: string) => {
    const digits = typed.replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (digits === code) return;
    setNotice(null);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void enterCode(digits);
  };

  const confirm = () => {
    if (verifiedRef.current || code.length === CODE_LENGTH) {
      void enterCode(code);
      return;
    }
    setNotice("חסר קוד");
    codeRef.current?.focus();
  };

  return (
    <Modal title={title} confirmLabel="אישור" busy={busy} onConfirm={confirm} onClose={onClose}>
      <div className="flex flex-col gap-[var(--space-3)]">
        <p className="m-0">קוד נשלח לנייד שמסתיים ב-<span className="sa-num">{phone.slice(-4)}</span></p>
        <Input
          ref={codeRef}
          className="app-login-code"
          name="code"
          aria-label="קוד אימות"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          readOnly={busy}
          end={<CodeSlots code={code} />}
          onChange={(e) => typeCode(e.target.value)}
        />
        {notice ? <Notice tone="danger">{notice}</Notice> : null}
        <Button variant="link" className="self-start" disabled={busy || wait > 0} onClick={() => void send()}>
          {wait > 0 ? `קוד חדש בעוד ${wait}` : "שליחת קוד חדש"}
        </Button>
      </div>
    </Modal>
  );
}
