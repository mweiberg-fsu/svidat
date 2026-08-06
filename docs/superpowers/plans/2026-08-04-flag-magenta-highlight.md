# Flag Magenta Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight flagged data in `SvgPlot.tsx` magenta — a solid magenta line segment for already-committed flags, and a translucent magenta band (tight around the selected values, not the full row) for a pending flag selection, both during the drag and after it resolves.

**Architecture:** Three small pure-function additions (`computeModeCode` extracted from existing code, `buildFlagSegments`, `computeTightBand`) plus wiring into the existing per-row SVG render in `SvgPlot.tsx`. No new components, no new state — reuses the existing `flagSelection`/`flagDrag` state that already drives the flag-select gesture.

**Tech Stack:** React + TypeScript, hand-built SVG rendering (no charting library), Vitest + Testing Library.

**No git repo:** `svidat/` has no `.git` anywhere, so there are no commit steps in this plan — each task ends with "mark task complete" instead of a commit.

---

## Reference: current relevant code (`client/src/components/SvgPlot.tsx`)

- Color constants: lines 23–39.
- `buildPath`: lines 102–115.
- `pxToIdx`: lines 121–132.
- `buildFlagMarkers` (marker/legend logic, includes inline mode-code detection): lines 134–184.
- Row loop start / `flagMarkers` computed: line 835 (`const flagMarkers = buildFlagMarkers(...)`).
- Base data `<path>` + markers, inside `<g clipPath=...>`: lines 1003–1019.
- `flagDrag` live rubber-band rect (`ZOOM_BOX_FILL`, to be replaced): lines 1045–1055.
- `flagSelection` → `FlagToolbar` popover (unchanged by this plan): lines 1058–1085.

Row height in tests is fixed at `DEFAULT_ROW_HEIGHT` (200) since jsdom has no `ResizeObserver`; inner plot height is `200 - MARGIN.top(26) - MARGIN.bottom(36) = 138`.

---

### Task 1: Extract `computeModeCode` (refactor, no behavior change)

**Files:**
- Modify: `client/src/components/SvgPlot.tsx:134-184`
- Test: `client/src/__tests__/SvgPlot.test.tsx` (existing suite — regression only, no new test)

This is a pure refactor: pull the mode-code detection out of `buildFlagMarkers` so `buildFlagSegments` (Task 2) can reuse the same "what counts as flagged" rule. No new test needed — the existing suite already covers marker/legend behavior; this task must not change any of it.

- [ ] **Step 1: Run the existing suite as a baseline**

Run: `cd client && npm test -- SvgPlot`
Expected: all tests in `SvgPlot.test.tsx` PASS.

- [ ] **Step 2: Extract `computeModeCode` and refactor `buildFlagMarkers`**

Replace lines 134–184 (the `FlagMarker` interface through the end of `buildFlagMarkers`) with:

```ts
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
```

Note the old `if (counts.size <= 1) return { markers: [], legendCodes: [] }` short-circuit is dropped — it was a pure optimization; when every point shares one code, that code becomes `modeCode` and the loop below naturally produces the same empty result.

- [ ] **Step 3: Run the suite again to confirm no regression**

Run: `cd client && npm test -- SvgPlot`
Expected: same tests PASS as Step 1, including `'draws no markers or legend when every point shares the same flag'` and `'shows a legend entry for a non-dominant flag code present in the row'`.

- [ ] **Step 4: Mark task complete**

---

### Task 2: Magenta line segments for committed flags

**Files:**
- Modify: `client/src/components/SvgPlot.tsx` (constants ~line 38, new function after `buildFlagMarkers` ~line 185, row loop ~line 835, JSX ~line 1009)
- Test: `client/src/__tests__/SvgPlot.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `client/src/__tests__/SvgPlot.test.tsx`, inside the `describe('SvgPlot', ...)` block (near the other flag-marker tests, after `'draws a colored marker for points whose flag differs from the row's dominant flag'`):

```ts
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
```

Also extend the existing `'draws no markers or legend when every point shares the same flag'` test with one more assertion at the end:

```ts
    expect(container.querySelectorAll('circle').length).toBe(0)
    expect(container.querySelectorAll('path[stroke="#ff00ff"]').length).toBe(0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- SvgPlot`
