# svidat — Plot Drag-to-Flag Selection Design

Date: 2026-08-03

## Purpose

Let a qca/admin user drag-select a range of points directly on a plot and
apply a QC flag to it, writing into the file's real `flag` variable through
the existing edit/audit/lock machinery — and see previously-flagged points
marked on the chart.

## Background / supersedes

`docs/superpowers/specs/2026-07-31-variable-plotting-design.md` already
specified this exact feature (drag-select → flag toolbar → `POST
/edit/flag`) against a Plotly-based `PlotView.tsx`. Sometime after
`docs/superpowers/specs/2026-08-01-custom-zoom-controller-design.md`, the
chart was rewritten to a dependency-free custom SVG component
(`SvgPlot.tsx`, current) — Plotly was dropped, and the zoom gestures were
ported but the flagging drag was not. This spec ports flagging onto the
current `SvgPlot.tsx`, folded into a page merge (below) that also fixes a
dead link left over from that same gap.

This spec **supersedes** the Frontend and marker-color sections of the
2026-07-31 spec: markers use a per-code color palette + legend here, not
that spec's binary "Z = normal, anything else = one highlight color."
Backend (`POST /edit/flag`, `write_flags`, data endpoint) is unchanged and
already implemented as that spec described.

## Scope and placement

- `FilesPage` and `DataViewerPage` are merged into one page at `/files`
  (`DataViewerPage.tsx` deleted, route `/files/:filename` removed). File and
  variable selection stays exactly as today — the query-param
  `PlotSelectionContext` (`?ship=&year=&file=&vars=`), driving `PlotPicker`
  in `Sidebar`.
- The merged page renders, top to bottom: session open/close button
  (admin/qca only — role-gated client-side; `user` role never sees it, since
  `POST /session/{filename}/open` already 403s for that role server-side),
  `SvgPlot` (extended, see below), then the existing `EditForm` and
  `AuditPanel`, both unchanged, shown once a session is open.
- `ProfilePage`'s draft-file link (`src/pages/ProfilePage.tsx:77`) currently
  navigates to `/files/${filename}?source=draft` — the path-param route
  being deleted, and not actually connected to the chart/session UI even
  today. Changed to `/files?file=${encodeURIComponent(f)}&source=draft`,
  consistent with the query-param scheme. The merged page reads `source`
  off the URL the same way `DataViewerPage.handleOpenSession` does today
  (`searchParams.get('source') ?? 'raw'`).

## Interaction spec (on `SvgPlot`)

Existing gestures (shift-drag = X-zoom, ctrl-drag = Y-zoom, right-click =
undo, shift+right-click = redo, double-click = redo, cmd+click = undo) are
unchanged.

New: plain mousedown+drag (no modifier key) on a row, moving past the
existing `MIN_DRAG_PX` threshold, starts a flag-select box on that row only
— same rect-overlay visual already used for the zoom boxes (`ZOOM_BOX_FILL`
/ dashed `ACTIVE_COLOR` stroke). A plain click with no drag still sets the
active variable, unchanged.

The gesture is armed only when `editable` is true (a prop: session open AND
role is admin/qca). When not editable, plain mousedown+drag does nothing
extra — click-to-activate still works, box-select is simply not wired up.

On mouseup (drag ≥ `MIN_DRAG_PX`): a popover (`.plot-flag-toolbar`, already
styled but unused today) renders anchored under the drag box, showing:

- The selected range and point count (e.g. "14:02:10–14:05:40, 42 points").
- One button per valid flag code for that file, sourced from
  `metadata.variables.flag.attrs`, filtered to single-uppercase-letter keys
  (e.g. `{ Z: "Good data", K: "Suspect - visual" }`), labeled `"K — Suspect
  - visual"`.
- A Cancel button. Escape also cancels. Clicking outside the popover cancels.

Clicking a code button calls `applyFlag(filename, varName, startIdx,
endIdx, code)`, disables the popover's buttons, and polls the returned job
(`jobStatus`, same 300ms/30s poll loop `EditForm`'s bulk-edit already
implements). On `done`: popover closes, selection clears, `SvgPlot`
refetches `getVariableData(file, variables)` (full current selection, same
call already used on mount — simplest, avoids partial-merge bugs) so
markers reflect the new flags, and calls the `onFlagged` prop (bumps the
page's `auditRefreshKey`, same as `EditForm`'s `onChanged`). On `failed`: an
inline error replaces the popover's button row (same `status`-message
convention as `EditForm`), selection stays so the user can retry or cancel.

## Flag markers

For each row, compute the set of distinct flag codes present in that
variable's current `flags` array and the mode (most common) code — the mode
is treated as "normal" and gets no marker. Every point whose flag differs
from the mode gets a small filled circle drawn on top of the line, colored
by a fixed palette (8 colors, cycling if more codes appear), assigned to
codes in order of first appearance within that row — stable for the
lifetime of the mount, not a global fixed mapping (codes are file-defined,
not universal beyond `Z`).

A one-line legend renders under each row, listing only the non-mode codes
actually present in that row (e.g. `● K — Suspect - visual`), reusing
`tickLabelColor`-style small text. A row with only one distinct flag code
(the common case: everything still `Z`) shows no markers and no legend.

## Props change

`SvgPlot` gains two props: `editable: boolean` and `onFlagged?: () => void`.
Both optional-in-spirit but the merged page always passes them — `editable`
computed as `sessionOpen && (role === 'admin' || role === 'qca')`.
Everything else about `SvgPlot`'s public surface (it still reads
`file`/`variables` from `usePlotSelection()` internally) is unchanged.

## Error handling

Same inline `status`-role convention used throughout: flag-apply errors (no
open session, invalid code, job failure) shown inline in the popover,
selection preserved for retry. Data-fetch errors on the post-flag refetch
fall back to the same empty-state handling `SvgPlot` already has for a
failed initial load.

## Testing

- `SvgPlot.test.tsx`: plain drag below `MIN_DRAG_PX` still sets active
  variable (no popover). Plain drag past threshold with `editable=false`
  does nothing (no popover). With `editable=true`: popover appears with one
  button per flag code from metadata, Cancel/Escape/outside-click all clear
  it without calling `applyFlag`, clicking a code calls `applyFlag` with the
  right args, successful job completion refetches data and calls
  `onFlagged`, failed job shows inline error and keeps selection. Markers:
  a row with mixed flags renders one dot per non-mode point, colored
  consistently for repeated codes within a render; an all-`Z` row renders no
  dots/legend.
- Routing: `/files/:filename` route is removed from `App.tsx` outright — no
  redirect added, matching today's behavior for any other unmatched path
  (there's no catch-all route today either). `ProfilePage`'s draft link
  points at `/files?file=...&source=draft`.

## Out of scope

- Multi-row / multi-variable flagging in one drag (one drag = one row = one
  `applyFlag` call, matches the backend's one-variable-per-call shape).
- Persisting the flag-color palette assignment across remounts or across
  users.
- Any change to `EditForm`, `AuditPanel`, or the backend — all unchanged.
