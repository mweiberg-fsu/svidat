import { useSyncExternalStore } from 'react'
import type { AppConfig, ClickTrigger, DocTab, DragTrigger, KeyBindings, Modifier } from './api/types'
import { IS_MAC } from './platform'

// Mirrors server/app/app_config.py DEFAULT_KEYBINDINGS, so plot gestures work
// before (or without) the /config fetch landing.
export const DEFAULT_KEYBINDINGS: KeyBindings = {
  x_zoom: 'shift',
  y_zoom: 'ctrl',
  box_zoom: 'shift+ctrl',
  flag_select: 'none',
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
      '- {{flag_select}} on a row (admin/qca only) — select a point range and open the flag toolbar.',
      '- {{x_zoom}} — zoom the X axis.',
      '- {{y_zoom}} — zoom the Y axis.',
      '- {{box_zoom}} — box-zoom the X axis and that row\'s Y axis together.',
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
  { key: 'box_zoom', label: 'Box zoom', kind: 'drag' },
  { key: 'flag_select', label: 'Select flag range', kind: 'drag' },
  { key: 'undo', label: 'Undo zoom', kind: 'click' },
  { key: 'redo', label: 'Redo zoom', kind: 'click' },
]

// Message for the first binding conflict found (rules 3–6 of the Phase A
// design spec), or null. Mirrors the server's validation, comparing on the
// canonical form so a legacy token and its canonical twin count as the same
// trigger.
export function findConflict(bindings: KeyBindings): string | null {
  const parsed = GESTURES.map((g) => ({ g, spec: parseTrigger(bindings[g.key], g.kind) }))
  for (const { g, spec } of parsed) {
    if (!spec) return `"${g.label}" has an invalid binding.`
  }

  // Rule 4: the six normalized triggers are pairwise distinct.
  const seen = new Map<string, string>()
  for (const { g } of parsed) {
    const key = canonicalTrigger(bindings[g.key], g.kind) as string
    const other = seen.get(key)
    if (other) return `"${other}" and "${g.label}" can't share the same binding.`
    seen.set(key, g.label)
  }

  // Rule 5: a click gesture (action 'click') can't share (mods, button) with
  // a drag gesture — a drag ends with a click.
  const dragSpecs = parsed.filter(({ g }) => g.kind === 'drag')
  const clickSpecs = parsed.filter(({ g }) => g.kind === 'click')
  for (const { g: cg, spec: cs } of clickSpecs) {
    if (cs!.action !== 'click') continue
    for (const { g: dg, spec: ds } of dragSpecs) {
      if (sameModsButton(cs!, ds!)) {
        return `"${cg.label}" can't use the same keys and button as "${dg.label}" — a drag ends with a click.`
      }
    }
  }

  // Rule 6: undo and redo can't be the click and double-click of the same
  // keys and button — the first click of a double-click fires the single-
  // click gesture.
  const undo = parsed.find(({ g }) => g.key === 'undo')!
  const redo = parsed.find(({ g }) => g.key === 'redo')!
  if (sameModsButton(undo.spec!, redo.spec!) && undo.spec!.action !== redo.spec!.action) {
    return `"${undo.g.label}" and "${redo.g.label}" can't be the click and double-click of the same keys and button.`
  }

  return null
}

interface ConfigState {
  keybindings: KeyBindings
  defaultKeybindings: KeyBindings
  userKeybindings: KeyBindings | null
  documentation: DocTab[]
}

let state: ConfigState = {
  keybindings: DEFAULT_KEYBINDINGS,
  defaultKeybindings: DEFAULT_KEYBINDINGS,
  userKeybindings: null,
  documentation: DEFAULT_DOCUMENTATION,
}
const listeners = new Set<() => void>()

