// Modo claro / oscuro.
//
// El tema vive en un único lugar: el atributo `data-theme` de <html>. El CSS
// (src/index.css) redefine ahí los tokens `--color-*`, así que cambiar el
// atributo repinta toda la app sin que ningún componente sepa qué tema está
// activo. Este módulo sólo se ocupa de decidirlo, persistirlo y avisar.
//
// La elección inicial sale de: preferencia guardada > preferencia del sistema
// (`prefers-color-scheme`) > claro. Una vez que el usuario toca el toggle, su
// elección manda y ya no se vuelve a mirar el sistema.
//
// El primer pintado lo resuelve el script inline de index.html, que corre antes
// que este módulo para que no haya un parpadeo claro al abrir en oscuro.

import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'organizador:theme'

const listeners = new Set<() => void>()

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

// localStorage puede tirar (modo privado de Safari, storage bloqueado): en ese
// caso el tema simplemente no se recuerda entre sesiones, pero la app anda.
export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function resolveInitialTheme(): Theme {
  return readStoredTheme() ?? (prefersDark() ? 'dark' : 'light')
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

// Lee el tema efectivo del DOM (que es la fuente de verdad). Si el script
// inline no llegó a correr, lo resuelve igual que él.
export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  const attr = document.documentElement.dataset.theme
  return isTheme(attr) ? attr : resolveInitialTheme()
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* sin persistencia: el tema vale para esta sesión */
  }
  applyTheme(theme)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'light')
}
