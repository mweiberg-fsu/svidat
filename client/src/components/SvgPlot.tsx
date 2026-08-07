import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { getFileMetadata, getVariableData } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import type { FileMetadata, VariableDataResponse } from '../api/types'
import { useEditSession } from '../context/EditSessionContext'
import { FLAG_CODES } from '../constants/flagCodes'

// Fallbacks used only before the container's first real measurement (or in
// environments without ResizeObserver, e.g. jsdom in tests) — actual
// rendered size is measured per-instance so plots fill the window and
// respond to resizing; see the layout effect in SvgPlot.
const DEFAULT_WIDTH = 900
const DEFAULT_ROW_HEIGHT = 200
const MIN_ROW_HEIGHT = 250
const MAX_ROW_HEIGHT = 400
// Reserved space below the plot container (padding, scroll margin) when
// fitting row heights to the remaining viewport height.
const BOTTOM_PADDING = 24

const MARGIN = { top: 26, right: 20, bottom: 36, left: 70 }
const Y_TICK_COUNT = 5
const MIN_DRAG_PX = 4

const AXIS_COLOR = '#444444'
const GRID_COLOR = '#eeeeee'
const TICK_LABEL_COLOR = '#444444'
const LINE_COLOR = '#000000'
const ACTIVE_COLOR = '#2563eb'
const ZOOM_BOX_FILL = 'rgba(37, 99, 235, 0.15)'
const FLAG_MARKER_COLORS = [
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
  '#7c3aed',
  '#db2777',
  '#4b5563',
]
const FLAG_HIGHLIGHT_COLOR = '#ff00ff'
const FLAG_HIGHLIGHT_FILL_OPACITY = 0.15
const FLAG_HIGHLIGHT_PAD_PX = 12
const FONT_FAMILY = 'Arial, sans-serif'
const TOOLTIP_BG_COLOR = '#1f2937'
const TOOLTIP_TEXT_COLOR = '#ffffff'

// Inclusive [startIdx, endIdx] window into the shared time axis. `null` means
// full extent — every row zooms to the same window since they share one
// timeline, so this lives once at the top rather than per-row.
type XRange = [number, number] | null

interface Scale {
  min: number
  max: number
  yTicks: number[]
  x: (i: number) => number
  y: (v: number) => number
}

// Y auto-fits to whatever's visible in [startIdx, endIdx] — X maps that same
// window onto the full plot width, so zooming in only changes which slice of
// `values`/`i` the scale covers, not the plot's pixel dimensions. `yOverride`
// pins the Y range instead (from a Ctrl+drag on this row), bypassing auto-fit.
//
// The Y *pixel mapping* uses niceTicks' rounded [min, max] rather than the
// raw data/override range — niceTicks intentionally rounds outward so grid
// lines land on human-friendly numbers, and if the pixel domain didn't
// follow that rounding too, a rounded tick just past the real data max would
// map to a pixel above MARGIN.top (off the top of the plot, overlapping the
// title). Using the rounded domain for both keeps every tick inside the
// plot by construction, with the data getting a little breathing room at
// the top/bottom as a side effect — standard charting behavior.
function buildScale(
  values: (number | null)[],
  startIdx: number,
  endIdx: number,
  width: number,
  height: number,
  yOverride?: [number, number]
): Scale {
  const innerWidth = width - MARGIN.left - MARGIN.right
  const innerHeight = height - MARGIN.top - MARGIN.bottom
  const span = endIdx - startIdx || 1

  let rawMin: number
  let rawMax: number
  if (yOverride) {
    ;[rawMin, rawMax] = yOverride
  } else {
    const windowValues = values.slice(startIdx, endIdx + 1)
    const numeric = windowValues.filter((v): v is number => v !== null)
    rawMin = numeric.length ? Math.min(...numeric) : 0
    rawMax = numeric.length ? Math.max(...numeric) : 1
  }

  const { ticks: yTicks, min, max } = niceTicks(rawMin, rawMax, Y_TICK_COUNT)
  const range = max - min || 1

  return {
    min,
    max,
    yTicks,
    x: (i) => MARGIN.left + ((i - startIdx) / span) * innerWidth,
    y: (v) => MARGIN.top + innerHeight - ((v - min) / range) * innerHeight,
  }
}

function buildPath(
  values: (number | null)[],
  scale: Scale,
  startIdx: number,
  endIdx: number
): string {
  let d = ''
  for (let i = startIdx; i <= endIdx; i++) {
    const v = values[i]
    if (v === null || v === undefined) continue
    d += d === '' ? `M${scale.x(i)},${scale.y(v)}` : `L${scale.x(i)},${scale.y(v)}`
  }
  return d
}

// Converts a pixel offset (within one row's plot area) back to a data
// index, given the index range [startIdx, endIdx] that pixel range
// currently maps across. Shared by the X-zoom and flag-drag mouseup
// handlers, which both need to turn a drag's pixel endpoints into indices.
function pxToIdx(
  px: number,
  startIdx: number,
  endIdx: number,
  plotWidth: number,
  dataLength: number
): number {
  const innerWidth = plotWidth - MARGIN.left - MARGIN.right
  const span = endIdx - startIdx || 1
  const idx = startIdx + Math.round(((px - MARGIN.left) / innerWidth) * span)
  return Math.max(0, Math.min(idx, dataLength - 1))
}

interface FlagMarker {
  idx: number
  code: string
  color: string
}

