import { createContext, useContext, useState, type ReactNode } from 'react'
import { ID_KEY, ROLE_KEY, USERNAME_KEY, clearAuthStorage, getToken, setToken } from '../api/client'
import type { Role } from '../api/types'

interface AuthState {
  token: string | null
  roles: Role[]
  username: string | null
  id: number | null
  avatarVersion: number
  login: (token: string, roles: Role[], username: string, id: number) => void
  logout: () => void
  bumpAvatarVersion: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

function readStoredRoles(): Role[] {
  const raw = localStorage.getItem(ROLE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken())
  const [roles, setRoles] = useState<Role[]>(readStoredRoles())
  const [username, setUsername] = useState<string | null>(localStorage.getItem(USERNAME_KEY))
  const [id, setId] = useState<number | null>(() => {
    const stored = localStorage.getItem(ID_KEY)
    return stored ? parseInt(stored, 10) : null
  })
  const [avatarVersion, setAvatarVersion] = useState(0)

  const login = (newToken: string, newRoles: Role[], newUsername: string, newId: number) => {
    setToken(newToken)
    localStorage.setItem(ROLE_KEY, JSON.stringify(newRoles))
    localStorage.setItem(USERNAME_KEY, newUsername)
    localStorage.setItem(ID_KEY, String(newId))
    setTokenState(newToken)
    setRoles(newRoles)
    setUsername(newUsername)
    setId(newId)
  }

  const logout = () => {
    clearAuthStorage()
    setTokenState(null)
    setRoles([])
    setUsername(null)
    setId(null)
  }

  const bumpAvatarVersion = () => setAvatarVersion((v) => v + 1)

  return (
    <AuthContext.Provider
      value={{ token, roles, username, id, avatarVersion, login, logout, bumpAvatarVersion }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
