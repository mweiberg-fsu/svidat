import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from '../components/ProtectedRoute'
import { AuthProvider } from '../context/AuthContext'
import { setToken, clearToken } from '../api/client'

function renderProtected(initialEntries: string[]) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route
            path="/private"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <div>private content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    clearToken()
    localStorage.clear()
  })

  it('redirects to login when not authenticated', () => {
    renderProtected(['/private'])
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('renders children when authenticated with an allowed role', () => {
    setToken('abc123')
    localStorage.setItem('svidat_role', 'qca')
    renderProtected(['/private'])
    expect(screen.getByText('private content')).toBeInTheDocument()
  })

  it('redirects when authenticated but role not allowed', () => {
    setToken('abc123')
    localStorage.setItem('svidat_role', 'user')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/private']}>
          <Routes>
            <Route path="/login" element={<div>login page</div>} />
            <Route
              path="/private"
              element={
                <ProtectedRoute roles={['admin', 'qca']}>
                  <div>private content</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    )
    expect(screen.getByText('login page')).toBeInTheDocument()
  })
})
