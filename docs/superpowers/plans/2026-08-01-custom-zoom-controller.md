# Custom Zoom Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `PlotView`'s Plotly-native zoom (dragmode `'zoom'` + after-the-fact relayout correction) with a controller we own: axis-constrained zoom built from box-*select* events (correct by construction, no correction hack) plus a right-click/shift-right-click undo/redo history.

**Architecture:** `dragmode` stays `'select'` always. On a box-select event, branch on which modifier key (Shift or Cmd/Ctrl) was held during the drag: read the reported `range` for just the intended axis (x for Shift, this row's y for Cmd/Ctrl) and `Plotly.relayout` only that axis — Plotly's box-select event reports the drawn rectangle without applying any zoom itself, so there's nothing to correct afterward. Two ref-based stacks (`backStackRef`/`forwardStackRef`) hold full axis-range snapshots for undo/redo, driven by right-click/shift+right-click on a wrapper div. File/variable changes clear history and reset to full extent.

**Tech Stack:** React 18/19, TypeScript, Plotly.js via `react-plotly.js`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-01-custom-zoom-controller-design.md`

Note on the spec: it says double-click-reset is disabled via `layout.doubleClick =
false`. That's not accurate to the Plotly API — double-click behavior is a
**config** option, not a layout option. Task 9 below implements it correctly as
`config={{ ..., doubleClick: false }}`. No behavior change from what was agreed,
just a corrected implementation detail.

---

## Reference: current file state

`src/components/PlotView.tsx` currently has, among other things not touched by
this plan:
- A `zoomAxis` derived from `shiftHeld`/`metaHeld` state (lines 51–75).
- `zoomAxisRef`, `correctingRef`, `preservedRangesRef` and an effect that
  snapshots axis ranges before a native Plotly zoom (lines 77–97).
- `handleRelayout`, which corrects the non-intended axis after Plotly's native
  zoom already applied to both (lines 176–206).
- `dragmode: zoomAxis ? 'zoom' : 'select'` in the `layout` object (line 311).
- `<PlotlyPlot ... onRelayout={handleRelayout} ... />` (line 342).

All of the above gets removed across Tasks 2–4 below and replaced with the new
controller. `shiftHeld`/`metaHeld` themselves (lines 51, 52, 53–74) are kept
unchanged — they're still how we detect which modifier is held during a drag.

`src/__tests__/PlotView.test.tsx` currently mocks `PlotlyPlot` with a fixed
"simulate select" button that always fires a hardcoded points-only event, and
doesn't mock `PlotlyLib` at all (the real module's relayout would be called,
but no test today exercises a code path that calls it). Task 1 replaces this
mock with one that (a) exposes the latest props so tests can invoke
`onSelected` with an arbitrary payload including `range`, (b) mocks
`PlotlyLib.relayout` and has it actually mutate a fake graph div's `layout` so
sequential zoom/undo/redo assertions reflect real state instead of a static
snapshot, and (c) still provides the "simulate select" button for the existing
flagging tests, unchanged.

---

### Task 1: Test infrastructure — upgrade the `PlotlyPlot`/`PlotlyLib` mock

**Files:**
- Modify: `src/__tests__/PlotView.test.tsx:1-27`

No behavior changes in this task — it upgrades shared test infrastructure so
Tasks 2+ have something to test against. Verified by re-running the full
existing suite (must stay green).

- [ ] **Step 1: Replace the mock block**

Replace lines 1–27 of `src/__tests__/PlotView.test.tsx` (the imports through
the end of the `vi.mock('../components/PlotlyPlot', ...)` call) with:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { PlotlyPlotProps } from 'react-plotly.js/factory'
import { PlotView } from '../components/PlotView'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

type FakeAxisLayout = Record<string, { range?: [number, number] }>

const plotlyMock = vi.hoisted(() => {
  const graphDiv = { layout: {} as FakeAxisLayout }
  const relayout = vi.fn((_graphDiv: unknown, patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      const [axisKey, prop] = key.split('.')
      graphDiv.layout[axisKey] = graphDiv.layout[axisKey] ?? {}
      if (prop === 'range') {
        graphDiv.layout[axisKey].range = value as [number, number]
      } else if (prop === 'autorange') {
        delete graphDiv.layout[axisKey].range
      }
    }
    return Promise.resolve()
  })
  return {
    latestProps: null as PlotlyPlotProps | null,
    graphDiv,
    relayout,
  }
})

vi.mock('../components/PlotlyPlot', () => ({
  PlotlyPlot: (props: PlotlyPlotProps) => {
    plotlyMock.latestProps = props
    props.onInitialized?.(null, plotlyMock.graphDiv as unknown as HTMLDivElement)
    return (
      <div data-testid="plotly-plot">
        traces:{props.data.length}
        <button
          onClick={() =>
            props.onSelected?.({
              points: [
                { curveNumber: 0, pointIndex: 1 },
                { curveNumber: 0, pointIndex: 2 },
              ],
            })
          }
        >
          simulate select
        </button>
      </div>
    )
  },
  PlotlyLib: { relayout: plotlyMock.relayout },
}))

// Fires a box-select event carrying only a `range` (no points) — the shape
// Plotly reports for a Shift/Cmd-modified zoom drag. `range` keys follow
// Plotly's axis id convention: 'x'/'y' for the first row, 'x2'/'y2' for the
// second, etc.
function simulateZoomDrag(range: Record<string, [number, number]>) {
  act(() => {
    plotlyMock.latestProps?.onSelected?.({ points: [], range })
  })
}
```

- [ ] **Step 2: Reset the mock's captured state between tests**

The existing `beforeEach` in the `describe('PlotView', ...)` block currently
reads:

```tsx
  beforeEach(() => {
    vi.restoreAllMocks()
  })
```

Replace it with:

```tsx
  beforeEach(() => {
    vi.restoreAllMocks()
    plotlyMock.relayout.mockClear()
    plotlyMock.graphDiv.layout = {}
  })
```

- [ ] **Step 3: Run the full existing suite to confirm no regression**

Run: `npx vitest run src/__tests__/PlotView.test.tsx`
Expected: All 5 existing tests still PASS (mock shape changed, behavior
exercised by existing tests didn't).

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/PlotView.test.tsx
git commit -m "test: upgrade PlotlyPlot mock to support zoom controller tests"
```

---

### Task 2: Shift+drag zooms the x-axis only

**Files:**
- Modify: `src/types/plotly.d.ts`
- Modify: `src/components/PlotView.tsx`
- Test: `src/__tests__/PlotView.test.tsx`

- [ ] **Step 1: Add `range` to the `PlotlySelectedEvent` type**

In `src/types/plotly.d.ts`, the `PlotlySelectedEvent` interface currently
reads:

```ts
  export interface PlotlySelectedEvent {
    points: PlotlySelectedPoint[]
  }
```

Replace with:

```ts
  export interface PlotlySelectedEvent {
    points: PlotlySelectedPoint[]
    // Present on box-select drags: the drawn rectangle's data-coordinate
    // bounds, keyed by Plotly axis id ('x'/'y' for the first subplot,
    // 'x2'/'y2' for the second, etc). Absent for lasso-select or a
    // zero-width click.
    range?: Record<string, [number, number]>
  }
```

No test for this step (type-only change, not independently testable) — its
effect is verified by Task 2's Step 3 type-checking cleanly.

- [ ] **Step 2: Write the failing test**

Add to the `describe('PlotView', ...)` block in
`src/__tests__/PlotView.test.tsx`, after the existing `'fetches data and
renders one combined plot...'` test:

```tsx
  it('shift+drag zooms the x-axis only, across all rows', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: {
        temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] },
        salinity: { values: [30, 31, 32], flags: ['Z', 'Z', 'Z'] },
      },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature', 'salinity'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'Shift' })
    simulateZoomDrag({ x: [10, 20] })
    fireEvent.keyUp(window, { key: 'Shift' })

    expect(plotlyMock.relayout).toHaveBeenCalledTimes(1)
    expect(plotlyMock.relayout).toHaveBeenCalledWith(plotlyMock.graphDiv, {
      'xaxis.range': [10, 20],
      'xaxis2.range': [10, 20],
    })
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "shift+drag zooms the x-axis only"`
Expected: FAIL — `plotlyMock.relayout` was called 0 times (current code only
zooms via native Plotly `dragmode: 'zoom'`, which this event shape doesn't
trigger).

- [ ] **Step 4: Implement**

In `src/components/PlotView.tsx`:

Replace the import line:

```ts
import { useEffect, useRef, useState } from 'react'
```

with:

```ts
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
```

Replace lines 46–97 (the comment through the end of the snapshot `useEffect`,
i.e. from `// Shift+drag zooms...` through `}, [zoomAxis, variables])`) with:

```ts
  // Shift+drag zooms the (shared) x-axis only; Cmd/Ctrl+drag zooms one row's
  // y-axis only. Both are read from a box-*select* event's `range` (Plotly
  // reports the drawn rectangle without applying any zoom itself for
  // dragmode 'select'), so only the intended axis is ever patched — no
  // after-the-fact correction needed. See handleSelected/applyZoom.
  const [shiftHeld, setShiftHeld] = useState(false)
  const [metaHeld, setMetaHeld] = useState(false)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true)
      if (e.key === 'Meta' || e.key === 'Control') setMetaHeld(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false)
      if (e.key === 'Meta' || e.key === 'Control') setMetaHeld(false)
    }
    const handleBlur = () => {
      setShiftHeld(false)
      setMetaHeld(false)
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

  const graphDivRef = useRef<HTMLDivElement | null>(null)
  const backStackRef = useRef<AxisSnapshot[]>([])
  const forwardStackRef = useRef<AxisSnapshot[]>([])

  // Snapshots every row's current x/y axis range (undefined = autorange),
  // so it can be pushed onto the undo/redo stacks before a new zoom applies.
  const getCurrentRanges = (): AxisSnapshot => {
    const layout =
      (graphDivRef.current as unknown as { layout?: Record<string, { range?: [number, number] }> })
        ?.layout ?? {}
    const snapshot: AxisSnapshot = {}
    variables.forEach((_, i) => {
      const suffix = i === 0 ? '' : `${i + 1}`
      snapshot[`xaxis${suffix}`] = layout[`xaxis${suffix}`]?.range
      snapshot[`yaxis${suffix}`] = layout[`yaxis${suffix}`]?.range
    })
    return snapshot
  }

  const relayoutToSnapshot = (snapshot: AxisSnapshot) => {
    if (!graphDivRef.current) return
    const patch: Record<string, unknown> = {}
    for (const [key, range] of Object.entries(snapshot)) {
      if (range) patch[`${key}.range`] = range
      else patch[`${key}.autorange`] = true
    }
    PlotlyLib.relayout(graphDivRef.current, patch)
  }

  const applyZoom = (patch: Record<string, unknown>) => {
    if (!graphDivRef.current) return
    backStackRef.current.push(getCurrentRanges())
    forwardStackRef.current = []
    PlotlyLib.relayout(graphDivRef.current, patch)
  }

  const handleContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    const stack = e.shiftKey ? forwardStackRef.current : backStackRef.current
    const other = e.shiftKey ? backStackRef.current : forwardStackRef.current
    if (stack.length === 0) return
    const snapshot = stack.pop()!
    other.push(getCurrentRanges())
    relayoutToSnapshot(snapshot)
  }

  // Resets zoom to full extent and clears undo/redo history whenever the
  // selected file or variable set changes — a stale zoomed range or history
  // entry from a previous file/row layout wouldn't make sense here.
  useEffect(() => {
    backStackRef.current = []
    forwardStackRef.current = []
    if (!graphDivRef.current || variables.length === 0) return
    const patch: Record<string, unknown> = {}
    variables.forEach((_, i) => {
      const suffix = i === 0 ? '' : `${i + 1}`
      patch[`xaxis${suffix}.autorange`] = true
      patch[`yaxis${suffix}.autorange`] = true
    })
    PlotlyLib.relayout(graphDivRef.current, patch)
  }, [file, variables])
```

Add this type above the `PlotView` function (after the `interface Selection`
block):

```ts
type AxisSnapshot = Record<string, [number, number] | undefined>
```

Replace `handleRelayout` (lines 176–206) — delete it entirely, it's fully
superseded by `applyZoom`/`relayoutToSnapshot`/`handleContextMenu` above.

Replace the start of `handleSelected` (currently `if (!evt || !evt.points ||
evt.points.length === 0) return`) — the full function currently reads:

```ts
  const handleSelected = (evt: PlotlySelectedEvent | undefined) => {
    if (!evt || !evt.points || evt.points.length === 0) return
    const byVar: Record<string, number[]> = {}
```

Replace with:

```ts
  const handleSelected = (evt: PlotlySelectedEvent | undefined) => {
    if (!evt) return
    if (shiftHeld || metaHeld) {
      const range = evt.range
      if (!range) return
      if (shiftHeld) {
        const xKey = Object.keys(range).find((k) => k[0] === 'x')
        if (!xKey) return
        const patch: Record<string, unknown> = {}
        variables.forEach((_, i) => {
          const suffix = i === 0 ? '' : `${i + 1}`
          patch[`xaxis${suffix}.range`] = range[xKey]
        })
        applyZoom(patch)
      } else {
        const yKey = Object.keys(range).find((k) => k[0] === 'y')
        if (!yKey) return
        applyZoom({ [`${yKey.replace(/^y/, 'yaxis')}.range`]: range[yKey] })
      }
      return
    }
    if (!evt.points || evt.points.length === 0) return
    const byVar: Record<string, number[]> = {}
```

(The `yKey.replace(/^y/, 'yaxis')` inline converts Plotly's short axis id —
`'y'`, `'y2'`, ... — to the layout property name `'yaxis'`, `'yaxis2'`, ....)

In the `layout` object (currently `dragmode: zoomAxis ? 'zoom' : 'select',`),
replace with:

```ts
    dragmode: 'select',
```

In the JSX, remove the now-deleted handler from the `<PlotlyPlot>` call —
delete the line `onRelayout={handleRelayout}` from the props list (it stays
otherwise unchanged; Task 4 wraps this element in a new div, so don't worry
about surrounding structure yet).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "shift+drag zooms the x-axis only"`
Expected: PASS

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run src/__tests__/PlotView.test.tsx && npx tsc --noEmit`
Expected: All tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/types/plotly.d.ts src/components/PlotView.tsx src/__tests__/PlotView.test.tsx
git commit -m "feat: replace native Plotly zoom with shift-drag x-axis-only zoom controller"
```

---

### Task 3: Cmd/Ctrl+drag zooms the y-axis only, on the correct row

**Files:**
- Modify: `src/components/PlotView.tsx` (no change needed — implemented in Task 2)
- Test: `src/__tests__/PlotView.test.tsx`

The y-branch was already implemented in Task 2 (both branches were added
together since they share `handleSelected`'s modifier check). This task adds
the test that proves it, and is expected to pass immediately — still run it
red-then-green by temporarily confirming the assertion is meaningful.

- [ ] **Step 1: Write the test**

Add after the `'shift+drag zooms the x-axis only...'` test:

```tsx
  it('cmd/ctrl+drag zooms the y-axis only, on the row the drag happened in', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: {
        temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] },
        salinity: { values: [30, 31, 32], flags: ['Z', 'Z', 'Z'] },
      },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature', 'salinity'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    // Drag on the second row (salinity) — Plotly reports both x2 and y2 for
    // that subplot's box; only y2 should end up in the relayout patch.
    fireEvent.keyDown(window, { key: 'Control' })
    simulateZoomDrag({ x2: [1, 2], y2: [5, 15] })
    fireEvent.keyUp(window, { key: 'Control' })

    expect(plotlyMock.relayout).toHaveBeenCalledTimes(1)
    expect(plotlyMock.relayout).toHaveBeenCalledWith(plotlyMock.graphDiv, {
      'yaxis2.range': [5, 15],
    })
  })
