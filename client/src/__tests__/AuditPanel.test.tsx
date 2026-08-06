import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuditPanel } from '../components/AuditPanel'
import * as apiClient from '../api/client'
import type { AuditEntry } from '../api/types'

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

    render(<AuditPanel filename="shipx_2026-08-30" refreshSignal={0} />)

    await waitFor(() => expect(screen.getByText(/temperature/)).toBeInTheDocument())

    fireEvent.click(screen.getByText('Revert'))
    await waitFor(() => expect(revertSpy).toHaveBeenCalledWith(1))
  })

  it('disables revert button for already-reverted entries', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([{ ...entries[0], reverted: true }])

    render(<AuditPanel filename="shipx_2026-08-30" refreshSignal={0} />)

    await waitFor(() => expect(screen.getByText('Reverted')).toBeInTheDocument())
  })

  it('refetches audit history when refreshSignal changes', async () => {
    const historySpy = vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)

    const { rerender } = render(<AuditPanel filename="shipx_2026-08-30" refreshSignal={0} />)

    await waitFor(() => expect(historySpy).toHaveBeenCalledTimes(1))

    rerender(<AuditPanel filename="shipx_2026-08-30" refreshSignal={1} />)

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

    render(<AuditPanel filename="shipx_2026-08-27" refreshSignal={0} />)

    await waitFor(() => expect(screen.getByText('Revert')).toBeInTheDocument())
  })
})
