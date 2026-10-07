import { useEffect, useState } from 'react';
import { onThemeChange } from '../lib/theme.js';

// Chart libraries draw SVG with colour *attributes*, which can't use CSS
// variables reliably. This reads the current values of the given variables
// from styles.css, and reads them again whenever the theme changes (the
// theme button or the operating system), so charts follow it too.
export function useThemeColors(names) {
  const read = () =>
    Object.fromEntries(names.map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()]));
  const [colors, setColors] = useState(read);

  useEffect(() => onThemeChange(() => setColors(read())), []); // eslint-disable-line react-hooks/exhaustive-deps

  return colors;
}
