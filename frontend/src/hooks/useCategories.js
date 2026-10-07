import { useEffect, useState } from 'react';
import { listCategories } from '../api/endpoints.js';

// The fixed category list, loaded once per page load and shared.
let cache = null;

export function useCategories() {
  const [categories, setCategories] = useState(cache?.value ?? []);

  useEffect(() => {
    if (!cache || cache.failed) {
      cache = { promise: listCategories().then((r) => r.categories) };
      cache.promise.then((value) => (cache.value = value)).catch(() => (cache.failed = true));
    }
    let active = true;
    cache.promise.then((value) => active && setCategories(value)).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return categories;
}

export function categoryName(categories, key) {
  return categories.find((c) => c.key === key)?.name ?? key;
}
