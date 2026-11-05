'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

/**
 * Loads data from the admin API. `refreshMs` re-polls (used by live screens);
 * a failed refresh keeps showing the last good data and reports the error.
 */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (p === null) return;
    try {
      const result = await api<T>(p);
      if (pathRef.current === p) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login');
        return;
      }
      setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    setLoading(path !== null);
    void load();
    if (!refreshMs || path === null) return;
    const id = setInterval(() => void load(), refreshMs);
    return () => clearInterval(id);
  }, [path, refreshMs, load]);

  return { data, error, loading, reload: load };
}
