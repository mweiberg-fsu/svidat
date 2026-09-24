import { useSyncExternalStore } from 'react'
import type { ThemeSettings } from './api/types'

export const DEFAULT_SITE_NAME = 'SVIDAT'
export const DEFAULT_SAVE_DRAFT_LABEL = 'Save draft (v250)'
export const DEFAULT_PUBLISH_LABEL = 'Publish (v300)'

interface Branding {
  siteName: string
  saveDraftLabel: string
  publishLabel: string
  hasLogo: boolean
  // Bumped on every applyTheme so consumers refetch the logo blob after an
  // admin uploads a replacement (has_logo stays true across the swap).
  logoVersion: number
}

let branding: Branding = {
  siteName: DEFAULT_SITE_NAME,
  saveDraftLabel: DEFAULT_SAVE_DRAFT_LABEL,
  publishLabel: DEFAULT_PUBLISH_LABEL,
  hasLogo: false,
  logoVersion: 0,
}
const listeners = new Set<() => void>()

// Applies admin-configured colors as CSS custom properties and publishes the
// site name/logo/button labels to useBranding() subscribers (e.g. Navbar). Module-level
// rather than a context so AdminUsersPage can push a just-saved theme without
// needing to sit under a provider.
export function applyTheme(theme: ThemeSettings) {
  document.documentElement.style.setProperty('--accent', theme.primary_color)
  document.documentElement.style.setProperty('--secondary', theme.secondary_color)
  document.documentElement.style.setProperty('--tertiary', theme.tertiary_color)
  branding = {
    siteName: theme.site_name || DEFAULT_SITE_NAME,
    saveDraftLabel: theme.save_draft_label || DEFAULT_SAVE_DRAFT_LABEL,
    publishLabel: theme.publish_label || DEFAULT_PUBLISH_LABEL,
    hasLogo: theme.has_logo,
    logoVersion: branding.logoVersion + 1,
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useBranding(): Branding {
  return useSyncExternalStore(subscribe, () => branding)
}
