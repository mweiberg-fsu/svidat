import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getSstPoint, getSstSource, getVariableData } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { useFloatingPanel } from '../hooks/useFloatingPanel'
import { buildTrack, nearestFix, windowSegments, type TrackFix } from '../shipTrack'
import { createSstLayer } from '../sstLayer'
import { SstLegend } from './SstLegend'
import { SSS_LEGEND_URL, createSssLayer, formatSssBin, resolveSssDate, sssAt, type SssBin } from '../sssLayer'
import { formatLatLon, snapToSstCell, wrapLon } from '../sstPoint'

const ESRI_OCEAN_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA, CHS, OSU, UNH, CSUMB, National Geographic, DeLorme, NAVTEQ, and Esri'
const TRACK_COLOR = '#2563eb'
const DIMMED_COLOR = '#64748b'
// Pointer must rest this long before an SST lookup (cached cells skip it).
const SST_LOOKUP_DELAY_MS = 250
const HIT_PX = 10
// Default panel size, shrunk to fit smaller windows (leaving this much
// room) so the header and resize grip stay reachable.
const DEFAULT_WIDTH = 960
const DEFAULT_HEIGHT = 800
const MIN_WIDTH = 280
const MIN_HEIGHT = 220
const VIEWPORT_MARGIN_PX = 32

// One map overlay at a time: both are semi-opaque colour fields.
type Overlay = 'none' | 'sst' | 'sss'

function formatFix(fix: TrackFix): string {
  return `${fix.time.slice(0, 10)} ${fix.time.slice(11, 16)}Z · ${fix.lat.toFixed(3)}, ${fix.lon.toFixed(3)}`
}

