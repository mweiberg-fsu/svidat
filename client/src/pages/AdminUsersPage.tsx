import { useEffect, useState } from 'react'
import {
  createUser,
  deleteUser,
  getOAuthSettings,
  listUsers,
  updateOAuthSettings,
} from '../api/client'

interface UserRow {
  id: number
  username: string
  role: string
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [status, setStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [allowedDomains, setAllowedDomains] = useState<string[]>([])
  const [domainInput, setDomainInput] = useState('')
  const [oauthStatus, setOauthStatus] = useState<string | null>(null)
  const [oauthSubmitting, setOauthSubmitting] = useState(false)

  const refresh = () => {
    listUsers()
      .then(setUsers)
      .catch((err) => {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  useEffect(refresh, [])

  useEffect(() => {
    getOAuthSettings()
      .then((s) => setAllowedDomains(s.allowed_domains))
      .catch((err) => {
        setOauthStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }, [])

  const handleCreate = async () => {
    setSubmitting(true)
    try {
      await createUser(username, password, role)
      setUsername('')
      setPassword('')
      setStatus('User created')
      refresh()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    setSubmitting(true)
    try {
      await deleteUser(id)
      setStatus('User deleted')
      refresh()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const saveDomains = async (next: string[]) => {
    setOauthStatus(null)
    setOauthSubmitting(true)
    try {
      const saved = await updateOAuthSettings(next)
      setAllowedDomains(saved.allowed_domains)
      setOauthStatus('Domain list updated')
    } catch (err) {
      setOauthStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setOauthSubmitting(false)
    }
  }

  const handleAddDomain = () => {
    const domain = domainInput.trim().toLowerCase()
    if (!domain) return
    setDomainInput('')
    saveDomains([...new Set([...allowedDomains, domain])])
  }

  const handleRemoveDomain = (domain: string) => {
    saveDomains(allowedDomains.filter((d) => d !== domain))
  }

  return (
    <div>
      <h1>Users</h1>
      <ul>
        {users.map((u) => (
          <li key={u.id}>
            {u.username} ({u.role})
            <button onClick={() => handleDelete(u.id)} disabled={submitting}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      <h2>Add user</h2>
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
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="user">user</option>
          <option value="qca">qca</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <button onClick={handleCreate} disabled={submitting}>
        Create user
      </button>

      {status && <p role="status">{status}</p>}

      <h2>OAuth allowed email domains</h2>
      <p>Empty list = any Google/Microsoft account may sign in and auto-create an account.</p>
      <ul>
        {allowedDomains.map((d) => (
          <li key={d}>
            {d}
            <button onClick={() => handleRemoveDomain(d)} disabled={oauthSubmitting}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <label>
        New domain
        <input
          value={domainInput}
          onChange={(e) => setDomainInput(e.target.value)}
          placeholder="fsu.edu"
          disabled={oauthSubmitting}
        />
      </label>
      <button onClick={handleAddDomain} disabled={oauthSubmitting}>
        Add domain
      </button>

      {oauthStatus && <p role="status">{oauthStatus}</p>}
    </div>
  )
}
