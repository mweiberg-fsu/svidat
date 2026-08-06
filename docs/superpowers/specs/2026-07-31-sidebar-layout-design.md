# svidat — Full-width Navbar + Resizable Sidebar Design

Date: 2026-07-31

## Purpose

Move from the current centered/constrained layout to a full-width app shell:
navbar spans the full viewport width, a resizable left sidebar (250px
default) sits below it for the app's life, and the sidebar collapses into a
horizontal strip under the navbar on narrow viewports. The sidebar's main
job is fast ship→year→file navigation, backed by a new backend catalog
endpoint built from the ~105k downloaded netCDF filenames.

## Layout shell

- `#root`'s current `max-width: 1126px` centered/bordered constraint is
  removed — the whole app goes edge-to-edge.
- Navbar (existing component) becomes full width, unchanged otherwise
  (logo, account dropdown, Profile/Admin/Log out — dropdown links are
  KEPT, per explicit decision to have both dropdown and sidebar nav).
- New `Sidebar` component renders below the navbar, for the full
  remaining viewport height, alongside a `<main>` content area that takes
  the rest of the width.
- Sidebar default width 250px, resizable by dragging its right edge,
  clamped to 200–400px. Width is session-only state (not persisted to
  localStorage) — simplest option, matches nothing else in this app
  persisting layout preferences.
- Breakpoint: **1024px** (matches the app's one existing responsive
  breakpoint in `index.css`). Below it, the sidebar stops being a
  fixed-width side column and renders as a full-width horizontal block
  stacked under the navbar instead (no resize handle in this mode — drag-
  resize doesn't make sense on a full-width mobile strip).

## Sidebar contents (top to bottom)

1. **Welcome header**: avatar (reuses the same avatar-fetching logic as
   `Navbar`/`ProfilePage`) + "Welcome" / username, then a horizontal
   divider.
2. **Nav links**: Files, Admin (admin role only), Profile — same
   destinations as the navbar dropdown's links.
3. **Ship → Year → File cascading selector**: three `<select>` dropdowns.
   Selecting a ship populates the year dropdown with that ship's
   available years; selecting a year populates the file dropdown with
   that ship+year's files (filename stems, no `.nc`); selecting a file
   navigates to `/files/{filename}` (the existing `DataViewerPage`).
   Selections reset downstream (changing ship clears year+file, changing
   year clears file).

## Shared avatar hook (refactor)

`Navbar`, `ProfilePage`, and now `Sidebar` all need the identical
blob-URL avatar-fetching-with-cleanup logic (the exact pattern that had a
real leak bug once, already fixed in both existing copies). Extract it
into `client/src/hooks/useAvatar.ts`:

```typescript
export function useAvatar(id: number | null, avatarVersion: number): string | null
```

Encapsulates the effect, the `cancelled` guard, the ref-based object-URL
tracking, and unmount cleanup exactly as already proven correct in
`Navbar.tsx`. `Navbar.tsx` and `ProfilePage.tsx` are refactored to use
this hook instead of their own copies (removes duplication, doesn't
change behavior — same test coverage should still pass since the hook
preserves identical semantics). `Sidebar.tsx` uses it directly from day
one instead of copy-pasting a third time.

## Backend: ship→year→file catalog endpoint

- `GET /files/catalog` — any authenticated role (same access level as the
  existing `GET /files/raw`). Scans `data/raw/*.nc` fresh on every
  request (105k simple filename-parse operations is fast; no caching
  needed at this scale — revisit only if it becomes a measured problem).
- Filenames follow `{SHIP}_{YYYYMMDD}v{VERSION}.nc` — parsed via a regex
  splitting on the first `_`, taking the first 4 digits of the date
  segment as the year. Files that don't match the pattern are skipped
  (not errored) — e.g. `shipx_2026-07-30.nc` (a manual test file from
  earlier, dashes not digits) legitimately won't parse and should be
  silently excluded from the catalog rather than crashing the endpoint.
- Response shape: `{ [ship: string]: { [year: string]: string[] } }`,
  values are filename stems (no `.nc`), ships and years sorted, files
  within a year sorted.

## FilesPage (was FileBrowserPage) — dedicated full-page version

`/files` becomes a larger, roomier version of the same three-dropdown
ship→year→file selector (reuses the catalog endpoint), PLUS keeps the
existing "My drafts" list section (raw file browsing + draft browsing
were both in the old `FileBrowserPage` — the ship/year/file catalog only
covers raw files, so drafts need to stay visible somewhere or that
existing capability silently regresses). Layout: ship/year/file selector
at the top, "My drafts" list below it (unchanged from current behavior —
`listDrafts()`, admin/qca only, links to `/files/{filename}?source=draft`).

**Note on this addition:** the original request only described the
ship/year/file catalog; keeping "My drafts" alongside it is a deliberate
call to avoid silently dropping an existing feature. Flagging this
explicitly — if drafts should live somewhere else (or be dropped from
this page), that's an easy follow-up change.

## Error handling

- Catalog endpoint: no special error cases beyond the standard auth
  gate — an empty/missing `data/raw/` directory returns `{}`, not an
  error (matches `GET /files/raw`'s existing "return `[]` if dir doesn't
  exist" convention).
- Sidebar/FilesPage: if the catalog fetch fails, show a simple inline
  error message in place of the dropdowns (same `status`-message
  convention used everywhere else in this app), don't crash the shell.

## Testing

- Backend: unit tests for the catalog endpoint — correct grouping across
  multiple ships/years, malformed filenames skipped not errored, empty
  dir returns `{}`, accessible to all three roles.
- Frontend: component test for the cascading dropdown logic (selecting a
  ship populates years, selecting a year populates files, changing ship
  resets year/file), a test for the resize behavior (drag updates width
  within the 200–400 clamp), a test confirming the sidebar collapses to
  the stacked layout below the 1024px breakpoint is out of scope for
  jsdom-based unit tests (no real viewport/media-query evaluation in
  Vitest's default environment) — verified via live browser smoke test
  instead, same as prior layout work in this project.

## Out of scope

- Persisting sidebar width across sessions (localStorage) — session-only
  for v1.
- Backend caching/invalidation for the catalog endpoint — revisit only if
  105k-file scans become a measured performance problem.
- A collapsible/hideable sidebar toggle on desktop (always visible at
  ≥1024px per the request).
