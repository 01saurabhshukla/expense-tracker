import { useEffect, useRef } from 'react';

// Calls `callback` every `intervalMs` while `active` is true, and stops when
// the tab is hidden (no point polling a page nobody is looking at).
export function usePolling(callback, intervalMs, active) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!active) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') saved.current();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, active]);
}
