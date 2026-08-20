import { useEffect } from 'react';
import { useStore } from '../store/useStore';

/** Sun/moon theme toggle; applies data-theme to the document root. */
export function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <button
      className="icon theme-toggle"
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle theme"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? '☾' : '☀'}
    </button>
  );
}