Expected: FAIL — the two new tests find 0 magenta paths (element doesn't exist yet); `stroke="#ff00ff"` never appears.

- [ ] **Step 3: Add the `FLAG_HIGHLIGHT_*` constants**

In `client/src/components/SvgPlot.tsx`, after the `FLAG_MARKER_COLORS` array (~line 38, before `const FONT_FAMILY = ...`):

```ts
const FLAG_HIGHLIGHT_COLOR = '#ff00ff'
const FLAG_HIGHLIGHT_FILL_OPACITY = 0.15
const FLAG_HIGHLIGHT_PAD_PX = 12
```

- [ ] **Step 4: Add `buildFlagSegments`**

Immediately after `buildFlagMarkers` (right after the closing `}` from Task 1's refactor):

```ts
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
```

- [ ] **Step 5: Compute `flagSegments` per row**

In the row loop, right after the existing `const flagMarkers = buildFlagMarkers(series.flags, series.values, startIdx, endIdx)` (~line 835):

```ts
        const flagMarkers = buildFlagMarkers(series.flags, series.values, startIdx, endIdx)
        const flagSegments = buildFlagSegments(series.flags, series.values, scale, startIdx, endIdx)
```

- [ ] **Step 6: Render the magenta segments**

In the JSX, right after the base data `<path>` and before `{flagMarkers.markers.map(...)}` (~line 1009):

```tsx
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
```

(the rest of the `flagMarkers.markers.map` block is unchanged — only the new block above is inserted before it)

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd client && npm test -- SvgPlot`
Expected: all tests PASS, including the two new ones and the extended no-flags test.

- [ ] **Step 8: Mark task complete**

---

### Task 3: Magenta band for the resolved pending selection

**Files:**
- Modify: `client/src/components/SvgPlot.tsx` (new function after `buildFlagSegments`, row loop, JSX ~line 1003)
- Test: `client/src/__tests__/SvgPlot.test.tsx`

This covers the selection *after* mouseup (`flagSelection` state, toolbar open) — live-drag comes in Task 4.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/__tests__/SvgPlot.test.tsx`, near the other flag-toolbar tests (after `'editable plain-drag opens the flag toolbar with codes from file metadata'`):

```ts
  it('shows a translucent magenta band tight around the selected values once the drag resolves', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { flag: { dims: [], shape: [], dtype: 'S1', attrs: { Z: 'Good data' } } },
      dimensions: {},
      global_attrs: {},
    })

    const { container } = render(
      <MemoryRouter>
        <PlotSelectionProvider>
          <Setup file="FILE_A" variables={['temperature']} />
          <SvgPlot editable onFlagged={() => {}} />
        </PlotSelectionProvider>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    const band = container.querySelector('rect[fill="#ff00ff"]')
    expect(band).toBeInTheDocument()
    expect(band?.getAttribute('opacity')).toBe('0.15')
    expect(Number(band?.getAttribute('x'))).toBeCloseTo(pxForIndex(4, 18), 1)
    expect(Number(band?.getAttribute('width'))).toBeCloseTo(pxForIndex(14, 18) - pxForIndex(4, 18), 1)
    // Tight around values 4..14 (of the row's 0..20 full range) — well
    // under the row's full 138px inner height, proving it isn't a
    // full-height band.
    expect(Number(band?.getAttribute('height'))).toBeLessThan(138)
  })

  it('clamps the highlight band to the plot area when padding would push it past the edge', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { flag: { dims: [], shape: [], dtype: 'S1', attrs: { Z: 'Good data' } } },
      dimensions: {},
      global_attrs: {},
    })

    const { container } = render(
      <MemoryRouter>
        <PlotSelectionProvider>
          <Setup file="FILE_A" variables={['temperature']} />
          <SvgPlot editable onFlagged={() => {}} />
        </PlotSelectionProvider>
      </MemoryRouter>
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
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    const band = container.querySelector('rect[fill="#ff00ff"]')
    const y = Number(band?.getAttribute('y'))
    const height = Number(band?.getAttribute('height'))
    // Unclamped this would be ~176 (38px past the edge) — clamped, it must
    // land exactly on rowHeight - MARGIN.bottom (164).
    expect(y + height).toBeCloseTo(164, 1)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- SvgPlot`
Expected: FAIL — no `rect[fill="#ff00ff"]` exists yet.

- [ ] **Step 3: Add `computeTightBand`**

Immediately after `buildFlagSegments`:

```ts
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
```

- [ ] **Step 4: Compute `highlightRange`/`highlightBand` per row**

Right after the `flagSegments` line added in Task 2 (~line 836):

```ts
        const flagSegments = buildFlagSegments(series.flags, series.values, scale, startIdx, endIdx)
        const highlightRange: [number, number] | null =
          flagSelection && flagSelection.varName === varName
            ? [flagSelection.startIdx, flagSelection.endIdx]
            : null
        const highlightBand = highlightRange
          ? computeTightBand(series.values, highlightRange[0], highlightRange[1], scale, rowHeight)
          : null
```

- [ ] **Step 5: Render the band as the first child of the clipped group**

In the JSX, change:

```tsx
              <g clipPath={`url(#plot-clip-${rowIdx})`}>
                <path
                  d={buildPath(series.values, scale, startIdx, endIdx)}
```

to:

```tsx
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
                <path
                  d={buildPath(series.values, scale, startIdx, endIdx)}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd client && npm test -- SvgPlot`
Expected: all tests PASS, including the two new ones.

- [ ] **Step 7: Mark task complete**

---

### Task 4: Extend the band to the live drag, remove the old rubber-band

**Files:**
- Modify: `client/src/components/SvgPlot.tsx` (row loop, JSX ~lines 1045–1055)
- Test: `client/src/__tests__/SvgPlot.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `client/src/__tests__/SvgPlot.test.tsx`, after the Task 3 tests:

```ts
  it('shows the magenta band live while dragging, before the selection resolves, replacing the old blue rubber-band', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { flag: { dims: [], shape: [], dtype: 'S1', attrs: { Z: 'Good data' } } },
      dimensions: {},
      global_attrs: {},
    })

    const { container } = render(
      <MemoryRouter>
        <PlotSelectionProvider>
          <Setup file="FILE_A" variables={['temperature']} />
          <SvgPlot editable onFlagged={() => {}} />
        </PlotSelectionProvider>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })

    // Mouse still down — no toolbar yet, but the band should already show.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const band = container.querySelector('rect[fill="#ff00ff"]')
    expect(band).toBeInTheDocument()
    expect(container.querySelector('rect[fill="rgba(37, 99, 235, 0.15)"]')).not.toBeInTheDocument()

    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- SvgPlot`
Expected: FAIL — `band` is `null` (`highlightRange` doesn't yet consider `flagDrag`), or the old blue rect is still present.

- [ ] **Step 3: Extend `highlightRange` to cover the live drag**

Replace the `highlightRange` computation from Task 3 with:

```ts
        const highlightRange: [number, number] | null =
          flagSelection && flagSelection.varName === varName
            ? [flagSelection.startIdx, flagSelection.endIdx]
            : flagDrag && flagDrag.varName === varName && flagDragStartRef.current
              ? (() => {
                  const start = flagDragStartRef.current!
                  const a = pxToIdx(flagDrag.startPx, start.startIdx, start.endIdx, plotWidth, data.time.length)
                  const b = pxToIdx(flagDrag.currentPx, start.startIdx, start.endIdx, plotWidth, data.time.length)
                  return [Math.min(a, b), Math.max(a, b)]
                })()
              : null
```

- [ ] **Step 4: Remove the old blue rubber-band block for flag-drags**

Delete this block from the JSX (it currently sits right after the `yDrag` rubber-band rect, ~lines 1045–1055):

```tsx
                {flagDrag && flagDrag.varName === varName && (
                  <rect
                    x={Math.min(flagDrag.startPx, flagDrag.currentPx)}
                    y={MARGIN.top}
                    width={Math.abs(flagDrag.currentPx - flagDrag.startPx)}
                    height={rowHeight - MARGIN.top - MARGIN.bottom}
                    fill={ZOOM_BOX_FILL}
                    stroke={ACTIVE_COLOR}
                    strokeDasharray="4 2"
                  />
                )}
```

The `xDrag`/`yDrag` rubber-band blocks directly above it are untouched — only this flag-drag-specific block is removed, since it's now fully superseded by the `highlightRange`/`highlightBand` rendering added in Task 3.

- [ ] **Step 5: Run the full `SvgPlot` suite**

Run: `cd client && npm test -- SvgPlot`
Expected: all tests PASS — the new test, everything from Tasks 1–3, and the pre-existing X/Y-zoom rubber-band tests (`'shift+drag zooms...'`, `'ctrl+drag zooms...'`, etc., which don't touch `flagDrag` and must be unaffected).

- [ ] **Step 6: Mark task complete**

---

## Final verification

- [ ] Run the full client test suite: `cd client && npm test`. Expected: all PASS.
- [ ] Run typecheck: `cd client && npx tsc -b`. Expected: no errors (the new helpers are fully typed, no `any`).
- [ ] Run lint: `cd client && npm run lint`. Expected: no new warnings/errors.
