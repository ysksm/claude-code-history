import { useEffect, useState } from "react";

interface State<T> { data?: T; error?: string; loading: boolean; }

// Runs an async loader whenever deps change; returns {data, error, loading}.
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): State<T> {
  const [state, setState] = useState<State<T>>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    loader()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => alive && setState({ error: String(e?.message ?? e), loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
