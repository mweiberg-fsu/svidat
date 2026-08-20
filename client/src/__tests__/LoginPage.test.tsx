import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from '../pages/LoginPage'
import { AuthProvider } from '../context/AuthContext'
import * as client from '../api/client'
import * as microsoftSignIn from '../auth/microsoftSignIn'

vi.mock('../auth/googleSignIn')
vi.mock('../auth/microsoftSignIn')

function renderLoginPage() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('LoginPage OAuth buttons', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-google-client')
    vi.stubEnv('VITE_MS_CLIENT_ID', 'test-ms-client')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('signs in via Microsoft and navigates on success', async () => {
    vi.spyOn(microsoftSignIn, 'signInWithMicrosoft').mockResolvedValue('ms-id-token')
    vi.spyOn(client, 'loginWithMicrosoft').mockResolvedValue({
      access_token: 'tok',
      token_type: 'bearer',
      role: 'user',
    })
    vi.spyOn(client, 'getCurrentUser').mockResolvedValue({ id: 1, username: 'a@b.com', role: 'user' })

    renderLoginPage()
    fireEvent.click(screen.getByText('Sign in with Microsoft'))

    await waitFor(() => expect(client.loginWithMicrosoft).toHaveBeenCalledWith('ms-id-token'))
  })

  it('shows a domain-specific error banner on a 403 from OAuth login', async () => {
    vi.spyOn(microsoftSignIn, 'signInWithMicrosoft').mockResolvedValue('ms-id-token')
    vi.spyOn(client, 'loginWithMicrosoft').mockRejectedValue(new Error('403: domain not allowed'))

    renderLoginPage()
    fireEvent.click(screen.getByText('Sign in with Microsoft'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/domain/i)
  })

  it('shows a generic error banner on a 401 from OAuth login', async () => {
    vi.spyOn(microsoftSignIn, 'signInWithMicrosoft').mockResolvedValue('ms-id-token')
    vi.spyOn(client, 'loginWithMicrosoft').mockRejectedValue(new Error('401: invalid token'))

    renderLoginPage()
    fireEvent.click(screen.getByText('Sign in with Microsoft'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign-in failed/i)
  })

  it('does not render OAuth buttons when client IDs are not configured', () => {
    vi.unstubAllEnvs()
    renderLoginPage()
    expect(screen.queryByText('Sign in with Microsoft')).not.toBeInTheDocument()
  })
})
