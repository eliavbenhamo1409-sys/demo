"use client";

import type { ReactNode } from "react";

export interface FieldItem {
  label: ReactNode;
  value?: ReactNode;
  num?: boolean;
}

export interface FieldsProps {
  items: FieldItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Definition list of label/value pairs. */
export function Fields({ items, columns = 2, className }: FieldsProps) {
  return (
    <dl className={cx("sa-fields", `is-${columns}`, className)}>
      {items.map((f, i) => {
        const empty = f.value == null || f.value === "";
        return (
          <div key={i}>
            <dt>{f.label}</dt>
            <dd className={cx(f.num && "is-num") || undefined} title={typeof f.value === "string" ? f.value : undefined}>
              {empty ? "—" : f.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
