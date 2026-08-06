# Sidebar Flags tab — design

## Context

The sidebar (`client/src/components/Sidebar.tsx`) currently renders one flat
panel, `PlotPicker.tsx` (ship/year/file cascading selects + a variable
multi-select), only on the `/files` route. Flagging a selected range of
points currently works via a floating popover, `FlagToolbar.tsx`, anchored
under the plot row where the drag happened. Its flag-code buttons come from
`getFileMetadata(file).variables.flag.attrs`, filtered to single-letter keys
— fully dynamic per file.

`editable` (whether flagging/editing is allowed at all) is computed today as
local state inside `FilesPage.tsx`: `sessionOpen && canEdit`, where
`canEdit = role === 'admin' || role === 'qca'` and `sessionOpen` tracks a
per-file edit-session lock acquired via an "Open for editing" button.
`Sidebar` and `FilesPage` are siblings under `ProtectedRoute` (`<Sidebar/>`
and `<main>{children}</main>`, `children` = `FilesPage`) — neither is an
ancestor of the other, so this state isn't currently reachable from
`Sidebar`.

The user wants the flagging panel moved into the sidebar as a second tab
("File Selection" first, "Flags" second), using a fixed 26-code list (image
provided) instead of the file's dynamic metadata.

## Goals

1. Sidebar gets two tabs: "File Selection" (today's `PlotPicker`, unchanged)
   and "Flags" (new).
2. The Flags tab fully replaces the `FlagToolbar` popover — one place to
   pick a flag code, not two.
3. Flag codes are a fixed, hardcoded list of 26 (A–Z), not derived from file
   metadata.
4. Selecting a range on the plot (drag, mouseup) auto-switches the sidebar
   to the Flags tab.
5. The Flags tab always shows all 26 codes; they're disabled (non-clickable)
   until there's an active selection AND the file is open for editing by an
   eligible role. When disabled, a hint explains why.
6. After applying a flag or clearing the selection, the sidebar stays on
   the Flags tab (batch-flagging workflow).
7. Layout: 2-column grid, `LETTER-truncated label` per button (confirmed via
   mockup — matches the legacy tool's layout better than a single full-width
   column at sidebar width).

## Non-goals

- No change to the "Open for editing" / "Close session" buttons' location
  (they stay in `FilesPage`'s main content, just sourced from shared state).
- No change to the magenta highlight feature just shipped (committed-flag
  segments, tight selection band, live-drag band) — this plan only moves
  *where the code is picked*, not how the plot renders selections/flags.
- No change to backend flag storage/validation — the server still receives
  whatever code string the client sends; it isn't told about this fixed list.

## Shared constant: `client/src/constants/flagCodes.ts`

The 26-code list is used in two places, not one: the sidebar's `FlagsPanel`
button grid, AND `SvgPlot`'s existing top-right legend (`● K — Suspect -
visual`), which today looks up a flagged point's description from the same
metadata-derived list this plan removes. Both need the identical
letter→description mapping, so it lives in its own module:

```ts
export interface FlagCode {
  code: string
  description: string
}

export const FLAG_CODES: FlagCode[] = [ /* the 26 entries below */ ]
```

`SvgPlot.tsx` imports `FLAG_CODES` to replace its current
`flagCodes.find((f) => f.code === code)?.description` legend lookup
(dropping the metadata-derived `flagVar`/`flagAttrs`/`flagCodes`
computation and the local `FlagCode` interface it currently declares).
`FlagsPanel.tsx` imports it for the button grid.

## The 26 flag codes

```
A - Units added                  N - In port
B - Out of bounds                O - Multiple convers_units
C - Time not sequential          P - Plat. position uncert.
D - Failed T>Tw>Td                Q - Questionable
E - True wind error              R - Interpolated value
F - Unreal movement              S - Spike
G - Value > 4 s.d.               T - Time duplicate
H - Discontinuity                U - Suspect from flagger
I - Interesting feature          V - Spike from flagger
J - Bad data                     W - Undefined
K - Suspect/Caution              X - Step from flagger
L - Land Error                   Y - Suspect between X's
M - Malfunction                  Z - Good data
```

## Architecture

### New context: `EditSessionContext` (`client/src/context/EditSessionContext.tsx`)

A new context, separate from `PlotSelectionContext` (which stays scoped to
ship/year/file/variable *selection*, per its existing name and the drift
already noted in the variable-browser design doc — not compounding that
drift further). Provides:

```ts
interface FlagSelection {
  varName: string
  startIdx: number
  endIdx: number
  rangeLabel: string // e.g. "04:00:00–14:00:00" — precomputed by SvgPlot,
                      // which has the time data; nothing downstream needs
                      // to re-derive it from raw timestamps.
}

interface EditSessionContextValue {
  sessionOpen: boolean
  canEdit: boolean   // role === 'admin' || role === 'qca'
  editable: boolean  // sessionOpen && canEdit
  openSession: () => Promise<void>
  closeSession: () => Promise<void>
  sessionError: string | null

  flagSelection: FlagSelection | null
  setFlagSelection: (sel: FlagSelection | null) => void

  flagAppliedAt: number       // bumped on every successful flag apply
  notifyFlagged: () => void   // increments flagAppliedAt
}
```

`sessionOpen`/`canEdit`/`openSession`/`closeSession`/`sessionError` are
moved verbatim from `FilesPage.tsx`'s current local state/handlers — same
behavior, new home. `canEdit` reads `useAuth()` internally so consumers
don't need to.

`flagAppliedAt` replaces the current `onFlagged` prop-callback chain
(`FilesPage` → `SvgPlot` → `FlagToolbar`). Two independent consumers watch
it via `useEffect`:
- `SvgPlot` calls its existing `refetchData()` when it changes (replacing
  the current `onApplied` callback inside the old popover flow).
- `FilesPage` bumps its `auditRefreshKey` when it changes (replacing the
  current `onFlagged={() => setAuditRefreshKey(k => k + 1)}` prop).

Like `PlotSelectionContext`, this needs a provider mounted above both
`Sidebar` and `FilesPage` — in `ProtectedRoute.tsx`, alongside/wrapping the
existing `PlotSelectionProvider`.

### New component: `FlagsPanel.tsx` (`client/src/components/FlagsPanel.tsx`)

Sidebar tab content. Reads `file` from `usePlotSelection()` and
`editable`/`flagSelection`/`setFlagSelection`/`notifyFlagged` from
`useEditSession()`. Renders:
- A header line: `flagSelection.rangeLabel — N points selected` when a
  selection is active, else a hint: *"Open this file for editing to flag
  data"* (not editable) or *"Select points on the plot to flag them"*
  (editable but no selection yet).
- The 26-code 2-column grid, sourced from a shared constant (see below).
  Buttons disabled when `!editable || !flagSelection`.
- A "Clear selection" button (disabled under the same condition), calling
  `setFlagSelection(null)`.
- Click on a code button: same apply chain `FlagToolbar` used today
  (`applyFlag(filename, varName, startIdx, endIdx, code)` → poll
  `jobStatus` → on success, `setFlagSelection(null)` + `notifyFlagged()`;
  on failure, show an inline error).

No Escape-key/outside-click-to-cancel — those were floating-popover
affordances; a persistent sidebar panel just uses the explicit "Clear
selection" button.

### `Sidebar.tsx`

Adds local `activeTab: 'files' | 'flags'` state (this stays local — it's
pure UI state, not shared with anything outside `Sidebar`). Two tab buttons
render above the existing conditional content block (still gated on
`location.pathname === '/files'`, unchanged). A `useEffect` watching
`flagSelection` from `EditSessionContext` sets `activeTab` to `'flags'`
whenever it transitions from `null` to non-null. Tab body: `<PlotPicker/>`
when `activeTab === 'files'`, `<FlagsPanel/>` when `'flags'`.

### `SvgPlot.tsx`

- Drops the `metadata`-derived `flagVar`/`flagAttrs`/`flagCodes` block and
  the local `FlagCode` interface (no longer needed — codes aren't dynamic).
  `metadata` itself is still fetched (used for the dataset title). The
  existing marker legend switches to looking up descriptions from the new
  shared `FLAG_CODES` constant instead.
- Drops the `FlagToolbar` import and its popover JSX block entirely.
- `flagSelection` state (currently local `useState`) becomes
  `useEditSession().flagSelection`/`.setFlagSelection` — same read sites
  (the `highlightRange`/`highlightBand` computation from the magenta-highlight
  feature keeps working unchanged, just backed by context state instead of
  local state). The mouseup handler that used to build
  `{varName, startIdx, endIdx, anchorPx}` now builds
  `{varName, startIdx, endIdx, rangeLabel}` instead (drops `anchorPx` —
  nothing positions a popover anymore; adds `rangeLabel`, computed the same
  way the old popover's `rangeLabel` prop was).
- `flagDrag`/`flagDragStartRef` (live in-progress drag) stay exactly as
  they are — local state, not shared. Only the *resolved* selection moves
  to context.
- Adds a `useEffect` on `flagAppliedAt` (from context) that refetches
  variable data directly (same `getVariableData(file, variables).then(setData)`
  call the primary data-fetch effect uses, guarded by `flagAppliedAt === 0`
  so it doesn't double-fetch on mount) — this replaces the render-body
  `refetchData()` helper and the old `onApplied` callback entirely, so that
  helper is deleted too.
- `editable` stays a prop (`FilesPage` sources its value from context
  instead of local state, but `SvgPlot`'s own interface is unchanged —
  it still just gates the drag-to-select gesture). `onFlagged` is dropped
  from `SvgPlot`'s props entirely — superseded by the `flagAppliedAt`
  effect above, which lives inside `SvgPlot` itself.

### `FilesPage.tsx`

- Removes local `sessionOpen`/`canEdit`/`handleOpenSession`/
  `handleCloseSession`/`error` state — sources them from
  `useEditSession()` instead. The "Open for editing"/"Close session"
  buttons and error display stay exactly where they are in the JSX, just
  wired to context handlers.
- `<SvgPlot editable={editable}>` — `editable` now comes from context, no
  `onFlagged` prop passed (removed from `SvgPlot`'s interface). `FilesPage`
  instead adds its own `useEffect` on `flagAppliedAt` (from context) to
  bump `auditRefreshKey`.

### Deleted: `FlagToolbar.tsx`

Fully superseded by `FlagsPanel.tsx`. Deleted, along with its dedicated
tests. `SvgPlot.test.tsx`'s existing flag-toolbar-oriented tests (dialog
open/close, code buttons rendering from metadata, apply/cancel flows) get
rewritten as `FlagsPanel.test.tsx` tests (rendering, disabled states, apply
chain) plus a smaller set of `SvgPlot.test.tsx` tests confirming
`flagSelection` gets set correctly on drag-resolve (the magenta-band tests
already added stay as-is — they don't depend on the popover).

## Testing

- `FlagsPanel.test.tsx` (new): renders 26 buttons; disabled with no
  selection; disabled when `!editable`; enabled + correct label with an
  active selection; clicking a code calls `applyFlag` and polls
  `jobStatus`, clearing selection + bumping `flagAppliedAt` on success;
  "Clear selection" clears without calling the API.
- `Sidebar.test.tsx` (extends the existing file): tab switching,
  auto-switch-to-Flags on selection, tab content matches `activeTab`.
- `SvgPlot.test.tsx`: remove/replace the popover-specific tests (dialog
  role, metadata-driven code buttons, apply/cancel through the popover);
  add/keep a test confirming mouseup sets `flagSelection` in context with
  the right `rangeLabel`; keep the magenta-highlight tests from the prior
  feature unchanged (they read `flagSelection` from context now, but same
  shape minus `anchorPx`).
- `FilesPage.test.tsx` (extends the existing file): confirm `auditRefreshKey`
  bumps on `flagAppliedAt` change instead of the old `onFlagged` callback.
