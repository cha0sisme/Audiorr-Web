import { browser } from '$app/environment';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'audiorr-theme';

function getInitial(): Theme {
  if (!browser) return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

class ThemeStore {
  current = $state<Theme>(getInitial());

  set(theme: Theme) {
    this.current = theme;
    if (!browser) return;
    localStorage.setItem(STORAGE_KEY, theme);
    const root = document.documentElement;
    root.classList.remove('dark', 'light-theme');
    root.classList.add(theme === 'light' ? 'light-theme' : 'dark');
  }

  toggle() {
    this.set(this.current === 'dark' ? 'light' : 'dark');
  }
}

export const theme = new ThemeStore();
