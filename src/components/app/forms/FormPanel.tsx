"use client";

/**
 * The SidePanel shell shared by every action form: a <form> body with an
 * optional danger Notice on top, and a footer with [start] … [secondary, submit].
 * The submit button lives in the footer and targets the form via `form={id}`.
 */
import { useId, type FormEvent, type ReactNode } from "react";
import { Button, Notice, SidePanel } from "@/components/ui";
import { useUi } from "../ui-state";
import { submitOnModEnter, useAutofocus } from "./useForm";

export interface FormPanelProps {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
  busy?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  /** Rendered at the start (right, in RTL) of the footer — e.g. a delete button. */
  footerStart?: ReactNode;
  /** Rendered beside the submit button. */
  secondary?: ReactNode;
  children?: ReactNode;
}

export function FormPanel({
  title, subtitle, onClose, onSubmit, submitLabel, submitDisabled, busy, error, onDismissError,
  footerStart, secondary, children,
}: FormPanelProps) {
  const { close, requestClose } = useUi();
  const formId = `sa-form-${useId()}`;
  const rootRef = useAutofocus<HTMLFormElement>();

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    onSubmit();
  };

  return (
    <SidePanel
      title={title}
      subtitle={subtitle}
      // In the shell's drawer the X and Escape go through its guard; a save keeps calling close.
      onClose={onClose === close ? requestClose : onClose}
      footer={
        <>
          <div>{footerStart}</div>
          <div>
            {secondary}
            <Button type="submit" form={formId} variant="primary" isLoading={busy} disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </div>
        </>
      }
    >
      <form
        id={formId}
        ref={rootRef}
        noValidate
        onSubmit={handleSubmit}
        onKeyDown={submitOnModEnter}
        className="sa-form flex flex-col gap-[var(--space-5)]"
        aria-busy={busy || undefined}
      >
        {error ? (
          <Notice tone="danger" title="השמירה נכשלה" onDismiss={onDismissError}>
            {error}
          </Notice>
        ) : null}
        {children}
      </form>
    </SidePanel>
  );
}
