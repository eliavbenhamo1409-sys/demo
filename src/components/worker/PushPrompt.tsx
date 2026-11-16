"use client";

/**
 * The first time a worker opens the app with notifications off: one card in the middle of the screen offers them.
 * On an iPhone in Safari it says how to add the app to the home screen, which iOS needs first; when the phone
 * blocks them it says where they come back. What happens after is decided in src/lib/push.ts (usePushPrompt).
 */
import { useEffect, useRef, type ReactElement } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { PushStatus } from "@/lib/push";
import { useBackToClose } from "./index";

export function PushPrompt({ status, busy, error, onEnable, onClose }: {
  status: PushStatus;
  busy: boolean;
  error: string | null;
  onEnable: () => void;
  onClose: () => void;
}): ReactElement {
  const first = useRef<HTMLButtonElement>(null);
  // The phone's back closes the card rather than leaving the app.
  useBackToClose(onClose);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);

  const ask = status === "off";
  const title = ask ? "התראות על משימות" : status === "install" ? "התראות באייפון" : "ההתראות חסומות";
  const text = ask
    ? "משימה מהמנהל תגיע ישר לטלפון"
    : status === "install"
      ? "שיתוף ← הוספה למסך הבית, ופותחים את „מחסן” משם"
      : "אפשר להפעיל אותן בהגדרות הטלפון";

  return (
    <div
      className="sa-scrim wk-prompt-scrim"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      <div className="wk-prompt" role="dialog" aria-modal="true" aria-labelledby="wk-prompt-title" aria-describedby="wk-prompt-text">
        <Icon name="bell" className="wk-prompt-icon" />
        <h2 id="wk-prompt-title" className="wk-prompt-title">{title}</h2>
        <p id="wk-prompt-text" className="wk-prompt-text">{text}</p>
        {error ? <p className="wk-prompt-error" role="alert">{error}</p> : null}
        <div className="wk-prompt-actions">
          {ask ? (
            <>
              <Button ref={first} variant="primary" size="touch" isLoading={busy} onClick={onEnable}>הפעלת התראות</Button>
              <button type="button" className="wk-prompt-later" disabled={busy} onClick={onClose}>לא עכשיו</button>
            </>
          ) : (
            <Button ref={first} variant="primary" size="touch" onClick={onClose}>הבנתי</Button>
          )}
        </div>
      </div>
    </div>
  );
}
