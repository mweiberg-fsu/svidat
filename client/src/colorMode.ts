import { useSyncExternalStore } from 'react'

export type ColorMode = 'light' | 'dark'

const STORAGE_KEY = 'svidat-color-mode'
const listeners = new Set<() => void>()

function readStored(): ColorMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function systemMode(): ColorMode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Until the user picks a mode explicitly, follow the OS preference.
let mode: ColorMode = readStored() ?? systemMode()

function apply() {
  document.documentElement.dataset.theme = mode
}

// Module-level (same approach as theme.ts) so the sidebar and profile page
// toggles stay in sync without sharing a provider.
export function setColorMode(next: ColorMode) {
  mode = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Storage unavailable (private mode etc.) — mode still applies this session.
  }
  apply()
  listeners.forEach((l) => l())
}

export function initColorMode() {
  apply()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useColorMode(): ColorMode {
  return useSyncExternalStore(subscribe, () => mode)
}
