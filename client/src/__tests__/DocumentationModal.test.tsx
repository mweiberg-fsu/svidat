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

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<DocumentationModal onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('Close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
