// Light or dark. The person's choice is remembered on this device
// (localStorage); until they choose, the operating system decides.
//
// The choice is a data-theme attribute on <html> ("light" | "dark"), which
// styles.css reads; no attribute = follow the system. public/theme-init.js
// sets it before the page paints, so a reload never flashes the wrong theme.

const KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

// 'light' | 'dark' | 'system'. Storage can be blocked (private mode):
// then it's simply 'system'.
export function storedTheme() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

// The theme actually on screen.
export function currentTheme() {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // not remembered, but still applied for this visit
  }
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

// Calls `listener` whenever the theme on screen may have changed: the
// button (data-theme) or the operating system. Returns an unsubscribe.
export function onThemeChange(listener) {
  const media = window.matchMedia?.(DARK_QUERY);
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  media?.addEventListener('change', listener);
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', listener);
  };
}
