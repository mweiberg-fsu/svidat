# Plot Hover Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering a plot row shows a tooltip attached to the mouse pointer with the nearest sample's date, time, and value.

**Architecture:** A single `hoverTip` state value in `SvgPlot` (`{ varName, clientX, clientY, idx } | null`), updated by `onMouseMove`/`onMouseLeave` handlers on each row's `<svg>` (reusing the existing `pxToIdx` helper for pixel→index conversion), rendered as one `position: fixed` HTML `<div>` that follows the pointer. Hidden while any drag gesture (X-zoom, Y-zoom, flag-select) is active.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library (existing patterns in `client/src/__tests__/SvgPlot.test.tsx`).

Spec: `docs/superpowers/specs/2026-08-07-plot-hover-tooltip-design.md`

---

## File Structure

- Modify: `client/src/components/SvgPlot.tsx` — add `hoverTip` state, mousemove/mouseleave handlers, tooltip render.
- Modify: `client/src/__tests__/SvgPlot.test.tsx` — add hover tooltip tests.

No new files.

## Shared Test Helpers

All new tests reuse `renderSvgPlot`, `hourlyTimes`, and `pxForIndex` already defined at the top of `client/src/__tests__/SvgPlot.test.tsx` (no changes needed to those helpers).

---

### Task 1: Tooltip state, hover/leave handlers, and basic render

**Files:**
- Modify: `client/src/components/SvgPlot.tsx:532-536` (state block), `:826-855` (handleRowMouseDown + new handlers), `:897-898` (pre-return consts + container div), `:949-955` (svg element props)
- Test: `client/src/__tests__/SvgPlot.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `client/src/__tests__/SvgPlot.test.tsx`, inside the `describe('SvgPlot', ...)` block (e.g. after the last existing `it(...)`):

```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/__tests__/SvgPlot.test.tsx -t "shows a tooltip with date, time, and value"`
Expected: FAIL — `screen.getByTestId('hover-tooltip')` throws (element not found).

- [ ] **Step 3: Add `hoverTip` state**

In `client/src/components/SvgPlot.tsx`, after the existing `flagDrag` state (immediately after line 536, `} | null>(null)`), add:

```tsx
  const [hoverTip, setHoverTip] = useState<{
    varName: string
    clientX: number
    clientY: number
    idx: number
  } | null>(null)
