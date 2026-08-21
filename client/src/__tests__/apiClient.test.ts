import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setToken, getToken, apiFetch } from '../api/client'
import {
  getOAuthSettings,
  loginWithGoogle,
  loginWithMicrosoft,
  updateOAuthSettings,
  createUser,
  updateUserRoles,
} from '../api/client'

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

describe('oauth client functions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('loginWithGoogle posts the id token and returns the parsed response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 't', token_type: 'bearer', roles: [] }), {
          status: 200,
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await loginWithGoogle('idtok')

    expect(result.roles).toEqual([])
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/auth/oauth/google')
    expect(JSON.parse(options.body)).toEqual({ id_token: 'idtok' })
  })

  it('loginWithGoogle throws a status-prefixed error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })))
    await expect(loginWithGoogle('idtok')).rejects.toThrow('403:')
  })

  it('loginWithMicrosoft posts the id token and returns the parsed response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 't', token_type: 'bearer', roles: [] }), {
          status: 200,
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await loginWithMicrosoft('idtok')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/auth/oauth/microsoft')
    expect(JSON.parse(options.body)).toEqual({ id_token: 'idtok' })
  })

  it('getOAuthSettings and updateOAuthSettings hit the admin endpoint', async () => {
    setToken('abc123')
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ allowed_domains: ['fsu.edu'] }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)

    const got = await getOAuthSettings()
    expect(got.allowed_domains).toEqual(['fsu.edu'])

    await updateOAuthSettings(['fsu.edu', 'noaa.gov'])
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toContain('/admin/oauth-settings')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body)).toEqual({ allowed_domains: ['fsu.edu', 'noaa.gov'] })
  })
})

describe('user-management client functions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('createUser posts a roles array', async () => {
    setToken('abc123')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 1, username: 'x', roles: ['qca'] }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await createUser('x', 'pw', ['qca'])

    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ username: 'x', password: 'pw', roles: ['qca'] })
  })

  it('updateUserRoles PATCHes the roles endpoint', async () => {
    setToken('abc123')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 5, username: 'y', roles: ['admin', 'qca'] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await updateUserRoles(5, ['admin', 'qca'])

    expect(result.roles).toEqual(['admin', 'qca'])
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/users/5/roles')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ roles: ['admin', 'qca'] })
  })
})
