import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { AuthProvider } from '../context/AuthContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

function Consumer() {
  const {
    sessionOpen,
    canEdit,
    editable,
    sessionError,
    openSession,
    closeSession,
    flagSelection,
    setFlagSelection,
    flagAppliedAt,
    notifyFlagged,
    bulkEdit,
    toggleBulkEdit,
  } = useEditSession()
  const sel = usePlotSelection()
  return (
    <div>
      <span>sessionOpen:{String(sessionOpen)}</span>
      <span>canEdit:{String(canEdit)}</span>
      <span>editable:{String(editable)}</span>
      <span>sessionError:{sessionError ?? 'none'}</span>
      <span>flagSelection:{flagSelection ? flagSelection.rangeLabel : 'none'}</span>
      <span>flagAppliedAt:{flagAppliedAt}</span>
      <span>bulkEdit:{String(bulkEdit)}</span>
      <span>file:{sel.file || 'none'}</span>
      <button onClick={() => openSession()}>open</button>
      <button onClick={() => closeSession()}>close</button>
      <button
        onClick={() =>
          setFlagSelection({ varName: 'temperature', startIdx: 4, endIdx: 14, rangeLabel: '04:00–14:00' })
        }
      >
        select
      </button>
      <button onClick={() => setFlagSelection(null)}>clear</button>
      <button onClick={() => notifyFlagged()}>notify</button>
      <button onClick={() => toggleBulkEdit()}>toggle bulk</button>
    </div>
  )
}

function SetFile({ file, testId = 'set-file' }: { file: string; testId?: string }) {
  const sel = usePlotSelection()
  return (
    <button data-testid={testId} onClick={() => sel.setFile(file)}>
      set file
    </button>
  )
}

// Two separate sibling components (not parent/child) reading/writing the
// same EditSessionContext — proves state is genuinely shared across the
// provider, not just re-rendered within a single consumer.
function FlagSetterSibling() {
  const { setFlagSelection } = useEditSession()
  return (
    <button
      onClick={() =>
        setFlagSelection({ varName: 'humidity', startIdx: 1, endIdx: 2, rangeLabel: '01:00–02:00' })
      }
    >
      set-flag-sibling
    </button>
  )
}

function FlagDisplaySibling() {
  const { flagSelection } = useEditSession()
  return (
    <span data-testid="flag-display-sibling">
      flagSelection:{flagSelection ? flagSelection.rangeLabel : 'none'}
    </span>
  )
}

function ExplicitOpenConsumer() {
  const { sessionOpen, sessionOpenedAt, openSession } = useEditSession()
  return (
    <div>
      <span>sessionOpen:{String(sessionOpen)}</span>
      <span>sessionOpenedAt:{sessionOpenedAt ?? 'none'}</span>
      <button onClick={() => openSession('EXPLICIT_FILE')}>open explicit</button>
    </div>
  )
}

function renderWithRole(role: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(role === 'user' ? [] : [role]))
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <SetFile file="FILE_A" />
          <SetFile file="FILE_B" testId="set-file-b" />
          <EditSessionProvider>
            <Consumer />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

