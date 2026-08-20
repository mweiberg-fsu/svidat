import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderGoogleButton } from '../auth/googleSignIn'

describe('renderGoogleButton', () => {
  beforeEach(() => {
    delete window.google
  })

  it('initializes and renders using an already-loaded SDK, and forwards the token', async () => {
    const initialize = vi.fn()
    const renderButton = vi.fn()
    window.google = { accounts: { id: { initialize, renderButton } } }

    const container = document.createElement('div')
    const onToken = vi.fn()
    await renderGoogleButton(container, { clientId: 'cid-123', onToken, onError: vi.fn() })

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'cid-123' }))
    expect(renderButton).toHaveBeenCalledWith(container, expect.any(Object))

    const callback = initialize.mock.calls[0][0].callback
    callback({ credential: 'signed-id-token' })
    expect(onToken).toHaveBeenCalledWith('signed-id-token')
  })

  it('calls onError when the SDK script fails to load', async () => {
    const script = document.createElement('script')
    vi.spyOn(document, 'createElement').mockReturnValue(script)
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      queueMicrotask(() => script.dispatchEvent(new Event('error')))
      return node
    })

    const onError = vi.fn()
    await renderGoogleButton(document.createElement('div'), {
      clientId: 'cid-123',
      onToken: vi.fn(),
      onError,
    })

    expect(onError).toHaveBeenCalledWith('Google sign-in unavailable')
  })
})
