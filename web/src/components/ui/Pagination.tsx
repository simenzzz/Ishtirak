import { ChevronLeft, ChevronRight } from "lucide-react";

import type { PageMeta } from "../../lib/types";
import { Button } from "./Button";

export function Pagination({
  meta,
  onPageChange,
  sortableColumns = false,
}: {
  readonly meta: PageMeta;
  readonly onPageChange: (page: number) => void;
  /** Set when the page also has sortable column headers, so users know sort only orders the current page. */
  readonly sortableColumns?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <Button variant="ghost" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
        <ChevronLeft size={16} aria-hidden />
        Previous
      </Button>
      <span className="pagination__status">
        Page {meta.page} of {totalPages}
      </span>
      <Button variant="ghost" disabled={meta.page >= totalPages} onClick={() => onPageChange(meta.page + 1)}>
        Next
        <ChevronRight size={16} aria-hidden />
      </Button>
      {sortableColumns ? <span className="pagination__note">Sorting applies to the current page only.</span> : null}
    </nav>
  );
}
