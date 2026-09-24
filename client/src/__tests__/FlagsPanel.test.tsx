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
  const {
    openSession,
    setFlagSelection,
    flagsVisible,
    climatologyVisible,
    bulkEdit,
    toggleBulkEdit,
    flagAppliedAt,
    selectedVariables,
    toggleVariableSelected,
  } = useEditSession()
  return (
    <div>
      <span data-testid="flags-visible">{String(flagsVisible)}</span>
      <span data-testid="climatology-visible">{String(climatologyVisible)}</span>
      <span data-testid="bulk-edit">{String(bulkEdit)}</span>
      <span data-testid="flag-applied-at">{flagAppliedAt}</span>
      <span data-testid="selected-variables">{selectedVariables.join(',')}</span>
      <button onClick={() => sel.setFile('FILE_A')}>set file</button>
      <button onClick={() => sel.setVariables(['temperature', 'humidity', 'salinity'])}>
        set variables
      </button>
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
      <button onClick={() => toggleBulkEdit()}>toggle bulk</button>
      <button onClick={() => toggleVariableSelected('temperature')}>select temperature</button>
      <button onClick={() => toggleVariableSelected('humidity')}>select humidity</button>
      <button onClick={() => toggleVariableSelected('salinity')}>select salinity</button>
    </div>
  )
}

function renderPanel(role: string = 'qca') {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(role === 'user' ? [] : [role]))
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

async function selectAndMakeEditable(beforeSelect?: () => void) {
  renderPanel()
  vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
  // Selecting a file now opens a session automatically, so the mock must be
  // in place before this click, not after.
  fireEvent.click(screen.getByText('set file'))
  await waitFor(() =>
    expect(screen.getByText('Select points on the plot to flag them')).toBeInTheDocument()
  )
  // setVariables resets flagSelection (EditSessionContext resets on
  // [file, variables] change), so any variable-list setup must happen
  // before the selection is made, not after.
  beforeSelect?.()
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

  it('renders the mode row: Show flags checked by default', () => {
    renderPanel()
    const showFlags = screen.getByLabelText('Show flags') as HTMLInputElement
    expect(showFlags.checked).toBe(true)
    expect(screen.queryByLabelText(/^Bulk edit/)).not.toBeInTheDocument()
  })

  it('clicking "Show flags" toggles flagsVisible', () => {
    renderPanel()
    expect(screen.getByTestId('flags-visible')).toHaveTextContent('true')

    fireEvent.click(screen.getByLabelText('Show flags'))
    expect(screen.getByTestId('flags-visible')).toHaveTextContent('false')

    fireEvent.click(screen.getByLabelText('Show flags'))
    expect(screen.getByTestId('flags-visible')).toHaveTextContent('true')
  })

  it('renders "Show Climo" unchecked by default', () => {
    renderPanel()
    const box = screen.getByLabelText('Show Climo') as HTMLInputElement
    expect(box.checked).toBe(false)
  })

  it('clicking "Show Climo" toggles climatologyVisible', () => {
    renderPanel()
    expect(screen.getByTestId('climatology-visible')).toHaveTextContent('false')
    fireEvent.click(screen.getByLabelText('Show Climo'))
    expect(screen.getByTestId('climatology-visible')).toHaveTextContent('true')
    fireEvent.click(screen.getByLabelText('Show Climo'))
    expect(screen.getByTestId('climatology-visible')).toHaveTextContent('false')
  })

  it('with bulk edit off, applying a code still calls applyFlag only for the selected variable', async () => {
    const applyFlagSpy = vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-1' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'done',
      error: null,
      result: { audit_id: 1 },
    })
    await selectAndMakeEditable(() => fireEvent.click(screen.getByText('set variables')))

    fireEvent.click(screen.getByText('K-Suspect/Caution'))

    await waitFor(() => expect(applyFlagSpy).toHaveBeenCalledTimes(1))
    expect(applyFlagSpy).toHaveBeenCalledWith('FILE_A', 'temperature', 4, 14, 'K')
  })

  it('with bulk edit on, applying a code calls applyFlag once per selected variable with the same range', async () => {
    const applyFlagSpy = vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-1' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'done',
      error: null,
      result: { audit_id: 1 },
    })
    await selectAndMakeEditable(() => fireEvent.click(screen.getByText('set variables')))
    fireEvent.click(screen.getByText('toggle bulk'))
    fireEvent.click(screen.getByText('select temperature'))
    fireEvent.click(screen.getByText('select humidity'))
    fireEvent.click(screen.getByText('select salinity'))

    fireEvent.click(screen.getByText('K-Suspect/Caution'))

    await waitFor(() => expect(applyFlagSpy).toHaveBeenCalledTimes(3))
    expect(applyFlagSpy).toHaveBeenCalledWith('FILE_A', 'temperature', 4, 14, 'K')
    expect(applyFlagSpy).toHaveBeenCalledWith('FILE_A', 'humidity', 4, 14, 'K')
    expect(applyFlagSpy).toHaveBeenCalledWith('FILE_A', 'salinity', 4, 14, 'K')
    // notifyFlagged fires once for the whole batch, not once per variable.
    await waitFor(() => expect(screen.getByTestId('flag-applied-at')).toHaveTextContent('1'))
  })

  it('with bulk edit on but no variables selected, falls back to the selection\'s own variable', async () => {
    const applyFlagSpy = vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-1' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'done',
      error: null,
      result: { audit_id: 1 },
    })
    await selectAndMakeEditable()
    fireEvent.click(screen.getByText('toggle bulk'))

    fireEvent.click(screen.getByText('K-Suspect/Caution'))

    await waitFor(() => expect(applyFlagSpy).toHaveBeenCalledTimes(1))
    expect(applyFlagSpy).toHaveBeenCalledWith('FILE_A', 'temperature', 4, 14, 'K')
  })

  it('with bulk edit on, a partial failure reports the failing variables and still notifies for the successes', async () => {
    vi.spyOn(apiClient, 'applyFlag').mockImplementation((_file, varName) =>
      Promise.resolve({ job_id: `job-${varName}` })
    )
    vi.spyOn(apiClient, 'jobStatus').mockImplementation((jobId: string) => {
      if (jobId === 'job-humidity') {
        return Promise.resolve({ status: 'failed', error: 'var not found', result: null })
      }
      return Promise.resolve({ status: 'done', error: null, result: { audit_id: 1 } })
    })
    await selectAndMakeEditable(() => fireEvent.click(screen.getByText('set variables')))
    fireEvent.click(screen.getByText('toggle bulk'))
    fireEvent.click(screen.getByText('select temperature'))
    fireEvent.click(screen.getByText('select humidity'))
    fireEvent.click(screen.getByText('select salinity'))

    fireEvent.click(screen.getByText('K-Suspect/Caution'))

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Flagged 2 of 3')
    )
    expect(screen.getByRole('status').textContent).toContain('humidity: var not found')
    // The two successful variables (temperature, salinity) still count.
    expect(screen.getByTestId('flag-applied-at')).toHaveTextContent('1')
  })
})
