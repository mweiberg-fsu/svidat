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
  requiredRoles,
}: {
  children: ReactNode
  requiredRoles?: Role[]
}) {
  const { token, roles } = useAuth()
  if (!token) {
    return <Navigate to="/login" replace />
  }
  if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.some((r) => roles.includes(r))) {
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
