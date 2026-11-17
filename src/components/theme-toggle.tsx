'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';
const storageKey = 'registro-docente-theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Activar modo oscuro' : 'Activar modo claro';

  return <button type="button" className="button secondary theme-toggle" aria-label={label} aria-pressed={theme === 'dark'} title={label} onClick={() => {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(storageKey, next); } catch { /* Theme still applies for this page load. */ }
    setTheme(next);
  }}>{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}<span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span></button>;
}
