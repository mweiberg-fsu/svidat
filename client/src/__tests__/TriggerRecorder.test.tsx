import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TriggerRecorder } from '../components/TriggerRecorder'

function setup(value: string | null = null) {
  const onChange = vi.fn()
  render(<TriggerRecorder value={value} onChange={onChange} />)
  return { onChange, box: screen.getByRole('button', { name: /record keybind/i }) }
}

describe('TriggerRecorder', () => {
  it('records a click with held modifiers', () => {
    const { onChange, box } = setup()
    fireEvent.mouseDown(box, { button: 0, clientX: 10, clientY: 10, shiftKey: true, altKey: true })
    fireEvent.mouseUp(window, { button: 0, clientX: 11, clientY: 10, detail: 1 })
    expect(onChange).toHaveBeenCalledWith('shift+alt/left/click')
  })

  it('records a drag past 4px, even ending outside the box', () => {
    const { onChange, box } = setup()
    fireEvent.mouseDown(box, { button: 2, clientX: 10, clientY: 10, ctrlKey: true })
    fireEvent.mouseUp(window, { button: 2, clientX: 30, clientY: 10 })
    expect(onChange).toHaveBeenCalledWith('ctrl/right/drag')
  })

  it('records a double-click on any button', () => {
    const { onChange, box } = setup()
    fireEvent.mouseDown(box, { button: 1, clientX: 5, clientY: 5 })
    fireEvent.mouseUp(window, { button: 1, clientX: 5, clientY: 5, detail: 2 })
    expect(onChange).toHaveBeenLastCalledWith('none/middle/dblclick')
  })

  it('ignores a mouseup from a different button', () => {
    const { onChange, box } = setup()
    fireEvent.mouseDown(box, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.mouseUp(window, { button: 2, clientX: 0, clientY: 0 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('suppresses the context menu', () => {
    const { box } = setup()
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    box.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('shows the label of the current value and clears on Re-record', () => {
    const { onChange } = setup('shift/middle/drag')
    expect(screen.getByText('Shift+middle-drag')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Re-record' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
