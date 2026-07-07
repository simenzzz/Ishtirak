import { useMemo, useState } from "react";

type Direction = "asc" | "desc";

export function useSort<T, K extends keyof T>(data: readonly T[], defaultKey: K | null = null) {
  const [sortKey, setSortKey] = useState<K | null>(defaultKey);
  const [direction, setDirection] = useState<Direction>("asc");

  function toggleSort(key: K) {
    if (sortKey === key) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      if (left === right) return 0;
      const comparison = left > right ? 1 : -1;
      return direction === "asc" ? comparison : -comparison;
    });
  }, [data, sortKey, direction]);

  return { sorted, sortKey, direction, toggleSort };
}
