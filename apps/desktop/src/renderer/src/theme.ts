import { useEffect, useState } from 'react';
import { THEME_KEYS, type Theme } from '@aio/core';

/** Put a theme's colours on the page (ROADMAP 4.1). Values were validated as colours in core and main. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const key of THEME_KEYS) root.style.setProperty(`--${key}`, theme.colors[key]);
  root.style.colorScheme = theme.scheme; // native controls (selects, scrollbars) follow
}

/** The desktop's light/dark setting, live. */
export function useSystemDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}
