import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

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

function renderSidebar(role: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(role === 'user' ? [] : [role]))
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Sidebar />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([])
  })

  it('shows welcome message with username', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('qca')
    expect(screen.getByText('testuser')).toBeInTheDocument()
    expect(screen.getByText('Welcome')).toBeInTheDocument()
  })

  it('shows Admin link only for admin role', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('admin')
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('hides Admin link for non-admin role', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('qca')
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('shows an Audit History link for every role, including user', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('user')
    expect(screen.getByText('Audit History')).toBeInTheDocument()
  })

  it('shows a Documentation link for every role, including user', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('user')
    expect(screen.getByText('Documentation')).toBeInTheDocument()
  })

  it('opens the documentation modal when the link is clicked, and closes it', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('qca')
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Documentation'))

    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Close'))

    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument()
  })

  it('opens the audit history modal when the link is clicked, and closes it', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('qca')
    expect(screen.queryByText('Select a file to view its audit history.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Audit History'))

    await waitFor(() => expect(screen.getByText('Select a file to view its audit history.')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Close'))

    expect(screen.queryByText('Select a file to view its audit history.')).not.toBeInTheDocument()
  })

  it('closes the audit history modal when the documentation link is clicked', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('qca')

    fireEvent.click(screen.getByText('Audit History'))
    await waitFor(() => expect(screen.getByText('Select a file to view its audit history.')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Documentation'))

    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.queryByText('Select a file to view its audit history.')).not.toBeInTheDocument()
  })

  it('closes the documentation modal when the audit history link is clicked', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('qca')

    fireEvent.click(screen.getByText('Documentation'))
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()

    fireEvent.click(screen.getByText('Audit History'))

    await waitFor(() => expect(screen.getByText('Select a file to view its audit history.')).toBeInTheDocument())
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument()
  })

  it('renders no tabs outside /files', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/profile']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('testuser')).toBeInTheDocument())
    expect(screen.queryByRole('tab', { name: 'File Selection' })).not.toBeInTheDocument()
  })

  it('renders File Selection and Flags tabs on /files, File Selection active by default', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: 'File Selection' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Flags' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'File Selection' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Flags' })).toHaveAttribute('aria-selected', 'false')
    // File Selection tab active by default -> PlotPicker's Ship label visible.
    expect(screen.getByText('Ship')).toBeInTheDocument()
  })

  it('clicking the Flags tab switches panels', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Flags' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: 'Flags' }))

    expect(screen.getByRole('tab', { name: 'Flags' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('A-Units added')).toBeInTheDocument()
    expect(screen.queryByText('Ship')).not.toBeInTheDocument()
  })

  it('auto-switches to the Flags tab when a flag selection resolves', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')

    function SelectDriver() {
      const { setFlagSelection } = useEditSession()
      return (
        <button
          onClick={() =>
            setFlagSelection({ varName: 'temperature', startIdx: 4, endIdx: 14, rangeLabel: 'x' })
          }
        >
          resolve selection
        </button>
      )
    }

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SelectDriver />
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: 'File Selection' })).toHaveAttribute('aria-selected', 'true'))

    fireEvent.click(screen.getByText('resolve selection'))

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Flags' })).toHaveAttribute('aria-selected', 'true')
    )
  })

  it('reverts to the File Selection tab when the session closes', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')

    function CloseDriver() {
      const sel = usePlotSelection()
      const { openSession, closeSession, setFlagSelection } = useEditSession()
      return (
        <>
          <button onClick={() => sel.setFile('FILE_A')}>set file</button>
          <button onClick={() => openSession()}>open session</button>
          <button
            onClick={() =>
              setFlagSelection({ varName: 'temperature', startIdx: 4, endIdx: 14, rangeLabel: 'x' })
            }
          >
            resolve selection
          </button>
          <button onClick={() => closeSession()}>close session</button>
        </>
      )
    }

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <CloseDriver />
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )

    fireEvent.click(screen.getByText('set file'))
    fireEvent.click(screen.getByText('open session'))
    fireEvent.click(screen.getByText('resolve selection'))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Flags' })).toHaveAttribute('aria-selected', 'true')
    )

    fireEvent.click(screen.getByText('close session'))

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'File Selection' })).toHaveAttribute('aria-selected', 'true')
    )
  })

  it('highlights the Plots link when on /files', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('Plots')).toHaveClass('active'))
    expect(screen.getByText('Profile')).not.toHaveClass('active')
  })

  it('highlights the Profile link when on /profile', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/profile']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('Profile')).toHaveClass('active'))
    expect(screen.getByText('Plots')).not.toHaveClass('active')
  })

  it('highlights the Admin link when on /admin/users', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['admin']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/users']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('Admin')).toHaveClass('active'))
    expect(screen.getByText('Plots')).not.toHaveClass('active')
  })

  it('confirms before navigating when a session is open, and only navigates if confirmed', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SessionDriver />
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByText('set file'))
    fireEvent.click(screen.getByText('open session'))
    await waitFor(() => expect(apiClient.openSession).toHaveBeenCalled())

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('Profile'))
    expect(confirmSpy).toHaveBeenCalledWith(
      'You have an open edit session. Leave without closing it?'
    )
    // Cancelled — still on /files.
    expect(screen.getByText('Plots')).toHaveClass('active')

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByText('Profile'))
    await waitFor(() => expect(screen.getByText('Profile')).toHaveClass('active'))
  })

  it('navigates without prompting when no session is open', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderSidebar('qca')

    fireEvent.click(screen.getByText('Plots'))

    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Plots')).toHaveClass('active'))
  })

  it('confirms before navigating when there are unresolved resumable sessions, and only navigates if confirmed', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([
      { filename: 'shipx_2026-08-01', created_at: '2026-08-01T10:00:00', last_edited_at: '2026-08-01T10:05:00' },
    ])
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('Continue editing?')).toBeInTheDocument())

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('Profile'))
    expect(confirmSpy).toHaveBeenCalledWith(
      'You have unresolved edits to continue or discard. Leave anyway?'
    )
    // Cancelled — still on /files.
    expect(screen.getByText('Plots')).toHaveClass('active')

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByText('Profile'))
    await waitFor(() => expect(screen.getByText('Profile')).toHaveClass('active'))
  })

  it('does not show the resume prompt when there are no resumable sessions', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('qca')
    await waitFor(() => expect(apiClient.getMySessions).toHaveBeenCalled())
    expect(screen.queryByText('Continue editing?')).not.toBeInTheDocument()
  })

  it('shows the resume prompt and continues a resumable session', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([
      { filename: 'shipx_2026-08-01', created_at: '2026-08-01T10:00:00', last_edited_at: '2026-08-01T10:05:00' },
    ])
    const openSpy = vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    renderSidebar('qca')

    await waitFor(() => expect(screen.getByText('Continue editing?')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Continue'))

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('shipx_2026-08-01', 'raw'))
    await waitFor(() => expect(screen.queryByText('Continue editing?')).not.toBeInTheDocument())
  })

  it('discards a resumable session', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([
      { filename: 'shipx_2026-08-01', created_at: '2026-08-01T10:00:00', last_edited_at: null },
    ])
    const discardSpy = vi.spyOn(apiClient, 'discardSession').mockResolvedValue({ status: 'discarded' })
    renderSidebar('qca')

    await waitFor(() => expect(screen.getByText('Continue editing?')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Discard'))

    await waitFor(() => expect(discardSpy).toHaveBeenCalledWith('shipx_2026-08-01'))
    await waitFor(() => expect(screen.queryByText('Continue editing?')).not.toBeInTheDocument())
  })

  it('only fetches resumable sessions once per browser tab', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    const mineSpy = vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([])
    const { unmount } = renderSidebar('qca')
    await waitFor(() => expect(mineSpy).toHaveBeenCalledTimes(1))
    unmount()

    renderSidebar('qca')
    await waitFor(() => expect(screen.getByText('testuser')).toBeInTheDocument())
    expect(mineSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps resumable sessions (and the nav-guard) alive across a Sidebar remount within the same AuthProvider, mirroring per-route navigation', async () => {
    // This is the regression test for the bug: App.tsx wraps each route in
    // its own <ProtectedRoute> (which renders Sidebar), so navigating
    // between routes unmounts and remounts the Sidebar tree while the
    // single AuthProvider above <BrowserRouter> stays mounted. Data owned
    // by Sidebar-local state would be lost on that remount; data owned by
    // AuthContext should not be.
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    const mineSpy = vi.spyOn(apiClient, 'getMySessions').mockResolvedValue([
      { filename: 'shipx_2026-08-01', created_at: '2026-08-01T10:00:00', last_edited_at: '2026-08-01T10:05:00' },
    ])
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')

    const { rerender } = render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar key="first" />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByText('Continue editing?')).toBeInTheDocument())
    expect(mineSpy).toHaveBeenCalledTimes(1)

    // Re-render with a differently-keyed Sidebar element so React unmounts
    // the first Sidebar instance and mounts a brand new one, while
    // AuthProvider/MemoryRouter/PlotSelectionProvider/EditSessionProvider —
    // same element types at the same tree positions — are only re-rendered,
    // not remounted. This mirrors App.tsx exactly: AuthProvider sits above
    // BrowserRouter/Routes and is never remounted by route navigation, only
    // the per-route ProtectedRoute -> Sidebar tree is.
    rerender(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar key="second" />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )

    // The new Sidebar instance should immediately show the resume prompt —
    // proving resumableSessions survived the remount — without triggering a
    // second fetch.
    expect(screen.getByText('Continue editing?')).toBeInTheDocument()
    expect(mineSpy).toHaveBeenCalledTimes(1)
  })
})