```

- [ ] **Step 4: Add mousemove/mouseleave handlers**

In `client/src/components/SvgPlot.tsx`, `handleRowMouseDown` currently reads (lines 826-855):

```tsx
  const handleRowMouseDown = (
    e: ReactMouseEvent<SVGSVGElement>,
    varName: string,
    scaleMin: number,
    scaleMax: number
  ) => {
    if (e.shiftKey) {
```

Immediately after the opening `) => {` line, add a call to clear the tooltip so a drag starting under the pointer hides it right away:

```tsx
  const handleRowMouseDown = (
    e: ReactMouseEvent<SVGSVGElement>,
    varName: string,
    scaleMin: number,
    scaleMax: number
  ) => {
    setHoverTip(null)
    if (e.shiftKey) {
```

Right after the closing `}` of `handleRowMouseDown` (line 855, before the `// Reads the CURRENT value...` comment on line 857), add two new handlers:

```tsx
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
```

- [ ] **Step 5: Wire the handlers onto each row's `<svg>`**

In `client/src/components/SvgPlot.tsx`, the row `<svg>` currently reads (lines 949-955):

```tsx
            <svg
              width={plotWidth}
              height={rowHeight}
              fontFamily={FONT_FAMILY}
              onMouseDown={(e) => handleRowMouseDown(e, varName, scale.min, scale.max)}
              style={{ cursor: shiftHeld ? 'crosshair' : ctrlHeld ? 'ns-resize' : undefined }}
            >
```

Change to:

```tsx
            <svg
              width={plotWidth}
              height={rowHeight}
              fontFamily={FONT_FAMILY}
              onMouseDown={(e) => handleRowMouseDown(e, varName, scale.min, scale.max)}
              onMouseMove={(e) => handleRowMouseMove(e, varName)}
              onMouseLeave={handleRowMouseLeave}
              style={{ cursor: shiftHeld ? 'crosshair' : ctrlHeld ? 'ns-resize' : undefined }}
            >
```

- [ ] **Step 6: Compute tooltip content and render it**

In `client/src/components/SvgPlot.tsx`, right before the component's final `return (` (line 897, directly after `handleRowContextMenu`'s closing `}`), add:

```tsx
  const hoverTipSeries = hoverTip ? data.variables[hoverTip.varName] : null
  const hoverTipValue = hoverTipSeries ? hoverTipSeries.values[hoverTip!.idx] : null
```

Then, in the JSX, the container div currently opens as (line 898):

```tsx
    <div className="svg-plot" ref={containerRef}>
      {variables.map((varName, rowIdx) => {
```

Add the tooltip render as the container's first child, before `{variables.map(...)}`:

```tsx
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
            background: '#1f2937',
            color: '#ffffff',
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
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd client && npx vitest run src/__tests__/SvgPlot.test.tsx -t "tooltip"`
Expected: PASS for both new tests.

- [ ] **Step 8: Run the full test suite to check for regressions**

Run: `cd client && npx vitest run src/__tests__/SvgPlot.test.tsx`
Expected: PASS — all existing tests still pass (the new `onMouseMove`/`onMouseLeave` props don't fire from `fireEvent.mouseDown`/window-level `fireEvent.mouseMove` calls used by the existing drag tests).

- [ ] **Step 9: Commit**

```bash
git add client/src/components/SvgPlot.tsx client/src/__tests__/SvgPlot.test.tsx
git commit -m "feat: show hover tooltip with date/time/value on plot rows"
```

---

### Task 2: Show "no data" for a null nearest sample

**Files:**
- Modify: `client/src/components/SvgPlot.tsx` (tooltip render block added in Task 1)
- Test: `client/src/__tests__/SvgPlot.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `client/src/__tests__/SvgPlot.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/SvgPlot.test.tsx -t "no data"`
Expected: FAIL — React renders `null` as nothing, so the tooltip's third line is empty and doesn't contain "no data".

- [ ] **Step 3: Render "no data" for null/undefined values**

In `client/src/components/SvgPlot.tsx`, the tooltip's value line currently reads:

```tsx
          <div>{hoverTipValue}</div>
```

Change to:

```tsx
          <div>{hoverTipValue === null || hoverTipValue === undefined ? 'no data' : hoverTipValue}</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/__tests__/SvgPlot.test.tsx -t "no data"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/SvgPlot.tsx client/src/__tests__/SvgPlot.test.tsx
git commit -m "feat: show 'no data' in hover tooltip for null values"
```

---

### Task 3: Hide tooltip during active drag gestures

**Files:**
- Modify: none expected (Task 1 already added the `setHoverTip(null)` call in `handleRowMouseDown` and the `if (xDrag || yDrag || flagDrag) return` guard in `handleRowMouseMove`) — this task verifies that behavior with tests. If either test fails, the guard/clear from Task 1 needs fixing (see Step 3).
- Test: `client/src/__tests__/SvgPlot.test.tsx`

- [ ] **Step 1: Write the tests**

Add to `client/src/__tests__/SvgPlot.test.tsx`:

```tsx
  it('hides the tooltip as soon as a shift+drag (X-zoom) starts', async () => {
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

    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18), shiftKey: true })
    expect(screen.queryByTestId('hover-tooltip')).not.toBeInTheDocument()

    // Moving over the row mid-drag must not resurrect the tooltip.
    fireEvent.mouseMove(svg, { clientX: pxForIndex(6, 18), clientY: 100 })
    expect(screen.queryByTestId('hover-tooltip')).not.toBeInTheDocument()

    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
  })

  it('hides the tooltip as soon as a plain drag (flag-select) starts', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseMove(svg, { clientX: pxForIndex(5, 18), clientY: 100 })
    expect(screen.getByTestId('hover-tooltip')).toBeInTheDocument()

    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    expect(screen.queryByTestId('hover-tooltip')).not.toBeInTheDocument()

    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
  })
```

- [ ] **Step 2: Run tests to verify current state**

Run: `cd client && npx vitest run src/__tests__/SvgPlot.test.tsx -t "hides the tooltip as soon as"`
Expected: PASS — Task 1 already added `setHoverTip(null)` at the top of `handleRowMouseDown` (clears on drag start) and the `if (xDrag || yDrag || flagDrag) return` guard at the top of `handleRowMouseMove` (prevents the tooltip reappearing mid-drag). This step exists to prove that behavior with dedicated tests, not to introduce new code.

- [ ] **Step 3: If either test fails, fix the guard**

Only needed if Step 2 fails. Re-check `client/src/components/SvgPlot.tsx`:
- `handleRowMouseDown` must call `setHoverTip(null)` as its first statement.
- `handleRowMouseMove` must start with `if (xDrag || yDrag || flagDrag) return`.

Then re-run Step 2's command.

- [ ] **Step 4: Run the full test suite**

Run: `cd client && npx vitest run src/__tests__/SvgPlot.test.tsx`
Expected: PASS — all tests, including the 5 new ones across Tasks 1-3.

- [ ] **Step 5: Commit**

```bash
git add client/src/__tests__/SvgPlot.test.tsx
git commit -m "test: verify hover tooltip hides during active drag gestures"
```

---

## Final Verification

- [ ] Run `cd client && npm run lint` — expect no new errors.
- [ ] Run `cd client && npm run build` — expect `tsc -b && vite build` to succeed (verifies no type errors from the new `hoverTip` state/handlers).
- [ ] Run `cd client && npm test` — expect full suite green.
