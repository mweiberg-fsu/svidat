import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAvatar } from '../hooks/useAvatar'
import * as apiClient from '../api/client'

describe('useAvatar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when id is null', () => {
    const fetchSpy = vi.spyOn(apiClient, 'fetchAvatarBlobUrl')
    const { result } = renderHook(() => useAvatar(null, 0))
    expect(result.current).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches and returns the avatar URL for a given id', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue('blob:fake-url')
    const { result } = renderHook(() => useAvatar(1, 0))
    await waitFor(() => expect(result.current).toBe('blob:fake-url'))
  })

  it('refetches when avatarVersion changes', async () => {
    const fetchSpy = vi
      .spyOn(apiClient, 'fetchAvatarBlobUrl')
      .mockResolvedValueOnce('blob:v0')
      .mockResolvedValueOnce('blob:v1')

    const { result, rerender } = renderHook(({ version }) => useAvatar(1, version), {
      initialProps: { version: 0 },
    })
    await waitFor(() => expect(result.current).toBe('blob:v0'))

    rerender({ version: 1 })
    await waitFor(() => expect(result.current).toBe('blob:v1'))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
