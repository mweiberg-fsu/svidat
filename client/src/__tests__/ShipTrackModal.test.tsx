import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { AuthProvider } from '../context/AuthContext'
import * as apiClient from '../api/client'
import { setToken } from '../api/client'

// Minimal Leaflet stand-in: records layers and map event handlers.
const drawn = vi.hoisted(() => ({
  polylines: [] as { latlngs: [number, number][]; options: Record<string, unknown> }[],
  markers: [] as { latlng: [number, number]; options: Record<string, unknown> }[],
  handlers: {} as Record<string, (e: unknown) => void>,
  fitBounds: vi.fn(),
}))
vi.mock('leaflet', () => {
  const layerGroup = () => {
    const g = {
      addTo: () => g,
      clearLayers: () => {
        drawn.polylines.length = 0
        drawn.markers.length = 0
      },
    }
    return g
  }
  const map = () => {
    const m = {
      setView: () => m,
      fitBounds: drawn.fitBounds,
      on: (ev: string, fn: (e: unknown) => void) => {
        drawn.handlers[ev] = fn
        return m
      },
      remove: () => {},
      invalidateSize: () => {},
      latLngToContainerPoint: ([lat, lng]: [number, number]) => ({ x: lng * 100, y: -lat * 100 }),
    }
    return m
  }
  const L = {
    map,
    tileLayer: () => ({ addTo: () => ({}) }),
    layerGroup,
    polyline: (latlngs: [number, number][], options: Record<string, unknown>) => ({
      addTo: () => drawn.polylines.push({ latlngs, options }),
    }),
    circleMarker: (latlng: [number, number], options: Record<string, unknown>) => ({
      addTo: () => drawn.markers.push({ latlng, options }),
    }),
    latLngBounds: (pts: unknown) => pts,
  }
  return { default: L, ...L }
})

const sst = vi.hoisted(() => ({
  created: [] as string[],
  added: 0,
  removed: 0,
}))
vi.mock('../sstLayer', () => ({
  createSstLayer: (date: string) => {
    sst.created.push(date)
    const layer = {
      addTo: () => {
        sst.added++
        return layer
      },
      remove: () => {
        sst.removed++
      },
    }
    return layer
  },
  sstLegendUrl: (date: string) => `legend:${date}`,
}))

import { ShipTrackModal } from '../components/ShipTrackModal'

function Probe({ file, file2 }: { file: string | null; file2?: string }) {
  const sel = usePlotSelection()
  const { timeMarker } = useEditSession()
  return (
    <>
      {file && <button onClick={() => sel.setFile(file)}>set file</button>}
      {file2 && <button onClick={() => sel.setFile(file2)}>set file 2</button>}
      <span data-testid="time-marker">{timeMarker ?? 'none'}</span>
    </>
  )
}

function renderModal(file: string | null, file2?: string) {
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(['user']))
  localStorage.setItem('svidat_username', 'u')
  const utils = render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Probe file={file} file2={file2} />
            <ShipTrackModal onClose={() => {}} />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
  if (file) act(() => screen.getByText('set file').click())
  return utils
}

