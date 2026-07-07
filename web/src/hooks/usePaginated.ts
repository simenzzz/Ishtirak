import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest, asPage } from "../lib/apiClient";
import type { PageMeta, Paginated } from "../lib/types";

type Params = Readonly<Record<string, string | number | undefined>>;
type Options = Readonly<{ limit?: number; params?: Params }>;

export function usePaginated<T>(path: string, options: Options = {}) {
  const { limit = 10, params } = options;
  const paramsKey = params ? JSON.stringify(params) : "";
  const [page, setPage] = useState(1);
  const [data, setData] = useState<readonly T[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ total: 0, page: 1, limit });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryPath = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    return `${path}?${query.toString()}`;
    // paramsKey stands in for `params` identity below; its serialized value is what should trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, page, limit, paramsKey]);

  const load = useCallback(async (): Promise<{ data: readonly T[]; meta: PageMeta } | null> => {
    try {
      const response = await apiRequest<Paginated<T> | readonly T[]>(queryPath);
      return asPage<T>(response, page, limit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      return null;
    }
  }, [queryPath, page, limit]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await load();
    if (result) {
      setData(result.data);
      setMeta(result.meta);
    }
    setLoading(false);
  }, [load]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void load().then((result) => {
      if (!active || !result) return;
      setData(result.data);
      setMeta(result.meta);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [load]);

  return { data, meta, page, setPage, loading, error, refetch };
}
