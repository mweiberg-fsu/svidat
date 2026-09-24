import { useSyncExternalStore } from 'react'
import type { AppConfig, ClickTrigger, DocTab, KeyBindings } from './api/types'
import { IS_MAC } from './platform'

// Mirrors server/app/app_config.py DEFAULT_KEYBINDINGS, so plot gestures work
// before (or without) the /config fetch landing.
export const DEFAULT_KEYBINDINGS: KeyBindings = {
  x_zoom: 'shift',
  y_zoom: 'ctrl',
  undo: 'meta',
  redo: 'dblclick',
}

// Mirrors server/app/app_config.py DEFAULT_DOCUMENTATION: shown until the
// /config fetch lands, and used by the admin panel's "Reset to defaults".
export const DEFAULT_DOCUMENTATION: DocTab[] = [
  {
    title: 'Overview',
    body: [
      'svidat is a netCDF quality-control tool. It lets you browse, plot, and hand-edit variable flag information in netCDF files, with every change tracked in an audit log.',
      '',
      '## Roles',
      '',
      '- **admin** — full access, manages users.',
      '- **qca** — can edit, save, and publish files.',
      '- **user** — view only.',
      '',
    ].join('\n'),
  },
  {
    title: 'Workflow',
    body: [
      '## File lifecycle',
      '',
      '1. A file is uploaded as **raw** — the original, read-only source.',
      '2. A qca/admin user opens an edit session, creating their own working copy.',
      '3. Flag edits write to that working copy.',
      '4. **Save** copies the working copy into a draft version (version 250).',
      '5. **Publish** copies the working copy into a draft version (version 250) AND copies the working copy into the published version (version 300).',
      '6. Every edit is recorded in the audit history and can be reverted.',
      '',
    ].join('\n'),
  },
  {
    title: 'Controls',
    body: [
      '## Plot gestures',
      '',
      '- Click a row — set that row as the active variable.',
      '- Drag on a row (admin/qca only) — select a point range and open the flag toolbar.',
      '- {{x_zoom}} — zoom the X axis.',
      '- {{y_zoom}} — zoom the Y axis.',
      '- {{undo}} or right-click — undo the last zoom.',
      '- {{redo}} or Shift+right-click — redo zoom.',
      '- Escape — cancel an open flag-selection popover.',
      '',
      '## Sidebar',
      '',
      '- Drag the sidebar\'s right edge to resize it.',
      '',
    ].join('\n'),
  },
]

export const GESTURES: { key: keyof KeyBindings; label: string; kind: 'drag' | 'click' }[] = [
  { key: 'x_zoom', label: 'Zoom X axis', kind: 'drag' },
  { key: 'y_zoom', label: 'Zoom Y axis', kind: 'drag' },
  { key: 'undo', label: 'Undo zoom', kind: 'click' },
  { key: 'redo', label: 'Redo zoom', kind: 'click' },
]

interface ConfigState {
  keybindings: KeyBindings
  documentation: DocTab[]
}

let state: ConfigState = { keybindings: DEFAULT_KEYBINDINGS, documentation: DEFAULT_DOCUMENTATION }
const listeners = new Set<() => void>()

// Module-level store (same approach as theme.ts) so AdminUsersPage can push a
// just-saved config to SvgPlot/DocumentationModal without a provider.
export function applyConfig(config: AppConfig) {
  state = { keybindings: { ...DEFAULT_KEYBINDINGS, ...config.keybindings }, documentation: config.documentation }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAppConfig(): ConfigState {
  return useSyncExternalStore(subscribe, () => state)
}

type Modifier = Exclude<ClickTrigger, 'dblclick'>

export function modifierName(mod: Modifier): string {
  switch (mod) {
    case 'shift':
      return 'Shift'
    case 'ctrl':
      return 'Ctrl'
    case 'alt':
      return IS_MAC ? 'Option' : 'Alt'
    case 'meta':
      return IS_MAC ? 'Cmd' : 'Meta'
  }
}

export function triggerLabel(trigger: ClickTrigger, kind: 'drag' | 'click'): string {
  if (trigger === 'dblclick') return 'Double-click'
  return `${modifierName(trigger)}+${kind}`
}

// KeyboardEvent.key value for each modifier, for tracking which are held.
export const MODIFIER_KEY: Record<Modifier, string> = {
  shift: 'Shift',
  ctrl: 'Control',
  alt: 'Alt',
  meta: 'Meta',
}

export function hasModifier(
  e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean },
  trigger: ClickTrigger
): boolean {
  switch (trigger) {
    case 'shift':
      return e.shiftKey
    case 'ctrl':
      return e.ctrlKey
    case 'alt':
      return e.altKey
    case 'meta':
      return e.metaKey
    case 'dblclick':
      return false
  }
}

// Replaces {{x_zoom}}-style placeholders in documentation text with the
// current binding's label; unknown placeholders are left as-is.
export function fillPlaceholders(text: string, bindings: KeyBindings): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const gesture = GESTURES.find((g) => g.key === key)
    return gesture ? triggerLabel(bindings[gesture.key], gesture.kind) : match
  })
}
