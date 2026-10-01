import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { FilesPage } from './pages/FilesPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { ProfilePage } from './pages/ProfilePage'
import { GuidePage } from './pages/GuidePage'
import { GUIDE_PATH, LegacyPlotRedirect, PLOT_PATH } from './routes'
import { useFavicon } from './hooks/useFavicon'

export default function App() {
  // Tab icon follows the admin-set logo on every page, login included.
  useFavicon()
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path={PLOT_PATH}
            element={
              <ProtectedRoute>
                <FilesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute requiredRoles={['admin']}>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path={GUIDE_PATH}
            element={
              <ProtectedRoute>
                <GuidePage />
              </ProtectedRoute>
            }
          />
          <Route path="/files" element={<LegacyPlotRedirect />} />
          <Route path="/" element={<Navigate to={PLOT_PATH} replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
