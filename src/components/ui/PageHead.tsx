import type { ReactElement, ReactNode } from "react";

export interface PageHeadProps {
  title: string;
  /** One quiet fact no tab already states. Its line stays reserved, so nothing below moves. */
  sub?: ReactNode;
  /** The page's buttons: at most one primary, placed last. */
  actions?: ReactNode;
}

/** The top of every page: the same height and the same place on all six. */
export function PageHead({ title, sub, actions }: PageHeadProps): ReactElement {
  return (
    <header className="sa-pagehead">
      <h1 className="sa-page-title">{title}</h1>
      <p className="sa-page-sub">{sub}</p>
      {actions ? <div className="sa-pagehead-actions">{actions}</div> : null}
    </header>
  );
}
