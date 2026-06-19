import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest, asPage } from "../lib/apiClient";
import type { PageMeta, Paginated } from "../lib/types";

export function usePaginated<T>(path: string, initialLimit = 10) {
  const [page, setPage] = useState(1);
  const [limit] = useState(initialLimit);
  const [data, setData] = useState<readonly T[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ total: 0, page: 1, limit: initialLimit });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryPath = useMemo(() => `${path}?page=${page}&limit=${limit}`, [path, page, limit]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<Paginated<T> | readonly T[]>(queryPath);
      const pageResult = asPage<T>(response, page, limit);
      setData(pageResult.data);
      setMeta(pageResult.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [queryPath, page, limit]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await apiRequest<Paginated<T> | readonly T[]>(queryPath);
        if (!active) return;
        const pageResult = asPage<T>(response, page, limit);
        setData(pageResult.data);
        setMeta(pageResult.meta);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Request failed.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [queryPath, page, limit]);

  return { data, meta, page, setPage, loading, error, refetch };
}
