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

import { ShipTrackModal } from '../components/ShipTrackModal'

function Probe({ file }: { file: string | null }) {
  const sel = usePlotSelection()
  const { timeMarker } = useEditSession()
  return (
    <>
      {file && <button onClick={() => sel.setFile(file)}>set file</button>}
      <span data-testid="time-marker">{timeMarker ?? 'none'}</span>
    </>
  )
}

function renderModal(file: string | null) {
  setToken('tok')
  localStorage.setItem('svidat_role', JSON.stringify(['user']))
  localStorage.setItem('svidat_username', 'u')
  const utils = render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Probe file={file} />
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
})
