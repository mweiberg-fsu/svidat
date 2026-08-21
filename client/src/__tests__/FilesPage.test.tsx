import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilesPage } from '../pages/FilesPage'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

function SetFile({ file }: { file: string }) {
  const sel = usePlotSelection()
  return (
    <button data-testid="set-file" onClick={() => sel.setFile(file)}>
      set file
    </button>
  )
}

function OpenSessionButton() {
  const { openSession } = useEditSession()
  return (
    <button data-testid="open-session" onClick={() => openSession()}>
      open session
    </button>
  )
}

function renderFilesPage(role: string = 'qca') {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(role === 'user' ? [] : [role]))
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <FilesPage />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

function renderFilesPageWithFile(role: string, file: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(role === 'user' ? [] : [role]))
  localStorage.setItem('svidat_username', 'testuser')
  const utils = render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <SetFile file={file} />
            <OpenSessionButton />
            <FilesPage />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
  fireEvent.click(screen.getByTestId('set-file'))
  return utils
}

describe('FilesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the empty state before any variables are selected', () => {
    renderFilesPage()
    expect(
      screen.getByText('Select variables in the sidebar to view plots.')
    ).toBeInTheDocument()
  })

  it('shows the drag-to-edit hint for qca once a file is selected', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {},
      dimensions: {},
      global_attrs: {},
    })
    renderFilesPageWithFile('qca', 'FILE_A')
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )
  })

  it('hides the drag-to-edit hint for user role', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {},
      dimensions: {},
      global_attrs: {},
    })
    renderFilesPageWithFile('user', 'FILE_A')
    await waitFor(() => expect(apiClient.getFileMetadata).toHaveBeenCalledWith('FILE_A'))
    expect(screen.queryByText('Drag on a plot to start editing.')).not.toBeInTheDocument()
  })

  it('opens a session and shows the edit form and audit panel', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { temperature: { dims: ['time'], shape: [10], dtype: 'f4', attrs: {} } },
      dimensions: {},
      global_attrs: {},
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([])

    renderFilesPageWithFile('qca', 'FILE_A')
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )

    fireEvent.click(screen.getByTestId('open-session'))

    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Audit history')).toBeInTheDocument()
  })

  it('closes a session and hides the edit form again', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { temperature: { dims: ['time'], shape: [10], dtype: 'f4', attrs: {} } },
      dimensions: {},
      global_attrs: {},
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([])

    renderFilesPageWithFile('qca', 'FILE_A')
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Close session'))
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })

  it('bumps the audit panel refresh signal when flagAppliedAt increments', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { temperature: { dims: ['time'], shape: [10], dtype: 'f4', attrs: {} } },
      dimensions: {},
      global_attrs: {},
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    const getAuditHistorySpy = vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([])

    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')

    function NotifyButton() {
      const { notifyFlagged } = useEditSession()
      return <button onClick={() => notifyFlagged()}>notify flagged</button>
    }

    render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SetFile file="FILE_A" />
              <OpenSessionButton />
              <NotifyButton />
              <FilesPage />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Audit history')).toBeInTheDocument())
    await waitFor(() => expect(getAuditHistorySpy).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('notify flagged'))

    await waitFor(() => expect(getAuditHistorySpy).toHaveBeenCalledTimes(2))
  })
})
