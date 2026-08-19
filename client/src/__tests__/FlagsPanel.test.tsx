import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FlagsPanel } from '../components/FlagsPanel'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { AuthProvider } from '../context/AuthContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

// Drives file + session + selection state directly — FlagsPanel only cares
// about the resulting context values, not how they got set (the real app
// sets them via SvgPlot's drag gesture, which both opens the session and
// sets the selection, covered in its own test file).
function Driver() {
  const sel = usePlotSelection()
  const { openSession, setFlagSelection } = useEditSession()
  return (
    <div>
      <button onClick={() => sel.setFile('FILE_A')}>set file</button>
      <button onClick={() => openSession()}>open session</button>
      <button
        onClick={() =>
          setFlagSelection({
            varName: 'temperature',
            startIdx: 4,
            endIdx: 14,
            rangeLabel: '04:00:00–14:00:00',
          })
        }
      >
        select
      </button>
      <button onClick={() => setFlagSelection(null)}>clear</button>
    </div>
  )
}

function renderPanel(role: string = 'qca') {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Driver />
            <FlagsPanel />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

async function selectAndMakeEditable() {
  renderPanel()
  fireEvent.click(screen.getByText('set file'))
  vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
  fireEvent.click(screen.getByText('open session'))
  await waitFor(() =>
    expect(screen.getByText('Select points on the plot to flag them')).toBeInTheDocument()
  )
  fireEvent.click(screen.getByText('select'))
}

describe('FlagsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders all 26 flag code buttons', () => {
    renderPanel()
    expect(screen.getByText('A-Units added')).toBeInTheDocument()
    expect(screen.getByText('K-Suspect/Caution')).toBeInTheDocument()
    expect(screen.getByText('Z-Good data')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^[A-Z]-/ })).toHaveLength(26)
  })

  it('shows the permission hint and disables codes when not editable', () => {
    renderPanel()
    expect(screen.getByText('A-Units added')).toBeDisabled()
    expect(screen.getByText('Drag on the plot to start editing')).toBeInTheDocument()
  })

  it('shows the selection hint once editable but before a selection is made', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    renderPanel()
    fireEvent.click(screen.getByText('set file'))
    fireEvent.click(screen.getByText('open session'))
    await waitFor(() =>
      expect(screen.getByText('Select points on the plot to flag them')).toBeInTheDocument()
    )
    expect(screen.getByText('A-Units added')).toBeDisabled()
  })

  it('keeps codes disabled when a selection exists but the file is not editable', () => {
    renderPanel()
    fireEvent.click(screen.getByText('set file'))
    fireEvent.click(screen.getByText('select'))
    expect(screen.getByText('A-Units added')).toBeDisabled()
  })

  it('enables codes and shows the range once both editable and selected', async () => {
    await selectAndMakeEditable()
    expect(screen.getByText('A-Units added')).not.toBeDisabled()
    expect(screen.getByText('04:00:00–14:00:00 — 11 points selected')).toBeInTheDocument()
  })

  it('applies a flag code, polls the job, and keeps the selection active on success', async () => {
    const applyFlagSpy = vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-1' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'done',
      error: null,
      result: { audit_id: 1 },
    })
    await selectAndMakeEditable()

    fireEvent.click(screen.getByText('K-Suspect/Caution'))

    await waitFor(() =>
      expect(applyFlagSpy).toHaveBeenCalledWith('FILE_A', 'temperature', 4, 14, 'K')
    )
    // The selection/highlight stays active after a successful apply — only
    // an explicit "Clear selection" click or a file/variable change resets
    // it (see EditSessionContext) — so the range label keeps showing.
    await waitFor(
      () =>
        expect(
          screen.getByText('04:00:00–14:00:00 — 11 points selected')
        ).toBeInTheDocument(),
      { timeout: 2000 }
    )
  })

  it('shows an inline error and keeps the selection when the job fails', async () => {
    vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-2' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'failed',
      error: 'invalid flag_code',
      result: null,
    })
    await selectAndMakeEditable()

    fireEvent.click(screen.getByText('K-Suspect/Caution'))

    await waitFor(
      () => expect(screen.getByText('Error: invalid flag_code')).toBeInTheDocument(),
      { timeout: 2000 }
    )
    expect(screen.getByText('04:00:00–14:00:00 — 11 points selected')).toBeInTheDocument()
  })

  it('"Clear selection" clears without calling the API', async () => {
    const applyFlagSpy = vi.spyOn(apiClient, 'applyFlag')
    await selectAndMakeEditable()

    fireEvent.click(screen.getByText('Clear selection'))

    expect(screen.getByText('Select points on the plot to flag them')).toBeInTheDocument()
    expect(applyFlagSpy).not.toHaveBeenCalled()
  })
})
