import { useCallback, useEffect, useState } from 'react';
import { currentTheme, onThemeChange, setTheme } from '../lib/theme.js';

// The theme on screen, and a toggle between light and dark.
export function useTheme() {
  const [theme, setState] = useState(currentTheme);

  useEffect(() => onThemeChange(() => setState(currentTheme())), []);

  const toggle = useCallback(() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}
