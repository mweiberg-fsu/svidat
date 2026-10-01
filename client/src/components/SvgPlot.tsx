import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { getClimatology, getFileMetadata, getVariableData } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import type { ClimatologyResponse, FileMetadata, VariableDataResponse, VariableSeries } from '../api/types'
import { useEditSession } from '../context/EditSessionContext'
import { FLAG_CODES } from '../constants/flagCodes'
import {
  GESTURES,
  MODIFIER_KEY,
  heldMatchesTrigger,
  matchesPointer,
  parseTrigger,
  useAppConfig,
  type MouseButton,
} from '../appConfig'
import { IS_MAC } from '../platform'
import { CurrentUserPlotGuide } from './PlotGuide'

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

// Latitude/longitude Y tick labels are shown to 3 decimal places, so their
// ticks are kept at least 0.001 apart — finer steps would print duplicate
// labels.
const COORD_DECIMALS = 3
const COORD_MIN_TICK_STEP = 10 ** -COORD_DECIMALS
function isCoordVariable(varName: string): boolean {
  return /^(lat|lon|latitude|longitude)$/i.test(varName)
}
function yTickMinStep(varName: string): number {
  return isCoordVariable(varName) ? COORD_MIN_TICK_STEP : 0
}
const MIN_DRAG_PX = 4
// Two middle or right clicks within this window count as a double-click.
const DOUBLE_CLICK_MS = 400

