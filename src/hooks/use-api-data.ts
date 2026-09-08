"use client";

// Generic data-fetching hook for WEDJAT GET endpoints.
// `path === null` disables fetching (conditional scoping). Data is kept
// stale-while-revalidate style: previous data remains visible until the
// next response lands, `loading` is true only while the request for the
// current key (path + refresh tick) is in flight.

import { useCallback, useEffect, useState } from "react";
import { api, errMessage } from "@/lib/wedjat/client";

export interface UseApiDataResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

export function useApiData<T>(
  path: string | null,
  opts?: { pollMs?: number },
): UseApiDataResult<T> {
  const [tick, setTick] = useState(0);
  // Snapshot of the last COMPLETED request (key = path#tick).
  const [snap, setSnap] = useState<{
    key: string;
    data: T | null;
    error: string | null;
  }>({ key: path ?? "", data: null, error: null });

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const key = path === null ? "" : `${path}#${tick}`;
  const loading = path !== null && snap.key !== key;
  const error = snap.key === key ? snap.error : null;

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    const load = () => {
      api<T>(path)
        .then((d) => {
          if (cancelled) return;
          setSnap({ key: `${path}#${tick}`, data: d, error: null });
        })
        .catch((e) => {
          if (cancelled) return;
          setSnap({ key: `${path}#${tick}`, data: null, error: errMessage(e) });
        });
    };
    load();
    let interval: ReturnType<typeof setInterval> | undefined;
    if (opts?.pollMs) {
      interval = setInterval(load, opts.pollMs);
    }
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [path, tick, opts?.pollMs]);

  const setData = useCallback<
    React.Dispatch<React.SetStateAction<T | null>>
  >(
    (value) => {
      setSnap((prev) => ({
        key: prev.key,
        data: typeof value === "function" ? (value as (p: T | null) => T | null)(prev.data) : value,
        error: prev.error,
      }));
    },
    [],
  );

  return { data: snap.data, error, loading, refresh, setData };
}
