import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditForm } from '../components/EditForm'
import * as apiClient from '../api/client'

describe('EditForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('submits a point edit with parsed indices and value', async () => {
    const pointEditSpy = vi
      .spyOn(apiClient, 'pointEdit')
      .mockResolvedValue({ audit_id: 1, old_value: 10, new_value: 42 })

    render(
      <EditForm filename="shipx_2026-08-30" variables={['temperature']} onChanged={() => {}} />
    )

    fireEvent.change(screen.getByLabelText('Indices (comma separated)'), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '42' } })
    fireEvent.click(screen.getByText('Apply point edit'))

    await waitFor(() =>
      expect(pointEditSpy).toHaveBeenCalledWith('shipx_2026-08-30', 'temperature', [1], 42)
    )
  })

  it('calls save and publish handlers', async () => {
    const saveSpy = vi.spyOn(apiClient, 'saveDraft').mockResolvedValue({ draft_path: 'x' })
    const publishSpy = vi.spyOn(apiClient, 'publishFile').mockResolvedValue({ published_path: 'y' })

    render(
      <EditForm filename="shipx_2026-08-31" variables={['temperature']} onChanged={() => {}} />
    )

    fireEvent.click(screen.getByText('Save draft (v250)'))
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith('shipx_2026-08-31'))

    fireEvent.click(screen.getByText('Publish (v300)'))
    await waitFor(() => expect(publishSpy).toHaveBeenCalledWith('shipx_2026-08-31'))
  })

  it('calls onChanged after a successful point edit', async () => {
    vi.spyOn(apiClient, 'pointEdit').mockResolvedValue({ audit_id: 1, old_value: 10, new_value: 42 })
    const onChanged = vi.fn()

    render(
      <EditForm filename="shipx_2026-08-30" variables={['temperature']} onChanged={onChanged} />
    )

    fireEvent.change(screen.getByLabelText('Indices (comma separated)'), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '42' } })
    fireEvent.click(screen.getByText('Apply point edit'))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })
})
