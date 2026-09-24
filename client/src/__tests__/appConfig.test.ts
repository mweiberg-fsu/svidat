import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYBINDINGS, fillPlaceholders, hasModifier, triggerLabel } from '../appConfig'

const noMods = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }

describe('appConfig helpers', () => {
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

  it('matches a mouse event against a trigger', () => {
    expect(hasModifier({ ...noMods, altKey: true }, 'alt')).toBe(true)
    expect(hasModifier({ ...noMods, altKey: true }, 'shift')).toBe(false)
    expect(hasModifier({ ...noMods, shiftKey: true }, 'dblclick')).toBe(false)
  })
})
