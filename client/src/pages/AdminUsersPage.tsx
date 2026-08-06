import { useEffect, useState } from 'react'
import { createUser, deleteUser, listUsers } from '../api/client'

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

  const refresh = () => {
    listUsers()
      .then(setUsers)
      .catch((err) => {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  useEffect(refresh, [])

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
    </div>
  )
}
