import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getCurrentUser,
  login,
  loginWithGoogle,
  loginWithMicrosoft,
  setToken,
} from '../api/client'
import { useAuth } from '../context/AuthContext'
import { renderGoogleButton } from '../auth/googleSignIn'
import { signInWithMicrosoft } from '../auth/microsoftSignIn'
import type { LoginResponse } from '../api/types'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const auth = useAuth()
  const navigate = useNavigate()
  const googleButtonRef = useRef<HTMLDivElement>(null)

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  const microsoftClientId = import.meta.env.VITE_MS_CLIENT_ID as string | undefined

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return
    renderGoogleButton(googleButtonRef.current, {
      clientId: googleClientId,
      onToken: (idToken) => completeOAuthLogin(loginWithGoogle(idToken)),
      onError: (message) => setError(message),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId])

  const finishLogin = async (response: LoginResponse) => {
    setToken(response.access_token)
    const me = await getCurrentUser()
    auth.login(response.access_token, response.roles, me.username, me.id)
    navigate('/files')
  }

  const completeOAuthLogin = async (pending: Promise<LoginResponse>) => {
    setError(null)
    setSubmitting(true)
    try {
      const response = await pending
      await finishLogin(response)
    } catch (err) {
      auth.logout()
      const message = err instanceof Error ? err.message : String(err)
      setError(
        message.startsWith('403') ? "This email domain isn't authorized to sign in" : 'Sign-in failed'
      )
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const response = await login(username, password)
      await finishLogin(response)
    } catch {
      auth.logout()
      setError('Invalid username or password')
      setSubmitting(false)
    }
  }

  const handleMicrosoftSignIn = async () => {
    if (!microsoftClientId) return
    await completeOAuthLogin(signInWithMicrosoft(microsoftClientId).then(loginWithMicrosoft))
  }

  return (
    <div className="login-page">
      <div className="login-orb login-orb-a" aria-hidden="true" />
      <div className="login-orb login-orb-b" aria-hidden="true" />

      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">
          svi<span>dat</span>
        </div>
        <p className="login-subtitle">USER LOGIN</p>

        <label className="login-field">
          <span>Username</span>
          <input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button className="login-submit" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Log in'}
        </button>

        {(googleClientId || microsoftClientId) && (
          <div className="login-oauth">
            {googleClientId && <div ref={googleButtonRef} />}
            {microsoftClientId && (
              <button type="button" onClick={handleMicrosoftSignIn} disabled={submitting}>
                Sign in with Microsoft
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  )
}
