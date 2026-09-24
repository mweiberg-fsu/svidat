import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Navbar } from '../components/Navbar'
import { AuthProvider } from '../context/AuthContext'
import * as apiClient from '../api/client'
import { setToken, getToken } from '../api/client'
import { applyTheme } from '../theme'

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

  it('shows the admin-configured site name and logo', async () => {
    vi.spyOn(apiClient, 'fetchLogoBlobUrl').mockResolvedValue('blob:logo')
    const { container } = renderNavbar('qca')
    act(() =>
      applyTheme({
        primary_color: '#111111',
        secondary_color: '#222222',
        tertiary_color: '#333333',
        site_name: 'My QC',
        save_draft_label: 'Save draft (v250)',
        publish_label: 'Publish (v300)',
        has_logo: true,
      })
    )
    expect(screen.getByText('My QC')).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(container.querySelector('.navbar-logo-img')).toHaveAttribute('src', 'blob:logo')
    )

    act(() =>
      applyTheme({
        primary_color: '#111111',
        secondary_color: '#222222',
        tertiary_color: '#333333',
        site_name: 'SVIDAT',
        save_draft_label: 'Save draft (v250)',
        publish_label: 'Publish (v300)',
        has_logo: false,
      })
    )
    expect(container.querySelector('.navbar-logo-img')).toBeNull()
  })
})
