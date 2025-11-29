import React, { createContext, useContext, useState } from 'react';

// ThemeContextType defines the shape of the theme context value
interface ThemeContextType {
  theme: 'light' | 'dark';       // Current theme mode
  toggleTheme: () => void;       // Function to toggle between light and dark mode
}

// Create a React context for theme state management
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// ThemeProvider wraps children with theme context and state management
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Track the current theme, default to 'dark'
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // Toggle between light and dark themes
  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  return (
    // Provide the theme context value to wrapped children
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook to use the theme context
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};