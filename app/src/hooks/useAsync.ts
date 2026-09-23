import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  /** Re-run the loader. Keeps showing current data while it loads. */
  reload: () => void;
}

/** Runs an async loader and tracks loading / error / data for screen states. */
export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const key = `${JSON.stringify(deps)}#${nonce}`;
  // The latest settled result and the request key it belongs to.
  const [result, setResult] = useState<{ key?: string; data?: T; error?: Error }>({});
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let cancelled = false;
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setResult({ key, data });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setResult((prev) => ({ key, data: prev.data, error: e instanceof Error ? e : new Error(String(e)) }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const loading = result.key !== key;
  return { data: result.data, error: loading ? undefined : result.error, loading, reload };
}
