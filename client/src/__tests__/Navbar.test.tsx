import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Navbar } from '../components/Navbar'
import { AuthProvider } from '../context/AuthContext'
import { setToken, getToken } from '../api/client'

function renderNavbar(role: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(role === 'user' ? [] : [role]))
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('Navbar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows username and opens dropdown on click', () => {
    renderNavbar('qca')
    expect(screen.getByText('testuser')).toBeInTheDocument()
    fireEvent.click(screen.getByText('testuser'))
    expect(screen.getByText('Log out')).toBeInTheDocument()
    expect(screen.getByText('Profile')).toBeInTheDocument()
  })

  it('shows Admin link only for admin role', () => {
    renderNavbar('admin')
    fireEvent.click(screen.getByText('testuser'))
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('hides Admin link for non-admin role', () => {
    renderNavbar('qca')
    fireEvent.click(screen.getByText('testuser'))
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('logout clears the stored token', () => {
    renderNavbar('qca')
    fireEvent.click(screen.getByText('testuser'))
    fireEvent.click(screen.getByText('Log out'))
    expect(getToken()).toBeNull()
  })
})
