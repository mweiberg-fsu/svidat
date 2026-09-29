import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getVariableData } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { useFloatingPanel } from '../hooks/useFloatingPanel'
import { buildTrack, nearestFix, windowSegments, type TrackFix } from '../shipTrack'
import { createSstLayer, sstLegendUrl } from '../sstLayer'

const ESRI_OCEAN_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA, CHS, OSU, UNH, CSUMB, National Geographic, DeLorme, NAVTEQ, and Esri'
const TRACK_COLOR = '#2563eb'
const DIMMED_COLOR = '#64748b'
const HIT_PX = 10

function formatFix(fix: TrackFix): string {
  return `${fix.time.slice(0, 10)} ${fix.time.slice(11, 16)}Z · ${fix.lat.toFixed(3)}, ${fix.lon.toFixed(3)}`
}

// Floating map of the selected file's lat/lon track. Leaflet owns the map
// imperatively inside `mapElRef`; React only drives what's drawn on it.
export function ShipTrackModal({ onClose }: { onClose: () => void }) {
  const { file } = usePlotSelection()
  const { xWindow, timeMarker, setTimeMarker } = useEditSession()
  const panel = useFloatingPanel({ width: 480, height: 400, minWidth: 280, minHeight: 220 })
  const mapElRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const segmentsRef = useRef<TrackFix[][]>([])
  const [segments, setSegments] = useState<TrackFix[][] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<{ fix: TrackFix; x: number; y: number } | null>(null)
  const [trackDate, setTrackDate] = useState<string | null>(null)
  const [sstOn, setSstOn] = useState(false)

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
    })
    map.on('mouseout', () => setHover(null))
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

  // SST overlay for the loaded file's day; recreated when the day changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !sstOn || !trackDate) return
    const layer = createSstLayer(trackDate).addTo(map)
    return () => {
      layer.remove()
    }
  }, [sstOn, trackDate])

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
          onClick={() => setSstOn((v) => !v)}
          title="Sea surface temperature (NOAA OISST v2.1) for the file's date"
        >
          SST
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
        {sstOn && trackDate && (
          <img className="ship-track-legend" src={sstLegendUrl(trackDate)} alt="SST legend" />
        )}
      </div>
      <div className="keybinds-modal-resize-handle" onMouseDown={panel.onResizeMouseDown} />
    </div>
  )
}
