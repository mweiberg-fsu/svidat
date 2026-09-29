import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import { KeybindsModal } from '../components/KeybindsModal'
import { DEFAULT_DOCUMENTATION, DEFAULT_KEYBINDINGS, applyConfig } from '../appConfig'

function modalEl(): HTMLElement {
  return document.querySelector('.keybinds-modal') as HTMLElement
}

describe('KeybindsModal', () => {
  afterEach(() => {
    act(() => applyConfig({ keybindings: DEFAULT_KEYBINDINGS, documentation: DEFAULT_DOCUMENTATION }))
  })

  it('lists the condensed plot and sidebar controls with the configured bindings', () => {
    render(<KeybindsModal onClose={() => {}} />)
    expect(screen.getByText('Keybinds')).toBeInTheDocument()
    const rows = within(screen.getByRole('table')).getAllByRole('row').map((r) => r.textContent)
    expect(rows).toEqual([
      'Click rowSet active variable',
      'DragSelect range (qca)',
      'Shift+dragZoom X axis',
      'Ctrl+dragZoom Y axis',
      'Shift+Ctrl+dragBox zoom',
      expect.stringMatching(/^(Cmd|Meta)\+clickRight-clickUndo zoom$/),
      'Double-clickShift+right-clickRedo zoom',
      'Drag right edgeResize sidebar',
    ])
  })

  it('puts each alternative key combo on its own line', () => {
    render(<KeybindsModal onClose={() => {}} />)
    const redoKeys = screen.getByText('Redo zoom').closest('tr')!.querySelector('th')!
    expect(Array.from(redoKeys.querySelectorAll('.keybinds-key')).map((k) => k.textContent)).toEqual([
      'Double-click',
      'Shift+right-click',
    ])
  })

  it('follows admin-configured keybindings', () => {
    render(<KeybindsModal onClose={() => {}} />)
    act(() =>
      applyConfig({
        keybindings: { ...DEFAULT_KEYBINDINGS, x_zoom: 'ctrl', y_zoom: 'shift' },
        documentation: DEFAULT_DOCUMENTATION,
      })
    )
    expect(screen.getByText('Ctrl+drag').closest('tr')).toHaveTextContent('Zoom X axis')
    expect(screen.getByText('Shift+drag').closest('tr')).toHaveTextContent('Zoom Y axis')
  })

  it('opens tall and narrow', () => {
    render(<KeybindsModal onClose={() => {}} />)
    const m = modalEl()
    expect(parseFloat(m.style.height)).toBeGreaterThan(parseFloat(m.style.width))
  })

  it('closes via the close button', () => {
    const onClose = vi.fn()
    render(<KeybindsModal onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('moves by dragging the header', () => {
    render(<KeybindsModal onClose={() => {}} />)
    const m = modalEl()
    const top = parseFloat(m.style.top)
    const left = parseFloat(m.style.left)
    fireEvent.mouseDown(screen.getByText('Keybinds'), { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 140, clientY: 120 })
    fireEvent.mouseUp(window)
    expect(parseFloat(m.style.left)).toBeCloseTo(left + 40, 1)
    expect(parseFloat(m.style.top)).toBeCloseTo(top + 20, 1)
  })

  it('several can be open: each new one opens offset and on top; clicking one raises it', () => {
    // Opened one after the other, as from separate sidebar clicks.
    const { rerender } = render(
      <>
        <KeybindsModal onClose={() => {}} />
      </>
    )
    rerender(
      <>
        <KeybindsModal onClose={() => {}} />
        <KeybindsModal onClose={() => {}} />
      </>
    )
    const [first, second] = Array.from(document.querySelectorAll<HTMLElement>('.keybinds-modal'))
    const z = (el: HTMLElement) => Number(el.style.zIndex)
    expect(z(second)).toBeGreaterThan(z(first))
    expect(parseFloat(second.style.left)).toBeCloseTo(parseFloat(first.style.left) + 24, 1)
    expect(parseFloat(second.style.top)).toBeCloseTo(parseFloat(first.style.top) + 24, 1)

    fireEvent.mouseDown(first.querySelector('.keybinds-modal-body')!)
    expect(z(first)).toBeGreaterThan(z(second))
  })

  it('starting a drag or resize does not start a text selection', () => {
    render(<KeybindsModal onClose={() => {}} />)
    const m = modalEl()
    // fireEvent returns false when the handler called preventDefault().
    expect(fireEvent.mouseDown(screen.getByText('Keybinds'), { clientX: 0, clientY: 0 })).toBe(false)
    fireEvent.mouseUp(window)
    const handle = m.querySelector('.keybinds-modal-resize-handle')!
    expect(fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })).toBe(false)
    fireEvent.mouseUp(window)
  })

  it('resizes from the corner handle, not below its minimum size', () => {
    render(<KeybindsModal onClose={() => {}} />)
    const m = modalEl()
    const width = parseFloat(m.style.width)
    const handle = m.querySelector('.keybinds-modal-resize-handle')!
    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 60, clientY: 40 })
    fireEvent.mouseUp(window)
    expect(parseFloat(m.style.width)).toBeCloseTo(width + 60, 1)

    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: -2000, clientY: -2000 })
    fireEvent.mouseUp(window)
    expect(parseFloat(m.style.width)).toBeGreaterThanOrEqual(200)
    expect(parseFloat(m.style.height)).toBeGreaterThanOrEqual(200)
  })
})
