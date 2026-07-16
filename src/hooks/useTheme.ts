import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const STORAGE_KEY = 'chuhaibang_theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useThemeState(): ThemeContextValue {
  const [theme, setThemeRaw] = useState<Theme>(() =>
    (localStorage.getItem(STORAGE_KEY) as Theme) || 'dark'
  );

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeRaw(t);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    root.classList.remove('theme-dark', 'theme-light');
    root.classList.add(`theme-${theme}`);
    root.setAttribute('data-theme', theme);
  }, [theme]);

  return useMemo(() => ({
    theme,
    isDark: theme === 'dark',
    toggle,
    setTheme,
  }), [theme, toggle, setTheme]);
}

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
