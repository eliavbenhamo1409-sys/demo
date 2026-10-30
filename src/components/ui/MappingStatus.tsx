"use client";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { Icon } from "./Icon";

export interface MappingStatusProps {
  status: "approved" | "pending";
  /** Internal SKU the external name maps to; mono LTR. */
  target?: string;
  onApprove?: () => void;
  onFix?: () => void;
  className?: string;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Supplier-dictionary mapping state with in-row approve/fix actions. */
export function MappingStatus({ status, target, onApprove, onFix, className }: MappingStatusProps) {
  const approved = status === "approved";
  return (
    <span className={cx("sa-mapping", className)}>
      <Badge tone={approved ? "success" : "warning"} solid={!approved} dot={approved}>
        {approved ? "מאושר" : "לא מאושר"}
      </Badge>
      {target ? (
        <span className="sa-mapping-target">
          <Icon name="link" size={14} />
          <code>{target}</code>
        </span>
      ) : null}
      {!approved && onApprove ? <Button variant="secondary" size="sm" icon="check" onClick={onApprove}>אשר</Button> : null}
      {!approved && onFix ? <Button variant="ghost" size="sm" onClick={onFix}>תקן</Button> : null}
    </span>
  );
}
