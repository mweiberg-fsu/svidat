import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { KeybindingsFields } from '../components/KeybindingsFields'
import { DEFAULT_KEYBINDINGS, modifierName } from '../appConfig'

const SHARED = [
  { name: 'Pan', trigger: 'none/middle/drag' },
  { name: 'Quick undo', trigger: 'alt/right/click' },
  { name: 'Shift dup', trigger: 'shift/left/drag' }, // same as built-in "shift"
]
const MINE = [{ name: 'Pan again', trigger: 'none/middle/drag' }] // dup of shared

function select(label: string) {
  return screen.getByRole('combobox', { name: label })
}

describe('KeybindingsFields custom groups', () => {
  it('renders built-in plus a group per non-empty custom list, filtered by kind and deduped', () => {
    render(
      <KeybindingsFields
        value={DEFAULT_KEYBINDINGS}
        onChange={vi.fn()}
        customGroups={[
          { label: 'Shared', triggers: SHARED },
          { label: 'Mine', triggers: MINE },
        ]}
      />
    )
    const xZoom = select('Zoom X axis')
    const groups = xZoom.querySelectorAll('optgroup')
    expect([...groups].map((g) => g.label)).toEqual(['Built-in', 'Shared']) // Mine emptied by dedup
    expect(within(groups[1] as HTMLElement).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Pan — Middle-drag',
    ])
    const undo = select('Undo zoom')
    expect(within(undo).getByRole('option', { name: /Quick undo/ })).toHaveValue('alt/right/click')
    expect(within(undo).queryByRole('option', { name: /Pan/ })).toBeNull()
  })

  it('selects a matching option on canonical form without a fallback duplicate', () => {
    render(
      <KeybindingsFields value={{ ...DEFAULT_KEYBINDINGS, x_zoom: 'shift/left/drag' }} onChange={vi.fn()} />
    )
    const xZoom = select('Zoom X axis') as HTMLSelectElement
    expect(xZoom.value).toBe('shift')
    expect(within(xZoom).getAllByRole('option', { name: 'Shift+drag' })).toHaveLength(1)
  })

  it('shows a labelled fallback for a value no option matches (e.g. a deleted custom trigger)', () => {
    render(
      <KeybindingsFields value={{ ...DEFAULT_KEYBINDINGS, y_zoom: 'alt/right/drag' }} onChange={vi.fn()} />
    )
    const yZoom = select('Zoom Y axis') as HTMLSelectElement
    expect(yZoom.value).toBe('alt/right/drag')
    expect(within(yZoom).getByRole('option', { name: `${modifierName('alt')}+right-drag` })).toBeInTheDocument()
  })

  it('selects a custom trigger option when the value equals it, with no fallback duplicate', () => {
    render(
      <KeybindingsFields
        value={{ ...DEFAULT_KEYBINDINGS, y_zoom: 'none/middle/drag' }}
        onChange={vi.fn()}
        customGroups={[{ label: 'Shared', triggers: [{ name: 'Pan', trigger: 'none/middle/drag' }] }]}
      />
    )
    const yZoom = select('Zoom Y axis') as HTMLSelectElement
    expect(yZoom.value).toBe('none/middle/drag')
    expect([...yZoom.options].filter((o) => o.value === 'none/middle/drag')).toHaveLength(1)
  })
})
