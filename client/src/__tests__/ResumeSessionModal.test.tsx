import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResumeSessionModal } from '../components/ResumeSessionModal'
import type { TempSessionEntry } from '../api/types'

const entries: TempSessionEntry[] = [
  {
    filename: 'shipx_2026-08-01',
    created_at: '2026-08-01T10:00:00',
    last_edited_at: '2026-08-01T10:05:00',
  },
  {
    filename: 'shipx_2026-08-02',
    created_at: '2026-08-02T09:00:00',
    last_edited_at: null,
  },
]

describe('ResumeSessionModal', () => {
  it('renders one row per entry with its filename', () => {
    render(<ResumeSessionModal entries={entries} onContinue={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.getByText(/shipx_2026-08-01/)).toBeInTheDocument()
    expect(screen.getByText(/shipx_2026-08-02/)).toBeInTheDocument()
  })

  it('calls onContinue with the filename when Continue is clicked', () => {
    const onContinue = vi.fn()
    render(<ResumeSessionModal entries={entries} onContinue={onContinue} onDiscard={vi.fn()} />)
    fireEvent.click(screen.getAllByText('Continue')[0])
    expect(onContinue).toHaveBeenCalledWith('shipx_2026-08-01')
  })

  it('calls onDiscard with the filename when Discard is clicked', () => {
    const onDiscard = vi.fn()
    render(<ResumeSessionModal entries={entries} onContinue={vi.fn()} onDiscard={onDiscard} />)
    fireEvent.click(screen.getAllByText('Discard')[1])
    expect(onDiscard).toHaveBeenCalledWith('shipx_2026-08-02')
  })

  it('falls back to created_at when last_edited_at is null', () => {
    render(<ResumeSessionModal entries={[entries[1]]} onContinue={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.getByText(/2026-08-02T09:00:00/)).toBeInTheDocument()
  })
})
