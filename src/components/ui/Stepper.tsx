import type { ReactElement } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";

export interface StepItem { key: string; label: string; hint?: string }

export interface StepperProps {
  steps: StepItem[];
  current: string;
  busy?: boolean;
  className?: string;
}

/** 2–4 step process indicator. */
export function Stepper({ steps, current, busy, className }: StepperProps): ReactElement {
  const c = steps.findIndex((s) => s.key === current);
  return (
    <ol className={cx("sa-steps", className)} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((s, i) => {
        const status: "done" | "active" | "pending" = i < c ? "done" : i === c ? "active" : "pending";
        return (
          <li key={s.key} className={cx("sa-step", `is-${status}`)} aria-current={status === "active" ? "step" : undefined}>
            <span className="sa-step-dot">
              {status === "done" ? (
                <Icon name="check" size={14} strokeWidth={3} />
              ) : status === "active" && busy ? (
                <Spinner size="sm" />
              ) : (
                <span className="sa-num" style={{ fontSize: "inherit", lineHeight: "inherit", fontWeight: "inherit" }}>{i + 1}</span>
              )}
            </span>
            <div className="sa-step-body">
              <p className="sa-step-label">{s.label}</p>
              {s.hint ? <p className="sa-step-hint">{s.hint}</p> : null}
              <div className="sa-step-bar">{status === "active" && busy ? <span /> : null}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