```

- [ ] **Step 2: Run it — confirm it passes (implementation already present from Task 2)**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "cmd/ctrl\\+drag zooms the y-axis only"`
Expected: PASS

If it fails, re-check Task 2 Step 4's `handleSelected` replacement was applied
completely — this test exercises the `else` (metaHeld) branch added there.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/PlotView.test.tsx
git commit -m "test: cover cmd/ctrl-drag y-axis-only zoom on the correct row"
```

---

### Task 4: Right-click steps zoom back one level; native context menu suppressed

**Files:**
- Modify: `src/components/PlotView.tsx`
- Test: `src/__tests__/PlotView.test.tsx`

- [ ] **Step 1: Write the failing test**

Add after the cmd/ctrl-drag test:

```tsx
  it('right-click steps zoom back one level and suppresses the context menu', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: { temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'Shift' })
    simulateZoomDrag({ x: [10, 20] })
    fireEvent.keyUp(window, { key: 'Shift' })
    expect(plotlyMock.graphDiv.layout.xaxis?.range).toEqual([10, 20])

    const notCancelled = fireEvent.contextMenu(screen.getByTestId('plot-canvas'))

    expect(notCancelled).toBe(false) // event.preventDefault() was called
    expect(plotlyMock.relayout).toHaveBeenCalledTimes(2)
    expect(plotlyMock.relayout).toHaveBeenLastCalledWith(plotlyMock.graphDiv, {
      'xaxis.autorange': true,
      'yaxis.autorange': true,
    })
    expect(plotlyMock.graphDiv.layout.xaxis?.range).toBeUndefined()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "right-click steps zoom back"`
Expected: FAIL — `screen.getByTestId('plot-canvas')` doesn't exist yet (no
wrapper div with that testid/context-menu handler).

- [ ] **Step 3: Implement**

In `src/components/PlotView.tsx`, find the JSX block:

```tsx
      {data && (
        <PlotlyPlot
          data={traces}
          layout={layout}
          config={{ displaylogo: false }}
          style={{ width: '100%' }}
          useResizeHandler
          onSelected={handleSelected}
          onInitialized={handleGraphRef}
          onUpdate={handleGraphRef}
        />
      )}
