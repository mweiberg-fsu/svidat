# Plot hover tooltip design

Date: 2026-08-07

## Goal

Hovering a plot row shows a tooltip attached to the mouse pointer with the nearest sample's date, time, and value.

## Scope

- One row (one variable) at a time — no cross-row crosshair.
- Nearest-sample lookup within the row's current zoom window (`[startIdx, endIdx]`).
- Tooltip follows the pointer with a small offset so the cursor doesn't cover it.
- Nearest sample with a `null` value still shows the tooltip, with the value rendered as "no data".
- Tooltip hides on mouse leave and during any active drag gesture (shift X-zoom, ctrl Y-zoom, or plain flag-select drag) so it doesn't clutter drag feedback.
- No new files — implemented entirely in `client/src/components/SvgPlot.tsx`.

## State

One new state value at the top of `SvgPlot`:

```ts
const [hoverTip, setHoverTip] = useState<{
  varName: string
  clientX: number
  clientY: number
  idx: number
} | null>(null)
```

## Behavior

- Each row's `<svg>` gets `onMouseMove` and `onMouseLeave` handlers alongside the existing `onMouseDown`.
- `onMouseMove`: if any drag is active (`xDrag`, `yDrag`, or `flagDrag` truthy), clear `hoverTip` (or no-op) instead of updating it. Otherwise convert the event's pixel X to a data index using the existing `pxToIdx` helper (same one used by X-zoom/flag-drag), clamp to `[startIdx, endIdx]`, and set `hoverTip` to `{ varName, clientX: e.clientX, clientY: e.clientY, idx }`.
- `onMouseLeave`: clear `hoverTip`.

## Rendering

- One tooltip `<div>` rendered once (outside the per-row `.map`), shown only when `hoverTip` is non-null. It looks up `data.variables[hoverTip.varName]` and `data.time[hoverTip.idx]` to build its content, so it doesn't need each row's scale.
- Positioned `position: fixed`, `left: hoverTip.clientX + 12`, `top: hoverTip.clientY + 12`.
- `pointer-events: none` so it never blocks row mouse events; `z-index` above the SVGs.
- Content: date (`YYYY-MM-DD`), time (`HH:MM:SS`), and value — formatted the same way values already appear elsewhere (raw number), or the literal string `no data` when the value at `idx` is `null`/`undefined`.
- Plain inline styles, consistent with the rest of this file's styling approach (no CSS module currently in use here).

## Out of scope

- Cross-row crosshair / multi-variable tooltip.
- Showing flag code in the tooltip.
- Touch/mobile hover equivalent.