// Module-level store (same approach as theme.ts) so AdminUsersPage can push a
// just-saved config to SvgPlot/DocumentationModal without a provider.
// The effective `keybindings` are the caller's own saved set, if any, over
// the admin-configured defaults.
export function applyConfig(config: AppConfig) {
  const defaults = { ...DEFAULT_KEYBINDINGS, ...config.keybindings }
  const mine = config.user_keybindings ? { ...DEFAULT_KEYBINDINGS, ...config.user_keybindings } : null
  state = {
    keybindings: mine ?? defaults,
    defaultKeybindings: defaults,
    userKeybindings: mine,
    documentation: config.documentation,
  }
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

// The 11 drag triggers (plain drag, a single modifier, or a canonically-
// ordered pair), in the same order as server/app/app_config.py DRAG_TRIGGERS.
const PAIR_MODIFIERS: Modifier[] = ['shift', 'ctrl', 'alt', 'meta']
export const DRAG_TRIGGERS: DragTrigger[] = [
  'none',
  ...PAIR_MODIFIERS,
  ...PAIR_MODIFIERS.flatMap((a, i) => PAIR_MODIFIERS.slice(i + 1).map((b) => `${a}+${b}` as DragTrigger)),
]

export const CLICK_TRIGGERS: ClickTrigger[] = ['shift', 'ctrl', 'alt', 'meta', 'dblclick']

// Canonical trigger grammar (Phase A): a binding is either a legacy token
// above (valid for its gesture kind) or "<mods>/<button>/<action>". Mirrors
// server/app/triggers.py exactly, but returns null instead of raising, since
// the client only needs to know whether a value is usable.
export type MouseButton = 'left' | 'middle' | 'right'
export type PointerAction = 'drag' | 'click' | 'dblclick'
export interface TriggerSpec {
  mods: Modifier[]
  button: MouseButton
  action: PointerAction
}
type Kind = 'drag' | 'click'

const BUTTONS: MouseButton[] = ['left', 'middle', 'right']

// Mirrors server/app/triggers.py _parse_mods: 'none', or modifiers joined by
// '+' in canonical order (shift, ctrl, alt, meta), each appearing once.
function parseMods(text: string): Modifier[] | null {
  if (text === 'none') return []
  const parts = text.split('+') as Modifier[]
  if (parts.some((p) => !PAIR_MODIFIERS.includes(p)) || new Set(parts).size !== parts.length) return null
  const sorted = [...parts].sort((a, b) => PAIR_MODIFIERS.indexOf(a) - PAIR_MODIFIERS.indexOf(b))
  return sorted.join('+') === parts.join('+') ? parts : null
}

// Mirrors server/app/triggers.py parse_trigger.
export function parseTrigger(t: string, kind: Kind): TriggerSpec | null {
  if (!t.includes('/')) {
    const allowed: readonly string[] = kind === 'drag' ? DRAG_TRIGGERS : CLICK_TRIGGERS
    if (!allowed.includes(t)) return null
    if (t === 'dblclick') return { mods: [], button: 'left', action: 'dblclick' }
    const mods = parseMods(t)
    return mods ? { mods, button: 'left', action: kind === 'drag' ? 'drag' : 'click' } : null
  }
  const pieces = t.split('/')
  if (pieces.length !== 3) return null
  const [modsText, button, action] = pieces
  const mods = parseMods(modsText)
  if (!mods || !BUTTONS.includes(button as MouseButton)) return null
  const actions: PointerAction[] = kind === 'drag' ? ['drag'] : ['click', 'dblclick']
  if (!actions.includes(action as PointerAction)) return null
  if (kind === 'click' && mods.length === 0 && button === 'left' && action === 'click') return null
  return { mods, button: button as MouseButton, action: action as PointerAction }
}

// Mirrors server/app/triggers.py canonical(); null when `t` isn't valid for `kind`.
export function canonicalTrigger(t: string, kind: Kind): string | null {
  const s = parseTrigger(t, kind)
  return s ? `${s.mods.join('+') || 'none'}/${s.button}/${s.action}` : null
}

function heldModifiers(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): Modifier[] {
  const held: Modifier[] = []
  if (e.shiftKey) held.push('shift')
  if (e.ctrlKey) held.push('ctrl')
  if (e.altKey) held.push('alt')
  if (e.metaKey) held.push('meta')
  return held
}

function sameMods(a: Modifier[], b: Modifier[]): boolean {
  return a.length === b.length && a.every((m, i) => b[i] === m)
}

function sameModsButton(a: TriggerSpec, b: TriggerSpec): boolean {
  return a.button === b.button && sameMods(a.mods, b.mods)
}

// Exact match: `t` must parse as a `kind` trigger with this `action`, whose
// button and held modifiers exactly equal the pointer event's.
export function matchesPointer(
  e: { button: number; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean },
  t: string,
  kind: Kind,
  action: PointerAction
): boolean {
  const spec = parseTrigger(t, kind)
  if (!spec || spec.action !== action || BUTTONS[e.button] !== spec.button) return false
  return sameMods(heldModifiers(e), spec.mods)
}

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

function actionWord(action: PointerAction, button: MouseButton): string {
  if (action === 'drag') return button === 'left' ? 'drag' : `${button}-drag`
  if (action === 'click') return button === 'left' ? 'click' : `${button}-click`
  return button === 'left' ? 'double-click' : `${button} double-click`
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Legacy left-button labels stay byte-identical to before Phase A ("Shift+drag",
// "Cmd+click", "Double-click", "Drag"); new mods/button/action triggers get
// labels like "Shift+Alt+right-drag", "Right-click" and "Middle double-click".
// An unparseable value is returned as-is.
export function triggerLabel(t: string, kind: 'drag' | 'click'): string {
  const spec = parseTrigger(t, kind)
  if (!spec) return t
  const word = actionWord(spec.action, spec.button)
  return spec.mods.length === 0 ? capitalize(word) : `${spec.mods.map(modifierName).join('+')}+${word}`
}

// KeyboardEvent.key value for each modifier, for tracking which are held.
export const MODIFIER_KEY: Record<Modifier, string> = {
  shift: 'Shift',
  ctrl: 'Control',
  alt: 'Alt',
  meta: 'Meta',
}

// Exact match against a set of currently-held KeyboardEvent.key names (as
// tracked for cursor feedback), rather than a single event's modifier flags.
// Only left-button drag specs apply: the button isn't known until the press,
// so a right/middle-button drag binding gets no hover cursor.
export function heldMatchesTrigger(held: ReadonlySet<string>, t: string): boolean {
  const spec = parseTrigger(t, 'drag')
  if (!spec || spec.button !== 'left') return false
  const heldMods = (Object.keys(MODIFIER_KEY) as Modifier[]).filter((m) => held.has(MODIFIER_KEY[m]))
  return sameMods(heldMods, spec.mods)
}

// Replaces {{x_zoom}}-style placeholders in documentation text with the
// current binding's label; unknown placeholders are left as-is.
export function fillPlaceholders(text: string, bindings: KeyBindings): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const gesture = GESTURES.find((g) => g.key === key)
    return gesture ? triggerLabel(bindings[gesture.key], gesture.kind) : match
  })
}
