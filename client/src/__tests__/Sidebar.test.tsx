import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

function renderSidebar(role: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
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
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
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
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    renderSidebar('qca')
    expect(screen.queryByText('No edits yet.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Audit History'))

    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Close'))

    expect(screen.queryByText('No edits yet.')).not.toBeInTheDocument()
  })

  it('closes the audit history modal when the documentation link is clicked', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    renderSidebar('qca')

    fireEvent.click(screen.getByText('Audit History'))
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Documentation'))

    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.queryByText('No edits yet.')).not.toBeInTheDocument()
  })

  it('closes the documentation modal when the audit history link is clicked', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    renderSidebar('qca')

    fireEvent.click(screen.getByText('Documentation'))
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()

    fireEvent.click(screen.getByText('Audit History'))

    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument()
  })

  it('renders no tabs outside /files', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
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
    localStorage.setItem('svidat_role', 'qca')
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
    localStorage.setItem('svidat_role', 'qca')
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
    localStorage.setItem('svidat_role', 'qca')
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

  it('highlights the Plots link when on /files', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
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
    localStorage.setItem('svidat_role', 'qca')
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
    localStorage.setItem('svidat_role', 'admin')
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
})