```

Replace with:

```tsx
      {data && (
        <div className="plot-canvas" data-testid="plot-canvas" onContextMenu={handleContextMenu}>
          <PlotlyPlot
            data={traces}
            layout={layout}
            config={{ displaylogo: false }}
            style={{ width: '100%' }}
            useResizeHandler
            onSelected={handleSelected}
            onInitialized={handleGraphRef}
            onUpdate={handleGraphRef}
          />
        </div>
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "right-click steps zoom back"`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run src/__tests__/PlotView.test.tsx`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/PlotView.tsx src/__tests__/PlotView.test.tsx
git commit -m "feat: right-click steps zoom back one level, suppresses context menu"
```

---

### Task 5: Shift+right-click steps zoom forward one level

**Files:**
- Modify: `src/components/PlotView.tsx` (no change needed — implemented in Task 2/4)
- Test: `src/__tests__/PlotView.test.tsx`

`handleContextMenu` already branches on `e.shiftKey` (Task 2 Step 4). This
task proves the forward direction.

- [ ] **Step 1: Write the test**

Add after the right-click test:

```tsx
  it('shift+right-click steps zoom forward one level after an undo', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: { temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'Shift' })
    simulateZoomDrag({ x: [10, 20] })
    fireEvent.keyUp(window, { key: 'Shift' })

    fireEvent.contextMenu(screen.getByTestId('plot-canvas')) // undo
    expect(plotlyMock.graphDiv.layout.xaxis?.range).toBeUndefined()

    fireEvent.contextMenu(screen.getByTestId('plot-canvas'), { shiftKey: true }) // redo

    expect(plotlyMock.relayout).toHaveBeenCalledTimes(3)
    expect(plotlyMock.relayout).toHaveBeenLastCalledWith(plotlyMock.graphDiv, {
      'xaxis.range': [10, 20],
      'yaxis.autorange': true,
    })
    expect(plotlyMock.graphDiv.layout.xaxis?.range).toEqual([10, 20])
  })
