import { useEffect, useState } from 'react';

type Palette = Record<string, string>;

const DARK: Palette = {
  '--bg-primary': '#0a0a0e',
  '--bg-secondary': '#1a1a22',
  '--bg-tertiary': '#0f0f13',
  '--border': '#2a2a35',
  '--border-strong': '#3a3a45',
  '--text-primary': '#e2e2e7',
  '--text-secondary': '#aaa',
  '--text-muted': '#888',
  '--text-faint': '#666',
  '--accent': '#3d7eff',
  '--accent-hover': '#5491ff',
  '--success': '#52e052',
  '--danger': '#e05252',
  '--danger-bg': '#2a1414',
  '--warning': '#f0c060',
  '--toast-bg': '#3a1a1a',
  '--toast-border': '#c04040',
};

const LIGHT: Palette = {
  '--bg-primary': '#ffffff',
  '--bg-secondary': '#f5f5f7',
  '--bg-tertiary': '#ffffff',
  '--border': '#e2e2e7',
  '--border-strong': '#c8c8d0',
  '--text-primary': '#1a1a22',
  '--text-secondary': '#555',
  '--text-muted': '#888',
  '--text-faint': '#aaa',
  '--accent': '#3d7eff',
  '--accent-hover': '#2d6def',
  '--success': '#0a8a0a',
  '--danger': '#c0282a',
  '--danger-bg': '#fdecec',
  '--warning': '#b07020',
  '--toast-bg': '#fdecec',
  '--toast-border': '#c0282a',
};

export type ColorScheme = 'dark' | 'light';

function detectScheme(): ColorScheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(scheme: ColorScheme): void {
  const vars = scheme === 'light' ? LIGHT : DARK;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.style.colorScheme = scheme;
}

export function applyBaseStyles(): void {
  apply(detectScheme());
  const body = document.body;
  body.style.margin = '0';
  body.style.padding = '0';
  body.style.background = 'var(--bg-primary)';
  body.style.color = 'var(--text-primary)';
  body.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  body.style.fontSize = '14px';
}

export function useColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(detectScheme);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => setScheme(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    apply(scheme);
  }, [scheme]);

  return scheme;
}
