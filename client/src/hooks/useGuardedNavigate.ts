import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEditSession } from '../context/EditSessionContext'

// Page navigation shared by the sidebar and navbar: confirms before leaving
// an open edit session or unresolved resumable edits, and does nothing when
// already on `path` (navigating to the bare path would drop the current
// ship/year/file/vars query params and reset the page).
export function useGuardedNavigate(): (path: string) => void {
  const { sessionOpen } = useEditSession()
  const { resumableSessions } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  return (path: string) => {
    if (location.pathname === path) return
    if (sessionOpen && !window.confirm('You have an open edit session. Leave without closing it?')) {
      return
    }
    if (
      resumableSessions.length > 0 &&
      !window.confirm('You have unresolved edits to continue or discard. Leave anyway?')
    ) {
      return
    }
    navigate(path)
  }
}
