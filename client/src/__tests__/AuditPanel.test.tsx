import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuditPanel } from '../components/AuditPanel'
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
import { EditSessionProvider } from '../context/EditSessionContext'
import { AuthProvider } from '../context/AuthContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'
import type { AuditEntry } from '../api/types'

// AuditPanel calls notifyFlagged() on a successful revert, which requires
// EditSessionContext (and its own PlotSelectionContext/AuthContext
// dependencies) in the tree — same wrapper shape as FlagsPanel's tests.
function wrapPanel(filename: string, refreshSignal: number) {
  return (
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <AuditPanel filename={filename} refreshSignal={refreshSignal} />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

function renderPanel(filename: string, refreshSignal: number) {
  setToken('tok')
  localStorage.setItem('svidat_role', 'qca')
  localStorage.setItem('svidat_username', 'testuser')
  return render(wrapPanel(filename, refreshSignal))
}

const entries: AuditEntry[] = [
  {
    id: 1,
    user_id: 1,
    username: 'audituser1',
    action: 'point_edit',
    var_name: 'temperature',
    old_value: 10,
    new_value: 42,
    reverted: false,
    timestamp: '2026-07-30T00:00:00',
  },
]

describe('AuditPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lists audit entries and reverts on click', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)
    const revertSpy = vi.spyOn(apiClient, 'revertAuditEntry').mockResolvedValue({ status: 'reverted' })

    renderPanel('shipx_2026-08-30', 0)

    await waitFor(() => expect(screen.getByText(/temperature/)).toBeInTheDocument())

    fireEvent.click(screen.getByText('Revert'))
    await waitFor(() => expect(revertSpy).toHaveBeenCalledWith(1))
  })

  it('disables revert button for already-reverted entries', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([{ ...entries[0], reverted: true }])

    renderPanel('shipx_2026-08-30', 0)

    await waitFor(() => expect(screen.getByText('Reverted')).toBeInTheDocument())
  })

  it('refetches audit history when refreshSignal changes', async () => {
    const historySpy = vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)

    const { rerender } = renderPanel('shipx_2026-08-30', 0)

    await waitFor(() => expect(historySpy).toHaveBeenCalledTimes(1))

    rerender(wrapPanel('shipx_2026-08-30', 1))

    await waitFor(() => expect(historySpy).toHaveBeenCalledTimes(2))
  })

  it('shows a Revert button for a non-reverted flag_edit entry', async () => {
    const flagEntry: AuditEntry = {
      id: 2,
      user_id: 1,
      username: 'audituser1',
      action: 'flag_edit',
      var_name: 'temperature',
      old_value: null,
      new_value: 'K',
      reverted: false,
      timestamp: '2026-08-04T10:00:00',
    }
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([flagEntry])

    renderPanel('shipx_2026-08-27', 0)

    await waitFor(() => expect(screen.getByText('Revert')).toBeInTheDocument())
  })
})
