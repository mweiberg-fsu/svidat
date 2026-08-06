# svidat — Custom Zoom Controller Design

Date: 2026-08-01

## Purpose

Replace `PlotView`'s current Plotly-native zoom (dragmode `'zoom'` +
after-the-fact `relayout` correction, see existing comment in
`PlotView.tsx`) with a controller we own, so zoom history (undo/redo) is
possible and axis-constrained zoom is correct by construction instead of
patched after Plotly applies it.

## Problem with the current approach

Plotly's box-zoom always sets both axes from the drawn rectangle. The
existing code lets Plotly zoom natively, then reads back the resulting
layout in `handleRelayout` and issues a corrective `relayout` restoring
whichever axis the gesture wasn't supposed to touch. This works but is
fragile, and Plotly has no built-in concept of a zoom history stack, so
undo/redo isn't possible without owning zoom application ourselves.

## Scope

Stays inside `PlotView.tsx`. Rendering stays on `PlotlyPlot`
(`react-plotly.js` / Plotly.js) — no new rendering engine. Only the zoom
*interaction* layer is replaced.

## Interaction spec

- Drag alone (no modifier): unchanged — box-select points for flagging.
- Shift+drag: zoom x-axis only, all stacked plots move together (shared
  time axis).
- Cmd/Ctrl+drag: zoom y-axis only, on whichever plot row the drag happened
  in.
- Right-click: step zoom back one level (undo).
- Shift+right-click: step zoom forward one level (redo), only available
  after stepping back.
- Switching `file` or `variables`: zoom history clears, view resets to
  full extent.
- Right-click's native browser context menu is suppressed inside the plot
  area (`contextmenu` handler, `preventDefault`).
- Double-click's default Plotly reset-to-autorange is disabled entirely
  (`layout.doubleClick = false`) — right-click, held down, is the only
  path back to full extent. Keeps everything going through one history
  instead of two divergent reset mechanisms.

## Architecture

`dragmode` stays `'select'` always (same as today's flagging drag) —
`dragmode: 'zoom'` is removed entirely. On `plotly_selected`, branch on
which modifier key was held during the drag (already tracked today via
`shiftHeld`/`metaHeld`):

- No modifier → today's behavior: build point selection for flagging,
  unchanged.
- Shift → read `evt.range.x` (the data-coordinate x-bounds Plotly reports
  for a box-select — no zoom side effect from reading it), push the
  current full axis-range snapshot onto the back stack, `relayout` setting
  only the x-axis range across all rows.
- Cmd/Ctrl → read `evt.range.y` (or `.y2`, `.y3`, ... — Plotly keys the
  range by that row's own y-axis id), push current snapshot onto the back
  stack, `relayout` setting only that one row's y-axis range.

Two ref-based stacks (not React state — mirrors today's
`preservedRangesRef` pattern, since these only drive imperative relayout
calls and don't need re-renders): `backStackRef` and `forwardStackRef`,
each holding a full axis-range snapshot: `Record<string, [number, number]
| undefined>` keyed by axis id (`xaxis`, `yaxis`, `yaxis2`, ...).

- Right-click (`contextmenu`, `preventDefault`ed): if `backStackRef` is
  non-empty, pop it, push the current snapshot onto `forwardStackRef`,
  relayout to the popped snapshot.
- Shift+right-click: mirrored, with `forwardStackRef`/`backStackRef`
  swapped.
- Any new shift/cmd zoom action after stepping back clears
  `forwardStackRef` (standard undo/redo semantics — a fresh branch
  invalidates old redo).
- On `file` or `variables` change (existing `useEffect` that already
  resets selection/flag state on file change — extend to variables too):
  clear both stacks. Y-axis history is keyed by row position, and rows are
  1:1 with `variables` order/count, so a variables change (not just file)
  must also invalidate history.

Removed entirely: `zoomAxisRef`, `correctingRef`, `preservedRangesRef`,
`handleRelayout`, the `dragmode: zoomAxis ? 'zoom' : 'select'` branch. Net
simpler than what exists today.

## Edge cases

- Right-click with empty `backStackRef`: no-op (context menu still
  suppressed, nothing to relayout).
- Shift+right-click with empty `forwardStackRef`: no-op.
- Zero-width drag (click without drag) under shift/cmd: `evt.range` may be
  absent — ignore, no history push.

## Testing

`PlotView.test.tsx`:
- Shift-drag sets x-only range (y unchanged).
- Cmd/ctrl-drag sets y-only range on the correct row (other rows
  unchanged).
- Right-click steps back one level.
- Shift+right-click steps forward one level.
- Redo stack clears after a new zoom action following an undo.
- History clears on file change and on variables change.
- Right-click with empty history is a no-op.
- Native context menu is suppressed over the plot area.

## Out of scope

- Multi-user shared zoom state.
- Persisting zoom across page reloads.
- Zoom on touch/pinch.
- Saved/named/bookmarked zoom windows (history back/forward covers the
  need).
