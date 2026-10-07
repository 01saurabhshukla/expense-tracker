import { useCallback, useEffect, useRef, useState } from 'react';

// Loads data for a page and reloads when `key` changes (e.g. the filters).
//
// While reloading, the previous data stays on screen (`refreshing` is true)
// instead of flashing an empty page. Answers that arrive out of order (an
// old request finishing after a newer one) are ignored.
export function useApiData(load, key) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await loadRef.current();
      if (id === latest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === latest.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    run();
  }, [run, key]);

  return {
    data: state.data,
    error: state.error,
    loading: state.loading && state.data === undefined, // first load
    refreshing: state.loading && state.data !== undefined, // reload with data shown
    reload: run,
  };
}
