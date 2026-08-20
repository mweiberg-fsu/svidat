import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from '../components/ProtectedRoute'
import { AuthProvider } from '../context/AuthContext'
import { setToken, clearToken } from '../api/client'

function renderProtected(initialEntries: string[], requiredRoles?: ('admin' | 'qca')[]) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route
            path="/private"
            element={
              <ProtectedRoute requiredRoles={requiredRoles}>
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

  it('renders children for a view-only account (no roles) when no requiredRoles are given', () => {
    setToken('abc123')
    localStorage.setItem('svidat_role', JSON.stringify([]))
    renderProtected(['/private'])
    expect(screen.getByText('private content')).toBeInTheDocument()
  })

  it('renders children when authenticated with a required role', () => {
    setToken('abc123')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    renderProtected(['/private'], ['admin', 'qca'])
    expect(screen.getByText('private content')).toBeInTheDocument()
  })

  it('redirects when authenticated but missing every required role', () => {
    setToken('abc123')
    localStorage.setItem('svidat_role', JSON.stringify([]))
    renderProtected(['/private'], ['admin'])
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('redirects when authenticated with some roles but not the required one', () => {
    setToken('abc123')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    renderProtected(['/private'], ['admin'])
    expect(screen.getByText('login page')).toBeInTheDocument()
  })
})