```

- [ ] **Step 2: Run it — confirm it passes**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "shift\\+right-click steps zoom forward"`
Expected: PASS

If it fails, re-check `handleContextMenu` from Task 2 Step 4 correctly swaps
`stack`/`other` based on `e.shiftKey`.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/PlotView.test.tsx
git commit -m "test: cover shift+right-click zoom redo"
```

---

### Task 6: A new zoom action after an undo clears the redo stack

**Files:**
- Modify: `src/components/PlotView.tsx` (no change needed — implemented in Task 2)
- Test: `src/__tests__/PlotView.test.tsx`

`applyZoom` already does `forwardStackRef.current = []` (Task 2 Step 4). This
task proves it.

- [ ] **Step 1: Write the test**

Add after the redo test:

```tsx
  it('a new zoom after an undo clears the redo stack', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: { temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'Shift' })
    simulateZoomDrag({ x: [10, 20] })
    fireEvent.contextMenu(screen.getByTestId('plot-canvas')) // undo — redo stack now has 1 entry
    simulateZoomDrag({ x: [30, 40] }) // new zoom — should clear the redo stack
    fireEvent.keyUp(window, { key: 'Shift' })

    const callsBeforeRedoAttempt = plotlyMock.relayout.mock.calls.length
    fireEvent.contextMenu(screen.getByTestId('plot-canvas'), { shiftKey: true }) // redo — should be a no-op

    expect(plotlyMock.relayout).toHaveBeenCalledTimes(callsBeforeRedoAttempt)
    expect(plotlyMock.graphDiv.layout.xaxis?.range).toEqual([30, 40])
  })
