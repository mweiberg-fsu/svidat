import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuditHistoryModal } from '../components/AuditHistoryModal'
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
import { EditSessionProvider } from '../context/EditSessionContext'
import { AuthProvider } from '../context/AuthContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'
import type { AuditEntry } from '../api/types'

const entries: AuditEntry[] = [
  {
    id: 1,
    filename: 'shipx_2026-08-01',
    user_id: 1,
    username: 'testuser',
    action: 'point_edit',
    var_name: 'temperature',
    old_value: 10,
    new_value: 12,
    reverted: false,
    timestamp: '2026-08-03T14:02:00',
  },
  {
    id: 2,
    filename: 'shipx_2026-07-30',
    user_id: 1,
    username: 'testuser',
    action: 'bulk_edit',
    var_name: 'salinity',
    old_value: null,
    new_value: null,
    reverted: true,
    timestamp: '2026-08-02T09:11:00',
  },
  {
    id: 3,
    filename: 'shipx_2026-08-27',
    user_id: 1,
    username: 'testuser',
    action: 'flag_edit',
    var_name: 'temperature',
    old_value: null,
    new_value: 'K',
    reverted: false,
    timestamp: '2026-08-04T10:00:00',
  },
]

// AuditHistoryModal calls notifyFlagged() on a successful revert, which
// requires EditSessionContext (and its own PlotSelectionContext/AuthContext
// dependencies) in the tree — same wrapper shape as FlagsPanel's tests.
function renderModal(onClose = vi.fn()) {
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(['qca']))
  localStorage.setItem('svidat_username', 'testuser')
  const utils = render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <AuditHistoryModal onClose={onClose} />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
  return { ...utils, onClose }
}

describe('AuditHistoryModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches and lists the current user's audit entries with filename links", async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    renderModal()

    await waitFor(() => expect(screen.getByText('shipx_2026-08-01')).toBeInTheDocument())
    expect(screen.getByText('shipx_2026-08-01').closest('a')).toHaveAttribute(
      'href',
      '/files?file=shipx_2026-08-01'
    )
    expect(screen.getByText('shipx_2026-07-30')).toBeInTheDocument()
  })

  it('shows Revert for a non-reverted point_edit and Reverted for an already-reverted entry', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    renderModal()

    await waitFor(() => expect(screen.getAllByText('Revert')[0]).toBeInTheDocument())
    expect(screen.getByText('Reverted')).toBeInTheDocument()
  })

  it('shows Revert for a non-reverted flag_edit entry', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    renderModal()

    await waitFor(() => expect(screen.getAllByText('Revert')).toHaveLength(2))
  })

  it('shows an empty-state message when there are no entries', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    renderModal()

    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())
  })

  it('reverts an entry and refetches on success', async () => {
    const getSpy = vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    const revertSpy = vi
      .spyOn(apiClient, 'revertAuditEntry')
      .mockResolvedValue({ status: 'reverted' })
    renderModal()
    await waitFor(() => expect(screen.getAllByText('Revert')[0]).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Revert')[0])

    await waitFor(() => expect(revertSpy).toHaveBeenCalledWith(1))
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2))
  })

  it('shows an inline error when revert fails', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    vi.spyOn(apiClient, 'revertAuditEntry').mockRejectedValue(
      new Error('409: no active edit lock for this file')
    )
    renderModal()
    await waitFor(() => expect(screen.getAllByText('Revert')[0]).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Revert')[0])

    await waitFor(() =>
      expect(
        screen.getByText('Error: 409: no active edit lock for this file')
      ).toBeInTheDocument()
    )
  })

  it('calls onClose when the close button is clicked', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    const { onClose } = renderModal()
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('drags to a new position via the header', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    const { container } = renderModal()
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    const modal = container.querySelector('.audit-history-modal') as HTMLElement
    const header = container.querySelector('.audit-history-modal-header') as HTMLElement
    const startTop = parseFloat(modal.style.top)
    const startLeft = parseFloat(modal.style.left)

    fireEvent.mouseDown(header, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 130 })
    fireEvent.mouseUp(window, { clientX: 150, clientY: 130 })

    expect(parseFloat(modal.style.left)).toBeCloseTo(startLeft + 50, 1)
    expect(parseFloat(modal.style.top)).toBeCloseTo(startTop + 30, 1)
  })

  it('clamps drag position so the modal cannot be dragged fully off-screen', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    const { container } = renderModal()
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    const modal = container.querySelector('.audit-history-modal') as HTMLElement
    const header = container.querySelector('.audit-history-modal-header') as HTMLElement

    // Drag far up-and-left — clamps to the top-left edge (0, 0).
    fireEvent.mouseDown(header, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: -5000, clientY: -5000 })
    fireEvent.mouseUp(window, { clientX: -5000, clientY: -5000 })

    expect(parseFloat(modal.style.left)).toBe(0)
    expect(parseFloat(modal.style.top)).toBe(0)

    // Drag far down-and-right — clamps to (innerWidth - 40, innerHeight - 40).
    fireEvent.mouseDown(header, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 9000, clientY: 9000 })
    fireEvent.mouseUp(window, { clientX: 9000, clientY: 9000 })

    expect(parseFloat(modal.style.left)).toBe(window.innerWidth - 40)
    expect(parseFloat(modal.style.top)).toBe(window.innerHeight - 40)
  })

  it('does not move once the drag ends (mouseup detaches the listeners)', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    const { container } = renderModal()
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    const modal = container.querySelector('.audit-history-modal') as HTMLElement
    const header = container.querySelector('.audit-history-modal-header') as HTMLElement

    fireEvent.mouseDown(header, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 130 })
    fireEvent.mouseUp(window, { clientX: 150, clientY: 130 })
    const afterFirstDrag = { top: modal.style.top, left: modal.style.left }

    fireEvent.mouseMove(window, { clientX: 999, clientY: 999 })

    expect(modal.style.top).toBe(afterFirstDrag.top)
    expect(modal.style.left).toBe(afterFirstDrag.left)
  })

  it('resizes via the corner handle, clamped to a minimum size', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    const { container } = renderModal()
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    const modal = container.querySelector('.audit-history-modal') as HTMLElement
    const handle = container.querySelector('.audit-history-modal-resize-handle') as HTMLElement
    const startWidth = parseFloat(modal.style.width)
    const startHeight = parseFloat(modal.style.height)

    fireEvent.mouseDown(handle, { clientX: 500, clientY: 400 })
    fireEvent.mouseMove(window, { clientX: 560, clientY: 440 })
    fireEvent.mouseUp(window, { clientX: 560, clientY: 440 })

    expect(parseFloat(modal.style.width)).toBeCloseTo(startWidth + 60, 1)
    expect(parseFloat(modal.style.height)).toBeCloseTo(startHeight + 40, 1)

    // Shrinking past the minimum clamps rather than going smaller.
    fireEvent.mouseDown(handle, { clientX: 560, clientY: 440 })
    fireEvent.mouseMove(window, { clientX: -2000, clientY: -2000 })
    fireEvent.mouseUp(window, { clientX: -2000, clientY: -2000 })

    expect(parseFloat(modal.style.width)).toBe(360)
    expect(parseFloat(modal.style.height)).toBe(240)
  })
})