// Floating map of the selected file's lat/lon track. Leaflet owns the map
// imperatively inside `mapElRef`; React only drives what's drawn on it.
export function ShipTrackModal({ onClose }: { onClose: () => void }) {
  const { file } = usePlotSelection()
  const { xWindow, timeMarker, setTimeMarker } = useEditSession()
  const panel = useFloatingPanel({
    width: Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, window.innerWidth - VIEWPORT_MARGIN_PX)),
    height: Math.max(MIN_HEIGHT, Math.min(DEFAULT_HEIGHT, window.innerHeight - VIEWPORT_MARGIN_PX)),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  })
  const mapElRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const segmentsRef = useRef<TrackFix[][]>([])
  const [segments, setSegments] = useState<TrackFix[][] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<{ fix: TrackFix; x: number; y: number } | null>(null)
  const [trackDate, setTrackDate] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const sstOn = overlay === 'sst'
  const sssOn = overlay === 'sss'
  // Which OISST dataset has the file's day: final, else preliminary (the
  // final one trails real time by ~2 weeks), else none yet.
  const [sstSource, setSstSource] = useState<
    | { status: 'loading' }
    | { status: 'ok'; date: string; dataset: string; preliminary: boolean }
    | { status: 'none' }
    | { status: 'error' }
    | null
  >(null)
  // The salinity map date for the file's day (latest 8-day mean on or
  // before it; GIBS's record has gaps and lags real time).
  const [sssDate, setSssDate] = useState<
    { status: 'loading' } | { status: 'ok'; date: string } | { status: 'none' } | { status: 'error' } | null
  >(null)
  const [sssReading, setSssReading] = useState<
    { status: 'loading' } | { status: 'ok'; bin: SssBin | null } | { status: 'error' } | null
  >(null)
  // "Values": live pointer lat/lon + OISST at that spot. The map's mousemove
  // handler is registered once, so it reads the toggle through a ref.
  const [valuesOn, setValuesOn] = useState(false)
  const valuesOnRef = useRef(false)
  const [pointer, setPointer] = useState<{ lat: number; lon: number } | null>(null)
  const [reading, setReading] = useState<
    | { status: 'loading' }
    | { status: 'ok'; sst: number | null; preliminary: boolean }
    | { status: 'none' }
    | { status: 'error' }
    | null
  >(null)
  // SST per day + 0.25 deg cell (null = land), so revisiting a cell is instant.
  const sstCacheRef = useRef(new Map<string, { sst: number | null; preliminary: boolean }>())

  // Create the map once.
  useEffect(() => {
    if (!mapElRef.current) return
    const map = L.map(mapElRef.current, { worldCopyJump: false }).setView([0, 0], 2)
    L.tileLayer(ESRI_OCEAN_URL, { attribution: ESRI_ATTRIBUTION, maxNativeZoom: 13, maxZoom: 18 }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    const pick = (e: L.LeafletMouseEvent) =>
      nearestFix(
        segmentsRef.current,
        (f) => map.latLngToContainerPoint([f.lat, f.lon]),
        e.containerPoint,
        HIT_PX
      )
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      const fix = pick(e)
      setHover(fix ? { fix, x: e.containerPoint.x, y: e.containerPoint.y } : null)
      if (valuesOnRef.current) setPointer({ lat: e.latlng.lat, lon: wrapLon(e.latlng.lng) })
    })
    map.on('mouseout', () => {
      setHover(null)
      setPointer(null)
    })
    map.on('click', (e: L.LeafletMouseEvent) => setTimeMarker(pick(e)?.idx ?? null))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep Leaflet's size in sync with the resizable panel.
  useEffect(() => {
    mapRef.current?.invalidateSize()
  }, [panel.style.width, panel.style.height])

  // Load the track for the selected file.
  useEffect(() => {
    setSegments(null)
    setError(null)
    setHover(null)
    setTrackDate(null)
    if (!file) return
    let cancelled = false
    getVariableData(file, ['lat', 'lon'])
      .then((d) => {
        if (cancelled) return
        const segs = buildTrack(d.time, d.variables.lat?.values ?? [], d.variables.lon?.values ?? [])
        segmentsRef.current = segs
        setSegments(segs)
        setTrackDate(d.time[0] ? d.time[0].slice(0, 10) : null)
        const all = segs.flat()
        if (all.length && mapRef.current) {
          mapRef.current.fitBounds(L.latLngBounds(all.map((f) => [f.lat, f.lon] as [number, number])), {
            padding: [24, 24],
            maxZoom: 16,
          })
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [file])

  // Redraw track, highlight, start/end and marker pins.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.clearLayers()
    if (!segments || segments.length === 0) return
    const toLatLngs = (seg: TrackFix[]) => seg.map((f) => [f.lat, f.lon] as [number, number])
    const zoomed = xWindow !== null
    for (const seg of segments) {
      L.polyline(toLatLngs(seg), {
        color: zoomed ? DIMMED_COLOR : TRACK_COLOR,
        weight: zoomed ? 2 : 3,
        opacity: zoomed ? 0.5 : 0.9,
      }).addTo(layer)
    }
    if (xWindow) {
      for (const seg of windowSegments(segments, xWindow)) {
        L.polyline(toLatLngs(seg), { color: TRACK_COLOR, weight: 4, opacity: 1 }).addTo(layer)
      }
    }
    const all = segments.flat()
    const start = all[0]
    const end = all[all.length - 1]
    L.circleMarker([start.lat, start.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).addTo(layer)
    L.circleMarker([end.lat, end.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).addTo(layer)
    const marked = timeMarker === null ? undefined : all.find((f) => f.idx === timeMarker)
    if (marked) {
      L.circleMarker([marked.lat, marked.lon], { radius: 7, color: TRACK_COLOR, weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(layer)
    }
  }, [segments, xWindow, timeMarker])

  // Resolve which SST dataset to draw for the file's day.
  useEffect(() => {
    if (!sstOn || !trackDate) {
      setSstSource(null)
      return
    }
    setSstSource({ status: 'loading' })
    let cancelled = false
    getSstSource(trackDate)
      .then((src) => {
        if (cancelled) return
        setSstSource(
          src.dataset
            ? { status: 'ok', date: trackDate, dataset: src.dataset, preliminary: src.preliminary }
            : { status: 'none' }
        )
      })
      .catch(() => {
        if (!cancelled) setSstSource({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [sstOn, trackDate])

  const sstMapDate = sstSource?.status === 'ok' ? sstSource.date : null
  const sstDataset = sstSource?.status === 'ok' ? sstSource.dataset : null

  // SST overlay for the loaded file's day; recreated when the day changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sstMapDate || !sstDataset) return
    const layer = createSstLayer(sstMapDate, sstDataset).addTo(map)
    return () => {
      layer.remove()
    }
  }, [sstMapDate, sstDataset])

  // Resolve which salinity map to show for the file's day.
  useEffect(() => {
    if (!sssOn || !trackDate) {
      setSssDate(null)
      return
    }
    setSssDate({ status: 'loading' })
    let cancelled = false
    resolveSssDate(trackDate)
      .then((date) => {
        if (!cancelled) setSssDate(date ? { status: 'ok', date } : { status: 'none' })
      })
      .catch(() => {
        if (!cancelled) setSssDate({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [sssOn, trackDate])

  const sssMapDate = sssDate?.status === 'ok' ? sssDate.date : null

  useEffect(() => {
    const map = mapRef.current
    if (!map || !sssMapDate) return
    const layer = createSssLayer(sssMapDate).addTo(map)
    return () => {
      layer.remove()
    }
  }, [sssMapDate])

  // Salinity under the pointer while the salinity overlay is on, read from
  // the overlay's own tiles once the pointer pauses.
  useEffect(() => {
    if (!valuesOn || !pointer || !sssMapDate) {
      setSssReading(null)
      return
    }
    const { lat, lon } = pointer
    setSssReading({ status: 'loading' })
    let cancelled = false
    const timer = setTimeout(() => {
      sssAt(sssMapDate, lat, lon)
        .then((bin) => {
          if (!cancelled) setSssReading({ status: 'ok', bin })
        })
        .catch(() => {
          if (!cancelled) setSssReading({ status: 'error' })
        })
    }, SST_LOOKUP_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [valuesOn, pointer, sssMapDate])

  // Look up SST for the pointer's cell once it pauses (cached cells answer
  // immediately); a newer pointer position cancels the pending lookup.
  useEffect(() => {
    if (!valuesOn || !pointer || !trackDate) {
      setReading(null)
      return
    }
    const { lat, lon } = pointer
    const key = `${trackDate}|${snapToSstCell(lat, 89.875)}|${snapToSstCell(lon, 179.875)}`
    const cache = sstCacheRef.current
    const cached = cache.get(key)
    if (cached) {
      setReading({ status: 'ok', ...cached })
      return
    }
    setReading({ status: 'loading' })
    let cancelled = false
    const timer = setTimeout(() => {
      getSstPoint(trackDate, lat, lon)
        .then((r) => {
          const value = { sst: r.sst, preliminary: r.preliminary }
          cache.set(key, value)
          if (!cancelled) setReading({ status: 'ok', ...value })
        })
        .catch((err: unknown) => {
          // apiFetch errors read "<status>: <body>"; 404 = no data that day.
          const noData = err instanceof Error && err.message.startsWith('404')
          if (!cancelled) setReading({ status: noData ? 'none' : 'error' })
        })
    }, SST_LOOKUP_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [valuesOn, pointer, trackDate])

  const toggleValues = () => {
    valuesOnRef.current = !valuesOn
    setValuesOn(!valuesOn)
    setPointer(null)
  }

  const sstText =
    reading === null
      ? ''
      : reading.status === 'loading'
        ? 'SST …'
        : reading.status === 'error'
          ? 'SST unavailable'
          : reading.status === 'none'
            ? 'SST: no data for this date yet'
            : reading.sst === null
              ? 'SST: no data (land)'
              : `SST ${reading.sst.toFixed(2)} °C${reading.preliminary ? ' (preliminary)' : ''}`

  const sstCaption =
    sstSource === null
      ? ''
      : sstSource.status === 'loading'
        ? 'Loading SST…'
        : sstSource.status === 'error'
          ? 'SST unavailable'
          : sstSource.status === 'none'
            ? `No SST data for ${trackDate} yet`
            : sstSource.preliminary
              ? 'Preliminary OISST (final not yet available)'
              : ''

  const sssText =
    sssReading === null
      ? ''
      : sssReading.status === 'loading'
        ? 'SSS …'
        : sssReading.status === 'error'
          ? 'SSS unavailable'
          : sssReading.bin === null
            ? 'SSS: no data'
            : `SSS ${formatSssBin(sssReading.bin)} PSU`

  const sssCaption =
    sssDate === null
      ? ''
      : sssDate.status === 'loading'
        ? 'Loading salinity…'
        : sssDate.status === 'error'
          ? 'Salinity unavailable'
          : sssDate.status === 'none'
            ? `No salinity data on or within 30 days before ${trackDate}`
            : `8-day mean ending ${sssDate.date}`

  const message = !file
    ? 'Select a file to see its track.'
    : error
      ? `Error: ${error}`
      : segments === null
        ? 'Loading…'
        : segments.length === 0
          ? 'No position data in this file.'
          : null

  return (
    <div className="keybinds-modal ship-track-modal" style={panel.style} onMouseDownCapture={panel.onPanelMouseDown}>
      <div className="keybinds-modal-header" onMouseDown={panel.onHeaderMouseDown}>
        <span>Ship Track</span>
        <button type="button" className="keybinds-modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
      </div>
      <div className="ship-track-toolbar" role="toolbar" aria-label="Overlays">
        <span className="ship-track-toolbar-label">Overlays</span>
        <button
          type="button"
          className={`files-toolbar-btn${sstOn ? ' active' : ''}`}
          aria-pressed={sstOn}
          disabled={!trackDate}
          onClick={() => setOverlay((o) => (o === 'sst' ? 'none' : 'sst'))}
          title="Sea surface temperature (NOAA OISST v2.1) for the file's date; preliminary data for recent days the final dataset doesn't have yet"
        >
          SST
        </button>
        <button
          type="button"
          className={`files-toolbar-btn${sssOn ? ' active' : ''}`}
          aria-pressed={sssOn}
          disabled={!trackDate}
          onClick={() => setOverlay((o) => (o === 'sss' ? 'none' : 'sss'))}
          title="Sea surface salinity (NASA SMAP 8-day mean, via NASA GIBS/Worldview) for the file's date"
        >
          Salinity
        </button>
        <button
          type="button"
          className={`files-toolbar-btn${valuesOn ? ' active' : ''}`}
          aria-pressed={valuesOn}
          disabled={!trackDate}
          onClick={toggleValues}
          title="Show the position, SST and (with the Salinity overlay) salinity under the mouse pointer"
        >
          Values
        </button>
      </div>
      <div className="ship-track-modal-body">
        <div ref={mapElRef} className="ship-track-map" />
        {message && <p className="ship-track-message">{message}</p>}
        {hover && (
          <div className="ship-track-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {formatFix(hover.fix)}
          </div>
        )}
        {sstOn && sstSource && (
          <div className="ship-track-legend" data-testid="sst-legend">
            {sstSource.status === 'ok' && <SstLegend />}
            {sstCaption && <span className="ship-track-legend-caption">{sstCaption}</span>}
          </div>
        )}
        {sssOn && sssDate && (
          <div className="ship-track-legend" data-testid="sss-legend">
            {sssDate.status === 'ok' && <img src={SSS_LEGEND_URL} alt="Salinity legend" />}
            <span className="ship-track-legend-caption">{sssCaption}</span>
          </div>
        )}
        {valuesOn && (
          <div className="ship-track-values" data-testid="ship-track-values">
            {pointer ? (
              <>
                <span>{formatLatLon(pointer.lat, pointer.lon)}</span>
                <span className="ship-track-values-sst">{sstText}</span>
                {sssText && <span className="ship-track-values-sst">{sssText}</span>}
              </>
            ) : (
              <span>Move the pointer over the map</span>
            )}
          </div>
        )}
      </div>
      <div className="keybinds-modal-resize-handle" onMouseDown={panel.onResizeMouseDown} />
    </div>
  )
}