// The row's dominant flag code — the code counted "normal"/unflagged.
// Ties go to whichever code appears first in `flags` (Map iteration order),
// matching the original inline behavior this was extracted from.
function computeModeCode(flags: string[]): string {
  const counts = new Map<string, number>()
  for (const f of flags) counts.set(f, (counts.get(f) ?? 0) + 1)

  let modeCode = ''
  let modeCount = -1
  for (const [code, count] of counts) {
    if (count > modeCount) {
      modeCode = code
      modeCount = count
    }
  }
  return modeCode
}

// A row's flag markers: the mode (most common) flag code is "normal" and
// gets no marker; every other point in [startIdx, endIdx] that has a
// non-null value gets a marker, colored by first-appearance order across
// the row's *full* flags array (not just the visible window) so a color
// stays assigned to the same code as the user zooms in and out.
function buildFlagMarkers(
  flags: string[] | null,
  values: (number | null)[],
  startIdx: number,
  endIdx: number
): { markers: FlagMarker[]; legendCodes: string[] } {
  if (!flags) return { markers: [], legendCodes: [] }
  const modeCode = computeModeCode(flags)

  const colorForCode = new Map<string, string>()
  const legendCodes: string[] = []
  for (const f of flags) {
    if (f === modeCode) continue
    if (!colorForCode.has(f)) {
      colorForCode.set(f, FLAG_MARKER_COLORS[legendCodes.length % FLAG_MARKER_COLORS.length])
      legendCodes.push(f)
    }
  }

  const markers: FlagMarker[] = []
  for (let i = startIdx; i <= endIdx; i++) {
    const f = flags[i]
    if (f === undefined || f === modeCode) continue
    if (values[i] === null || values[i] === undefined) continue
    markers.push({ idx: i, code: f, color: colorForCode.get(f)! })
  }
  return { markers, legendCodes }
}

// Builds one path `d` string per contiguous run of "flagged" (non-mode,
// non-null) points in [startIdx, endIdx] — same "flagged" rule as
// buildFlagMarkers, but merges adjacent flagged points into one line
// instead of separate markers, so a committed flag range reads as a
// magenta segment on the data line itself. A run breaks on an unflagged
// point, a null value, or the end of the window — it never spans a gap.
function buildFlagSegments(
  flags: string[] | null,
  values: (number | null)[],
  scale: Scale,
  startIdx: number,
  endIdx: number
): string[] {
  if (!flags) return []
  const modeCode = computeModeCode(flags)

  const segments: string[] = []
  let current = ''
  for (let i = startIdx; i <= endIdx; i++) {
    const f = flags[i]
    const v = values[i]
    const flagged = f !== undefined && f !== modeCode && v !== null && v !== undefined
    if (flagged) {
      current +=
        current === '' ? `M${scale.x(i)},${scale.y(v as number)}` : `L${scale.x(i)},${scale.y(v as number)}`
    } else if (current !== '') {
      segments.push(current)
      current = ''
    }
  }
  if (current !== '') segments.push(current)
  return segments
}

// Y-extent (in plot pixels) a magenta highlight band should cover for a
// selected/flagged index range — tight around the values actually present
// in that range (not the full row height), padded a few px, and clamped to
// the plot's inner vertical extent. Returns null when the range has no
// numeric values (nothing to highlight around).
function computeTightBand(
  values: (number | null)[],
  startIdx: number,
  endIdx: number,
  scale: Scale,
  rowHeight: number
): { y: number; height: number } | null {
  const windowValues = values.slice(startIdx, endIdx + 1)
  const numeric = windowValues.filter((v): v is number => v !== null && v !== undefined)
  if (numeric.length === 0) return null

  const dataMin = Math.min(...numeric)
  const dataMax = Math.max(...numeric)
  // scale.y is inverted (larger value -> smaller pixel y).
  const rawTop = Math.min(scale.y(dataMax), scale.y(dataMin)) - FLAG_HIGHLIGHT_PAD_PX
  const rawBottom = Math.max(scale.y(dataMax), scale.y(dataMin)) + FLAG_HIGHLIGHT_PAD_PX

  const plotTop = MARGIN.top
  const plotBottom = rowHeight - MARGIN.bottom
  const y = Math.max(plotTop, rawTop)
  const bottom = Math.min(plotBottom, rawBottom)
  return { y, height: Math.max(0, bottom - y) }
}

// Derives an approximate [startIdx, endIdx] selection range from an
// in-progress flag-drag's pixel span, via the same px->idx conversion the
// drag's own mouseup handler uses. Only valid to call while `flagDragStartRef`
// still holds the gesture's start data — the mousedown/mouseup handlers
// always write `flagDrag` state and `flagDragStartRef.current` together, so
// by the time `flagDrag` is non-null for a row, the ref is guaranteed set.
function computeDragHighlightRange(
  flagDrag: { varName: string; startPx: number; currentPx: number },
  start: FlagDragStart,
  plotWidth: number,
  dataLength: number
): [number, number] {
  const a = pxToIdx(flagDrag.startPx, start.startIdx, start.endIdx, plotWidth, dataLength)
  const b = pxToIdx(flagDrag.currentPx, start.startIdx, start.endIdx, plotWidth, dataLength)
  return [Math.min(a, b), Math.max(a, b)]
}

