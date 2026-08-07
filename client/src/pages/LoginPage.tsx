import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentUser, login, setToken } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../api/types'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const auth = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const response = await login(username, password)
      setToken(response.access_token)
      const me = await getCurrentUser()
      auth.login(response.access_token, response.role as Role, me.username, me.id)
      navigate('/files')
    } catch {
      auth.logout()
      setError('Invalid username or password')
      setSubmitting(false)
    }
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
      </form>
    </div>
  )
}
