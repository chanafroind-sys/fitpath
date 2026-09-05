/**
 * Light and dark, with the viewer's palette kept in step.
 *
 * The 3D scene cannot read CSS variables, so the two palettes are declared in
 * `viewer/scene.ts` and selected here. One source of truth for "which theme are
 * we in", two consumers.
 */
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../viewer/scene.ts';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'fitpath-theme';
const listeners = new Set<(theme: Theme) => void>();

function preferred(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Private windows and blocked site data both throw here. The system
    // preference is a perfectly good answer.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let theme: Theme = preferred();

export function currentTheme(): Theme {
  return theme;
}

export function palette(): Palette {
  return theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}

export function applyTheme(next: Theme): void {
  theme = next;
  document.documentElement.dataset['theme'] = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not being able to remember the choice is not a reason to refuse it.
  }
  for (const listener of listeners) listener(next);
}

export function toggleTheme(): void {
  applyTheme(theme === 'dark' ? 'light' : 'dark');
}

export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initTheme(): void {
  applyTheme(theme);
}
