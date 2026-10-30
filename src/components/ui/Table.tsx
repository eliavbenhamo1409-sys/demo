"use client";

import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

export interface TableColumn<T> {
  key: keyof T | string;
  title: ReactNode;
  width?: string;
  align?: "start" | "num" | "ltr";
  mono?: boolean;
  muted?: boolean;
  className?: string;
  render?: (row: T, index: number) => ReactNode;
}

export interface TableProps<T extends { id?: string | number } = Record<string, unknown>> {
  columns: TableColumn<T>[];
  data: T[];
  isLoading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  selectedId?: string | number;
  footer?: ReactNode;
  caption?: string;
  className?: string;
  style?: CSSProperties;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

function cellValue<T>(row: T, key: keyof T | string): ReactNode {
  const v = (row as Record<string, unknown>)[String(key)];
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "כן" : "לא";
  return String(v);
}

/** Dense data table: 44px rows, sticky micro headers, mono numeric columns, selected row, hover row actions. */
export function Table<T extends { id?: string | number }>({
  columns, data, isLoading, skeletonRows = 4, empty, onRowClick, selectedId, footer, caption, className, style,
}: TableProps<T>) {
  const colClass = (c: TableColumn<T>) => cx(c.align === "num" && "is-num", c.align === "ltr" && "is-ltr");

  let body: ReactNode;
  if (isLoading) {
    body = Array.from({ length: skeletonRows }, (_, i) => (
      <tr key={`sk${i}`} aria-hidden="true">
        {columns.map((c, j) => (
          <td key={`${String(c.key)}-${j}`} className={colClass(c)}>
            <span className="sa-skeleton" style={{ width: `${j === 0 ? 60 : 40 + ((i * 7 + j * 13) % 35)}%` }} />
          </td>
        ))}
      </tr>
    ));
  } else if (data.length === 0) {
    body = (
      <tr>
        <td colSpan={Math.max(1, columns.length)} className="sa-table-empty">{empty ?? "אין נתונים להצגה"}</td>
      </tr>
    );
  } else {
    body = data.map((row, i) => {
      const selected = selectedId != null && row.id === selectedId;
      const clickable = typeof onRowClick === "function";
      const onKeyDown = clickable
        ? (e: KeyboardEvent<HTMLTableRowElement>) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); }
          }
        : undefined;
      return (
        <tr
          key={row.id ?? i}
          className={cx(clickable && "is-clickable", selected && "is-selected") || undefined}
          aria-selected={clickable ? selected : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? () => onRowClick(row) : undefined}
          onKeyDown={onKeyDown}
        >
          {columns.map((c, j) => (
            <td key={`${String(c.key)}-${j}`} className={cx(colClass(c), c.mono && "is-mono", c.muted && "is-muted", c.className) || undefined}>
              {c.render ? c.render(row, i) : cellValue(row, c.key)}
            </td>
          ))}
        </tr>
      );
    });
  }

  return (
    <div className={cx("sa-table-wrap", className)} style={style}>
      <table className="sa-table" aria-busy={isLoading || undefined}>
        {caption ? <caption className="sa-sr">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c, j) => (
              <th key={`${String(c.key)}-${j}`} scope="col" style={c.width ? { width: c.width } : undefined} className={colClass(c) || undefined}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
      {footer ? <div className="sa-table-caption">{footer}</div> : null}
    </div>
  );
}