// Rounds a step size up to the nearest "nice" 1/2/5-times-a-power-of-ten
// value — the same rule Plotly (and most charting libs) use so axis ticks
// land on human-friendly numbers instead of jagged fractions.
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / 10 ** exponent
  let niceFraction: number
  if (round) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else {
    if (fraction <= 1) niceFraction = 1
    else if (fraction <= 2) niceFraction = 2
    else if (fraction <= 5) niceFraction = 5
    else niceFraction = 10
  }
  return niceFraction * 10 ** exponent
}

// Returns tick values on a "nice" interval, along with the rounded
// [min, max] those ticks span — callers that use this range as the actual
// plot domain (not just for picking tick values) get every tick landing
// inside it by construction; see buildScale's Y-domain comment.
function niceTicks(
  min: number,
  max: number,
  tickCount: number
): { ticks: number[]; min: number; max: number } {
  const step = niceNum((max - min || 1) / (tickCount - 1), true)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  const epsilon = step * 1e-9
  for (let v = niceMin; v <= niceMax + epsilon; v += step) {
    ticks.push(Number(v.toFixed(10)))
  }
  return { ticks, min: niceMin, max: niceMax }
}

function formatTimeTick(iso: string, showDate: boolean, showSeconds: boolean): string {
  const date = iso.slice(0, 10)
  const time = showSeconds ? iso.slice(11, 19) : iso.slice(11, 16)
  return showDate ? `${date} ${time}` : time
}

// Finds the data index closest to a target timestamp via binary search —
// `times` is sorted ascending, so this beats a linear scan per tick.
function closestIndex(times: number[], target: number): number {
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < target) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(times[lo - 1] - target) < Math.abs(times[lo] - target)) return lo - 1
  return lo
}

const X_TICK_TARGET = 5

// Round, human-friendly tick intervals to choose from, ascending. Mirrors
// niceNum/niceTicks' 1/2/5-per-decade rule but for wall-clock time units,
// where the "decades" are seconds → minutes → hours → days rather than
// powers of ten.
const NICE_TIME_STEPS_MS = [
  1000, 5000, 10000, 15000, 30000, // seconds
  60000, 5 * 60000, 10 * 60000, 15 * 60000, 30 * 60000, // minutes
  3600000, 2 * 3600000, 3 * 3600000, 4 * 3600000, 6 * 3600000, 12 * 3600000, // hours
  86400000, 2 * 86400000, 7 * 86400000, // days / weeks
]

// Smallest nice step that still keeps the tick count near `targetTicks` —
// same "round up to the next nice value" idea as niceNum, just against a
// fixed list instead of a 1/2/5 formula, since time units aren't decimal.
function chooseTimeStep(spanMs: number, targetTicks: number): number {
  const ideal = spanMs / (targetTicks - 1)
  for (const step of NICE_TIME_STEPS_MS) {
    if (step >= ideal) return step
  }
  return NICE_TIME_STEPS_MS[NICE_TIME_STEPS_MS.length - 1]
}

// Rounds `date` up to the next `stepMs` boundary in local wall-clock time.
// Below the hour, native setSeconds/setMinutes already round in local time
// with no DST/offset subtlety to worry about. At/above the hour, alignment
// must go through getHours/setHours (not raw epoch-ms division) — dividing
// epoch ms directly only lands on clean marks when the runtime's UTC offset
// happens to be a whole multiple of the step; anywhere else it drifts.
function alignToStep(date: Date, stepMs: number): Date {
  const cursor = new Date(date)
  if (stepMs < 60000) {
    const stepSec = stepMs / 1000
    cursor.setMilliseconds(0)
    cursor.setSeconds(Math.ceil(cursor.getSeconds() / stepSec) * stepSec)
  } else if (stepMs < 3600000) {
    const stepMin = stepMs / 60000
    cursor.setSeconds(0, 0)
    cursor.setMinutes(Math.ceil(cursor.getMinutes() / stepMin) * stepMin)
  } else if (stepMs < 86400000) {
    const stepHour = stepMs / 3600000
    cursor.setMinutes(0, 0, 0)
    cursor.setHours(Math.ceil(cursor.getHours() / stepHour) * stepHour)
  } else {
    const stepDay = stepMs / 86400000
    cursor.setHours(0, 0, 0, 0)
    if (stepDay > 1) cursor.setDate(Math.ceil(cursor.getDate() / stepDay) * stepDay)
  }
  return cursor
}

function advanceByStep(cursor: Date, stepMs: number): void {
  if (stepMs < 3600000) {
    cursor.setTime(cursor.getTime() + stepMs)
  } else if (stepMs < 86400000) {
    cursor.setHours(cursor.getHours() + stepMs / 3600000)
  } else {
    cursor.setDate(cursor.getDate() + stepMs / 86400000)
  }
}

// `YYYY-MM-DDTHH:MM:SS` from a Date's *local* fields — matches how the API's
// timestamps are formatted, so a synthetic tick (see `overrideIso` below)
// round-trips through `formatTimeTick` the same as a real sample would.
function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

interface TimeTick {
  idx: number
  // Set only on the synthetic right-edge tick (see below) — the label to
  // show instead of the real sample at `idx`.
  overrideIso?: string
}