function renderSiblingsWithRole(role: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(role === 'user' ? [] : [role]))
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <SetFile file="FILE_A" />
          <EditSessionProvider>
            <FlagSetterSibling />
            <FlagDisplaySibling />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('EditSessionContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('canEdit reflects role; editable is false until a session is opened', () => {
    renderWithRole('qca')
    expect(screen.getByText('canEdit:true')).toBeInTheDocument()
    expect(screen.getByText('editable:false')).toBeInTheDocument()
  })

  it('canEdit is false for the user role', () => {
    renderWithRole('user')
    expect(screen.getByText('canEdit:false')).toBeInTheDocument()
  })

  it('canEdit is false for an admin-only account (no qca)', () => {
    renderWithRole('admin')
    expect(screen.getByText('canEdit:false')).toBeInTheDocument()
  })

  it('opening a session sets sessionOpen and editable (for an eligible role)', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())
    expect(screen.getByText('editable:true')).toBeInTheDocument()
  })

  it('closing a session clears sessionOpen and editable', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())

    fireEvent.click(screen.getByText('close'))
    await waitFor(() => expect(screen.getByText('sessionOpen:false')).toBeInTheDocument())
    expect(screen.getByText('editable:false')).toBeInTheDocument()
  })

  it('a failed open surfaces sessionError and leaves sessionOpen false', async () => {
    vi.spyOn(apiClient, 'openSession').mockRejectedValue(new Error('locked by another user'))
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    fireEvent.click(screen.getByText('open'))
    await waitFor(() =>
      expect(screen.getByText('sessionError:locked by another user')).toBeInTheDocument()
    )
    expect(screen.getByText('sessionOpen:false')).toBeInTheDocument()
  })

  it('a failed open also clears any pending flagSelection', async () => {
    vi.spyOn(apiClient, 'openSession').mockRejectedValue(new Error('locked by another user'))
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    fireEvent.click(screen.getByText('select'))
    expect(screen.getByText('flagSelection:04:00–14:00')).toBeInTheDocument()

    fireEvent.click(screen.getByText('open'))
    await waitFor(() =>
      expect(screen.getByText('sessionError:locked by another user')).toBeInTheDocument()
    )
    expect(screen.getByText('flagSelection:none')).toBeInTheDocument()
  })

  it('a successful close also clears any pending flagSelection', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())

    fireEvent.click(screen.getByText('select'))
    expect(screen.getByText('flagSelection:04:00–14:00')).toBeInTheDocument()

    fireEvent.click(screen.getByText('close'))
    await waitFor(() => expect(screen.getByText('sessionOpen:false')).toBeInTheDocument())
    expect(screen.getByText('flagSelection:none')).toBeInTheDocument()
  })

  it('a successful close also clears the plotted file (and variables)', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())
    expect(screen.getByText('file:FILE_A')).toBeInTheDocument()

    fireEvent.click(screen.getByText('close'))
    await waitFor(() => expect(screen.getByText('sessionOpen:false')).toBeInTheDocument())
    expect(screen.getByText('file:none')).toBeInTheDocument()
  })

  it('does not fire a second open request while one is already in flight', async () => {
    let resolveOpen: (v: { status: string }) => void = () => {}
    const openSpy = vi.spyOn(apiClient, 'openSession').mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve
      })
    )
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    fireEvent.click(screen.getByText('open'))
    fireEvent.click(screen.getByText('open'))
    fireEvent.click(screen.getByText('open'))
    expect(openSpy).toHaveBeenCalledTimes(1)

    resolveOpen({ status: 'opened' })
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())

    fireEvent.click(screen.getByText('open'))
    expect(openSpy).toHaveBeenCalledTimes(1)
  })

  it('shares flagSelection and flagAppliedAt between consumers under the same provider', () => {
    renderWithRole('qca')
    expect(screen.getByText('flagSelection:none')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select'))
    expect(screen.getByText('flagSelection:04:00–14:00')).toBeInTheDocument()

    fireEvent.click(screen.getByText('clear'))
    expect(screen.getByText('flagSelection:none')).toBeInTheDocument()

    expect(screen.getByText('flagAppliedAt:0')).toBeInTheDocument()
    fireEvent.click(screen.getByText('notify'))
    expect(screen.getByText('flagAppliedAt:1')).toBeInTheDocument()
  })

  it('changing the file resets both sessionOpen/sessionError and flagSelection', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())

    fireEvent.click(screen.getByText('select'))
    expect(screen.getByText('flagSelection:04:00–14:00')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('set-file-b'))
    await waitFor(() => expect(screen.getByText('sessionOpen:false')).toBeInTheDocument())
    expect(screen.getByText('flagSelection:none')).toBeInTheDocument()
  })

  it('switching files while an open request is in flight does not block opening the new file', async () => {
    let resolveFirstOpen: (v: { status: string }) => void = () => {}
    const openSpy = vi.spyOn(apiClient, 'openSession').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstOpen = resolve
        })
    )
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    // Kick off an open for FILE_A and leave it unresolved.
    fireEvent.click(screen.getByText('open'))
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenNthCalledWith(1, 'FILE_A', 'raw')

    // Switch to FILE_B before the FILE_A request resolves. This must clear
    // the stale in-flight guard so a subsequent open isn't silently dropped.
    fireEvent.click(screen.getByTestId('set-file-b'))
    await waitFor(() => expect(screen.getByText('sessionOpen:false')).toBeInTheDocument())

    openSpy.mockResolvedValueOnce({ status: 'opened' })
    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(2))
    expect(openSpy).toHaveBeenNthCalledWith(2, 'FILE_B', 'raw')
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())

    // Resolve the stale FILE_A request afterwards; it should not matter for
    // this test (the pre-existing stale-response issue is out of scope).
    resolveFirstOpen({ status: 'opened' })
  })

  it('intercepts beforeunload only while a session is open', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    // No session open yet — beforeunload is not intercepted (dispatchEvent
    // returns true when nothing called preventDefault on a cancelable event).
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)

    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())

    // Session open — beforeunload is intercepted (preventDefault called,
    // dispatchEvent returns false).
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false)

    fireEvent.click(screen.getByText('close'))
    await waitFor(() => expect(screen.getByText('sessionOpen:false')).toBeInTheDocument())

    // Session closed again — no longer intercepted.
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  })

  it('shares flagSelection across separate sibling components under the same provider', () => {
    renderSiblingsWithRole('qca')
    expect(screen.getByTestId('flag-display-sibling')).toHaveTextContent('flagSelection:none')

    fireEvent.click(screen.getByText('set-flag-sibling'))
    expect(screen.getByTestId('flag-display-sibling')).toHaveTextContent('flagSelection:01:00–02:00')
  })

  it('bulkEdit defaults to false; toggleBulkEdit flips it', () => {
    renderWithRole('qca')
    expect(screen.getByText('bulkEdit:false')).toBeInTheDocument()

    fireEvent.click(screen.getByText('toggle bulk'))
    expect(screen.getByText('bulkEdit:true')).toBeInTheDocument()

    fireEvent.click(screen.getByText('toggle bulk'))
    expect(screen.getByText('bulkEdit:false')).toBeInTheDocument()
  })

  it('changing the file resets bulkEdit to false', async () => {
    renderWithRole('qca')
    fireEvent.click(screen.getByText('toggle bulk'))
    expect(screen.getByText('bulkEdit:true')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('set-file-b'))
    await waitFor(() => expect(screen.getByText('bulkEdit:false')).toBeInTheDocument())
  })

  it('openSession(explicitFilename) opens a session for that file, independent of PlotSelectionContext', async () => {
    const openSpy = vi.spyOn(apiClient, 'openSession').mockResolvedValue({
      status: 'opened',
      session_started_at: '2026-09-17T12:00:00',
    })
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', JSON.stringify(['qca']))
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <ExplicitOpenConsumer />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )

    fireEvent.click(screen.getByText('open explicit'))

    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())
    expect(openSpy).toHaveBeenCalledWith('EXPLICIT_FILE', 'raw')
    expect(screen.getByText('sessionOpenedAt:2026-09-17T12:00:00')).toBeInTheDocument()
  })
})
