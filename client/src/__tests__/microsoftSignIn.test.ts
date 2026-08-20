import { describe, expect, it, vi, beforeEach } from 'vitest'

const { loginPopup, initialize, PublicClientApplicationMock } = vi.hoisted(() => {
  const loginPopup = vi.fn()
  const initialize = vi.fn()
  // Must be a regular function, not an arrow function: the real implementation is invoked
  // with `new`, and arrow functions have no [[Construct]] internal method, so vi.fn()'s
  // Reflect.construct-based dispatch would throw "is not a constructor".
  const PublicClientApplicationMock = vi.fn().mockImplementation(function () {
    return { initialize, loginPopup }
  })
  return { loginPopup, initialize, PublicClientApplicationMock }
})

vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: PublicClientApplicationMock,
}))

import type { signInWithMicrosoft as SignInWithMicrosoft } from '../auth/microsoftSignIn'

describe('signInWithMicrosoft', () => {
  let signInWithMicrosoft: typeof SignInWithMicrosoft

  beforeEach(async () => {
    loginPopup.mockReset()
    initialize.mockReset()
    PublicClientApplicationMock.mockClear()
    // microsoftSignIn.ts caches its PublicClientApplication instance and in-flight
    // initialize() promise at module scope (see comments in that file). Reset the module
    // registry so each test gets fresh singleton state instead of leaking across tests.
    vi.resetModules()
    ;({ signInWithMicrosoft } = await import('../auth/microsoftSignIn'))
  })

  it('returns the id token from a successful popup login', async () => {
    initialize.mockResolvedValue(undefined)
    loginPopup.mockResolvedValue({ idToken: 'ms-id-token' })

    const token = await signInWithMicrosoft('client-id')

    expect(token).toBe('ms-id-token')
    expect(loginPopup).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: expect.arrayContaining(['openid', 'email']) })
    )
  })

  it('throws when no id token is returned', async () => {
    initialize.mockResolvedValue(undefined)
    loginPopup.mockResolvedValue({ idToken: '' })

    await expect(signInWithMicrosoft('client-id')).rejects.toThrow('id token')
  })

  it('reuses the same instance and only initializes once for concurrent calls', async () => {
    // Mirrors the concurrent-call regression covered for googleSignIn.ts: e.g. React
    // StrictMode double-invoking an effect before the first call has resolved should not
    // construct a second PublicClientApplication, call initialize() twice, or open two popups.
    initialize.mockResolvedValue(undefined)
    loginPopup
      .mockResolvedValueOnce({ idToken: 'first-token' })
      .mockResolvedValueOnce({ idToken: 'second-token' })

    const [first, second] = await Promise.all([
      signInWithMicrosoft('client-id'),
      signInWithMicrosoft('client-id'),
    ])

    expect(first).toBe('first-token')
    expect(second).toBe('second-token')
    expect(PublicClientApplicationMock).toHaveBeenCalledTimes(1)
    expect(initialize).toHaveBeenCalledTimes(1)
  })
})