// Ticks land on a "nice" interval (seconds, minutes, hours, or days — whatever
// keeps the count near X_TICK_TARGET) within [startIdx, endIdx] (the current
// zoom window, or the full range), each mapped to its nearest sample. The
// interval automatically gets finer as the window narrows, matching how the
// data is actually timestamped rather than splitting the point count into
// evenly-spaced but time-irregular ticks.
//
// The right edge always gets one more tick beyond whatever real boundary
// falls inside the window, labeled with the *next* one — e.g. a full day of
// data ending around 23:59 gets a final tick reading the next day's 00:00,
// rather than leaving the axis's last label at 18:00 just because the data
// stops short of the next real boundary.
function timeTickIndices(
  isoTimes: string[],
  startIdx: number,
  endIdx: number
): { ticks: TimeTick[]; stepMs: number } {
  if (isoTimes.length === 0 || endIdx < startIdx) return { ticks: [], stepMs: 0 }
  const windowTimes = isoTimes.slice(startIdx, endIdx + 1).map((t) => new Date(t).getTime())
  const start = windowTimes[0]
  const end = windowTimes[windowTimes.length - 1]
  const stepMs = chooseTimeStep(end - start || 1, X_TICK_TARGET)

  const cursor = alignToStep(new Date(start), stepMs)
  const ticks: TimeTick[] = []
  let lastIdx = -1
  while (cursor.getTime() <= end) {
    const idx = startIdx + closestIndex(windowTimes, cursor.getTime())
    if (idx !== lastIdx) {
      ticks.push({ idx })
      lastIdx = idx
    }
    advanceByStep(cursor, stepMs)
  }

  if (ticks.length === 0) return { ticks: [{ idx: startIdx }, { idx: endIdx }], stepMs }

  // `cursor` now holds the first boundary past the visible range — that's
  // the "next" round time the edge tick should read, unless a real tick
  // already landed exactly on the last sample.
  if (lastIdx !== endIdx) {
    ticks.push({ idx: endIdx, overrideIso: toLocalIso(cursor) })
  }
  return { ticks, stepMs }
}

// Tracked across mousedown/mousemove/mouseup for one Shift+drag (X-zoom)
// gesture. `originLeft` is the dragged row's SVG left edge (in viewport
// coordinates), captured once at mousedown so mousemove/mouseup — attached to
// `window` so the drag keeps tracking even if the cursor leaves that row —
// can convert clientX back to the same coordinate space.
interface XDragStart {
  originLeft: number
  startPx: number
  startIdx: number
  endIdx: number
}

// Same idea for one Ctrl+drag (Y-zoom) gesture, tracked per-row: `varName`
// says which row's Y override to set, `scaleMin`/`scaleMax` are that row's
// displayed range *at drag start* (already-zoomed or auto-fit — either way,
// the basis a further Y-zoom narrows from).
interface YDragStart {
  varName: string
  originTop: number
  startPx: number
  scaleMin: number
  scaleMax: number
}

// Same idea for one plain-drag (flag-select) gesture — no modifier key,
// armed whenever `canEdit` is true (role permits editing), independent of
// whether a session is already open — a drag that commits while no session
// is open fires `openSession()` itself. `varName`/`startIdx`/`endIdx` are
// captured at mousedown (mirroring XDragStart) so mouseup can turn the
// pixel range back into a data-index range without depending on
// render-time closures.
interface FlagDragStart {
  originLeft: number
  startPx: number
  varName: string
  startIdx: number
  endIdx: number
}

// One entry in the shared undo/redo history — a snapshot of whichever piece
// of view state (the shared X range, or one row's Y override) was current
// right before a zoom replaced it. Right-click undo/redo walks this list
// regardless of whether each step was an X-zoom or a Y-zoom.
type ViewSnapshot =
  | { kind: 'x'; value: XRange }
  | { kind: 'y'; varName: string; value: [number, number] | null }

