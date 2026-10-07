import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentTheme, onThemeChange, setTheme, storedTheme } from './theme.js';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('follows the system until a choice is made', () => {
    expect(storedTheme()).toBe('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(currentTheme()).toBe('light'); // jsdom has no dark system theme
  });

  it('remembers a choice and applies it to <html>', () => {
    setTheme('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(storedTheme()).toBe('dark');
    expect(currentTheme()).toBe('dark');
  });

  it('"system" forgets the choice', () => {
    setTheme('light');
    setTheme('system');
    expect(localStorage.getItem('theme')).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('blocked storage (private mode) still switches the theme, without crashing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setTheme('dark')).not.toThrow();
    expect(currentTheme()).toBe('dark');
    expect(storedTheme()).toBe('system');
  });

  it('tells listeners when the theme changes', async () => {
    const listener = vi.fn();
    const stop = onThemeChange(listener);
    setTheme('dark');
    await new Promise((r) => setTimeout(r, 0)); // MutationObserver is async
    expect(listener).toHaveBeenCalled();
    stop();
  });
});
