import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentationModal } from '../components/DocumentationModal'

describe('DocumentationModal', () => {
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
