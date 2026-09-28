import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { DocumentationModal } from '../components/DocumentationModal'
import { DEFAULT_DOCUMENTATION, DEFAULT_KEYBINDINGS, applyConfig } from '../appConfig'

describe('DocumentationModal', () => {
  afterEach(() => {
    applyConfig({ keybindings: DEFAULT_KEYBINDINGS, documentation: DEFAULT_DOCUMENTATION })
  })

  it('shows admin-configured tabs and fills in the current keybindings', () => {
    render(<DocumentationModal onClose={vi.fn()} />)

    act(() =>
      applyConfig({
        keybindings: { ...DEFAULT_KEYBINDINGS, x_zoom: 'alt', y_zoom: 'shift' },
        documentation: [
          { title: 'Start', body: '## Welcome\n\n- **bold** item' },
          { title: 'Keys', body: 'Zoom X with {{x_zoom}}, Y with {{y_zoom}}.' },
        ],
      })
    )

    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Keys' }))
    expect(screen.getByText(/Zoom X with (Alt|Option)\+drag, Y with Shift\+drag\./)).toBeInTheDocument()
  })

  it('shows the Overview tab by default', () => {
    render(<DocumentationModal onClose={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/netCDF quality-control tool/)).toBeInTheDocument()
  })

  it('switches to the Workflow tab and shows its content', () => {
    render(<DocumentationModal onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }))

    expect(screen.getByRole('tab', { name: 'Workflow' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('File lifecycle')).toBeInTheDocument()
    expect(screen.queryByText(/netCDF quality-control tool/)).not.toBeInTheDocument()
  })

  it('switches to the Controls tab and shows its content', () => {
    render(<DocumentationModal onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Controls' }))

    expect(screen.getByRole('tab', { name: 'Controls' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Plot gestures')).toBeInTheDocument()
    expect(screen.getByText(/Shift\+drag/)).toBeInTheDocument()
  })

  it('moves by dragging the header', () => {
    render(<DocumentationModal onClose={() => {}} />)
    const m = document.querySelector<HTMLElement>('.documentation-modal')!
    const left = parseFloat(m.style.left)
    const top = parseFloat(m.style.top)
    fireEvent.mouseDown(screen.getByText('Documentation'), { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 130 })
    fireEvent.mouseUp(window)
    expect(parseFloat(m.style.left)).toBeCloseTo(left + 50, 1)
    expect(parseFloat(m.style.top)).toBeCloseTo(top + 30, 1)
  })

  it('resizes from the corner handle, not below its minimum size', () => {
    render(<DocumentationModal onClose={() => {}} />)
    const m = document.querySelector<HTMLElement>('.documentation-modal')!
    const width = parseFloat(m.style.width)
    const height = parseFloat(m.style.height)
    const handle = m.querySelector('.documentation-modal-resize-handle')!
    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 80, clientY: 40 })
    fireEvent.mouseUp(window)
    expect(parseFloat(m.style.width)).toBeCloseTo(width + 80, 1)
    expect(parseFloat(m.style.height)).toBeCloseTo(height + 40, 1)

    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: -5000, clientY: -5000 })
    fireEvent.mouseUp(window)
    expect(parseFloat(m.style.width)).toBeGreaterThanOrEqual(320)
    expect(parseFloat(m.style.height)).toBeGreaterThanOrEqual(240)
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<DocumentationModal onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('Close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
