import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Available themes. Each id maps to a `:root[data-theme="<id>"]` block in
// src/styles/themes.css that overrides the palette CSS variables.
export type ThemeId =
  | 'dark'
  | 'light'
  | 'midnight'
  | 'dracula'
  | 'solarized-dark'
  | 'nord'
  | 'crimson'
  | 'high-contrast';

export interface ThemeOption {
  id: ThemeId;
  label: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'dark', label: 'Dark (Default)' },
  { id: 'light', label: 'Light' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'nord', label: 'Nord' },
  { id: 'crimson', label: 'Crimson (Red / Black)' },
  { id: 'high-contrast', label: 'High Contrast' }
];

interface ThemeContextType {
  theme: ThemeId;
  themes: ThemeOption[];
  setTheme: (id: ThemeId) => void;
  toggleTheme: () => void; // kept for backwards compatibility (cycles dark/light)
}

const STORAGE_KEY = 'lseditor.theme';
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === 'string' && THEMES.some(theme => theme.id === value);

const readStoredTheme = (): ThemeId => {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    /* ignore */
  }
  return 'dark';
};

// ThemeProvider wraps children with theme state, persists the choice, and
// applies it to the document root so the whole UI re-themes via CSS variables.
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const value = useMemo<ThemeContextType>(
    () => ({
      theme,
      themes: THEMES,
      setTheme: (id: ThemeId) => {
        if (isThemeId(id)) setThemeState(id);
      },
      toggleTheme: () => setThemeState(prev => (prev === 'light' ? 'dark' : 'light'))
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// Custom hook to use the theme context
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
