"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: IconName;
  end?: ReactNode;
  size?: "md" | "lg" | "touch";
  mono?: boolean;
  multiline?: boolean;
  required?: boolean;
  optional?: boolean;
  className?: string;
}

/** Labelled text field; `mono` for SKUs and quantities, `size="touch"` in the worker app. */
export const Input = forwardRef<HTMLInputElement | HTMLTextAreaElement, InputProps>(function Input(
  { label, hint, error, icon, end, size = "md", mono, multiline, required, optional, className, id: idProp, type = "text", ...rest },
  ref,
): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sa-in-${autoId}`;
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errId : hint ? hintId : undefined;
  const cls = cx(
    "sa-input",
    size === "lg" && "sa-input-lg",
    size === "touch" && "sa-input-touch",
    mono && "sa-input-mono",
    error && "is-error",
    multiline && "sa-textarea",
  );
  const shared = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    required,
    className: cls,
    dir: mono ? "ltr" as const : undefined,
  };
  const control = multiline ? (
    <textarea
      {...(rest as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>)}
      {...shared}
      ref={ref as Ref<HTMLTextAreaElement>}
    />
  ) : (
    <input {...rest} {...shared} type={type} ref={ref as Ref<HTMLInputElement>} />
  );
  return (
    <div className={cx("sa-field", className)}>
      {label ? (
        <label className="sa-label" htmlFor={id}>
          <span>
            {label}
            {required ? <span className="sa-label-req" aria-hidden="true"> *</span> : null}
          </span>
          {optional ? <span className="sa-faint" style={{ fontWeight: 400 }}>אופציונלי</span> : null}
        </label>
      ) : null}
      <div className={cx("sa-control", icon && "has-icon")}>
        {icon ? <span className="sa-control-icon"><Icon name={icon} /></span> : null}
        {control}
        {end ? <span className="sa-control-end">{end}</span> : null}
      </div>
      {error ? (
        <span className="sa-error" id={errId} role="alert">
          <Icon name="alert-circle" size={12} />
          {error}
        </span>
      ) : hint ? (
        <span className="sa-hint" id={hintId}>{hint}</span>
      ) : null}
    </div>
  );
});