```

- [ ] **Step 2: Run it — confirm it passes**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "clears the redo stack"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/PlotView.test.tsx
git commit -m "test: cover redo stack invalidation after a new zoom"
```

---

### Task 7: Zoom history clears and view resets on file/variable change

**Files:**
- Modify: `src/components/PlotView.tsx` (no change needed — implemented in Task 2)
- Test: `src/__tests__/PlotView.test.tsx`

The reset effect was added in Task 2 Step 4 (`useEffect(..., [file,
variables])`). This task proves both trigger cases.

- [ ] **Step 1: Write the failing test**

This one needs a way to change `variables` without changing `file` — add a
small helper component alongside the existing `Setup`/`SwitchFile` pattern
already used later in this file. Add after the "clears the redo stack" test:

```tsx
  it('zoom history clears and resets to full extent when the file changes', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockImplementation((filename: string) =>
      Promise.resolve({
        time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
        variables: { temperature: { values: [1, 2, 3], flags: ['Z', 'Z', 'Z'] } },
      })
    )
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    function SwitchFile() {
      const sel = usePlotSelection()
      return (
        <button data-testid="switch-file" onClick={() => sel.setFile('FILE_B')}>
          switch
        </button>
      )
    }

    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    render(
      <AuthProvider>
        <PlotSelectionProvider>
          <Setup file="FILE_A" variables={['temperature']} />
          <SwitchFile />
          <PlotView />
        </PlotSelectionProvider>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('apply-selection'))
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'Shift' })
    simulateZoomDrag({ x: [10, 20] })
    fireEvent.keyUp(window, { key: 'Shift' })
    expect(plotlyMock.graphDiv.layout.xaxis?.range).toEqual([10, 20])

    fireEvent.click(screen.getByTestId('switch-file'))
    await waitFor(() =>
      expect(apiClient.getVariableData).toHaveBeenCalledWith('FILE_B', ['temperature'])
    )

    // Reset relayout call landed, and undo history is empty (a right-click
    // now must be a no-op — no additional relayout call).
    expect(plotlyMock.graphDiv.layout.xaxis?.range).toBeUndefined()
    const callsAfterReset = plotlyMock.relayout.mock.calls.length
    fireEvent.contextMenu(screen.getByTestId('plot-canvas'))
    expect(plotlyMock.relayout).toHaveBeenCalledTimes(callsAfterReset)
  })

  it('zoom history clears and resets to full extent when variables change', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: {
        temperature: { values: [1, 2, 3], flags: ['Z', 'Z', 'Z'] },
        salinity: { values: [4, 5, 6], flags: ['Z', 'Z', 'Z'] },
      },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    function ChangeVariables() {
      const sel = usePlotSelection()
      return (
        <button
          data-testid="change-variables"
          onClick={() => sel.setVariables(['temperature', 'salinity'])}
        >
          change
        </button>
      )
    }

    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    render(
      <AuthProvider>
        <PlotSelectionProvider>
          <Setup file="FILE_A" variables={['temperature']} />
          <ChangeVariables />
          <PlotView />
        </PlotSelectionProvider>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('apply-selection'))
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'Shift' })
    simulateZoomDrag({ x: [10, 20] })
    fireEvent.keyUp(window, { key: 'Shift' })
    expect(plotlyMock.graphDiv.layout.xaxis?.range).toEqual([10, 20])

    fireEvent.click(screen.getByTestId('change-variables'))
    await waitFor(() =>
      expect(apiClient.getVariableData).toHaveBeenLastCalledWith('FILE_A', [
        'temperature',
        'salinity',
      ])
    )

    expect(plotlyMock.graphDiv.layout.xaxis?.range).toBeUndefined()
    const callsAfterReset = plotlyMock.relayout.mock.calls.length
    fireEvent.contextMenu(screen.getByTestId('plot-canvas'))
    expect(plotlyMock.relayout).toHaveBeenCalledTimes(callsAfterReset)
  })
```