export function SvgPlot() {
  const { file, variables } = usePlotSelection()
  const { canEdit, sessionOpen, openSession, flagSelection, setFlagSelection, flagAppliedAt } =
    useEditSession()
  const [data, setData] = useState<VariableDataResponse | null>(null)
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [activeVariable, setActiveVariable] = useState<string | null>(null)
  const [xRange, setXRange] = useState<XRange>(null)
  const [yOverrides, setYOverrides] = useState<Record<string, [number, number] | null>>({})
  const [shiftHeld, setShiftHeld] = useState(false)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [plotWidth, setPlotWidth] = useState(DEFAULT_WIDTH)
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT)
  const [xDrag, setXDrag] = useState<{ startPx: number; currentPx: number } | null>(null)
  const [yDrag, setYDrag] = useState<{
    varName: string
    startPx: number
    currentPx: number
  } | null>(null)
  const xDragStartRef = useRef<XDragStart | null>(null)
  const yDragStartRef = useRef<YDragStart | null>(null)
  const undoStackRef = useRef<ViewSnapshot[]>([])
  const redoStackRef = useRef<ViewSnapshot[]>([])
  const flagDragStartRef = useRef<FlagDragStart | null>(null)
  const [flagDrag, setFlagDrag] = useState<{
    varName: string
    startPx: number
    currentPx: number
  } | null>(null)
  const [hoverTip, setHoverTip] = useState<{
    varName: string
    clientX: number
    clientY: number
    idx: number
  } | null>(null)

  // Fetches variable data on mount, whenever the selected file/variables
  // change, and after a flag is applied elsewhere (via EditSessionContext's
  // `flagAppliedAt`) — one dependency array covers all three triggers, so
  // there's no separate refetch effect to keep in sync with this one.
  useEffect(() => {
    if (!file || variables.length === 0) {
      setData(null)
      return
    }
    let cancelled = false
    getVariableData(file, variables).then((result) => {
      if (!cancelled) setData(result)
    })
    return () => {
      cancelled = true
    }
  }, [file, variables, flagAppliedAt])

  // Only used for the dataset title (global `title` attr) — a failure here
  // shouldn't block plotting, which already renders fine without it.
  useEffect(() => {
    if (!file) {
      setMetadata(null)
      return
    }
    let cancelled = false
    getFileMetadata(file)
      .then((result) => {
        if (!cancelled) setMetadata(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [file])

  useEffect(() => {
    setActiveVariable(null)
  }, [file])

  // A new file or variable set makes any prior zoom window meaningless — the
  // underlying index range (and any per-row Y overrides) no longer
  // correspond to the same data.
  useEffect(() => {
    setXRange(null)
    setYOverrides({})
    setHoverTip(null)
    undoStackRef.current = []
    redoStackRef.current = []
  }, [file, variables])

  // Fits each row to the container's width and to an even share of the
  // viewport's remaining height, so the whole stack stays on screen (rather
  // than each row staying a fixed size and the page just growing taller as
  // more variables are added). Re-measures on both container resize (e.g.
  // the sidebar collapsing) and window resize (e.g. the browser resizing) —
  // `data` is in the dependency list because the container only exists once
  // there's something to plot, so the very first measurement has to wait for
  // that first render rather than running once on mount.
  //
  // Skipped entirely without ResizeObserver (jsdom in tests — real browsers
  // always have it) — jsdom's layout is unmeasured (getBoundingClientRect is
  // all zeros), so attempting to fit against it would just replace the
  // DEFAULT_WIDTH/DEFAULT_ROW_HEIGHT fallbacks with meaningless numbers
  // derived from jsdom's fake window.innerHeight.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const recompute = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0) setPlotWidth(rect.width)
      const available = window.innerHeight - rect.top - BOTTOM_PADDING
      const perRow = available / Math.max(variables.length, 1)
      setRowHeight(Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, perRow)))
    }
    recompute()
    window.addEventListener('resize', recompute)
    const observer = new ResizeObserver(recompute)
    observer.observe(el)
    return () => {
      window.removeEventListener('resize', recompute)
      observer.disconnect()
    }
  }, [variables.length, data])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true)
      if (e.key === 'Control') setCtrlHeld(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false)
      if (e.key === 'Control') setCtrlHeld(false)
    }
    const handleBlur = () => {
      setShiftHeld(false)
      setCtrlHeld(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // Runs for the duration of one Shift+drag (X-zoom) gesture (mount on
  // mousedown, unmount on mouseup) — `xRange`/`data` are read from the
  // closure rather than refs since neither can legitimately change mid-drag.
  useEffect(() => {
    if (!xDrag) return
    const handleMouseMove = (e: MouseEvent) => {
      const start = xDragStartRef.current
      if (!start) return
      setXDrag({ startPx: start.startPx, currentPx: e.clientX - start.originLeft })
    }
    const handleMouseUp = (e: MouseEvent) => {
      const start = xDragStartRef.current
      xDragStartRef.current = null
      setXDrag(null)
      if (!start || !data) return
      const currentPx = e.clientX - start.originLeft
      if (Math.abs(currentPx - start.startPx) < MIN_DRAG_PX) return

      const newStart = pxToIdx(
        Math.min(start.startPx, currentPx),
        start.startIdx,
        start.endIdx,
        plotWidth,
        data.time.length
      )
      const newEnd = pxToIdx(
        Math.max(start.startPx, currentPx),
        start.startIdx,
        start.endIdx,
        plotWidth,
        data.time.length
      )
      if (newEnd - newStart < 1) return

      undoStackRef.current.push({ kind: 'x', value: xRange })
      redoStackRef.current = []
      setXRange([newStart, newEnd])
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xDrag])

  // Runs for the duration of one Ctrl+drag (Y-zoom) gesture — same shape as
  // the X-zoom effect above, but per-row and inverting the Y scale instead.
  useEffect(() => {
    if (!yDrag) return
    const handleMouseMove = (e: MouseEvent) => {
      const start = yDragStartRef.current
      if (!start) return
      setYDrag({
        varName: start.varName,
        startPx: start.startPx,
        currentPx: e.clientY - start.originTop,
      })
    }
    const handleMouseUp = (e: MouseEvent) => {
      const start = yDragStartRef.current
      yDragStartRef.current = null
      setYDrag(null)
      if (!start) return
      const currentPx = e.clientY - start.originTop
      if (Math.abs(currentPx - start.startPx) < MIN_DRAG_PX) return

      const innerHeight = rowHeight - MARGIN.top - MARGIN.bottom
      const range = start.scaleMax - start.scaleMin || 1
      const valueAtPx = (py: number) => {
        const clamped = Math.max(MARGIN.top, Math.min(py, rowHeight - MARGIN.bottom))
        return start.scaleMin + ((innerHeight - (clamped - MARGIN.top)) / innerHeight) * range
      }
      // Smaller pixel Y is higher on screen, which is the larger value.
      const newMax = valueAtPx(Math.min(start.startPx, currentPx))
      const newMin = valueAtPx(Math.max(start.startPx, currentPx))
      if (newMax - newMin <= 0) return

      undoStackRef.current.push({
        kind: 'y',
        varName: start.varName,
        value: yOverrides[start.varName] ?? null,
      })
      redoStackRef.current = []
      setYOverrides((y) => ({ ...y, [start.varName]: [newMin, newMax] }))
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yDrag])

  // Runs for the duration of one plain-drag (flag-select) gesture — same
  // shape as the X/Y-zoom effects above, but sets a flag *selection* in
  // EditSessionContext (picked up by FlagsPanel) instead of changing the view.
  useEffect(() => {
    if (!flagDrag) return
    const handleMouseMove = (e: MouseEvent) => {
      const start = flagDragStartRef.current
      if (!start) return
      setFlagDrag({
        varName: start.varName,
        startPx: start.startPx,
        currentPx: e.clientX - start.originLeft,
      })
    }
    const handleMouseUp = (e: MouseEvent) => {
      const start = flagDragStartRef.current
      flagDragStartRef.current = null
      setFlagDrag(null)
      if (!start || !data) return
      const currentPx = e.clientX - start.originLeft
      if (Math.abs(currentPx - start.startPx) < MIN_DRAG_PX) return

      const selStart = pxToIdx(
        Math.min(start.startPx, currentPx),
        start.startIdx,
        start.endIdx,
        plotWidth,
        data.time.length
      )
      const selEnd = pxToIdx(
        Math.max(start.startPx, currentPx),
        start.startIdx,
        start.endIdx,
        plotWidth,
        data.time.length
      )
      if (selEnd - selStart < 1) return

      if (!sessionOpen) {
        openSession()
      }

      setFlagSelection({
        varName: start.varName,
        startIdx: selStart,
        endIdx: selEnd,
        rangeLabel: `${data.time[selStart].slice(11, 19)}–${data.time[selEnd].slice(11, 19)}`,
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagDrag])

  // Clears any in-flight drag state if the role stops permitting edits (e.g.
  // a live role change mid-drag). An explicit session close clears
  // flagSelection itself — see EditSessionContext.handleCloseSession — since
  // by the time a session is open, sessionOpen briefly going false again
  // (right after this feature's optimistic open) must NOT wipe a selection
  // that was just set while the open request is still in flight.
  useEffect(() => {
    if (!canEdit) {
      setFlagSelection(null)
      setFlagDrag(null)
      flagDragStartRef.current = null
    }
  }, [canEdit, setFlagSelection])

  if (!file || variables.length === 0) {
    return <p>Select variables in the sidebar to view plots.</p>
  }
  if (!data) return null

  const [startIdx, endIdx] = xRange ?? [0, data.time.length - 1]
  const { ticks: xTicks, stepMs: xTickStepMs } = timeTickIndices(data.time, startIdx, endIdx)
  const xTickShowSeconds = xTickStepMs < 60000
  const firstTickDate =
    xTicks.length > 0 ? (xTicks[0].overrideIso ?? data.time[xTicks[0].idx]).slice(0, 10) : ''
  const datasetTitle = metadata?.global_attrs.title
  const titlePrefix = typeof datasetTitle === 'string' ? datasetTitle : null

  const handleRowMouseDown = (
    e: ReactMouseEvent<SVGSVGElement>,
    varName: string,
    scaleMin: number,
    scaleMax: number
  ) => {
    setHoverTip(null)
    if (e.shiftKey) {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientX - rect.left
      xDragStartRef.current = { originLeft: rect.left, startPx, startIdx, endIdx }
      setXDrag({ startPx, currentPx: startPx })
      return
    }
    if (e.ctrlKey) {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientY - rect.top
      yDragStartRef.current = { varName, originTop: rect.top, startPx, scaleMin, scaleMax }
      setYDrag({ varName, startPx, currentPx: startPx })
      return
    }
    if (canEdit) {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientX - rect.left
      flagDragStartRef.current = { originLeft: rect.left, startPx, varName, startIdx, endIdx }
      setFlagDrag({ varName, startPx, currentPx: startPx })
    }
  }

  // Updates the pointer-tracking tooltip as the mouse moves over a row's
  // plot area — skipped while any drag gesture is active so it doesn't
  // fight the drag's own visual feedback (rubber-band / Y-zoom box).
  const handleRowMouseMove = (e: ReactMouseEvent<SVGSVGElement>, varName: string) => {
    if (xDrag || yDrag || flagDrag) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const idx = pxToIdx(px, startIdx, endIdx, plotWidth, data.time.length)
    setHoverTip({ varName, clientX: e.clientX, clientY: e.clientY, idx })
  }

  const handleRowMouseLeave = () => {
    setHoverTip(null)
  }

  // Reads the CURRENT value for whichever slot a snapshot targets — used to
  // build the inverse entry pushed onto the other stack, so undo and redo
  // stay exact mirrors of each other regardless of how many X/Y zooms are
  // interleaved.
  const currentSnapshotFor = (entry: ViewSnapshot): ViewSnapshot =>
    entry.kind === 'x'
      ? { kind: 'x', value: xRange }
      : { kind: 'y', varName: entry.varName, value: yOverrides[entry.varName] ?? null }

  const applySnapshot = (entry: ViewSnapshot) => {
    if (entry.kind === 'x') {
      setXRange(entry.value)
    } else {
      setYOverrides((y) => ({ ...y, [entry.varName]: entry.value }))
    }
  }

  const undoOnce = () => {
    const prev = undoStackRef.current.pop()
    if (!prev) return
    redoStackRef.current.push(currentSnapshotFor(prev))
    applySnapshot(prev)
  }

  const redoOnce = () => {
    const next = redoStackRef.current.pop()
    if (!next) return
    undoStackRef.current.push(currentSnapshotFor(next))
    applySnapshot(next)
  }

  // Right-click still works as a secondary trigger alongside Cmd+click/
  // double-click below (shift+right-click for redo, matching the original
  // pattern before the Cmd/Ctrl bindings were introduced).
  const handleRowContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    if (e.shiftKey) redoOnce()
    else undoOnce()
  }

  const hoverTipSeries = hoverTip ? data.variables[hoverTip.varName] : null
  const hoverTipValue = hoverTip && hoverTipSeries ? hoverTipSeries.values[hoverTip.idx] : null

  return (
    <div className="svg-plot" ref={containerRef}>
      {hoverTip && hoverTipSeries && (
        <div
          data-testid="hover-tooltip"
          style={{
            position: 'fixed',
            left: hoverTip.clientX + 12,
            top: hoverTip.clientY + 12,
            pointerEvents: 'none',
            zIndex: 1000,
            background: TOOLTIP_BG_COLOR,
            color: TOOLTIP_TEXT_COLOR,
            fontSize: 12,
            fontFamily: FONT_FAMILY,
            padding: '4px 8px',
            borderRadius: 4,
            whiteSpace: 'nowrap',
          }}
        >
          <div>{data.time[hoverTip.idx].slice(0, 10)}</div>
          <div>{data.time[hoverTip.idx].slice(11, 19)}</div>
          <div>{hoverTipValue}</div>
        </div>
      )}
      {variables.map((varName, rowIdx) => {
        const series = data.variables[varName]
        if (!series) return null
        const scale = buildScale(
          series.values,
          startIdx,
          endIdx,
          plotWidth,
          rowHeight,
          yOverrides[varName] ?? undefined
        )
        const flagMarkers = buildFlagMarkers(series.flags, series.values, startIdx, endIdx)
        const flagSegments = buildFlagSegments(series.flags, series.values, scale, startIdx, endIdx)
        const highlightRange: [number, number] | null =
          flagSelection && flagSelection.varName === varName
            ? [flagSelection.startIdx, flagSelection.endIdx]
            : flagDrag && flagDrag.varName === varName && flagDragStartRef.current
              ? computeDragHighlightRange(flagDrag, flagDragStartRef.current, plotWidth, data.time.length)
              : null
        const highlightBand = highlightRange
          ? computeTightBand(series.values, highlightRange[0], highlightRange[1], scale, rowHeight)
          : null
        const yTicks = scale.yTicks
        const isLastRow = rowIdx === variables.length - 1
        const isActive = varName === activeVariable
        const axisColor = isActive ? ACTIVE_COLOR : AXIS_COLOR
        const tickLabelColor = isActive ? ACTIVE_COLOR : TICK_LABEL_COLOR
        const lineColor = isActive ? ACTIVE_COLOR : LINE_COLOR

        return (
          <div
            key={varName}
            className="svg-plot-row"
            style={{ position: 'relative' }}
            onClick={(e) => {
              if (e.metaKey) {
                undoOnce()
                return
              }
              if (!e.shiftKey && !e.ctrlKey) setActiveVariable(varName)
            }}
            onDoubleClick={(e) => {
              e.preventDefault()
              redoOnce()
            }}
            onContextMenu={handleRowContextMenu}
            role="button"
            tabIndex={0}
            aria-pressed={isActive}
          >
            <svg
              width={plotWidth}
              height={rowHeight}
              fontFamily={FONT_FAMILY}
              onMouseDown={(e) => handleRowMouseDown(e, varName, scale.min, scale.max)}
              onMouseMove={(e) => handleRowMouseMove(e, varName)}
              onMouseLeave={handleRowMouseLeave}
              style={{ cursor: shiftHeld ? 'crosshair' : ctrlHeld ? 'ns-resize' : undefined }}
            >
              <rect x={0} y={0} width={plotWidth} height={rowHeight} fill="#ffffff" />

              <defs>
                <clipPath id={`plot-clip-${rowIdx}`}>
                  <rect
                    x={MARGIN.left}
                    y={MARGIN.top}
                    width={plotWidth - MARGIN.left - MARGIN.right}
                    height={rowHeight - MARGIN.top - MARGIN.bottom}
                  />
                </clipPath>
              </defs>

              <text
                x={MARGIN.left + (plotWidth - MARGIN.left - MARGIN.right) / 2}
                y={16}
                textAnchor="middle"
                fontSize={13}
                fill={axisColor}
              >
                {titlePrefix ? `${titlePrefix}: ${varName}` : varName}
              </text>

              {flagMarkers.legendCodes.length > 0 && (
                <text
                  x={plotWidth - MARGIN.right}
                  y={16}
                  textAnchor="end"
                  fontSize={11}
                  fill={tickLabelColor}
                >
                  {flagMarkers.legendCodes
                    .map(
                      (code) =>
                        `● ${code} — ${FLAG_CODES.find((f) => f.code === code)?.description ?? code}`
                    )
                    .join('   ')}
                </text>
              )}

              {/* y-axis gridlines + ticks */}
              {yTicks.map((t) => (
                <g key={t}>
                  <line
                    x1={MARGIN.left}
                    y1={scale.y(t)}
                    x2={plotWidth - MARGIN.right}
                    y2={scale.y(t)}
                    stroke={GRID_COLOR}
                  />
                  <text
                    x={MARGIN.left - 8}
                    y={scale.y(t)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={11}
                    fill={tickLabelColor}
                  >
                    {t}
                  </text>
                </g>
              ))}

              {/* x-axis gridlines + ticks */}
              {xTicks.map(({ idx, overrideIso }, tickPos) => {
                const isFirst = tickPos === 0
                const isLast = tickPos === xTicks.length - 1
                const tickIso = overrideIso ?? data.time[idx]
                // Only the first tick anchors the date by default; later ticks
                // (including the synthetic edge tick) repeat it only when they
                // land on a different calendar day, so a tight zoom window
                // within one day doesn't cram a redundant date next to the
                // adjacent time-only label (see the day-boundary test above
                // for the case where it IS needed).
                const showDate = isFirst || tickIso.slice(0, 10) !== firstTickDate
                return (
                  <g key={idx}>
                    <line
                      x1={scale.x(idx)}
                      y1={MARGIN.top}
                      x2={scale.x(idx)}
                      y2={rowHeight - MARGIN.bottom}
                      stroke={GRID_COLOR}
                    />
                    <text
                      x={scale.x(idx)}
                      y={rowHeight - MARGIN.bottom + 16}
                      textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
                      fontSize={11}
                      fill={tickLabelColor}
                    >
                      {formatTimeTick(tickIso, showDate, xTickShowSeconds)}
                    </text>
                  </g>
                )
              })}

              {/* axis lines */}
              <line
                x1={MARGIN.left}
                y1={MARGIN.top}
                x2={MARGIN.left}
                y2={rowHeight - MARGIN.bottom}
                stroke={axisColor}
              />
              <line
                x1={MARGIN.left}
                y1={rowHeight - MARGIN.bottom}
                x2={plotWidth - MARGIN.right}
                y2={rowHeight - MARGIN.bottom}
                stroke={axisColor}
              />

              {/* axis titles: y = variable name (every row), x = "Time" (last row only) */}
              <text
                x={-(rowHeight / 2)}
                y={16}
                textAnchor="middle"
                fontSize={12}
                fill={tickLabelColor}
                transform="rotate(-90)"
              >
                {varName}
              </text>
              {isLastRow && (
                <text
                  x={MARGIN.left + (plotWidth - MARGIN.left - MARGIN.right) / 2}
                  y={rowHeight - 4}
                  textAnchor="middle"
                  fontSize={12}
                  fill={tickLabelColor}
                >
                  Time
                </text>
              )}

              <g clipPath={`url(#plot-clip-${rowIdx})`}>
                {highlightRange && highlightBand && (
                  <rect
                    x={scale.x(highlightRange[0])}
                    y={highlightBand.y}
                    width={scale.x(highlightRange[1]) - scale.x(highlightRange[0])}
                    height={highlightBand.height}
                    fill={FLAG_HIGHLIGHT_COLOR}
                    opacity={FLAG_HIGHLIGHT_FILL_OPACITY}
                  />
                )}
                {highlightRange &&
                  Array.from(
                    { length: highlightRange[1] - highlightRange[0] + 1 },
                    (_, i) => highlightRange[0] + i
                  ).map((idx) => {
                    const v = series.values[idx]
                    if (v === null || v === undefined) return null
                    return (
                      <circle
                        key={`sel-pt-${idx}`}
                        cx={scale.x(idx)}
                        cy={scale.y(v)}
                        r={2.5}
                        fill={FLAG_HIGHLIGHT_COLOR}
                      />
                    )
                  })}
                <path
                  d={buildPath(series.values, scale, startIdx, endIdx)}
                  fill="none"
                  stroke={lineColor}
                  strokeWidth={1}
                />

                {flagSegments.map((d, i) => (
                  <path
                    key={`flag-seg-${i}`}
                    d={d}
                    fill="none"
                    stroke={FLAG_HIGHLIGHT_COLOR}
                    strokeWidth={1}
                  />
                ))}

                {flagMarkers.markers.map((m) => (
                  <circle
                    key={m.idx}
                    cx={scale.x(m.idx)}
                    cy={scale.y(series.values[m.idx] as number)}
                    r={3}
                    fill={m.color}
                  />
                ))}

                {xDrag && (
                  <rect
                    x={Math.min(xDrag.startPx, xDrag.currentPx)}
                    y={MARGIN.top}
                    width={Math.abs(xDrag.currentPx - xDrag.startPx)}
                    height={rowHeight - MARGIN.top - MARGIN.bottom}
                    fill={ZOOM_BOX_FILL}
                    stroke={ACTIVE_COLOR}
                    strokeDasharray="4 2"
                  />
                )}

                {yDrag && yDrag.varName === varName && (
                  <rect
                    x={MARGIN.left}
                    y={Math.min(yDrag.startPx, yDrag.currentPx)}
                    width={plotWidth - MARGIN.left - MARGIN.right}
                    height={Math.abs(yDrag.currentPx - yDrag.startPx)}
                    fill={ZOOM_BOX_FILL}
                    stroke={ACTIVE_COLOR}
                    strokeDasharray="4 2"
                  />
                )}
              </g>
            </svg>
          </div>
        )
      })}
    </div>
  )
}
