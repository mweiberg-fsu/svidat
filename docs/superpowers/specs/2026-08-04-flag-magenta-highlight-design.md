# Magenta flag highlighting — design

## Context

`SvgPlot.tsx` renders each variable as a hand-built SVG line chart (no
charting library). Flagging a range of points is a plain-drag gesture on a
row (gated by `editable`), which sets `flagSelection` (a resolved
`{varName, startIdx, endIdx}`) and opens a `FlagToolbar` popover to pick a
flag code. Already-committed flags are shown only as small colored circle
markers (`buildFlagMarkers`, colored per flag code via `FLAG_MARKER_COLORS`).

There is currently no line/region highlighting anywhere in the component —
neither for the pending selection nor for committed flags. The user wants a
magenta highlight matching a legacy tool's style (reference: a plotted
variable with a mid-range magenta segment on the line itself).

## Goals

1. Committed (already-flagged) point ranges render as a magenta line
   segment overlaid on the data line, in addition to the existing colored
   circle markers.
2. The pending selection — from the moment a flag-drag starts until the
   user submits or cancels via `FlagToolbar` — renders as a translucent
   magenta shaded band, sized to the value range of the selected points
   (not the full row height).
3. Both the live drag (mouse still down) and the resolved selection
   (mouse released, toolbar open) get this same band treatment.

## Non-goals

- No change to `FLAG_MARKER_COLORS` or the circle markers themselves.
- No change to X/Y-zoom drag rendering (blue dashed rubber-band stays as is).
- No change to how flags are stored/submitted server-side.

## Design

### New constants (`SvgPlot.tsx`, alongside existing color constants)

```ts
const FLAG_HIGHLIGHT_COLOR = '#ff00ff'
const FLAG_HIGHLIGHT_FILL_OPACITY = 0.15
const FLAG_HIGHLIGHT_PAD_PX = 12
```

### Committed flags → magenta line segments

- Extract the "what counts as flagged" logic (mode-code detection) out of
  `buildFlagMarkers` into a shared `computeModeCode(flags: string[]):
  string` helper. Both `buildFlagMarkers` and the new function use it, so
  "flagged" stays consistent between markers and segments.
- Add `buildFlagSegments(flags, values, scale, startIdx, endIdx): string[]`.
  Walks indices `startIdx..endIdx`; a point is "flagged" if
  `flags[i] !== modeCode` and `values[i]` is non-null. Contiguous flagged
  points merge into one path (`buildPath`-style `M`/`L` commands); a gap
  (unflagged point, null value, or code reverting to mode) ends the current
  segment and starts a new one on the next flagged run. Returns one `d`
  string per segment — uniform magenta regardless of which non-mode code(s)
  are present, per your confirmation.
- Render: one `<path>` per segment, `stroke={FLAG_HIGHLIGHT_COLOR}`,
  `strokeWidth={1}`, `fill="none"`, inserted immediately after the base
  data `<path>` (~line 1009) and before the circle markers, so markers
  still draw on top.

### Pending selection → magenta tight band

- Add `computeTightBand(values, startIdx, endIdx, scale): {y: number,
  height: number} | null`. Takes the numeric min/max of `values` restricted
  to `[startIdx, endIdx]` (not the full visible window), maps both through
  `scale.y`, pads by `FLAG_HIGHLIGHT_PAD_PX` on each side, and clamps to the
  plot's inner vertical extent (`MARGIN.top` .. `rowHeight - MARGIN.bottom`).
  Returns `null` if there are no numeric values in range (falls back to not
  rendering a band rather than guessing a height).
- Render as `<rect fill={FLAG_HIGHLIGHT_COLOR} opacity={FLAG_HIGHLIGHT_FILL_OPACITY}>`
  spanning `x = scale.x(startIdx)` to `scale.x(endIdx)` and the computed
  `y`/`height`. Inserted as the *first* child inside the row's
  `<g clipPath=...>` (before the base data `<path>`), so the line remains
  visible drawn on top of the band.
- Applies whenever either state is active for that row:
  - `flagSelection.varName === varName` → use `flagSelection.startIdx` /
    `.endIdx` directly (exact, already resolved at mouseup).
  - `flagDrag.varName === varName` (mouse still down) → derive approximate
    `startIdx`/`endIdx` from `flagDrag.startPx`/`.currentPx` via the
    existing `pxToIdx` helper (same conversion the mouseup handler already
    uses), then feed into the same `computeTightBand`.
- The existing `flagDrag` block that renders a blue dashed `ZOOM_BOX_FILL`
  rect (~lines 1045–1055) is removed and replaced by this unified band
  logic. `xDrag`/`yDrag` rubber-bands are untouched.

### Render order recap (per row, inside `<g clipPath>`)

1. Pending-selection band (if `flagDrag` or `flagSelection` active for this row)
2. Base data `<path>`
3. Committed-flag magenta segment `<path>`s
4. Circle markers
5. `xDrag` / `yDrag` rubber-bands (unchanged, unrelated gestures)

## Testing

- Unit tests for `computeModeCode`, `buildFlagSegments`, and
  `computeTightBand` (pure functions, easy to test in isolation): mode
  detection with ties, segment merging across null gaps and code changes,
  band clamping at the top/bottom of the plot area, and the "no numeric
  values in range" → `null` case.
- Existing `SvgPlot` component tests (if any use a testing-library render)
  should still pass unchanged; add a case asserting a magenta `<path>`
  appears after committing a flag, and that a magenta `<rect>` appears
  during a flag-drag.