- [ ] **Step 2: Run the tests to verify current status**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "zoom history clears"`
Expected: Both PASS — the reset effect (`useEffect(..., [file, variables])`)
was already added in Task 2 Step 4. This step confirms it actually covers
both trigger cases correctly (row-position-keyed y snapshots aren't stale
after a variable-count change, which is exactly what the second test guards).

If either fails, re-check Task 2 Step 4's reset `useEffect` dependency array
is `[file, variables]`, not just `[file]`.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/PlotView.test.tsx
git commit -m "test: cover zoom history reset on file and variable changes"
```

---

### Task 8: Edge cases — empty history right-click, and a zero-width/no-range drag

**Files:**
- Modify: `src/components/PlotView.tsx` (no change needed — implemented in Task 2)
- Test: `src/__tests__/PlotView.test.tsx`

- [ ] **Step 1: Write the tests**

Add after the variables-change reset test:

```tsx
  it('right-click with no zoom history is a no-op', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: { temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    const notCancelled = fireEvent.contextMenu(screen.getByTestId('plot-canvas'))

    expect(notCancelled).toBe(false) // still suppresses the native menu
    expect(plotlyMock.relayout).not.toHaveBeenCalled()
  })

  it('a shift-drag with no reported range is ignored', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: { temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'Shift' })
    act(() => {
      plotlyMock.latestProps?.onSelected?.({ points: [] }) // no `range` — zero-width drag
    })
    fireEvent.keyUp(window, { key: 'Shift' })

    expect(plotlyMock.relayout).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests to verify current status**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "no zoom history is a no-op"`
Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "no reported range is ignored"`
Expected: Both PASS — `handleContextMenu`'s `if (stack.length === 0) return`
and `handleSelected`'s `if (!range) return` (Task 2 Step 4) already cover
these.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/PlotView.test.tsx
git commit -m "test: cover empty-history right-click and zero-width zoom drag"
```

