import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilesPage } from '../pages/FilesPage'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'
import { applyTheme } from '../theme'

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

  it('opens a session and shows close/save/publish buttons', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    renderFilesPageWithFile('qca', 'FILE_A')

    fireEvent.click(screen.getByTestId('open-session'))

    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())
    expect(screen.getByText('Save draft (v250)')).toBeInTheDocument()
    expect(screen.getByText('Publish (v300)')).toBeInTheDocument()
  })

  it('uses admin-configured save draft and publish button labels', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    const theme = {
      primary_color: '#ed1f21',
      secondary_color: '#5e6cb3',
      tertiary_color: '#cbe3f5',
      site_name: 'SVIDAT',
      save_draft_label: 'Save QC',
      publish_label: 'Release',
      has_logo: false,
    }

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())

    act(() => applyTheme(theme))
    expect(screen.getByText('Save QC')).toBeInTheDocument()
    expect(screen.getByText('Release')).toBeInTheDocument()

    act(() =>
      applyTheme({ ...theme, save_draft_label: 'Save draft (v250)', publish_label: 'Publish (v300)' })
    )
  })

  it('closes a session and hides the save/publish buttons again', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Close session'))
    await waitFor(() => expect(screen.queryByText('Close session')).not.toBeInTheDocument())
    expect(screen.queryByText('Save draft (v250)')).not.toBeInTheDocument()
  })

  it('saves a draft when the Save draft button is clicked', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    const saveDraftSpy = vi.spyOn(apiClient, 'saveDraft').mockResolvedValue({ status: 'saved' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Save draft (v250)')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Save draft (v250)'))

    await waitFor(() => expect(saveDraftSpy).toHaveBeenCalledWith('FILE_A'))
    await waitFor(() => expect(screen.getByText('Saved as v250 draft')).toBeInTheDocument())
  })

  it('publishes when the Publish button is clicked', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    const publishFileSpy = vi.spyOn(apiClient, 'publishFile').mockResolvedValue({ status: 'published' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Publish (v300)')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Publish (v300)'))

    await waitFor(() => expect(publishFileSpy).toHaveBeenCalledWith('FILE_A'))
    await waitFor(() => expect(screen.getByText('Published as v300')).toBeInTheDocument())
  })

  it('shows a Bulk edit button next to Close session, toggling active state', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())

    const bulkEditBtn = screen.getByText('Bulk edit')
    expect(bulkEditBtn).not.toHaveClass('active')

    fireEvent.click(bulkEditBtn)
    expect(screen.getByText('Bulk edit')).toHaveClass('active')
  })

  it('closing the session clears the file and shows the empty state again', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Close session'))

    await waitFor(() =>
      expect(screen.getByText('Select variables in the sidebar to view plots.')).toBeInTheDocument()
    )
  })
})
