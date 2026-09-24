import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlotPicker } from '../components/PlotPicker'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import * as apiClient from '../api/client'

function VariablesConsumer() {
  const { variables } = usePlotSelection()
  return <div data-testid="selected-variables">variables:{variables.join(',')}</div>
}

function renderPicker() {
  return render(
    <MemoryRouter>
      <PlotSelectionProvider>
        <PlotPicker />
      </PlotSelectionProvider>
    </MemoryRouter>
  )
}

function renderPickerWithConsumer() {
  return render(
    <MemoryRouter>
      <PlotSelectionProvider>
        <PlotPicker />
        <VariablesConsumer />
      </PlotSelectionProvider>
    </MemoryRouter>
  )
}

describe('PlotPicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('cascades ship -> year -> file and resets downstream selections', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'], '2026': ['KAQP_20260115v20001'] },
      WTDF: { '2025': ['WTDF_20250601v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { temperature: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} } },
      dimensions: { time: 5 },
    })
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'WTDF' } })

    const yearSelect = screen.getByLabelText('Year') as HTMLSelectElement
    expect(yearSelect.value).toBe('')

    // Now prove that File actually clears too: select ship -> year -> file,
    // then change year again and confirm the File select resets to ''.
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })

    const fileSelect = screen.getByLabelText('File') as HTMLSelectElement
    await waitFor(() => expect(fileSelect.value).toBe('KAQP_20250101v20001'))

    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } })
    expect(fileSelect.value).toBe('')
  })

  it('propagates variable selection into shared PlotSelection state', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        temperature: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
        salinity: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
      },
      dimensions: { time: 5 },
    })
    renderPickerWithConsumer()

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })

    await waitFor(() => expect(screen.getByLabelText('Variables')).toBeInTheDocument())

    const variablesSelect = screen.getByLabelText('Variables') as HTMLSelectElement
    const option = Array.from(variablesSelect.options).find((o) => o.value === 'temperature')!
    option.selected = true
    fireEvent.change(variablesSelect)

    await waitFor(() =>
      expect(screen.getByTestId('selected-variables')).toHaveTextContent(
        'variables:temperature'
      )
    )
  })

  it('shows an error when fetching file metadata fails', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockRejectedValue(new Error('boom'))
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })

    await waitFor(() => expect(screen.getByText(/Error:/)).toBeInTheDocument())
    expect(screen.queryByLabelText('Variables')).not.toBeInTheDocument()
  })

  it('only offers 1-D time-series variables, excluding flag/history', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        temperature: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
        flag: { dims: ['time', 'f_string'], shape: [5, 2], dtype: '|S1', attrs: {} },
        history: { dims: ['h_num', 'h_string'], shape: [1, 2], dtype: '|S1', attrs: {} },
      },
      dimensions: { time: 5, f_string: 2, h_num: 1, h_string: 2 },
    })
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })

    await waitFor(() => expect(screen.getByLabelText('Variables')).toBeInTheDocument())
    const variablesSelect = screen.getByLabelText('Variables') as HTMLSelectElement
    const optionValues = Array.from(variablesSelect.options).map((o) => o.value)
    expect(optionValues).toEqual(['temperature'])
  })

  it('lists variables in netCDF file order, not alphabetically', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        lat: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
        lon: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
        PL_HD: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
        DIR: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
        T: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
      },
      dimensions: { time: 5 },
    })
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })

    await waitFor(() => expect(screen.getByLabelText('Variables')).toBeInTheDocument())
    const variablesSelect = screen.getByLabelText('Variables') as HTMLSelectElement
    const optionValues = Array.from(variablesSelect.options).map((o) => o.value)
    expect(optionValues).toEqual(['lat', 'lon', 'PL_HD', 'DIR', 'T'])
  })

  it('shows a multi-select hint next to the Variables label', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { T: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} } },
      dimensions: { time: 5 },
    })
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })

    const icon = await screen.findByRole('img', { name: 'How to select multiple variables' })
    expect(icon).toHaveAccessibleDescription(/(Cmd|Ctrl)\+click to select multiple/)
    expect(icon).toHaveAccessibleDescription(/Click-and-drag/)
  })

  it('hides variables with qcindex = 1 (date, time, time_of_day)', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        date: { dims: ['time'], shape: [5], dtype: 'int32', attrs: { qcindex: 1 } },
        time: { dims: ['time'], shape: [5], dtype: 'int32', attrs: { qcindex: 1 } },
        time_of_day: { dims: ['time'], shape: [5], dtype: 'int32', attrs: { qcindex: [1] } },
        lat: { dims: ['time'], shape: [5], dtype: 'float32', attrs: { qcindex: 2 } },
        T: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
      },
      dimensions: { time: 5 },
    })
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })

    await waitFor(() => expect(screen.getByLabelText('Variables')).toBeInTheDocument())
    const variablesSelect = screen.getByLabelText('Variables') as HTMLSelectElement
    const optionValues = Array.from(variablesSelect.options).map((o) => o.value)
    expect(optionValues).toEqual(['lat', 'T'])
  })
})