---

### Task 9: Disable Plotly's double-click reset

**Files:**
- Modify: `src/components/PlotView.tsx`
- Test: `src/__tests__/PlotView.test.tsx`

- [ ] **Step 1: Write the failing test**

Add after the zero-width-drag test:

```tsx
  it('disables Plotly\'s built-in double-click reset', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: { temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    expect(plotlyMock.latestProps?.config).toMatchObject({ doubleClick: false })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "disables Plotly's built-in double-click reset"`
Expected: FAIL — current `config` prop is `{ displaylogo: false }`, no
`doubleClick` key.

- [ ] **Step 3: Implement**

In `src/components/PlotView.tsx`, find:

```tsx
            config={{ displaylogo: false }}
```

Replace with:

```tsx
            config={{ displaylogo: false, doubleClick: false }}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/PlotView.test.tsx -t "disables Plotly's built-in double-click reset"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/PlotView.tsx src/__tests__/PlotView.test.tsx
git commit -m "feat: disable Plotly's double-click reset in favor of right-click undo"
```

---

### Task 10: Final regression pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: All tests PASS, including all of `PlotView.test.tsx`'s 15 tests
(5 original + 10 added across Tasks 2–9) and every other suite in the project.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Lint**

Run: `npx oxlint`
Expected: No errors.

- [ ] **Step 4: Manual smoke check (if a dev server is available)**

Run: `npm run dev`, open the app, select a file + 2 variables on `/files`,
and confirm by hand: Shift-drag zooms x only across both rows; Cmd/Ctrl-drag
zooms y only on the dragged row; right-click steps back; shift+right-click
steps forward; double-click does nothing; switching files/variables resets
the view. This step has no pass/fail assertion beyond "does it behave as
specced" — use judgment.

No commit for this task unless Step 1–3 surface something to fix, in which
case fix it, re-run, and commit normally with a message describing the fix.
