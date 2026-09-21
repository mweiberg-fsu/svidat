import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  ID_KEY,
  ROLE_KEY,
  RESUME_CHECKED_KEY,
  USERNAME_KEY,
  clearAuthStorage,
  getMySessions,
  getTheme,
  getToken,
  setToken,
} from '../api/client'
import type { Role, TempSessionEntry } from '../api/types'

interface AuthState {
  token: string | null
  roles: Role[]
  username: string | null
  id: number | null
  avatarVersion: number
  resumableSessions: TempSessionEntry[]
  removeResumableSession: (filename: string) => void
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
  const [resumableSessions, setResumableSessions] = useState<TempSessionEntry[]>([])

  // Fires once per login (guarded by a sessionStorage flag so it survives
  // remounts of anything below this provider, e.g. per-route Sidebar
  // remounts), and re-evaluates when `token` changes so it also catches a
  // fresh login() call, not just the initial mount with a token already in
  // localStorage.
  useEffect(() => {
    if (!token) return
    if (sessionStorage.getItem(RESUME_CHECKED_KEY)) return
    sessionStorage.setItem(RESUME_CHECKED_KEY, '1')
    getMySessions()
      .then(setResumableSessions)
      .catch(() => {})
  }, [token])

  // Applies the site's admin-configured theme colors on login (and on
  // every fresh token, e.g. re-login after logout, in case an admin
  // changed the theme meanwhile). No sessionStorage re-fire guard is
  // needed here, unlike the resumable-sessions effect above — that one
  // specifically guards against per-route Sidebar remounts, but
  // AuthProvider itself doesn't remount per route, so this only re-runs
  // on an actual token change.
  useEffect(() => {
    if (!token) return
    getTheme()
      .then((theme) => {
        document.documentElement.style.setProperty('--accent', theme.primary_color)
        document.documentElement.style.setProperty('--secondary', theme.secondary_color)
        document.documentElement.style.setProperty('--tertiary', theme.tertiary_color)
      })
      .catch(() => {})
  }, [token])

  const removeResumableSession = (filename: string) => {
    setResumableSessions((prev) => prev.filter((s) => s.filename !== filename))
  }

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
    sessionStorage.removeItem(RESUME_CHECKED_KEY)
    setResumableSessions([])
    setTokenState(null)
    setRoles([])
    setUsername(null)
    setId(null)
  }

  const bumpAvatarVersion = () => setAvatarVersion((v) => v + 1)

  return (
    <AuthContext.Provider
      value={{
        token,
        roles,
        username,
        id,
        avatarVersion,
        resumableSessions,
        removeResumableSession,
        login,
        logout,
        bumpAvatarVersion,
      }}
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
