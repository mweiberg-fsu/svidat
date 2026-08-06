# svidat — Variable Plotting & QC Flagging Design

Date: 2026-07-31

## Purpose

Extend the Variable Browser so that selecting variables produces real time-series
plots, and lets a qca/admin user drag-select a time range on a plot and apply a
QC flag to it — writing into the file's real `flag` variable through the
existing edit/audit/lock machinery.

## Scope and placement

- The existing `VariableBrowser` (ship/year/file/variable cascade, currently a
  section on `FilesPage`) is replaced by a new `PlotPicker` component that
  lives in `Sidebar`, rendered only when the current route is `/files`.
  It is a separate component from `Sidebar`'s existing edit-navigation
  `ShipYearFilePicker` — that picker still navigates to `/files/{filename}`
  on file select (core to the existing point/bulk-edit workflow) and is not
  touched by this work. `PlotPicker` never navigates; picking variables just
  drives what renders in the main area.
- `FilesPage`'s "Browse by ship" section is removed (redundant with
  `Sidebar`'s edit picker, which does the same thing).
- `FilesPage`'s "My drafts" section moves to `ProfilePage` (role-gated,
  admin/qca only, same content/behavior, new location).
- `FilesPage` main area becomes a plot canvas: empty state ("Select variables
  in the sidebar to view plots.") until a file + at least one variable is
  selected in `PlotPicker`, then one stacked, full-width Plotly line chart per
  selected variable, sharing a synced time axis (zoom/pan on any one moves
  all of them together via Plotly's `matches` axis linking).

## Chart library

Plotly.js (via `react-plotly.js` or direct `Plotly.newPlot`), chosen for
built-in box-select (fires exact point/x-range indices) and built-in zoom/pan
— matches the flagging + zoom requirements without custom plugin work.
Tradeoff accepted: heaviest bundle of the options considered.

## Backend: new data endpoint

`GET /files/{filename}/data?vars=CNDC,SSPS,T2`

- Read-only against the raw file (same as the existing metadata endpoint) —
  no session/lock required just to view plots.
- Reads the `time` variable and converts it to ISO8601 strings server-side
  using `netCDF4.num2date` against the file's own `time` units attr (e.g.
  `"minutes since 1-1-1980 00:00 UTC"`).
- For each requested variable: returns its raw values, with any value
  matching that variable's `missing_value` or `special_value` attrs (when
  present) replaced with `null` — renders as a gap in the chart rather than
  an outlier spike.
- For each requested variable: also returns the existing per-point flag
  character, read from the shared `flag[time, qcindex-1]` column using that
  variable's `qcindex` attr (SAMOS convention — one shared `(time, 30)` char
  array covering all variables, column index given by each variable's own
  `qcindex` attribute, values documented as single-letter attrs A–Z on the
  `flag` variable itself, e.g. `Z` = "Good data").
- 400 for unknown var names, 404 for missing file/path traversal (same
  conventions as the existing metadata endpoint).

## Backend: flag writing

`POST /edit/flag`

Request: `{filename, var_name, start_time_idx, end_time_idx, flag_code}`

- `flag_code` must be one of the letter codes defined as attrs on that file's
  `flag` variable (validated server-side against the file, not a hardcoded
  list — codes are file-defined, not universal).
- Requires an already-open edit session for `filename` — same `require_lock`
  check used by existing point/bulk edit (`app/session_lock.py`). No
  auto-open: if there's no active lock owned by the caller, this 409s exactly
  like today's bulk edit. The user must have hit the existing
  `POST /session/{filename}/open` flow first (surfaced via an inline "Open
  for editing" button in the plot view — see Frontend section).
- `var_name` identifies which variable's QC column to write (its `qcindex`
  attr picks the column) — the actual netCDF write always targets the shared
  `flag` variable, at `flag[start_time_idx:end_time_idx, qcindex-1]`, on the
  user's temp copy, under `file_write_lock(f"nc:{filename}")`.
- Runs as a background job (same `jobs.submit_job` pattern as `bulk_edit`),
  polled via the existing `GET /edit/jobs/{job_id}`.
- Audit log: `action="flag_edit"`, `var_name` = the data variable being
  flagged (not `"flag"`), `indices_json` = `[start_time_idx, end_time_idx]`,
  `new_value_scalar` unused for a string flag — store the flag code string in
  a new nullable `AuditLog.new_value_str` column (existing `new_value_scalar`
  is a float column, wrong type for a letter code). Old flag characters for
  the affected range saved as a `.npy` blob via `old_value_ref`, same pattern
  as `bulk_edit`.

New `netcdf_ops.write_flags(path, var_name, start_idx, end_idx, flag_code) ->
np.ndarray` (old values), mirroring `write_bulk`'s shape but writing into the
shared `flag` variable's resolved column instead of the named variable
directly.

## Frontend

- `PlotPicker.tsx` (new, in `Sidebar`): ship → year → file cascade (same
  derivation/reset logic as `ShipYearFilePicker`/old `VariableBrowser`), plus
  a variables multi-select. Rendered in `Sidebar` only when
  `location.pathname === '/files'`. Selections lift up to `FilesPage` (via
  context or lifting state to a shared hook) so the main area can react.
- `FilesPage.tsx`: renders `PlotView` in the main area once file + variables
  are selected. Fetches `GET /files/{filename}/data?vars=...` on selection
  change.
- `PlotView.tsx` (new): one stacked Plotly chart per selected variable.
  - Line/marker color: default accent color where the point's existing flag
    is `'Z'`, a single distinct highlight color for any other flag value
    (not a 25-color rainbow — keeps charts readable).
  - Box-select drag mode enabled on each chart.
  - "Open for editing" button (qca/admin only) above the plots — calls the
    existing `POST /session/{filename}/open`. Flag controls stay disabled
    until a session for that file is confirmed open (track via existing
    session-open response / a lightweight session-status check).
  - On box-select: inline toolbar renders under that specific plot only
    (flagging is per-variable/per-column, not shared across plots) — shows
    selected range + point count, a flag-code `<select>` (options built from
    that variable's flag attrs returned by the metadata endpoint: letter +
    description), and an "Apply Flag" button. Apply calls `POST /edit/flag`,
    polls the job, then refetches that variable's data on completion to
    reflect updated colors and clears the selection/toolbar.

## Error handling

Same inline `status`-role message convention used throughout the app:
- Data-fetch errors (bad var, file not found) shown in `PlotView` in place of
  the charts.
- Flag-apply errors (no session/lock, invalid code, job failure) shown inline
  near that plot's toolbar, selection preserved so the user can retry.

## Testing

- Backend: data endpoint — missing-value masking, time conversion, unknown
  var 400. Flag endpoint — qcindex column resolution, lock enforcement
  (409 without open session), audit blob correctness.
- Frontend: `PlotPicker` cascade/reset (mirrors existing picker tests).
  `PlotView` — data fetch renders correct number of charts, flag toolbar
  appears on selection and clears after successful apply, flag controls
  disabled until session open, error states.

## Out of scope

- Direct point/bulk numeric editing from the plot view (stays on the
  existing `/files/{filename}` edit page).
- A dedicated flag-legend UI beyond the per-toolbar dropdown.
- Real-time/collaborative plot updates across multiple open sessions.
