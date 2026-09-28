import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { Navbar } from '../components/Navbar'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import * as apiClient from '../api/client'
import { setToken, getToken } from '../api/client'
import { applyTheme } from '../theme'

function LocationProbe() {
  const { resumableSessions } = useAuth()
  return (
    <>
      <span data-testid="path">{useLocation().pathname}</span>
      <span data-testid="resumable">{resumableSessions.length}</span>
    </>
  )
}

function SessionDriver() {
  const sel = usePlotSelection()
  const { openSession } = useEditSession()
  return (
    <>
      <button onClick={() => sel.setFile('FILE_A')}>set file</button>
      <button onClick={() => openSession()}>open session</button>
    </>
  )
}

function renderNavbar(role: string, path: string = '/plot') {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(role === 'user' ? [] : [role]))
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <SessionDriver />
            <LocationProbe />
            <Navbar />
          </EditSessionProvider>
        </PlotSelectionProvider>
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
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Log out')).toBeInTheDocument()
    expect(within(menu).getByText('Profile')).toBeInTheDocument()
  })

  it('shows Admin link only for admin role', () => {
    renderNavbar('admin')
    fireEvent.click(screen.getByText('testuser'))
    expect(within(screen.getByRole('menu')).getByText('Admin')).toBeInTheDocument()
  })

  it('hides Admin link for non-admin role', () => {
    renderNavbar('qca')
    fireEvent.click(screen.getByText('testuser'))
    expect(within(screen.getByRole('menu')).queryByText('Admin')).not.toBeInTheDocument()
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

  it('shows Plot, Profile and (for admins) Admin tabs to the left of Save Image', () => {
    renderNavbar('admin')
    const tabs = Array.from(document.querySelectorAll('.navbar-tab')).map(
      (t) => t.querySelector('.navbar-tab-label')?.textContent
    )
    expect(tabs).toEqual(['Plot', 'Profile', 'Admin', 'Save Image', 'Close Session'])
  })

  it('hides the Admin tab for non-admins', () => {
    renderNavbar('qca')
    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument()
  })

  it('underlines the tab for the current page', () => {
    renderNavbar('admin', '/admin/users')
    expect(screen.getByRole('button', { name: 'Admin' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Profile' })).not.toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Plot' })).not.toHaveClass('active')
  })

  it('underlines the Plot tab on /plot and navigates back to it from another page', () => {
    renderNavbar('qca', '/profile')
    expect(screen.getByRole('button', { name: 'Plot' })).not.toHaveClass('active')
    fireEvent.click(screen.getByRole('button', { name: 'Plot' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/plot')
    expect(screen.getByRole('button', { name: 'Plot' })).toHaveClass('active')
  })

  it('clicking Plot while already on /plot keeps the current file/query params', async () => {
    function FileReader() {
      return <span data-testid="current-file">{usePlotSelection().file}</span>
    }
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/plot?ship=KAOU&year=2011&file=FILE_A&vars=temperature']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <FileReader />
              <Navbar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByTestId('current-file')).toHaveTextContent('FILE_A'))
    fireEvent.click(screen.getByRole('button', { name: 'Plot' }))
    expect(screen.getByTestId('current-file')).toHaveTextContent('FILE_A')
  })

  it('navigates via the Profile tab without prompting when no session is open', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderNavbar('qca')
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('path')).toHaveTextContent('/profile')
  })

  it('confirms before leaving an open session via a nav tab, and only navigates if confirmed', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    renderNavbar('qca')
    fireEvent.click(screen.getByText('set file'))
    fireEvent.click(screen.getByText('open session'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(confirmSpy).toHaveBeenCalledWith(
      'You have an open edit session. Leave without closing it?'
    )
    expect(screen.getByTestId('path')).toHaveTextContent('/plot')

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/profile')
  })

  it('confirms before leaving with unresolved resumable sessions via a nav tab', async () => {
    sessionStorage.clear() // AuthProvider checks for resumable sessions once per login
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([
      { filename: 'shipx_2026-08-01', created_at: '2026-08-01T10:00:00', last_edited_at: '2026-08-01T10:05:00' },
    ])
    renderNavbar('qca')
    await waitFor(() => expect(screen.getByTestId('resumable')).toHaveTextContent('1'))

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(confirmSpy).toHaveBeenCalledWith(
      'You have unresolved edits to continue or discard. Leave anyway?'
    )
    expect(screen.getByTestId('path')).toHaveTextContent('/plot')
  })

  it('the account dropdown Profile item also goes through the leave-session check', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    renderNavbar('qca')
    fireEvent.click(screen.getByText('set file'))
    fireEvent.click(screen.getByText('open session'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('testuser'))
    fireEvent.click(within(screen.getByRole('menu')).getByText('Profile'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.getByTestId('path')).toHaveTextContent('/plot')
  })
})
