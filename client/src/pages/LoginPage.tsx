import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentUser, login, setToken } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../api/types'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const auth = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const response = await login(username, password)
      setToken(response.access_token)
      const me = await getCurrentUser()
      auth.login(response.access_token, response.role as Role, me.username, me.id)
      navigate('/files')
    } catch {
      auth.logout()
      setError('Invalid username or password')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>svidat login</h1>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Log in</button>
    </form>
  )
}
