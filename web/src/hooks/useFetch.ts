import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "../lib/apiClient";

export type FetchState<T> = Readonly<{ data: T | null; loading: boolean; error: string | null; refetch: () => Promise<void> }>;

export function useFetch<T>(path: string | null): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiRequest<T>(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    let active = true;
    if (!path) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await apiRequest<T>(path);
        if (active) setData(result);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Request failed.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [path]);

  return { data, loading, error, refetch };
}
