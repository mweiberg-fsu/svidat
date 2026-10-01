import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilesPage } from '../pages/FilesPage'
import { SessionNavActions } from '../components/SessionNavActions'
import { SecondaryNavbar } from '../components/SecondaryNavbar'
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
            {/* Close Session lives in the navbar; mounted here so the close
                flow is exercised end to end against FilesPage. */}
            <SessionNavActions />
            <SecondaryNavbar />
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

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )
    expect(screen.getByRole('button', { name: 'Save draft (v250)' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Publish (v300)' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Bulk edit' })).toBeEnabled()
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )

    act(() => applyTheme(theme))
    expect(screen.getByRole('button', { name: 'Save QC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument()

    act(() =>
      applyTheme({ ...theme, save_draft_label: 'Save draft (v250)', publish_label: 'Publish (v300)' })
    )
  })

  it('closing the session greys out the save/publish buttons again', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close Session' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exit file' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Exit file' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeDisabled()
    )
    expect(screen.getByRole('button', { name: 'Save draft (v250)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Publish (v300)' })).toBeDisabled()
  })

  it('Exit file asks for confirmation; Cancel keeps the session open', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    const closeSpy = vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close Session' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exit file' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('FILE_A')
    expect(closeSpy).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Close Session' })).toBeInTheDocument()
  })

  it('Escape dismisses the exit-file confirmation', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    const closeSpy = vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close Session' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exit file' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('saves a draft when the Save draft button is clicked', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    const saveDraftSpy = vi.spyOn(apiClient, 'saveDraft').mockResolvedValue({ status: 'saved' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft (v250)' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Save draft (v250)' }))

    await waitFor(() => expect(saveDraftSpy).toHaveBeenCalledWith('FILE_A'))
    await waitFor(() => expect(screen.getByText('Saved as v250 draft')).toBeInTheDocument())
  })

  it('publishes when the Publish button is clicked', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    const publishFileSpy = vi.spyOn(apiClient, 'publishFile').mockResolvedValue({ status: 'published' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish (v300)' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Publish (v300)' }))

    await waitFor(() => expect(publishFileSpy).toHaveBeenCalledWith('FILE_A'))
    await waitFor(() => expect(screen.getByText('Published as v300')).toBeInTheDocument())
  })

  it('shows a Bulk edit button in the secondary navbar, toggling active state', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )

    const bulkEditBtn = screen.getByText('Bulk edit')
    expect(bulkEditBtn).not.toHaveClass('active')

    fireEvent.click(bulkEditBtn)
    expect(screen.getByText('Bulk edit')).toHaveClass('active')
  })

  it('shows the Show flags, Show climo and Show points toggles right after Bulk edit', () => {
    const { container } = renderFilesPageWithFile('qca', 'FILE_A')
    const left = container.querySelector('.secondary-navbar-left')!
    expect(Array.from(left.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Bulk edit',
      'Show flags',
      'Show climo',
      'Show points',
    ])
    expect(left.querySelector('input[aria-label="Y min"]')).not.toBeNull()
    expect(left.querySelector('input[aria-label="Y max"]')).not.toBeNull()
  })

  it('Show flags starts pressed and Show climo unpressed; clicking toggles each', () => {
    renderFilesPageWithFile('qca', 'FILE_A')
    const flags = screen.getByRole('button', { name: 'Show flags' })
    const climo = screen.getByRole('button', { name: 'Show climo' })
    expect(flags).toHaveClass('active')
    expect(flags).toHaveAttribute('aria-pressed', 'true')
    expect(climo).not.toHaveClass('active')
    expect(climo).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(flags)
    fireEvent.click(climo)
    expect(flags).not.toHaveClass('active')
    expect(flags).toHaveAttribute('aria-pressed', 'false')
    expect(climo).toHaveClass('active')
    expect(climo).toHaveAttribute('aria-pressed', 'true')
  })

  it('view-only users can still toggle Show flags, Show climo and Show points', () => {
    renderFilesPageWithFile('user', 'FILE_A')
    expect(screen.getByRole('button', { name: 'Show flags' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Show climo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Show points' })).toBeEnabled()
  })

  it('Show points starts unpressed; clicking toggles it', () => {
    renderFilesPageWithFile('qca', 'FILE_A')
    const points = screen.getByRole('button', { name: 'Show points' })
    expect(points).not.toHaveClass('active')
    expect(points).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(points)
    expect(points).toHaveClass('active')
    expect(points).toHaveAttribute('aria-pressed', 'true')
  })

  it('closing the session clears the file and shows the empty state again', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close Session' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exit file' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Exit file' }))

    await waitFor(() =>
      expect(screen.getByText('Select variables in the sidebar to view plots.')).toBeInTheDocument()
    )
  })

  it('FilesPage itself renders none of the session toolbar buttons', async () => {
    const openSpy = vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SetFile file="FILE_A" />
              <OpenSessionButton />
              <FilesPage />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(openSpy).toHaveBeenCalled())
    for (const name of ['Close Session', 'Bulk edit', 'Save draft (v250)', 'Publish (v300)']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('secondary navbar buttons are visible but greyed out before a file is selected', () => {
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SecondaryNavbar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    for (const name of [
      'Bulk edit',
      'Show flags',
      'Show climo',
      'Show points',
      'Save draft (v250)',
      'Publish (v300)',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('view-only users see the secondary navbar buttons greyed out', () => {
    renderFilesPageWithFile('user', 'FILE_A')
    for (const name of ['Bulk edit', 'Save draft (v250)', 'Publish (v300)']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('shows Save Image to the left of Close Session once a file is selected', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    renderFilesPageWithFile('qca', 'FILE_A')
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Session' })).toBeEnabled()
    )

    const saveImage = screen.getByRole('button', { name: 'Save Image' })
    const close = screen.getByRole('button', { name: 'Close Session' })
    expect(saveImage.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('view-only users get Save Image enabled but Close Session greyed out', () => {
    renderFilesPageWithFile('user', 'FILE_A')
    expect(screen.getByRole('button', { name: 'Save Image' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close Session' })).toBeDisabled()
  })

  it('shows both navbar tabs greyed out before a file is selected', () => {
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SessionNavActions />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    expect(screen.getByRole('button', { name: 'Save Image' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close Session' })).toBeDisabled()
  })
})
