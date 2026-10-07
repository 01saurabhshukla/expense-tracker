import { useEffect, useState } from 'react';

// Chart libraries draw SVG with colour *attributes*, which can't use CSS
// variables reliably. This reads the current values of the given variables
// from styles.css, and reads them again when the system switches between
// light and dark mode, so charts follow the theme like everything else.
export function useThemeColors(names) {
  const read = () =>
    Object.fromEntries(names.map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()]));
  const [colors, setColors] = useState(read);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => setColors(read());
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return colors;
}
