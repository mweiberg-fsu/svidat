import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setToken, getToken, apiFetch } from '../api/client'

describe('apiClient', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('stores and retrieves the auth token', () => {
    setToken('abc123')
    expect(getToken()).toBe('abc123')
  })

  it('attaches Authorization header when a token is present', async () => {
    setToken('abc123')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/health')

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer abc123')
  })

  it('omits Authorization header when no token is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/health')

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBeUndefined()
  })
})
