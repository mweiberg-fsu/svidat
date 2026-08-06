# svidat — Variable Browser Design

Date: 2026-07-31

## Purpose

Add a fourth cascading step (Variables, multi-select) after Ship→Year→File
on the `/files` page, purely for browsing — helps the user figure out which
variables exist in a file before running their own separate, standalone
netCDF reader/writer Python script (out of scope here; the script itself is
not part of this web app).

## Placement and scope

New section on `FilesPage`, below the existing "Browse by ship" picker:
"Variable browser". No new route, no navbar/sidebar changes.

This is deliberately a **separate, new component** (`VariableBrowser.tsx`),
not an extension of the existing `ShipYearFilePicker`. The existing
component's file-selection immediately navigates to `/files/{filename}`
(core to the edit workflow, used by both `Sidebar` and `FilesPage` today) —
changing that behavior would break existing functionality. `VariableBrowser`
reimplements its own ship→year→file cascading selection (same derivation
logic, own local state) but never navigates; selecting a file just reveals
a fourth "Variables" step instead.

## Behavior

1. Ship → Year → File: same cascading-reset behavior as `ShipYearFilePicker`
   (changing ship clears year+file+variables, changing year clears
   file+variables, changing file clears variables and fetches that file's
   metadata via the existing `GET /files/{filename}/metadata` endpoint — no
   new backend work needed, this endpoint already returns
   `{variables: {name: {dims, shape, dtype, attrs}}, dimensions: {...}}`).
2. Variables: a native multi-select (`<select multiple>`), populated with
   that file's variable names once metadata loads. Starts empty — nothing
   pre-selected.
3. Selecting one or more variables renders their metadata inline below the
   picker (name, dims, shape, dtype per selected variable) — read-only,
   informational, no editing, no navigation, no connection to the external
   script.

## Error handling

Same `status`-message convention as the rest of the app: if
`getFileMetadata` fails, show an inline error instead of the variable list.

## Testing

Component test: cascading reset behavior (ship→year→file, same as
`ShipYearFilePicker`'s existing tests) plus variable multi-select rendering
metadata for each selected variable, and metadata clearing when file
changes.

## Out of scope

- The standalone netCDF reader/writer script itself (user's own separate
  tool, not part of this web app).
- Any connection between the selected variables and that script (explicitly
  informational only, per decision).
- Backend changes (existing `/files/{filename}/metadata` endpoint already
  provides everything needed).
