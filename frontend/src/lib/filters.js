import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

// Filters live in the URL (?from=…&category=…), so a filtered view can be
// bookmarked, shared, and the Back button undoes a filter change. The same
// keys as the backend's shared filters (D29).
export const FILTER_KEYS = ['from', 'to', 'category', 'direction', 'uploadId', 'q', 'merchant'];
const NO_EXTRA_KEYS = [];

// `extraKeys`: page-specific keys (sort, offset, granularity). Pass a
// constant array defined outside the component.
export function useUrlFilters(extraKeys = NO_EXTRA_KEYS) {
  const [searchParams, setSearchParams] = useSearchParams();
  const keys = useMemo(() => [...FILTER_KEYS, ...extraKeys], [extraKeys]);

  const values = useMemo(() => {
    const result = {};
    for (const key of keys) {
      const value = searchParams.get(key);
      if (value) result[key] = value;
    }
    return result;
  }, [searchParams, keys]);

  // update({ category: 'fuel', offset: undefined }) — undefined/'' removes a key.
  const update = useCallback(
    (changes) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined || value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  return [values, update];
}

// Only the shared filter keys (what exports and the dashboard accept).
export function pickFilters(values) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => FILTER_KEYS.includes(key)));
}
