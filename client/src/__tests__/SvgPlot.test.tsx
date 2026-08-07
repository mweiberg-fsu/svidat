import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SvgPlot } from '../components/SvgPlot'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { AuthProvider } from '../context/AuthContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'
import { FLAG_CODES } from '../constants/flagCodes'

function Setup({ file, variables }: { file: string; variables: string[] }) {
  const sel = usePlotSelection()
  return (
    <>
      <button data-testid="set-file" onClick={() => sel.setFile(file)}>
        set file
      </button>
      <button data-testid="set-variables" onClick={() => sel.setVariables(variables)}>
        set variables
      </button>
    </>
  )
}

function renderSvgPlot(file: string, variables: string[]) {
  setToken('tok')
  localStorage.setItem('svidat_role', 'qca')
  localStorage.setItem('svidat_username', 'testuser')
  const utils = render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Setup file={file} variables={variables} />
            <SvgPlot />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
  // Separate clicks (separate commits) — setFile clears `vars`, so setting
  // both search params in the same event handler would race against that.
  fireEvent.click(screen.getByTestId('set-file'))
  fireEvent.click(screen.getByTestId('set-variables'))
  return utils
}

// Hourly samples spanning 18 hours, so 6-hour-aligned ticks (00:00, 06:00,
// 12:00, 18:00) land exactly on real data points.
function hourlyTimes(hours: number): string[] {
  return Array.from({ length: hours + 1 }, (_, i) => {
    const h = String(i).padStart(2, '0')
    return `2025-01-01T${h}:00:00`
  })
}

// Number of line segments drawn in a plot's path `d` — one fewer than the
// number of points it covers, so it's a simple proxy for "how much of the
// series is currently visible" without depending on exact pixel math.
function segmentCount(d: string | null | undefined): number {
  return (d ?? '').match(/L/g)?.length ?? 0
}

// jsdom's getBoundingClientRect always returns an all-zero rect, so a row's
// SVG left edge is 0 in these tests — clientX values below can be used
// directly as plot-relative pixel offsets.
const INNER_WIDTH = 900 - 70 - 20 // WIDTH - MARGIN.left - MARGIN.right
function pxForIndex(index: number, lastIndex: number): number {
  return 70 + (index / lastIndex) * INNER_WIDTH // MARGIN.left + ...
}

