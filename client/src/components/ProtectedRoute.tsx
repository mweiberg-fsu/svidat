import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Navbar } from './Navbar'
import { Sidebar } from './Sidebar'
import { useAuth } from '../context/AuthContext'
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
import { EditSessionProvider } from '../context/EditSessionContext'
import type { Role } from '../api/types'

export function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode
  roles: Role[]
}) {
  const { token, role } = useAuth()
  if (!token || !role) {
    return <Navigate to="/login" replace />
  }
  if (!roles.includes(role)) {
    return <Navigate to="/login" replace />
  }
  return (
    <PlotSelectionProvider>
      <EditSessionProvider>
        <div className="app-shell">
          <Navbar />
          <div className="app-body">
            <Sidebar />
            <main className="app-main">{children}</main>
          </div>
        </div>
      </EditSessionProvider>
    </PlotSelectionProvider>
  )
}
