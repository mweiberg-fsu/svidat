import { describe, expect, it, afterEach } from 'vitest'
import type { KeyBindings } from '../api/types'
import {
  DEFAULT_DOCUMENTATION,
  DEFAULT_KEYBINDINGS,
  GESTURES,
  applyConfig,
  canonicalTrigger,
  fillPlaceholders,
  findConflict,
  heldMatchesTrigger,
  matchesPointer,
  parseTrigger,
  triggerLabel,
  useAppConfig,
} from '../appConfig'
import { IS_MAC } from '../platform'
import { renderHook } from '@testing-library/react'

const USER_KEYBINDINGS: KeyBindings = {
  x_zoom: 'alt',
  y_zoom: 'meta',
  box_zoom: 'alt+meta',
  flag_select: 'shift+ctrl',
  undo: 'shift',
  redo: 'ctrl',
}

describe('appConfig helpers', () => {
  afterEach(() => {
    applyConfig({ keybindings: DEFAULT_KEYBINDINGS, user_keybindings: null, documentation: DEFAULT_DOCUMENTATION })
  })

  it('applyConfig uses the user keybindings as the effective set when present', () => {
    applyConfig({ keybindings: DEFAULT_KEYBINDINGS, user_keybindings: USER_KEYBINDINGS, documentation: DEFAULT_DOCUMENTATION })
    const { result } = renderHook(() => useAppConfig())
    expect(result.current.keybindings).toEqual(USER_KEYBINDINGS)
    expect(result.current.defaultKeybindings).toEqual(DEFAULT_KEYBINDINGS)
    expect(result.current.userKeybindings).toEqual(USER_KEYBINDINGS)
  })

  it('applyConfig falls back to the admin defaults when user_keybindings is null', () => {
    applyConfig({ keybindings: DEFAULT_KEYBINDINGS, user_keybindings: null, documentation: DEFAULT_DOCUMENTATION })
    const { result } = renderHook(() => useAppConfig())
    expect(result.current.keybindings).toEqual(DEFAULT_KEYBINDINGS)
    expect(result.current.defaultKeybindings).toEqual(DEFAULT_KEYBINDINGS)
    expect(result.current.userKeybindings).toBeNull()
  })

  it('applyConfig falls back to the admin defaults when user_keybindings is absent', () => {
    applyConfig({ keybindings: DEFAULT_KEYBINDINGS, documentation: DEFAULT_DOCUMENTATION })
    const { result } = renderHook(() => useAppConfig())
    expect(result.current.keybindings).toEqual(DEFAULT_KEYBINDINGS)
    expect(result.current.defaultKeybindings).toEqual(DEFAULT_KEYBINDINGS)
    expect(result.current.userKeybindings).toBeNull()
  })
  it('labels drag, click, and double-click triggers', () => {
    expect(triggerLabel('shift', 'drag')).toBe('Shift+drag')
    expect(triggerLabel('ctrl', 'click')).toBe('Ctrl+click')
    expect(triggerLabel('dblclick', 'click')).toBe('Double-click')
  })

  it('fills known placeholders from the bindings and leaves unknown ones alone', () => {
    const text = fillPlaceholders('{{x_zoom}} / {{y_zoom}} / {{redo}} / {{nope}}', {
      ...DEFAULT_KEYBINDINGS,
      y_zoom: 'shift',
      x_zoom: 'ctrl',
    })
    expect(text).toBe('Ctrl+drag / Shift+drag / Double-click / {{nope}}')
  })

  it('heldMatchesTrigger matches a set of held KeyboardEvent.key names exactly', () => {
    expect(heldMatchesTrigger(new Set(['Shift', 'Control']), 'shift+ctrl')).toBe(true)
    expect(heldMatchesTrigger(new Set(['Shift']), 'shift+ctrl')).toBe(false)
    expect(heldMatchesTrigger(new Set(), 'none')).toBe(true)
    expect(heldMatchesTrigger(new Set(['Alt']), 'none')).toBe(false)
  })

  it('triggerLabel handles none and modifier pairs', () => {
    expect(triggerLabel('none', 'drag')).toBe('Drag')
    expect(triggerLabel('shift+ctrl', 'drag')).toBe('Shift+Ctrl+drag')
    expect(triggerLabel('meta', 'click')).toBe(IS_MAC ? 'Cmd+click' : 'Meta+click')
  })

  it('DEFAULT_KEYBINDINGS includes box_zoom and flag_select defaults', () => {
    expect(DEFAULT_KEYBINDINGS.box_zoom).toBe('shift+ctrl')
    expect(DEFAULT_KEYBINDINGS.flag_select).toBe('none')
  })

  it('GESTURES includes Box zoom and Flag select as drag gestures', () => {
    const boxZoom = GESTURES.find((g) => g.key === 'box_zoom')
    const flagSelect = GESTURES.find((g) => g.key === 'flag_select')
    expect(boxZoom).toMatchObject({ label: 'Box zoom', kind: 'drag' })
    expect(flagSelect).toMatchObject({ kind: 'drag' })
  })

  describe('canonical trigger grammar', () => {
    it.each([
      ['shift', 'drag', 'shift/left/drag'],
      ['none', 'drag', 'none/left/drag'],
      ['shift+ctrl', 'drag', 'shift+ctrl/left/drag'],
      ['meta', 'click', 'meta/left/click'],
      ['dblclick', 'click', 'none/left/dblclick'],
      ['shift+alt/right/drag', 'drag', 'shift+alt/right/drag'],
      ['ctrl+alt+meta/left/dblclick', 'click', 'ctrl+alt+meta/left/dblclick'],
      ['none/middle/click', 'click', 'none/middle/click'],
    ] as const)('canonicalTrigger(%s, %s) === %s', (value, kind, expected) => {
      expect(canonicalTrigger(value, kind)).toBe(expected)
    })

    it.each([
      ['ctrl+shift', 'drag'], // non-canonical order
      ['alt+shift/left/drag', 'drag'], // non-canonical order
      ['shift/top/drag', 'drag'], // bad button
      ['shift/left/hold', 'drag'], // bad action
      ['shift/left/click', 'drag'], // kind mismatch
      ['shift/left/drag', 'click'], // kind mismatch
      ['dblclick', 'drag'],
      ['none', 'click'], // legacy none is drag-only
      ['none/left/click', 'click'], // plain left click reserved for row selection
      ['shift+shift/left/drag', 'drag'],
      ['', 'drag'],
    ] as const)('parseTrigger(%s, %s) is null', (value, kind) => {
      expect(parseTrigger(value, kind)).toBeNull()
    })
  })

  describe('triggerLabel for canonical (button-aware) triggers', () => {
    it('keeps legacy labels byte-identical', () => {
      expect(triggerLabel('shift', 'drag')).toBe('Shift+drag')
      expect(triggerLabel('none', 'drag')).toBe('Drag')
      expect(triggerLabel('meta', 'click')).toBe(IS_MAC ? 'Cmd+click' : 'Meta+click')
      expect(triggerLabel('dblclick', 'click')).toBe('Double-click')
    })

    it('labels new mods/button/action triggers', () => {
      expect(triggerLabel('shift+alt/right/drag', 'drag')).toBe(`Shift+${IS_MAC ? 'Option' : 'Alt'}+right-drag`)
      expect(triggerLabel('none/right/click', 'click')).toBe('Right-click')
      expect(triggerLabel('none/middle/drag', 'drag')).toBe('Middle-drag')
      expect(triggerLabel('shift/left/dblclick', 'click')).toBe('Shift+double-click')
      expect(triggerLabel('none/middle/dblclick', 'click')).toBe('Middle double-click')
    })
  })

  describe('matchesPointer', () => {
    it('checks button, exact modifiers, and action', () => {
      const e = { button: 2, shiftKey: true, altKey: true, ctrlKey: false, metaKey: false }
      expect(matchesPointer(e, 'shift+alt/right/drag', 'drag', 'drag')).toBe(true)
      expect(matchesPointer({ ...e, button: 0 }, 'shift+alt/right/drag', 'drag', 'drag')).toBe(false)
      expect(matchesPointer({ ...e, ctrlKey: true }, 'shift+alt/right/drag', 'drag', 'drag')).toBe(false)
    })

    it('matches a legacy left-button trigger', () => {
      expect(
        matchesPointer({ button: 0, shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }, 'shift', 'drag', 'drag')
      ).toBe(true)
    })
  })

  describe('findConflict for canonical triggers', () => {
    it('treats a legacy token and its canonical twin as the same binding', () => {
      const bindings = { ...DEFAULT_KEYBINDINGS, x_zoom: 'shift', box_zoom: 'shift/left/drag' }
      expect(findConflict(bindings)).not.toBeNull()
    })

    it('rejects a click gesture sharing keys and button with a drag gesture', () => {
      const bindings = { ...DEFAULT_KEYBINDINGS, undo: 'shift/left/click', x_zoom: 'shift' }
      expect(findConflict(bindings)).not.toBeNull()
    })

    it('rejects undo/redo as the click and double-click of the same keys and button', () => {
      const bindings = { ...DEFAULT_KEYBINDINGS, undo: 'alt/right/click', redo: 'alt/right/dblclick' }
      expect(findConflict(bindings)).not.toBeNull()
    })

    it('returns null for the defaults', () => {
      expect(findConflict(DEFAULT_KEYBINDINGS)).toBeNull()
    })

    it('returns null for a valid right/middle mix', () => {
      const bindings = { ...DEFAULT_KEYBINDINGS, x_zoom: 'none/right/drag', y_zoom: 'none/middle/drag' }
      expect(findConflict(bindings)).toBeNull()
    })
  })
})