describe('SvgPlot', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    // The responsive-fit test below stubs globals (ResizeObserver,
    // innerHeight) that must never leak into other tests, which all assume
    // the unstubbed jsdom defaults (no ResizeObserver → fixed 900x200).
    // Runs even if that test's assertions throw, unlike inline cleanup code.
    vi.unstubAllGlobals()
  })

  it('fits the plot to the container width and remaining viewport height when ResizeObserver is available', async () => {
    // jsdom has no ResizeObserver by default — the component treats that as
    // "not a real browser" and skips the fit-to-container/viewport logic
    // entirely (see SvgPlot.tsx), which is what every other test here
    // relies on for its fixed 900x200 pixel math. This test stubs one in to
    // exercise that logic specifically.
    class FakeResizeObserver {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('innerHeight', 374)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 500,
      top: 50,
      height: 0,
      left: 0,
      right: 0,
      bottom: 0,
    } as DOMRect)

    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    // width comes straight from the measured container; height is
    // (innerHeight - rect.top - BOTTOM_PADDING) / 1 row = 374 - 50 - 24 = 300,
    // comfortably inside the [250, 400] clamp so this isolates the "fit"
    // math from the clamping (covered separately below).
    // The fit runs in an effect after the SVG first appears, so wait for it.
    await waitFor(() => {
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('width')).toBe('500')
      expect(svg.getAttribute('height')).toBe('300')
    })
  })

  it('clamps row height to a 250-400px range', async () => {
    class FakeResizeObserver {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 500,
      top: 0,
      height: 0,
      left: 0,
      right: 0,
      bottom: 0,
    } as DOMRect)

    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    // A tiny viewport would compute well under 250px for one row — clamped up.
    vi.stubGlobal('innerHeight', 100)
    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => {
      expect(container.querySelector('svg')?.getAttribute('height')).toBe('250')
    })

    // A huge viewport would compute well over 400px for one row — clamped down.
    vi.stubGlobal('innerHeight', 2000)
    window.dispatchEvent(new Event('resize'))
    await waitFor(() => {
      expect(container.querySelector('svg')?.getAttribute('height')).toBe('400')
    })
  })

  it('shows the empty state with no file/variables selected', () => {
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    expect(
      screen.getByText('Select variables in the sidebar to view plots.')
    ).toBeInTheDocument()
  })

  it('places x-axis ticks on real 6-hour boundaries, not evenly-split indices', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    expect(screen.getByText('2025-01-01 00:00')).toBeInTheDocument()
    expect(screen.getByText('06:00')).toBeInTheDocument()
    expect(screen.getByText('12:00')).toBeInTheDocument()
    expect(screen.getByText('18:00')).toBeInTheDocument()
  })

  it('adds a final edge tick for the next day when the data stops short of it', async () => {
    // 00:00..23:00 hourly — the last real 6h boundary inside this range is
    // 18:00, but the data goes on to 23:00, short of the next one (24:00).
    const time = hourlyTimes(23)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    expect(screen.getByText('2025-01-01 00:00')).toBeInTheDocument()
    expect(screen.getByText('06:00')).toBeInTheDocument()
    expect(screen.getByText('12:00')).toBeInTheDocument()
    expect(screen.getByText('18:00')).toBeInTheDocument()
    // The synthetic edge tick — next day's 00:00, not the real last sample
    // (23:00) — and it carries a date since it's a different calendar day.
    expect(screen.getByText('2025-01-02 00:00')).toBeInTheDocument()

    const texts = Array.from(container.querySelectorAll('svg text')).map((t) => t.textContent)
    expect(texts).not.toContain('23:00')
  })

  it('x-axis tick interval gets finer as the zoom narrows, instead of staying fixed at 6 hours', async () => {
    // One sample per minute across 2 hours (indices 0..120) — zooming to
    // this whole range gives a 2h span, which should land on 30-min ticks.
    const time = Array.from({ length: 121 }, (_, i) => {
      const totalMinutes = i
      const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
      const m = String(totalMinutes % 60).padStart(2, '0')
      return `2025-01-01T${h}:${m}:00`
    })
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    // Zoom to the full 2h range (indices 0..120) — still triggers the X-zoom
    // commit path (which recomputes ticks against [startIdx, endIdx]).
    fireEvent.mouseDown(svg, { clientX: pxForIndex(0, 120), shiftKey: true })
    fireEvent.mouseMove(window, { clientX: pxForIndex(120, 120) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(120, 120) })

    // 30-minute ticks (00:00, 00:30, 01:00, 01:30, 02:00) — not the old fixed
    // 6-hour interval, which would've collapsed to just the two edges.
    expect(screen.getByText('00:30')).toBeInTheDocument()
    expect(screen.getByText('01:00')).toBeInTheDocument()
    expect(screen.getByText('01:30')).toBeInTheDocument()
  })

  it('clicking a row recolors its axes and line from black to blue, leaving other rows black', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: {
        temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') },
        salinity: { values: time.map((_, i) => i * 2), flags: time.map(() => 'Z') },
      },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature', 'salinity'])
    await waitFor(() => expect(container.querySelectorAll('svg').length).toBe(2))

    const rows = container.querySelectorAll('.svg-plot-row')
    const paths = container.querySelectorAll('path')
    expect(paths[0].getAttribute('stroke')).toBe('#000000')
    expect(paths[1].getAttribute('stroke')).toBe('#000000')

    fireEvent.click(rows[1])

    expect(paths[0].getAttribute('stroke')).toBe('#000000')
    expect(paths[1].getAttribute('stroke')).toBe('#2563eb')
  })

  it('resets the active row when the file changes', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    function SwitchFile() {
      const sel = usePlotSelection()
      return (
        <>
          <button data-testid="switch-file" onClick={() => sel.setFile('FILE_B')}>
            switch file
          </button>
          <button
            data-testid="switch-variables"
            onClick={() => sel.setVariables(['temperature'])}
          >
            switch variables
          </button>
        </>
      )
    }

    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SwitchFile />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    fireEvent.click(container.querySelector('.svg-plot-row')!)
    expect(container.querySelector('path')?.getAttribute('stroke')).toBe('#2563eb')

    // Switching files clears the selected variables too (a fresh file needs
    // its own variable pick) — re-selecting the same variable name for
    // FILE_B still must not carry the highlight over.
    fireEvent.click(screen.getByTestId('switch-file'))
    fireEvent.click(screen.getByTestId('switch-variables'))
    await waitFor(() =>
      expect(apiClient.getVariableData).toHaveBeenLastCalledWith('FILE_B', ['temperature'])
    )
    expect(container.querySelector('path')?.getAttribute('stroke')).toBe('#000000')
  })

  it('shift+drag zooms to the dragged time window', async () => {
    const time = hourlyTimes(18) // indices 0..18
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(18)

    const fromPx = pxForIndex(4, 18)
    const toPx = pxForIndex(14, 18)
    fireEvent.mouseDown(svg, { clientX: fromPx, shiftKey: true })
    fireEvent.mouseMove(window, { clientX: toPx })
    fireEvent.mouseUp(window, { clientX: toPx })

    // Zoomed to indices [4, 14] — 11 points, 10 segments.
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(10)
  })

  it('dragging without Shift held does not zoom', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(18)
  })

  it('ignores a shift+drag shorter than the minimum drag distance', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: 200, shiftKey: true })
    fireEvent.mouseMove(window, { clientX: 202 })
    fireEvent.mouseUp(window, { clientX: 202 })

    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(18)
  })

  it('right-click undoes a zoom, shift+right-click redoes it', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    const row = container.querySelector('.svg-plot-row')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18), shiftKey: true })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(10)

    const undoResult = fireEvent.contextMenu(row)
    expect(undoResult).toBe(false) // preventDefault() was called
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(18)

    fireEvent.contextMenu(row, { shiftKey: true })
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(10)
  })

  it('resets the zoom window when the file changes', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    function SwitchFile() {
      const sel = usePlotSelection()
      return (
        <>
          <button data-testid="switch-file" onClick={() => sel.setFile('FILE_B')}>
            switch file
          </button>
          <button
            data-testid="switch-variables"
            onClick={() => sel.setVariables(['temperature'])}
          >
            switch variables
          </button>
        </>
      )
    }

    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SwitchFile />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18), shiftKey: true })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(10)

    fireEvent.click(screen.getByTestId('switch-file'))
    fireEvent.click(screen.getByTestId('switch-variables'))
    await waitFor(() =>
      expect(apiClient.getVariableData).toHaveBeenLastCalledWith('FILE_B', ['temperature'])
    )
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(18)
  })

  it('ctrl+drag zooms only the dragged row\'s Y-axis, leaving other rows and the X-axis alone', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: {
        temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') }, // 0..18
        salinity: { values: time.map((_, i) => i), flags: time.map(() => 'Z') }, // same range
      },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature', 'salinity'])
    await waitFor(() => expect(container.querySelectorAll('svg').length).toBe(2))

    const svgs = container.querySelectorAll('svg')
    const ticksOf = (svg: Element) =>
      Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)

    expect(ticksOf(svgs[0])).toEqual(expect.arrayContaining(['0', '5', '10', '15', '20']))
    expect(ticksOf(svgs[1])).toEqual(expect.arrayContaining(['0', '5', '10', '15', '20']))

    // Drag values [4.43, 13.57] on row 0 only, via the pixel math the
    // component itself uses to invert Y (MARGIN.top=26, innerHeight=138).
    fireEvent.mouseDown(svgs[0], { clientY: 60, ctrlKey: true })
    fireEvent.mouseMove(window, { clientY: 130 })
    fireEvent.mouseUp(window, { clientY: 130 })

    expect(ticksOf(svgs[0])).toEqual(expect.arrayContaining(['4', '6', '8', '10', '12', '14']))
    expect(ticksOf(svgs[0])).not.toEqual(expect.arrayContaining(['0']))
    // Row 1 (salinity) is untouched — still full-range.
    expect(ticksOf(svgs[1])).toEqual(expect.arrayContaining(['0', '5', '10', '15', '20']))
    // X-axis (shared) is also untouched by a Y-only zoom.
    expect(segmentCount(container.querySelectorAll('path')[0].getAttribute('d'))).toBe(18)
  })

  it('right-click undo/redo walks a mix of X-zooms and Y-zooms in order', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    const row = container.querySelector('.svg-plot-row')!
    const ticks = () => Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)
    const segments = () => segmentCount(container.querySelector('path')?.getAttribute('d'))

    // 1) X-zoom to indices [4, 14].
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18), shiftKey: true })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    expect(segments()).toBe(10)

    // After the X-zoom, this row's Y auto-fits to that window's values
    // ([4, 14], since values[i] === i) — confirm the pre-Y-zoom baseline.
    expect(ticks()).toEqual(expect.arrayContaining(['4', '6', '8', '10', '12', '14']))

    // 2) Y-zoom on top of that, narrowing further to roughly [6.46, 11.54].
    fireEvent.mouseDown(svg, { clientY: 60, ctrlKey: true })
    fireEvent.mouseMove(window, { clientY: 130 })
    fireEvent.mouseUp(window, { clientY: 130 })
    expect(ticks()).toEqual(expect.arrayContaining(['7', '9', '11']))
    expect(ticks()).not.toEqual(expect.arrayContaining(['4']))

    // Undo #1: drops the Y-zoom — back to the X-only ticks, X-zoom stays (10 segments).
    fireEvent.contextMenu(row)
    expect(segments()).toBe(10)
    expect(ticks()).toEqual(expect.arrayContaining(['4', '6', '8', '10', '12', '14']))
    expect(ticks()).not.toEqual(expect.arrayContaining(['7']))

    // Undo #2: drops the X-zoom too — back to full extent.
    fireEvent.contextMenu(row)
    expect(segments()).toBe(18)

    // Redo #1: restores the X-zoom.
    fireEvent.contextMenu(row, { shiftKey: true })
    expect(segments()).toBe(10)

    // Redo #2: restores the Y-zoom on top.
    fireEvent.contextMenu(row, { shiftKey: true })
    expect(ticks()).toEqual(expect.arrayContaining(['7', '9', '11']))
  })

  it('ctrl+drag shorter than the minimum drag distance is ignored', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientY: 60, ctrlKey: true })
    fireEvent.mouseMove(window, { clientY: 62 })
    fireEvent.mouseUp(window, { clientY: 62 })

    expect(Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)).toEqual(
      expect.arrayContaining(['0', '5', '10', '15', '20'])
    )
  })

  it('a plain click (no Shift/Ctrl/Cmd) still activates the row', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    fireEvent.click(container.querySelector('.svg-plot-row')!)
    expect(container.querySelector('path')?.getAttribute('stroke')).toBe('#2563eb')
  })

  it('cmd+click undoes a zoom, double-click redoes it', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    const row = container.querySelector('.svg-plot-row')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18), shiftKey: true })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(10)

    fireEvent.click(row, { metaKey: true })
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(18)

    fireEvent.doubleClick(row)
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(10)
  })

  it('cmd+click does not also activate the row', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    fireEvent.click(container.querySelector('.svg-plot-row')!, { metaKey: true })
    expect(container.querySelector('path')?.getAttribute('stroke')).toBe('#000000')
  })

  it('right-click still works for undo/redo alongside the new Cmd+click/double-click bindings', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    const row = container.querySelector('.svg-plot-row')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18), shiftKey: true })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(10)

    fireEvent.contextMenu(row)
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(18)

    fireEvent.contextMenu(row, { shiftKey: true })
    expect(segmentCount(container.querySelector('path')?.getAttribute('d'))).toBe(10)
  })

  it('shows a translucent magenta band tight around the selected values once the drag resolves', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    await waitFor(() => expect(container.querySelector('rect[fill="#ff00ff"]')).toBeInTheDocument())

    const band = container.querySelector('rect[fill="#ff00ff"]')
    expect(band).toBeInTheDocument()
    expect(band?.getAttribute('opacity')).toBe('0.15')
    expect(Number(band?.getAttribute('x'))).toBeCloseTo(pxForIndex(4, 18), 1)
    expect(Number(band?.getAttribute('width'))).toBeCloseTo(pxForIndex(14, 18) - pxForIndex(4, 18), 1)
    expect(Number(band?.getAttribute('height'))).toBeLessThan(138)
  })

  it('clamps the highlight band to the plot area when padding would push it past the edge', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    // Indices [0, 2] hold the row's lowest values (0, 1, 2). The row's Y
    // domain is niceTicks-rounded to [0, 20] (buildScale pads for
    // "breathing room"), and scale.y(0) lands exactly on the plot's bottom
    // edge (rowHeight - MARGIN.bottom = 164) by construction — so the 12px
    // pad here would push the band's bottom to 176, past that edge, unless
    // clamped back to 164.
    fireEvent.mouseDown(svg, { clientX: pxForIndex(0, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(2, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(2, 18) })
    await waitFor(() => expect(container.querySelector('rect[fill="#ff00ff"]')).toBeInTheDocument())

    const band = container.querySelector('rect[fill="#ff00ff"]')
    const y = Number(band?.getAttribute('y'))
    const height = Number(band?.getAttribute('height'))
    // Unclamped this would be ~176 (38px past the edge) — clamped, it must
    // land exactly on rowHeight - MARGIN.bottom (164).
    expect(y + height).toBeCloseTo(164, 1)
  })

  it('shows the magenta band live while dragging, before the selection resolves, replacing the old blue rubber-band', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })

    // Mouse still down — the band should already show, live.
    const band = container.querySelector('rect[fill="#ff00ff"]')
    expect(band).toBeInTheDocument()
    // The old blue rubber-band for flag-drags is gone.
    expect(container.querySelector('rect[fill="rgba(37, 99, 235, 0.15)"]')).not.toBeInTheDocument()

    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
  })

  it('editable plain-drag shorter than the minimum drag distance is ignored', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 202 })
    fireEvent.mouseUp(window, { clientX: 202 })

    expect(container.querySelector('rect[fill="#ff00ff"]')).not.toBeInTheDocument()
  })

  it('a rejected session-open clears the flag selection on commit', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'openSession').mockRejectedValue(new Error('locked'))
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    await waitFor(() =>
      expect(container.querySelector('rect[fill="#ff00ff"]')).not.toBeInTheDocument()
    )
  })

  it('ctrl+drag with editable=true zooms the Y-axis and does not also start a flag selection', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    const ticksOf = () => Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)
    expect(ticksOf()).toEqual(expect.arrayContaining(['0', '5', '10', '15', '20']))

    fireEvent.mouseDown(svg, { clientY: 60, ctrlKey: true })
    fireEvent.mouseMove(window, { clientY: 130 })
    fireEvent.mouseUp(window, { clientY: 130 })

    expect(ticksOf()).not.toEqual(expect.arrayContaining(['0', '5', '10', '15', '20']))
    expect(container.querySelector('rect[fill="#ff00ff"]')).not.toBeInTheDocument()
  })

  it('plain drag does not start a flag selection when not editable', async () => {
    // renderSvgPlot always sets the 'qca' role (which permits editing), so
    // arming is exercised directly with a role that doesn't — 'user' —
    // rather than via that helper, since arming now depends on canEdit
    // (role), not a prop.
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'user')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    expect(container.querySelector('rect[fill="#ff00ff"]')).not.toBeInTheDocument()
  })

  it('a resolved drag sets flagSelection in context with the correct rangeLabel', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    function SelectionReadout() {
      const { flagSelection } = useEditSession()
      return (
        <span data-testid="selection-readout">
          {flagSelection
            ? `${flagSelection.varName}:${flagSelection.startIdx}-${flagSelection.endIdx}:${flagSelection.rangeLabel}`
            : 'none'}
        </span>
      )
    }

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SelectionReadout />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    expect(screen.getByTestId('selection-readout')).toHaveTextContent(
      'temperature:4-14:04:00:00–14:00:00'
    )
  })

  it('refetches variable data when flagAppliedAt increments', async () => {
    const time = hourlyTimes(18)
    const getVariableDataSpy = vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    function NotifyButton() {
      const { notifyFlagged } = useEditSession()
      return <button onClick={() => notifyFlagged()}>notify flagged</button>
    }

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <NotifyButton />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())
    expect(getVariableDataSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('notify flagged'))

    await waitFor(() => expect(getVariableDataSpy).toHaveBeenCalledTimes(2))
  })

  it("draws a colored marker for points whose flag differs from the row's dominant flag", async () => {
    const time = hourlyTimes(18)
    const flags = time.map((_, i) => (i === 5 || i === 6 ? 'K' : 'Z'))
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    expect(container.querySelectorAll('circle').length).toBe(2)
  })

  it('draws no markers or legend when every point shares the same flag', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    expect(container.querySelectorAll('circle').length).toBe(0)
    expect(container.querySelectorAll('path[stroke="#ff00ff"]').length).toBe(0)
  })

  it('overlays a magenta line segment for a contiguous run of committed flagged points', async () => {
    const time = hourlyTimes(18)
    const flags = time.map((_, i) => (i === 5 || i === 6 ? 'K' : 'Z'))
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const magentaPaths = container.querySelectorAll('path[stroke="#ff00ff"]')
    expect(magentaPaths).toHaveLength(1)
    // Indices 5,6 are adjacent — one line command (M + one L).
    expect(segmentCount(magentaPaths[0].getAttribute('d'))).toBe(1)
  })

  it('splits into separate magenta segments when flagged runs are not contiguous', async () => {
    const time = hourlyTimes(18)
    const flaggedIdx = [5, 6, 10, 11]
    const flags = time.map((_, i) => (flaggedIdx.includes(i) ? 'K' : 'Z'))
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const magentaPaths = container.querySelectorAll('path[stroke="#ff00ff"]')
    expect(magentaPaths).toHaveLength(2)
    expect(Array.from(magentaPaths).map((p) => segmentCount(p.getAttribute('d')))).toEqual([1, 1])
  })

  it('shows a legend entry for a non-dominant flag code present in the row', async () => {
    const time = hourlyTimes(18)
    const flags = time.map((_, i) => (i === 5 ? 'K' : 'Z'))
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const kDescription = FLAG_CODES.find((f) => f.code === 'K')!.description
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`K — ${kDescription}`))).toBeInTheDocument()
    )
  })

  it('a plain drag past the threshold opens the session when one is not already open', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    const openSpy = vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    expect(openSpy).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(container.querySelector('rect[fill="#ff00ff"]')).toBeInTheDocument()
    )
  })

  it('a click below the drag threshold does not open a session', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    const openSpy = vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 202 })
    fireEvent.mouseUp(window, { clientX: 202 })

    expect(openSpy).not.toHaveBeenCalled()
  })

  it('does not re-open a session on a second drag once one is already open', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    const openSpy = vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1))

    fireEvent.mouseDown(svg, { clientX: pxForIndex(0, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(3, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(3, 18) })

    expect(openSpy).toHaveBeenCalledTimes(1)
  })

  it('shows a tooltip with date, time, and value when hovering a plot row', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseMove(svg, { clientX: pxForIndex(5, 18), clientY: 100 })

    const tip = screen.getByTestId('hover-tooltip')
    expect(tip).toHaveTextContent('2025-01-01')
    expect(tip).toHaveTextContent('05:00:00')
    expect(tip).toHaveTextContent('5')
  })

  it('hides the tooltip on mouse leave', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseMove(svg, { clientX: pxForIndex(5, 18), clientY: 100 })
    expect(screen.getByTestId('hover-tooltip')).toBeInTheDocument()

    fireEvent.mouseLeave(svg)
    expect(screen.queryByTestId('hover-tooltip')).not.toBeInTheDocument()
  })

  it('resets the hover tooltip when switching to a dataset with fewer samples', async () => {
    const timeA = hourlyTimes(18) // 19 samples, indices 0-18
    const timeB = hourlyTimes(4) // 5 samples, indices 0-4 — shorter than the hovered index

    vi.spyOn(apiClient, 'getVariableData').mockImplementation((file: string) => {
      if (file === 'FILE_B') {
        return Promise.resolve({
          time: timeB,
          variables: {
            temperature: { values: timeB.map((_, i) => i), flags: timeB.map(() => 'Z') },
          },
        })
      }
      return Promise.resolve({
        time: timeA,
        variables: {
          temperature: { values: timeA.map((_, i) => i), flags: timeA.map(() => 'Z') },
        },
      })
    })

    function SwitchFile() {
      const sel = usePlotSelection()
      return (
        <>
          <button data-testid="switch-file" onClick={() => sel.setFile('FILE_B')}>
            switch file
          </button>
          <button
            data-testid="switch-variables"
            onClick={() => sel.setVariables(['temperature'])}
          >
            switch variables
          </button>
        </>
      )
    }

    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SwitchFile />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    // Hover an index (15) that only exists in the 19-sample FILE_A dataset —
    // FILE_B only has 5 samples, so this index would be out of range there.
    fireEvent.mouseMove(svg, { clientX: pxForIndex(15, 18), clientY: 100 })
    expect(screen.getByTestId('hover-tooltip')).toBeInTheDocument()

    // A render crash here (stale hoverTip.idx read against the shorter
    // dataset) happens inside React's own scheduling — after the data-fetch
    // effect's `.then` calls setData — so it surfaces as a process-level
    // uncaught exception / unhandled rejection rather than a synchronous
    // throw any `expect(...).toThrow()` around the fireEvent calls would
    // catch. Capture it directly instead.
    // Minimal ambient typing for Node's `process` event emitter — this
    // project's browser tsconfig (tsconfig.app.json) doesn't include
    // @types/node, so `process` has no type here even though it exists at
    // runtime under vitest's Node-based test environment.
    const nodeProcess = globalThis as unknown as {
      process: {
        on: (event: string, listener: (reason: unknown) => void) => void
        off: (event: string, listener: (reason: unknown) => void) => void
      }
    }
    let caught: unknown = null
    const onError = (reason: unknown) => {
      caught = reason
    }
    nodeProcess.process.on('uncaughtException', onError)
    nodeProcess.process.on('unhandledRejection', onError)
    try {
      // Switching file/variables without the pointer leaving the SVG (so
      // mouseleave never fires) must not carry the stale index over — it
      // should be cleared by the [file, variables] reset effect instead.
      fireEvent.click(screen.getByTestId('switch-file'))
      fireEvent.click(screen.getByTestId('switch-variables'))
      await waitFor(() =>
        expect(apiClient.getVariableData).toHaveBeenLastCalledWith('FILE_B', ['temperature'])
      )
      // Let any render error triggered by the resolved fetch surface.
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      nodeProcess.process.off('uncaughtException', onError)
      nodeProcess.process.off('unhandledRejection', onError)
    }

    expect(caught).toBeNull()
    expect(screen.queryByTestId('hover-tooltip')).not.toBeInTheDocument()
  })

  it('shows "no data" when the nearest sample has a null value', async () => {
    const time = hourlyTimes(18)
    const values = time.map((_, i) => (i === 5 ? null : i))
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values, flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseMove(svg, { clientX: pxForIndex(5, 18), clientY: 100 })

    expect(screen.getByTestId('hover-tooltip')).toHaveTextContent('no data')
  })
})
