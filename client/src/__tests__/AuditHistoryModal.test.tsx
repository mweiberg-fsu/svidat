import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuditHistoryModal } from '../components/AuditHistoryModal'
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
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
    filename: 'shipx_2026-08-01',
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
    filename: 'shipx_2026-08-01',
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

// Opens an edit session from inside the provider tree — AuditHistoryModal
// scopes its fetch to sessionOpenedAt once one is open, same as AuditPanel.
function Driver() {
  const { openSession } = useEditSession()
  return (
    <button onClick={() => openSession()}>open session</button>
  )
}

// AuditHistoryModal calls notifyFlagged() on a successful revert, which
// requires EditSessionContext (and its own PlotSelectionContext/AuthContext
// dependencies) in the tree — same wrapper shape as FlagsPanel's tests.
// `route` puts a file (and optionally other params) in the URL, since
// PlotSelectionContext derives `file` from search params.
function renderModal(route = '/', onClose = vi.fn()) {
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(['qca']))
  localStorage.setItem('svidat_username', 'testuser')
  const utils = render(
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Driver />
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

  it('shows a prompt and does not fetch when no file is selected', async () => {
    const historySpy = vi.spyOn(apiClient, 'getAuditHistory')
    renderModal('/')

    expect(
      screen.getByText('Select a file to view its audit history.')
    ).toBeInTheDocument()
    expect(historySpy).not.toHaveBeenCalled()
  })

  it('fetches entries scoped to the selected file with no session filter when no session is open', async () => {
    const historySpy = vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)
    renderModal('/files?file=shipx_2026-08-01')

    await waitFor(() =>
      expect(historySpy).toHaveBeenCalledWith('shipx_2026-08-01', undefined)
    )
    expect(screen.getByText(/salinity/)).toBeInTheDocument()
  })

  it('fetches entries scoped to the session once one is open', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({
      temp_path: '/tmp/x',
      acquired_at: '2026-09-14T10:00:00',
      session_started_at: '2026-09-14T10:00:00',
    })
    const historySpy = vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)
    renderModal('/files?file=shipx_2026-08-01')
    await waitFor(() =>
      expect(historySpy).toHaveBeenCalledWith('shipx_2026-08-01', undefined)
    )

    fireEvent.click(screen.getByText('open session'))

    await waitFor(() =>
      expect(historySpy).toHaveBeenCalledWith('shipx_2026-08-01', '2026-09-14T10:00:00')
    )
  })

  it('no longer shows a filename link on each row (scope is implied by the single active file)', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)
    renderModal('/files?file=shipx_2026-08-01')

    await waitFor(() => expect(screen.getByText(/salinity/)).toBeInTheDocument())
    expect(screen.queryByText('shipx_2026-08-01')).not.toBeInTheDocument()
  })

  it('shows Revert for a non-reverted point_edit and Reverted for an already-reverted entry', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)
    renderModal('/files?file=shipx_2026-08-01')

    await waitFor(() => expect(screen.getAllByText('Revert')[0]).toBeInTheDocument())
    expect(screen.getByText('Reverted')).toBeInTheDocument()
  })

  it('shows Revert for a non-reverted flag_edit entry', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)
    renderModal('/files?file=shipx_2026-08-01')

    await waitFor(() => expect(screen.getAllByText('Revert')).toHaveLength(2))
  })

  it('shows an empty-state message when a file is selected but has no entries', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([])
    renderModal('/files?file=shipx_2026-08-01')

    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())
  })

  it('reverts an entry and refetches on success', async () => {
    const getSpy = vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)
    const revertSpy = vi
      .spyOn(apiClient, 'revertAuditEntry')
      .mockResolvedValue({ status: 'reverted' })
    renderModal('/files?file=shipx_2026-08-01')
    await waitFor(() => expect(screen.getAllByText('Revert')[0]).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Revert')[0])

    await waitFor(() => expect(revertSpy).toHaveBeenCalledWith(1))
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2))
  })

  it('shows an inline error when revert fails', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)
    vi.spyOn(apiClient, 'revertAuditEntry').mockRejectedValue(
      new Error('409: no active edit lock for this file')
    )
    renderModal('/files?file=shipx_2026-08-01')
    await waitFor(() => expect(screen.getAllByText('Revert')[0]).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Revert')[0])

    await waitFor(() =>
      expect(
        screen.getByText('Error: 409: no active edit lock for this file')
      ).toBeInTheDocument()
    )
  })

  it('calls onClose when the close button is clicked', async () => {
    const { onClose } = renderModal('/')

    fireEvent.click(screen.getByLabelText('Close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('drags to a new position via the header', async () => {
    const { container } = renderModal('/')

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
    const { container } = renderModal('/')

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
    const { container } = renderModal('/')

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
    const { container } = renderModal('/')

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
