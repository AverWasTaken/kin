import { useCallback, useEffect, useRef, useState } from "react";

/** Fetches on mount and whenever `version` changes; keeps showing stale data while refreshing. */
export function useResource<T>(load: () => Promise<T>, version: unknown = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loader.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  return { data, setData, error, loading, refresh };
}