// The fields matchesPointer reads, with `button` as the logical button index
// (0 left, 1 middle, 2 right).
interface PointerLike {
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

function withButton(e: PointerLike, button: number): PointerLike {
  return { button, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey }
}

const AXIS_COLOR = '#444444'
const GRID_COLOR = '#eeeeee'
const TICK_LABEL_COLOR = '#444444'
const LINE_COLOR = '#000000'
const ACTIVE_COLOR = '#2563eb'
const ZOOM_BOX_FILL = 'rgba(37, 99, 235, 0.15)'
// Radius of the per-sample markers drawn while "Show points" is on.
const POINT_RADIUS = 1.5
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
const LINE_HOVER_THRESHOLD_PX = 8
const CLIMATOLOGY_COLOR = '#0891b2'
const CLIMATOLOGY_DASH = '6 4'

// Inclusive [startIdx, endIdx] window into the shared time axis. `null` means
// full extent — every row zooms to the same window since they share one
// timeline, so this lives once at the top rather than per-row.
type XRange = [number, number] | null

// A row's pinned Y range. Drag-zooms are rounded outward to nice tick values
// like auto-fit; a range typed into the navbar's Y min/max inputs is `exact`
// and used as-is, so the plot shows precisely what was typed.
interface YOverride {
  range: [number, number]
  exact: boolean
}

interface Scale {
  min: number
  max: number
  yTicks: number[]
  x: (i: number) => number // sample index -> px, positioned by its time
  xAtMs: (ms: number) => number // UTC epoch ms -> px
  y: (v: number) => number
}

// The file's sample times as UTC epoch ms, plus the spacing beyond which two
// consecutive samples count as having missing data between them. X is
// positioned by time (not sample number), so missing minutes keep their
// place on the axis, and lines never bridge them.
interface TimeAxis {
  ms: number[]
  gapMs: number
}

// A consecutive-sample spacing above this multiple of the file's typical
// (median) interval means samples are missing there — for one-minute data,
// any missing minute.
const TIME_GAP_FACTOR = 1.5

// The API's timestamps are UTC without a zone suffix; parse them as UTC so
// positions don't shift with the browser's time zone or DST.
function parseUtcMs(iso: string): number {
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`)
}

function buildTimeAxis(time: string[]): TimeAxis {
  const ms = time.map(parseUtcMs)
  const diffs: number[] = []
  for (let i = 1; i < ms.length; i++) diffs.push(ms[i] - ms[i - 1])
  diffs.sort((a, b) => a - b)
  const median = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0
  return { ms, gapMs: median > 0 ? median * TIME_GAP_FACTOR : Infinity }
}

// True when samples are missing between i - 1 and i.
function isTimeGap(axis: TimeAxis, i: number): boolean {
  return i > 0 && axis.ms[i] - axis.ms[i - 1] > axis.gapMs
}

// Index in [lo, hi] whose time is closest to `target` (binary search; the
// times are ascending).
function closestIndexInRange(ms: number[], lo: number, hi: number, target: number): number {
  let a = lo
  let b = hi
  while (a < b) {
    const mid = (a + b) >> 1
    if (ms[mid] < target) a = mid + 1
    else b = mid
  }
  if (a > lo && Math.abs(ms[a - 1] - target) <= Math.abs(ms[a] - target)) return a - 1
  return a
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
  axis: TimeAxis,
  startIdx: number,
  endIdx: number,
  width: number,
  height: number,
  yOverride?: YOverride,
  minTickStep = 0
): Scale {
  const innerWidth = width - MARGIN.left - MARGIN.right
  const innerHeight = height - MARGIN.top - MARGIN.bottom
  const t0 = axis.ms[startIdx]
  const spanMs = axis.ms[endIdx] - t0 || 1
  const xAtMs = (ms: number) => MARGIN.left + ((ms - t0) / spanMs) * innerWidth

  let rawMin: number
  let rawMax: number
  if (yOverride) {
    ;[rawMin, rawMax] = yOverride.range
  } else {
    const windowValues = values.slice(startIdx, endIdx + 1)
    const numeric = windowValues.filter((v): v is number => v !== null)
    rawMin = numeric.length ? Math.min(...numeric) : 0
    rawMax = numeric.length ? Math.max(...numeric) : 1
  }

  const nice = niceTicks(rawMin, rawMax, Y_TICK_COUNT, minTickStep)
  let { ticks: yTicks, min, max } = nice
  if (yOverride?.exact) {
    // Keep the typed domain; drop the nice ticks that fall outside it.
    min = rawMin
    max = rawMax
    const epsilon = (max - min) * 1e-9
    yTicks = nice.ticks.filter((t) => t >= min - epsilon && t <= max + epsilon)
  }
  const range = max - min || 1

  return {
    min,
    max,
    yTicks,
    x: (i) => xAtMs(axis.ms[i]),
    xAtMs,
    y: (v) => MARGIN.top + innerHeight - ((v - min) / range) * innerHeight,
  }
}

// Line path over [startIdx, endIdx] that starts a new subpath after each
// null or missing-time stretch instead of bridging it, so missing data (and,
// for climatology, "no nearby ocean cell") shows as an empty gap rather than
// an interpolated line.
function buildGappedPath(
  values: (number | null)[],
  scale: Scale,
  axis: TimeAxis,
  startIdx: number,
  endIdx: number
): string {
  let d = ''
  let penDown = false
  for (let i = startIdx; i <= endIdx; i++) {
    if (isTimeGap(axis, i)) penDown = false
    const v = values[i]
    if (v === null || v === undefined) {
      penDown = false
      continue
    }
    d += `${penDown ? 'L' : 'M'}${scale.x(i)},${scale.y(v)}`
    penDown = true
  }
  return d
}

// Indices of valid samples with no linked neighbour inside [startIdx, endIdx]
// (a null, or missing time, on both sides):
// each is a one-point subpath in buildGappedPath, which draws nothing, so
// these get a dot instead of vanishing.
function isolatedIndices(
  values: (number | null)[],
  axis: TimeAxis,
  startIdx: number,
  endIdx: number
): number[] {
  const valid = (i: number) =>
    i >= startIdx && i <= endIdx && values[i] !== null && values[i] !== undefined
  const out: number[] = []
  for (let i = startIdx; i <= endIdx; i++) {
    const leftLinked = valid(i - 1) && !isTimeGap(axis, i)
    const rightLinked = valid(i + 1) && !isTimeGap(axis, i + 1)
    if (valid(i) && !leftLinked && !rightLinked) out.push(i)
  }
  return out
}

// Converts a pixel offset (within one row's plot area) back to the data
// index whose time is nearest, given the index range [startIdx, endIdx] that
// pixel range currently maps across (by time). Shared by the X-zoom,
// flag-drag and hover handlers.
function pxToIdx(
  px: number,
  startIdx: number,
  endIdx: number,
  plotWidth: number,
  axis: TimeAxis
): number {
  const innerWidth = plotWidth - MARGIN.left - MARGIN.right
  const t0 = axis.ms[startIdx]
  const spanMs = axis.ms[endIdx] - t0
  const target = t0 + ((px - MARGIN.left) / innerWidth) * spanMs
  return closestIndexInRange(axis.ms, startIdx, endIdx, target)
}

// Converts a pixel offset (within one row's height) back to a data value on
// a [scaleMin, scaleMax] Y scale, clamped to the plot area. Shared by the
// Y-zoom and box-zoom mouseup handlers.
function pxToValue(py: number, scaleMin: number, scaleMax: number, rowHeight: number): number {
  const innerHeight = rowHeight - MARGIN.top - MARGIN.bottom
  const range = scaleMax - scaleMin || 1
  const clamped = Math.max(MARGIN.top, Math.min(py, rowHeight - MARGIN.bottom))
  return scaleMin + ((innerHeight - (clamped - MARGIN.top)) / innerHeight) * range
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
// point, a null value, missing time, or the end of the window — it never
// spans a gap.
function buildFlagSegments(
  flags: string[] | null,
  values: (number | null)[],
  scale: Scale,
  axis: TimeAxis,
  startIdx: number,
  endIdx: number
): string[] {
  if (!flags) return []
  const modeCode = computeModeCode(flags)

  const segments: string[] = []
  let current = ''
  for (let i = startIdx; i <= endIdx; i++) {
    if (isTimeGap(axis, i) && current !== '') {
      segments.push(current)
      current = ''
    }
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
  axis: TimeAxis
): [number, number] {
  const a = pxToIdx(flagDrag.startPx, start.startIdx, start.endIdx, plotWidth, axis)
  const b = pxToIdx(flagDrag.currentPx, start.startIdx, start.endIdx, plotWidth, axis)
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
  tickCount: number,
  minStep = 0
): { ticks: number[]; min: number; max: number } {
  const step = Math.max(niceNum((max - min || 1) / (tickCount - 1), true), minStep)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  const epsilon = step * 1e-9
  for (let v = niceMin; v <= niceMax + epsilon; v += step) {
    ticks.push(Number(v.toFixed(10)))
  }
  return { ticks, min: niceMin, max: niceMax }
}

// Times come from the files' `time` variable, whose units are always
// "... since <date> UTC" — so labels carry the Zulu suffix.
function formatTimeTick(iso: string, showDate: boolean, showSeconds: boolean): string {
  const date = iso.slice(0, 10)
  const time = showSeconds ? iso.slice(11, 19) : iso.slice(11, 16)
  return showDate ? `${date} ${time}Z` : `${time}Z`
}

// A variable's `units` attribute, when it has a non-blank one.
function unitsOf(metadata: FileMetadata | null, varName: string): string | null {
  const units = metadata?.variables[varName]?.attrs.units
  return typeof units === 'string' && units.trim() ? units.trim() : null
}

// A variable's descriptive `long_name` attribute, when it has one that adds
// something beyond the short name.
function longNameOf(metadata: FileMetadata | null, varName: string): string | null {
  const longName = metadata?.variables[varName]?.attrs.long_name
  return typeof longName === 'string' && longName.trim() && longName !== varName
    ? longName.trim()
    : null
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

const DAY_MS = 86400000

// Closest two x-axis labels may sit (px) before the one before the right
// edge is dropped — about one "HH:MMZ" label's width.
const MIN_TICK_LABEL_GAP_PX = 55

// Rounds `ms` up to the next `stepMs` boundary in UTC (the data's time base).
// UTC has no offset or DST, so sub-day steps are plain epoch-ms multiples.
function alignToStep(ms: number, stepMs: number): number {
  if (stepMs < DAY_MS) return Math.ceil(ms / stepMs) * stepMs
  const stepDay = stepMs / DAY_MS
  const d = new Date(ms)
  d.setUTCHours(0, 0, 0, 0)
  if (stepDay > 1) d.setUTCDate(Math.ceil(d.getUTCDate() / stepDay) * stepDay)
  while (d.getTime() < ms) d.setUTCDate(d.getUTCDate() + stepDay)
  return d.getTime()
}

function advanceByStep(ms: number, stepMs: number): number {
  if (stepMs < DAY_MS) return ms + stepMs
  const d = new Date(ms)
  d.setUTCDate(d.getUTCDate() + stepMs / DAY_MS)
  return d.getTime()
}

// `YYYY-MM-DDTHH:MM:SS` in UTC — the API's timestamp format, so tick labels
// go through `formatTimeTick` the same as a real sample's time would.
function toUtcIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19)
}

interface TimeTick {
  ms: number // where the tick sits
  iso: string // what it reads
}

// Ticks land on a "nice" interval (seconds, minutes, hours, or days — whatever
// keeps the count near X_TICK_TARGET) at their exact times within the window
// [startIdx, endIdx] — including inside stretches of missing data, since X
// is positioned by time. The right edge always gets a label: the next
// boundary when the data stops just short of it (a day file ending 23:59
// reads next day's 00:00), otherwise the window's actual end time. A regular
// tick too close to that edge label to fit is dropped in its favour.
function timeTicks(
  axis: TimeAxis,
  startIdx: number,
  endIdx: number,
  innerWidthPx: number
): { ticks: TimeTick[]; stepMs: number } {
  if (axis.ms.length === 0 || endIdx < startIdx) return { ticks: [], stepMs: 0 }
  const start = axis.ms[startIdx]
  const end = axis.ms[endIdx]
  const stepMs = chooseTimeStep(end - start || 1, X_TICK_TARGET)

  const ticks: TimeTick[] = []
  let cursor = alignToStep(start, stepMs)
  while (cursor <= end) {
    ticks.push({ ms: cursor, iso: toUtcIso(cursor) })
    cursor = advanceByStep(cursor, stepMs)
  }

  if (ticks.length === 0) {
    return { ticks: [{ ms: start, iso: toUtcIso(start) }, { ms: end, iso: toUtcIso(end) }], stepMs }
  }
  if (ticks[ticks.length - 1].ms !== end) {
    const edgeIso = cursor - end <= axis.gapMs ? toUtcIso(cursor) : toUtcIso(end)
    const pxPerMs = innerWidthPx / (end - start || 1)
    while (ticks.length > 1 && (end - ticks[ticks.length - 1].ms) * pxPerMs < MIN_TICK_LABEL_GAP_PX) {
      ticks.pop()
    }
    ticks.push({ ms: end, iso: edgeIso })
  }
  return { ticks, stepMs }
}

// Tracked across mousedown/mousemove/mouseup for one Shift+drag or
// middle-mouse-drag (X-zoom) gesture. `originLeft` is the dragged row's SVG
// left edge (in viewport
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

// One X-zoom + Y-zoom modifier drag (default Shift+Ctrl) — a 2D box zoom:
// the shared X range and the dragged row's Y override both change at once.
// Combines XDragStart and YDragStart's fields.
interface BoxDragStart {
  varName: string
  originLeft: number
  originTop: number
  startX: number
  startY: number
  startIdx: number
  endIdx: number
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
  | { kind: 'y'; varName: string; value: YOverride | null }
  | { kind: 'xy'; x: XRange; varName: string; y: YOverride | null }
  // Whole view — an X zoom that also cleared typed Y ranges.
  | { kind: 'view'; x: XRange; y: Record<string, YOverride | null> }

export function SvgPlot() {
  const { file, variables, setVariables } = usePlotSelection()
  const {
    canEdit,
    sessionOpen,
    openSession,
    flagSelection,
    setFlagSelection,
    flagAppliedAt,
    flagsVisible,
    climatologyVisible,
    pointsVisible,
    setActiveYRange,
    setXWindow,
    timeMarker,
    setTimeMarker,
    yRangeRequest,
    bulkEdit,
    selectedVariables,
    toggleVariableSelected,
  } = useEditSession()
  const [data, setData] = useState<VariableDataResponse | null>(null)
  // Sample times parsed once per load; X positions, ticks and gap detection
  // all work from these.
  const timeAxis = useMemo(() => (data ? buildTimeAxis(data.time) : null), [data])
  const [climatology, setClimatology] = useState<ClimatologyResponse | null>(null)
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [activeVariable, setActiveVariable] = useState<string | null>(null)
  const [xRange, setXRange] = useState<XRange>(null)
  const [yOverrides, setYOverrides] = useState<Record<string, YOverride | null>>({})
  const { keybindings } = useAppConfig()
  // KeyboardEvent.key of each modifier currently held, for the zoom cursors.
  const [heldKeys, setHeldKeys] = useState<ReadonlySet<string>>(new Set())
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
  const [boxDrag, setBoxDrag] = useState<{
    varName: string
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
  const boxDragStartRef = useRef<BoxDragStart | null>(null)
  const undoStackRef = useRef<ViewSnapshot[]>([])
  const redoStackRef = useRef<ViewSnapshot[]>([])
  const flagDragStartRef = useRef<FlagDragStart | null>(null)
  // The most recent press on a row and whether it started a drag gesture,
  // so the auxclick/contextmenu that follows a middle/right drag isn't also
  // read as a click gesture. Reset on every row press (capture phase).
  const lastPressRef = useRef<{ button: number; startedDrag: boolean }>({ button: -1, startedDrag: false })
  // When the last middle / right click happened, for the double-click window.
  const lastAuxClickAtRef = useRef<Record<'middle' | 'right', number>>({ middle: -Infinity, right: -Infinity })
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
  // Pointer-based tab drag (mirrors the xDrag/yDrag pattern below rather
  // than native HTML5 drag-and-drop, which needs `preventDefault` on both
  // `dragenter` *and* `dragover` to reliably allow a drop across browsers,
  // and gives no hook for a custom "following the cursor" animation).
  //
  // The dragged row tracks the cursor via `position: fixed` (left/width/top
  // captured at grab time, top updated every move) rather than a translateY
  // delta off its starting layout position. A delta-off-start approach jumps
  // the instant the row's array index changes mid-drag, since its untransformed
  // flow position moves by a row height while the delta stays anchored to the
  // original position. Fixed positioning is decoupled from flow entirely, so
  // there's nothing to jump — and it drops the row out of flow, letting the
  // other rows' existing FLIP animation (below) close the gap on its own.
  const [tabDrag, setTabDrag] = useState<{
    varName: string
    currentY: number
    grabOffsetY: number
    left: number
    width: number
  } | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const prevRowTopsRef = useRef<Record<string, number>>({})

  const handleTabMouseDown = (e: ReactMouseEvent, varName: string) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const rect = rowRefs.current[varName]?.getBoundingClientRect()
    setTabDrag({
      varName,
      currentY: e.clientY,
      grabOffsetY: rect ? e.clientY - rect.top : 0,
      left: rect?.left ?? 0,
      width: rect?.width ?? 0,
    })
  }

  // Runs for the duration of one tab-drag gesture. On every mousemove it
  // measures the other rows' current on-screen centers and re-derives the
  // dragged variable's target index directly from the cursor position
  // (rather than accumulating a pixel delta), so the reorder stays correct
  // regardless of how row heights vary. `variables` is read fresh each time
  // because `tabDrag` (this effect's only dep) changes on every tick, so the
  // effect re-mounts with an up-to-date closure — same trick the X/Y-zoom
  // effects below rely on.
  useEffect(() => {
    if (!tabDrag) return
    const draggedVar = tabDrag.varName
    const handleMouseMove = (e: MouseEvent) => {
      setTabDrag((prev) => (prev ? { ...prev, currentY: e.clientY } : prev))

      const others = variables.filter((v) => v !== draggedVar)
      let targetIdx = 0
      for (const v of others) {
        const el = rowRefs.current[v]
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (e.clientY > rect.top + rect.height / 2) targetIdx++
      }
      const next = [...others]
      next.splice(targetIdx, 0, draggedVar)
      if (next.join(' ') !== variables.join(' ')) setVariables(next)
    }
    const handleMouseUp = () => setTabDrag(null)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabDrag])

  // FLIP animation: whenever row order changes, slide every row (other than
  // the one actively being dragged, which already tracks the cursor via its
  // own transform) from its last-known position to its new one instead of
  // letting it jump — "First, Last, Invert, Play" against `getBoundingClientRect`.
  useLayoutEffect(() => {
    const prevTops = prevRowTopsRef.current
    const nextTops: Record<string, number> = {}
    for (const v of variables) {
      const el = rowRefs.current[v]
      if (!el) continue
      nextTops[v] = el.getBoundingClientRect().top
      if (v === tabDrag?.varName) continue
      const prevTop = prevTops[v]
      if (prevTop === undefined) continue
      const delta = prevTop - nextTops[v]
      if (delta === 0) continue
      el.style.transition = 'none'
      el.style.transform = `translateY(${delta}px)`
      requestAnimationFrame(() => {
        el.style.transition = 'transform 150ms ease'
        el.style.transform = ''
      })
    }
    prevRowTopsRef.current = nextTops
  }, [variables, tabDrag?.varName])

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

  // A new file or variable set makes any stored climatology stale — it may
  // no longer correspond to the same track/variables, and would otherwise
  // stay on screen (misaligned) until the effect below's fetch resolves.
  // Deliberately not keyed on flagAppliedAt — a flag apply's refetch below
  // should replace the line in place, not blank it out and flicker on every
  // apply.
  useEffect(() => {
    setClimatology(null)
  }, [file, variables])

  // Climatology is fetched only while "Show climatology" is on — same
  // triggers as the data fetch above (file/variable change, a flag apply,
  // or an audit revert). Unchecking drops the stored result so no stale
  // line is drawn; a failed fetch drops it too, rather than leaving a
  // (possibly now-stale) line from a prior successful fetch on screen.
  useEffect(() => {
    if (!climatologyVisible || !file || variables.length === 0) {
      setClimatology(null)
      return
    }
    let cancelled = false
    getClimatology(file, variables)
      .then((result) => {
        if (!cancelled) setClimatology(result)
      })
      .catch((err) => {
        console.error('climatology fetch failed', err)
        if (!cancelled) setClimatology(null)
      })
    return () => {
      cancelled = true
    }
  }, [climatologyVisible, file, variables, flagAppliedAt])

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
    setTimeMarker(null)
  }, [file, setTimeMarker])

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
    const modifierKeys = new Set(Object.values(MODIFIER_KEY))
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!modifierKeys.has(e.key)) return
      setHeldKeys((prev) => (prev.has(e.key) ? prev : new Set(prev).add(e.key)))
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!modifierKeys.has(e.key)) return
      setHeldKeys((prev) => {
        const next = new Set(prev)
        next.delete(e.key)
        return next
      })
    }
    const handleBlur = () => {
      setHeldKeys(new Set())
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

  // Runs for the duration of one Shift+drag or middle-mouse-drag (X-zoom)
  // gesture (mount on mousedown, unmount on mouseup) — `xRange`/`data` are
  // read from the closure rather than refs since neither can legitimately
  // change mid-drag.
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
      if (!start || !data || !timeAxis) return
      const currentPx = e.clientX - start.originLeft
      if (Math.abs(currentPx - start.startPx) < MIN_DRAG_PX) return

      const newStart = pxToIdx(
        Math.min(start.startPx, currentPx),
        start.startIdx,
        start.endIdx,
        plotWidth,
        timeAxis
      )
      const newEnd = pxToIdx(
        Math.max(start.startPx, currentPx),
        start.startIdx,
        start.endIdx,
        plotWidth,
        timeAxis
      )
      if (newEnd - newStart < 1) return

      // A new X window supersedes ranges typed into the Y min/max inputs:
      // those rows go back to auto-fitting. Drag-zoomed Y ranges are kept.
      const hasTyped = Object.values(yOverrides).some((o) => o?.exact)
      undoStackRef.current.push(
        hasTyped ? { kind: 'view', x: xRange, y: yOverrides } : { kind: 'x', value: xRange }
      )
      redoStackRef.current = []
      setXRange([newStart, newEnd])
      if (hasTyped) {
        setYOverrides((y) => Object.fromEntries(Object.entries(y).filter(([, o]) => !o?.exact)))
      }
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

      const valueAtPx = (py: number) => pxToValue(py, start.scaleMin, start.scaleMax, rowHeight)
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
      setYOverrides((y) => ({ ...y, [start.varName]: { range: [newMin, newMax], exact: false } }))
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yDrag])

  // Runs for the duration of one box-zoom gesture — the X-zoom and Y-zoom
  // effects above combined, committed as a single 'xy' undo step so one undo
  // restores both axes.
  useEffect(() => {
    if (!boxDrag) return
    const handleMouseMove = (e: MouseEvent) => {
      const start = boxDragStartRef.current
      if (!start) return
      setBoxDrag({
        varName: start.varName,
        startX: start.startX,
        startY: start.startY,
        currentX: e.clientX - start.originLeft,
        currentY: e.clientY - start.originTop,
      })
    }
    const handleMouseUp = (e: MouseEvent) => {
      const start = boxDragStartRef.current
      boxDragStartRef.current = null
      setBoxDrag(null)
      if (!start || !data || !timeAxis) return
      const currentX = e.clientX - start.originLeft
      const currentY = e.clientY - start.originTop
      if (
        Math.abs(currentX - start.startX) < MIN_DRAG_PX ||
        Math.abs(currentY - start.startY) < MIN_DRAG_PX
      ) {
        return
      }

      const toIdx = (px: number) =>
        pxToIdx(px, start.startIdx, start.endIdx, plotWidth, timeAxis)
      const newStart = toIdx(Math.min(start.startX, currentX))
      const newEnd = toIdx(Math.max(start.startX, currentX))
      const toValue = (py: number) => pxToValue(py, start.scaleMin, start.scaleMax, rowHeight)
      // Smaller pixel Y is higher on screen, which is the larger value.
      const newMax = toValue(Math.min(start.startY, currentY))
      const newMin = toValue(Math.max(start.startY, currentY))
      if (newEnd - newStart < 1 || newMax - newMin <= 0) return

      undoStackRef.current.push({
        kind: 'xy',
        x: xRange,
        varName: start.varName,
        y: yOverrides[start.varName] ?? null,
      })
      redoStackRef.current = []
      setXRange([newStart, newEnd])
      setYOverrides((y) => ({ ...y, [start.varName]: { range: [newMin, newMax], exact: false } }))
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxDrag])

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
      if (!start || !data || !timeAxis) return
      const currentPx = e.clientX - start.originLeft
      if (Math.abs(currentPx - start.startPx) < MIN_DRAG_PX) return

      const selStart = pxToIdx(
        Math.min(start.startPx, currentPx),
        start.startIdx,
        start.endIdx,
        plotWidth,
        timeAxis
      )
      const selEnd = pxToIdx(
        Math.max(start.startPx, currentPx),
        start.startIdx,
        start.endIdx,
        plotWidth,
        timeAxis
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

  // Publishes the selected row's displayed Y range for the navbar's Y min/max
  // inputs — recomputed from the same inputs the row's own scale uses.
  useEffect(() => {
    const series = activeVariable ? data?.variables[activeVariable] : undefined
    if (!data || !timeAxis || !activeVariable || !series) {
      setActiveYRange(null)
      return
    }
    const [start, end] = xRange ?? [0, data.time.length - 1]
    const scale = buildScale(
      series.values,
      timeAxis,
      start,
      end,
      plotWidth,
      rowHeight,
      yOverrides[activeVariable] ?? undefined,
      yTickMinStep(activeVariable)
    )
    setActiveYRange({ varName: activeVariable, min: scale.min, max: scale.max })
  }, [data, timeAxis, activeVariable, xRange, yOverrides, plotWidth, rowHeight, setActiveYRange])

  useEffect(() => () => setActiveYRange(null), [setActiveYRange])

  // Publishes the X zoom window for the Ship Track map's highlight.
  useEffect(() => {
    setXWindow(xRange)
  }, [xRange, setXWindow])

  useEffect(() => () => setXWindow(null), [setXWindow])

  // Esc clears a time marker picked on the Ship Track map.
  useEffect(() => {
    if (timeMarker === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTimeMarker(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [timeMarker, setTimeMarker])

  // Applies a range typed into the navbar as an exact Y override, recorded on
  // the same undo stack as a Ctrl+drag Y-zoom.
  useEffect(() => {
    if (!yRangeRequest) return
    const { varName, min, max } = yRangeRequest
    undoStackRef.current.push({ kind: 'y', varName, value: yOverrides[varName] ?? null })
    redoStackRef.current = []
    setYOverrides((y) => ({ ...y, [varName]: { range: [min, max], exact: true } }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yRangeRequest])

  if (!file || variables.length === 0) {
    return <CurrentUserPlotGuide />
  }
  if (!data || !timeAxis) return null

  const [startIdx, endIdx] = xRange ?? [0, data.time.length - 1]
  const { ticks: xTicks, stepMs: xTickStepMs } = timeTicks(
    timeAxis,
    startIdx,
    endIdx,
    plotWidth - MARGIN.left - MARGIN.right
  )
  const xTickShowSeconds = xTickStepMs < 60000
  const firstTickDate =
    xTicks.length > 0 ? xTicks[0].iso.slice(0, 10) : ''
  const datasetTitle = metadata?.global_attrs.title
  const titlePrefix = typeof datasetTitle === 'string' ? datasetTitle : null

  // Whether any assigned binding (of the six) uses `button` with exactly the
  // modifiers held in `e`. Such a binding disables the built-in fallback on
  // that button: middle-drag X zoom, right-click undo / Shift+right-click redo.
  const bindingUsesButton = (e: PointerLike, button: MouseButton): boolean =>
    GESTURES.some(({ key, kind }) => {
      const spec = parseTrigger(keybindings[key], kind)
      return !!spec && spec.button === button && matchesPointer(e, keybindings[key], kind, spec.action)
    })

  const handleRowMouseDown = (
    e: ReactMouseEvent<SVGSVGElement>,
    varName: string,
    scaleMin: number,
    scaleMax: number
  ) => {
    setHoverTip(null)
    const startDrag = () => {
      e.preventDefault()
      lastPressRef.current = { button: e.button, startedDrag: true }
    }
    // Each binding must match the pressed button and the exact modifier set;
    // precedence: box, X, Y, then flag select (qca only).
    const boxZoom = matchesPointer(e, keybindings.box_zoom, 'drag', 'drag')
    const xZoom = !boxZoom && matchesPointer(e, keybindings.x_zoom, 'drag', 'drag')
    const yZoom = !boxZoom && !xZoom && matchesPointer(e, keybindings.y_zoom, 'drag', 'drag')
    const flag = !boxZoom && !xZoom && !yZoom && canEdit && matchesPointer(e, keybindings.flag_select, 'drag', 'drag')
    // Built-in: an unmatched middle press X-zooms, unless an assigned binding
    // (e.g. a middle-click undo) claims the middle button with these modifiers.
    const middleXZoom =
      e.button === 1 && !boxZoom && !xZoom && !yZoom && !flag && !bindingUsesButton(e, 'middle')
    if (boxZoom) {
      startDrag()
      const rect = e.currentTarget.getBoundingClientRect()
      const startX = e.clientX - rect.left
      const startY = e.clientY - rect.top
      boxDragStartRef.current = {
        varName,
        originLeft: rect.left,
        originTop: rect.top,
        startX,
        startY,
        startIdx,
        endIdx,
        scaleMin,
        scaleMax,
      }
      setBoxDrag({ varName, startX, startY, currentX: startX, currentY: startY })
      return
    }
    if (xZoom || middleXZoom) {
      startDrag()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientX - rect.left
      xDragStartRef.current = { originLeft: rect.left, startPx, startIdx, endIdx }
      setXDrag({ startPx, currentPx: startPx })
      return
    }
    if (yZoom) {
      startDrag()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientY - rect.top
      yDragStartRef.current = { varName, originTop: rect.top, startPx, scaleMin, scaleMax }
      setYDrag({ varName, startPx, currentPx: startPx })
      return
    }
    if (flag) {
      startDrag()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientX - rect.left
      flagDragStartRef.current = { originLeft: rect.left, startPx, varName, startIdx, endIdx }
      setFlagDrag({ varName, startPx, currentPx: startPx })
      return
    }
    // Keep a bare middle press (e.g. a middle-click binding) from starting
    // the browser's autoscroll.
    if (e.button === 1) e.preventDefault()
  }

  // Updates the pointer-tracking tooltip as the mouse moves over a row's
  // plot area — skipped while any drag gesture is active so it doesn't
  // fight the drag's own visual feedback (rubber-band / Y-zoom box), and
  // skipped unless the cursor is within LINE_HOVER_THRESHOLD_PX of the
  // plotted line itself (so the tooltip reads as attached to the line, not
  // the whole plot area). A null value at the nearest index has no drawn
  // line to be near, so it never triggers the tooltip either.
  const handleRowMouseMove = (
    e: ReactMouseEvent<SVGSVGElement>,
    varName: string,
    scale: Scale,
    series: VariableSeries
  ) => {
    if (xDrag || yDrag || boxDrag || flagDrag) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const idx = pxToIdx(px, startIdx, endIdx, plotWidth, timeAxis)
    const value = series.values[idx]
    if (value === null || value === undefined || Math.abs(scale.y(value) - py) > LINE_HOVER_THRESHOLD_PX) {
      setHoverTip(null)
      return
    }
    setHoverTip({ varName, clientX: e.clientX, clientY: e.clientY, idx })
  }

  const handleRowMouseLeave = () => {
    setHoverTip(null)
  }

  // Reads the CURRENT value for whichever slot a snapshot targets — used to
  // build the inverse entry pushed onto the other stack, so undo and redo
  // stay exact mirrors of each other regardless of how many X/Y zooms are
  // interleaved.
  const currentSnapshotFor = (entry: ViewSnapshot): ViewSnapshot => {
    switch (entry.kind) {
      case 'x':
        return { kind: 'x', value: xRange }
      case 'y':
        return { kind: 'y', varName: entry.varName, value: yOverrides[entry.varName] ?? null }
      case 'xy':
        return { kind: 'xy', x: xRange, varName: entry.varName, y: yOverrides[entry.varName] ?? null }
      case 'view':
        return { kind: 'view', x: xRange, y: yOverrides }
    }
  }

  const applySnapshot = (entry: ViewSnapshot) => {
    switch (entry.kind) {
      case 'x':
        setXRange(entry.value)
        break
      case 'y':
        setYOverrides((y) => ({ ...y, [entry.varName]: entry.value }))
        break
      case 'xy':
        setXRange(entry.x)
        setYOverrides((y) => ({ ...y, [entry.varName]: entry.y }))
        break
      case 'view':
        setXRange(entry.x)
        setYOverrides(entry.y)
        break
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

  // Runs undo or redo if either binding matches this click or double-click
  // (`e.button` being the logical button). True when one ran.
  const runClickGesture = (e: PointerLike, action: 'click' | 'dblclick'): boolean => {
    if (matchesPointer(e, keybindings.undo, 'click', action)) {
      undoOnce()
      return true
    }
    if (matchesPointer(e, keybindings.redo, 'click', action)) {
      redoOnce()
      return true
    }
    return false
  }

  // A middle or right click: the second click within DOUBLE_CLICK_MS first
  // tries the double-click bindings, then (like any click) the click
  // bindings. True when an assigned binding ran.
  const runAuxClick = (e: PointerLike, button: 'middle' | 'right'): boolean => {
    const now = performance.now()
    if (now - lastAuxClickAtRef.current[button] < DOUBLE_CLICK_MS && runClickGesture(e, 'dblclick')) {
      lastAuxClickAtRef.current[button] = -Infinity
      return true
    }
    lastAuxClickAtRef.current[button] = now
    return runClickGesture(e, 'click')
  }

  const pressStartedDrag = (button: number) =>
    lastPressRef.current.button === button && lastPressRef.current.startedDrag

  // Middle click (auxclick, button 1). The auxclick ending a middle drag
  // doesn't count.
  const handleRowAuxClick = (e: ReactMouseEvent) => {
    if (e.button !== 1 || pressStartedDrag(1)) return
    runAuxClick(e, 'middle')
  }

  // Right click, via contextmenu (always preventDefault'd). Skipped when the
  // right press started a drag gesture. Assigned right-button click /
  // double-click bindings run first; the built-in plain right-click = undo
  // and Shift+right-click = redo apply only when no assigned binding uses the
  // right button with exactly those modifiers.
  //
  // contextmenu is read as a right click whatever its `button` (jsdom and the
  // keyboard context-menu key report 0) — except macOS ctrl+click, which
  // turns a left click into a secondary click: it fires contextmenu here (on
  // mousedown) with ctrlKey and button 0 instead of a click. So a ctrl+drag
  // zoom must not be read as a right-click undo — or a second Y-zoom's
  // mousedown would undo the first before the drag starts — and a Ctrl-bound
  // left undo/redo has to run from here, since no click event follows.
  const handleRowContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    if (e.ctrlKey && e.button === 0) {
      if (IS_MAC) runClickGesture(e, 'click')
      return
    }
    if (pressStartedDrag(2)) return
    const right = withButton(e, 2)
    if (runAuxClick(right, 'right')) return
    if (e.ctrlKey || e.altKey || e.metaKey || bindingUsesButton(right, 'right')) return
    if (e.shiftKey) redoOnce()
    else undoOnce()
  }

  const hoverTipSeries = hoverTip ? data.variables[hoverTip.varName] : null
  const hoverTipValue = hoverTip && hoverTipSeries ? hoverTipSeries.values[hoverTip.idx] : null
  const hoverTipFlag = hoverTip && hoverTipSeries ? (hoverTipSeries.flags?.[hoverTip.idx] ?? null) : null
  const hoverTipClim =
    hoverTip && climatology ? (climatology.variables[hoverTip.varName]?.[hoverTip.idx] ?? null) : null
  const draggedIdx = tabDrag ? variables.indexOf(tabDrag.varName) : -1

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
          <div>Time: {data.time[hoverTip.idx].slice(11, 19)}</div>
          <div>
            {hoverTip.varName}: {hoverTipValue != null ? hoverTipValue.toFixed(2) : hoverTipValue}
          </div>
          {hoverTipClim != null && <div>clim: {hoverTipClim.toFixed(2)}</div>}
          {hoverTipFlag && (
            <div>
              Flags: {hoverTipFlag} — {FLAG_CODES.find((f) => f.code === hoverTipFlag)?.description ?? hoverTipFlag}
            </div>
          )}
        </div>
      )}
      {variables.map((varName, rowIdx) => {
        const series = data.variables[varName]
        if (!series) return null
        const scale = buildScale(
          series.values,
          timeAxis,
          startIdx,
          endIdx,
          plotWidth,
          rowHeight,
          yOverrides[varName] ?? undefined,
          yTickMinStep(varName)
        )
        const flagMarkers = buildFlagMarkers(series.flags, series.values, startIdx, endIdx)
        const flagSegments = buildFlagSegments(series.flags, series.values, scale, timeAxis, startIdx, endIdx)
        const highlightRange: [number, number] | null =
          flagSelection && flagSelection.varName === varName
            ? [flagSelection.startIdx, flagSelection.endIdx]
            : flagDrag && flagDrag.varName === varName && flagDragStartRef.current
              ? computeDragHighlightRange(flagDrag, flagDragStartRef.current, plotWidth, timeAxis)
              : null
        const highlightBand = highlightRange
          ? computeTightBand(series.values, highlightRange[0], highlightRange[1], scale, rowHeight)
          : null
        const yTicks = scale.yTicks
        const isActive = varName === activeVariable
        const axisColor = isActive ? ACTIVE_COLOR : AXIS_COLOR
        const tickLabelColor = isActive ? ACTIVE_COLOR : TICK_LABEL_COLOR
        const lineColor = isActive ? ACTIVE_COLOR : LINE_COLOR
        const longName = longNameOf(metadata, varName)
        const titleName = longName ? `${varName} (${longName})` : varName
        const plotTitle = titlePrefix ? `${titlePrefix}: ${titleName}` : titleName
        const units = unitsOf(metadata, varName)
        const yAxisTitle = units ? `${varName} (${units})` : varName

        const isDraggedRow = tabDrag?.varName === varName
        // Highlights the slot the dragged row would land in: the row
        // immediately after it (or, when dragged to the very end, the row
        // immediately before it) gets an accent edge as a drop-target cue.
        const isDropBefore = draggedIdx !== -1 && rowIdx === draggedIdx + 1
        const isDropAfter =
          draggedIdx !== -1 && draggedIdx === variables.length - 1 && rowIdx === draggedIdx - 1
        const dropTargetClass = isDropBefore ? ' drop-target-before' : isDropAfter ? ' drop-target-after' : ''

        return (
          <div
            key={varName}
            ref={(el) => {
              rowRefs.current[varName] = el
            }}
            data-variable={varName}
            className={`svg-plot-row${isDraggedRow ? ' dragging' : ''}${dropTargetClass}`}
            style={{
              position: isDraggedRow ? 'fixed' : 'relative',
              top: isDraggedRow ? tabDrag!.currentY - tabDrag!.grabOffsetY : undefined,
              left: isDraggedRow ? tabDrag!.left : undefined,
              width: isDraggedRow ? tabDrag!.width : undefined,
              transform: undefined,
              transition: isDraggedRow ? 'none' : 'transform 150ms ease',
              zIndex: isDraggedRow ? 10 : undefined,
              boxShadow: isDraggedRow ? '0 8px 20px rgba(0, 0, 0, 0.3)' : undefined,
              pointerEvents: isDraggedRow ? 'none' : undefined,
            }}
            onMouseDownCapture={(e) => {
              lastPressRef.current = { button: e.button, startedDrag: false }
            }}
            onClick={(e) => {
              if (runClickGesture(e, 'click')) return
              // Any other held modifier means this click ended a zoom drag.
              if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) setActiveVariable(varName)
            }}
            onDoubleClick={(e) => {
              e.preventDefault()
              runClickGesture(e, 'dblclick')
            }}
            onAuxClick={handleRowAuxClick}
            onContextMenu={handleRowContextMenu}
            role="button"
            tabIndex={0}
            aria-pressed={isActive}
          >
            <div
              data-testid="plot-tab"
              className={`svg-plot-tab${isActive ? ' active' : ''}${isDraggedRow ? ' dragging' : ''}`}
              onMouseDown={(e) => handleTabMouseDown(e, varName)}
              onClick={(e) => {
                e.stopPropagation()
                setActiveVariable(varName)
              }}
            >
              <span className="svg-plot-tab-grip">⠿</span>
              {varName}
              {bulkEdit && (
                <span
                  role="checkbox"
                  aria-checked={selectedVariables.includes(varName)}
                  className={`svg-plot-tab-select${selectedVariables.includes(varName) ? ' selected' : ''}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleVariableSelected(varName)
                  }}
                />
              )}
            </div>
            <svg
              width={plotWidth}
              height={rowHeight}
              fontFamily={FONT_FAMILY}
              onMouseDown={(e) => handleRowMouseDown(e, varName, scale.min, scale.max)}
              onMouseMove={(e) => handleRowMouseMove(e, varName, scale, series)}
              onMouseLeave={handleRowMouseLeave}
              style={{
                // Guarded on heldKeys.size so a `none`-bound gesture (held
                // whenever nothing is pressed) doesn't give a permanent cursor.
                cursor:
                  heldKeys.size === 0
                    ? undefined
                    : heldMatchesTrigger(heldKeys, keybindings.box_zoom)
                      ? 'cell'
                      : heldMatchesTrigger(heldKeys, keybindings.x_zoom)
                        ? 'crosshair'
                        : heldMatchesTrigger(heldKeys, keybindings.y_zoom)
                          ? 'ns-resize'
                          : undefined,
              }}
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
                {plotTitle}
              </text>


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
                    {isCoordVariable(varName) ? t.toFixed(COORD_DECIMALS) : t}
                  </text>
                </g>
              ))}

              {/* x-axis gridlines + ticks */}
              {xTicks.map(({ ms, iso: tickIso }, tickPos) => {
                const isFirst = tickPos === 0
                const isLast = tickPos === xTicks.length - 1
                // Only the first tick anchors the date by default; later ticks
                // (including the synthetic edge tick) repeat it only when they
                // land on a different calendar day, so a tight zoom window
                // within one day doesn't cram a redundant date next to the
                // adjacent time-only label (see the day-boundary test above
                // for the case where it IS needed).
                const showDate = isFirst || tickIso.slice(0, 10) !== firstTickDate
                return (
                  <g key={ms}>
                    <line
                      x1={scale.xAtMs(ms)}
                      y1={MARGIN.top}
                      x2={scale.xAtMs(ms)}
                      y2={rowHeight - MARGIN.bottom}
                      stroke={GRID_COLOR}
                    />
                    <text
                      x={scale.xAtMs(ms)}
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

              {/* axis titles: y = variable name (units), x = "Time (UTC)" */}
              <text
                x={-(rowHeight / 2)}
                y={16}
                textAnchor="middle"
                fontSize={12}
                fill={tickLabelColor}
                transform="rotate(-90)"
              >
                {yAxisTitle}
              </text>
              <text
                x={MARGIN.left + (plotWidth - MARGIN.left - MARGIN.right) / 2}
                y={rowHeight - 4}
                textAnchor="middle"
                fontSize={12}
                fill={tickLabelColor}
              >
                Time (UTC)
              </text>

              <g clipPath={`url(#plot-clip-${rowIdx})`}>
                {climatology?.variables[varName] && (
                  <path
                    data-testid={`climatology-${varName}`}
                    d={buildGappedPath(climatology.variables[varName], scale, timeAxis, startIdx, endIdx)}
                    fill="none"
                    stroke={CLIMATOLOGY_COLOR}
                    strokeWidth={1.5}
                    strokeDasharray={CLIMATOLOGY_DASH}
                  />
                )}
                {highlightRange && highlightBand && (
                  <rect
                    data-export="skip"
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
                        data-export="skip"
                        key={`sel-pt-${idx}`}
                        cx={scale.x(idx)}
                        cy={scale.y(v)}
                        r={2.5}
                        fill={FLAG_HIGHLIGHT_COLOR}
                      />
                    )
                  })}
                <path
                  data-testid="data-line"
                  d={buildGappedPath(series.values, scale, timeAxis, startIdx, endIdx)}
                  fill="none"
                  stroke={lineColor}
                  strokeWidth={1}
                />
                {isolatedIndices(series.values, timeAxis, startIdx, endIdx).map((idx) => (
                  <circle
                    key={`iso-${idx}`}
                    data-testid="isolated-point"
                    cx={scale.x(idx)}
                    cy={scale.y(series.values[idx] as number)}
                    r={1.5}
                    fill={lineColor}
                  />
                ))}

                {timeMarker !== null && timeMarker >= startIdx && timeMarker <= endIdx && (
                  <line
                    data-testid="time-marker-line"
                    data-export="skip"
                    x1={scale.x(timeMarker)}
                    x2={scale.x(timeMarker)}
                    y1={MARGIN.top}
                    y2={rowHeight - MARGIN.bottom}
                    stroke={ACTIVE_COLOR}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                  />
                )}

                {/* One marker per sample in the window, under the flag markers
                    so off-flag points keep their colour on top. */}
                {pointsVisible && (
                  <g data-testid="data-points" fill={lineColor}>
                    {Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i).map(
                      (idx) => {
                        const v = series.values[idx]
                        if (v === null || v === undefined) return null
                        return <circle key={idx} cx={scale.x(idx)} cy={scale.y(v)} r={POINT_RADIUS} />
                      }
                    )}
                  </g>
                )}

                {flagsVisible &&
                  flagSegments.map((d, i) => (
                    <path
                      key={`flag-seg-${i}`}
                      d={d}
                      fill="none"
                      stroke={FLAG_HIGHLIGHT_COLOR}
                      strokeWidth={1}
                    />
                  ))}

                {flagsVisible &&
                  flagMarkers.markers.map((m) => (
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
                    data-export="skip"
                    x={Math.min(xDrag.startPx, xDrag.currentPx)}
                    y={MARGIN.top}
                    width={Math.abs(xDrag.currentPx - xDrag.startPx)}
                    height={rowHeight - MARGIN.top - MARGIN.bottom}
                    fill={ZOOM_BOX_FILL}
                    stroke={ACTIVE_COLOR}
                    strokeDasharray="4 2"
                  />
                )}

                {boxDrag && boxDrag.varName === varName && (
                  <rect
                    data-export="skip"
                    x={Math.min(boxDrag.startX, boxDrag.currentX)}
                    y={Math.min(boxDrag.startY, boxDrag.currentY)}
                    width={Math.abs(boxDrag.currentX - boxDrag.startX)}
                    height={Math.abs(boxDrag.currentY - boxDrag.startY)}
                    fill={ZOOM_BOX_FILL}
                    stroke={ACTIVE_COLOR}
                    strokeDasharray="4 2"
                  />
                )}

                {yDrag && yDrag.varName === varName && (
                  <rect
                    data-export="skip"
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
