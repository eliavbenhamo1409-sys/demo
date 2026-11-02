import type { ReactElement, ReactNode } from "react";
import { SearchBar } from "./SearchBar";

export interface ToolbarProps {
  /** `<Tabs/>` at the start of the row; leave out on a page without tabs. */
  tabs?: ReactNode;
  /** `<Select/>` filters beside the search. Their width comes from the toolbar. */
  filters?: ReactNode;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
}

/** Tabs at the start, filters beside them, the search at the far end at one width on every page. */
export function Toolbar({ tabs, filters, query, onQuery, placeholder }: ToolbarProps): ReactElement {
  return (
    <div className="sa-toolbar">
      {tabs ? <div className="sa-toolbar-tabs">{tabs}</div> : null}
      <div className="sa-toolbar-tools">
        {filters}
        <SearchBar kbd={false} value={query} onChange={onQuery} placeholder={placeholder} />
      </div>
    </div>
  );
}
