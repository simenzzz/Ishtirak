import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";

export function SortableTh<K extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  readonly label: ReactNode;
  readonly sortKey: K;
  readonly activeKey: K | null;
  readonly direction: "asc" | "desc";
  readonly onSort: (key: K) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sortable-th" onClick={() => onSort(sortKey)}>
        {label}
        <Icon size={12} aria-hidden />
      </button>
    </th>
  );
}