describe('ShipTrackModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    drawn.polylines.length = 0
    drawn.markers.length = 0
    drawn.handlers = {}
    drawn.fitBounds.mockClear()
    sst.created.length = 0
    sst.added = 0
    sst.removed = 0
  })

  it('asks for a file when none is selected', () => {
    renderModal(null)
    expect(screen.getByText('Ship Track')).toBeInTheDocument()
    expect(screen.getByText('Select a file to see its track.')).toBeInTheDocument()
  })

  it('fetches lat/lon and draws the track with start/end markers, lon normalized', async () => {
    const spy = vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2022-04-24T00:00:00', '2022-04-24T01:00:00', '2022-04-24T02:00:00'],
      variables: {
        lat: { values: [28.871, 28.872, 28.873], flags: null },
        lon: { values: [270.68, 270.69, 270.7], flags: null },
      },
    })
    renderModal('FILE_A')
    await waitFor(() => expect(drawn.polylines.length).toBeGreaterThan(0))
    expect(spy).toHaveBeenCalledWith('FILE_A', ['lat', 'lon'])
    const line = drawn.polylines[0].latlngs
    expect(line).toHaveLength(3)
    expect(line[0][1]).toBeCloseTo(-89.32)
    expect(drawn.markers.map((m) => m.latlng[0])).toEqual([28.871, 28.873]) // start, end
    expect(drawn.fitBounds).toHaveBeenCalled()
  })

  it('says so when the file has no position data', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2022-04-24T00:00:00'],
      variables: { lat: { values: [null], flags: null }, lon: { values: [null], flags: null } },
    })
    renderModal('FILE_A')
    expect(await screen.findByText('No position data in this file.')).toBeInTheDocument()
  })

  it('clicking near a fix sets the shared time marker; clicking away clears it', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2022-04-24T00:00:00', '2022-04-24T01:00:00'],
      variables: {
        lat: { values: [0, 0], flags: null },
        lon: { values: [0, 1], flags: null },
      },
    })
    renderModal('FILE_A')
    await waitFor(() => expect(drawn.handlers.click).toBeDefined())
    // Mock projection: x = lng*100, y = -lat*100 -> fix 1 is at (100, 0).
    act(() => drawn.handlers.click({ containerPoint: { x: 103, y: 2 } }))
    expect(screen.getByTestId('time-marker')).toHaveTextContent('1')
    act(() => drawn.handlers.click({ containerPoint: { x: 500, y: 500 } }))
    expect(screen.getByTestId('time-marker')).toHaveTextContent('none')
  })

  it('has an Overlays toolbar whose SST toggle is disabled until the track loads', async () => {
    let resolve!: (v: unknown) => void
    vi.spyOn(apiClient, 'getVariableData').mockReturnValue(new Promise((r) => (resolve = r)) as never)
    renderModal('FILE_A')
    const sstBtn = screen.getByRole('button', { name: 'SST' })
    expect(sstBtn).toBeDisabled()
    expect(sstBtn).toHaveAttribute('aria-pressed', 'false')
    await act(async () =>
      resolve({
        time: ['2019-03-01T14:19:00'],
        variables: { lat: { values: [32.8], flags: null }, lon: { values: [280.05], flags: null } },
      })
    )
    expect(sstBtn).toBeEnabled()
  })

  it('toggling SST adds the OISST layer for the file date and shows the legend; toggling off removes both', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2019-03-01T14:19:00', '2019-03-01T15:19:00'],
      variables: {
        lat: { values: [32.8, 32.7], flags: null },
        lon: { values: [280.05, 280.1], flags: null },
      },
    })
    renderModal('FILE_A')
    const sstBtn = screen.getByRole('button', { name: 'SST' })
    await waitFor(() => expect(sstBtn).toBeEnabled())

    act(() => sstBtn.click())
    expect(sstBtn).toHaveAttribute('aria-pressed', 'true')
    expect(sst.created).toEqual(['2019-03-01'])
    expect(sst.added).toBe(1)
    expect(screen.getByAltText('SST legend')).toHaveAttribute('src', 'legend:2019-03-01')

    act(() => sstBtn.click())
    expect(sst.removed).toBe(1)
    expect(screen.queryByAltText('SST legend')).not.toBeInTheDocument()
  })

  it('switching files with SST on redraws it for the new file date', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockImplementation(async (file: string) => ({
      time: [file === 'FILE_A' ? '2019-03-01T00:00:00' : '2020-07-04T00:00:00'],
      variables: { lat: { values: [1], flags: null }, lon: { values: [2], flags: null } },
    }))
    renderModal('FILE_A', 'FILE_B')
    const sstBtn = screen.getByRole('button', { name: 'SST' })
    await waitFor(() => expect(sstBtn).toBeEnabled())
    act(() => sstBtn.click())
    act(() => screen.getByText('set file 2').click())
    await waitFor(() => expect(sst.created).toEqual(['2019-03-01', '2020-07-04']))
    expect(sst.removed).toBeGreaterThanOrEqual(1)
    expect(screen.getByAltText('SST legend')).toHaveAttribute('src', 'legend:2020-07-04')
  })

  describe('Values readout', () => {
    const TRACK = {
      time: ['2019-03-01T14:19:00', '2019-03-01T15:19:00'],
      variables: {
        lat: { values: [32.8, 32.7], flags: null },
        lon: { values: [280.05, 280.1], flags: null },
      },
    }
    const move = (lat: number, lng: number) =>
      act(() => drawn.handlers.mousemove({ containerPoint: { x: 9999, y: 9999 }, latlng: { lat, lng } }))

    async function openValues() {
      vi.spyOn(apiClient, 'getVariableData').mockResolvedValue(TRACK)
      renderModal('FILE_A')
      const btn = screen.getByRole('button', { name: 'Values' })
      await waitFor(() => expect(btn).toBeEnabled())
      act(() => btn.click())
      expect(btn).toHaveAttribute('aria-pressed', 'true')
    }

    it('is disabled until the track loads, and hidden readout while off', async () => {
      let resolve!: (v: unknown) => void
      vi.spyOn(apiClient, 'getVariableData').mockReturnValue(new Promise((r) => (resolve = r)) as never)
      renderModal('FILE_A')
      expect(screen.getByRole('button', { name: 'Values' })).toBeDisabled()
      await act(async () => resolve(TRACK))
      expect(screen.getByRole('button', { name: 'Values' })).toBeEnabled()
      expect(screen.queryByTestId('ship-track-values')).not.toBeInTheDocument()
    })

    it('shows pointer lat/lon and the SST for the file date after the pointer pauses', async () => {
      const spy = vi.spyOn(apiClient, 'getSstPoint').mockResolvedValue({
        date: '2019-03-01',
        lat: 27.625,
        lon: -84.375,
        sst: 28.06,
      })
      await openValues()
      const readout = screen.getByTestId('ship-track-values')
      expect(readout).toHaveTextContent('Move the pointer over the map')

      move(27.6, -84.3)
      expect(readout).toHaveTextContent('27.60°N, 84.30°W')
      expect(readout).toHaveTextContent('SST …')
      expect(spy).not.toHaveBeenCalled() // debounced: waits for the pointer to pause
      await waitFor(() => expect(spy).toHaveBeenCalledWith('2019-03-01', 27.6, -84.3))
      await waitFor(() => expect(readout).toHaveTextContent('SST 28.06 °C'))
    })

    it('reuses the cached value for the same grid cell', async () => {
      const spy = vi.spyOn(apiClient, 'getSstPoint').mockResolvedValue({
        date: '2019-03-01',
        lat: 27.625,
        lon: -84.375,
        sst: 28.06,
      })
      await openValues()
      const readout = screen.getByTestId('ship-track-values')
      move(27.6, -84.3)
      await waitFor(() => expect(readout).toHaveTextContent('SST 28.06 °C'))
      move(10, 10)
      move(27.55, -84.26) // same 0.25 deg cell
      expect(readout).toHaveTextContent('SST 28.06 °C')
      await new Promise((r) => setTimeout(r, 350))
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('says no data over land and unavailable on errors', async () => {
      const spy = vi
        .spyOn(apiClient, 'getSstPoint')
        .mockResolvedValueOnce({ date: '2019-03-01', lat: 39.625, lon: -99.875, sst: null })
        .mockRejectedValueOnce(new Error('502: {"detail":"SST service unavailable"}'))
      await openValues()
      const readout = screen.getByTestId('ship-track-values')
      move(39.5, -100)
      await waitFor(() => expect(readout).toHaveTextContent('SST: no data (land)'))
      move(5, 5)
      await waitFor(() => expect(readout).toHaveTextContent('SST unavailable'))
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('wraps longitude from map world copies into -180..180', async () => {
      const spy = vi.spyOn(apiClient, 'getSstPoint').mockResolvedValue({
        date: '2019-03-01',
        lat: 0.125,
        lon: -79.875,
        sst: 27,
      })
      await openValues()
      move(0.1, 280.1)
      expect(screen.getByTestId('ship-track-values')).toHaveTextContent('0.10°N, 79.90°W')
      await waitFor(() => expect(spy).toHaveBeenCalled())
      expect(spy.mock.calls[0][2]).toBeCloseTo(-79.9)
    })

    it('clears the position when the pointer leaves the map', async () => {
      vi.spyOn(apiClient, 'getSstPoint').mockResolvedValue({ date: '2019-03-01', lat: 1, lon: 1, sst: 1 })
      await openValues()
      move(1, 1)
      act(() => drawn.handlers.mouseout({}))
      expect(screen.getByTestId('ship-track-values')).toHaveTextContent('Move the pointer over the map')
    })
  })
})
