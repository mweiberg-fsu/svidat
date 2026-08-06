# svidat — Drag-to-Edit Design

Date: 2026-08-04

## Purpose

Replace the explicit "Open for editing" button (`FilesPage.tsx`) with an
implicit trigger: a qca/admin user's first drag-select gesture on a plot row
opens the edit session AND commits the flag selection in one continuous
motion, instead of requiring click-button-then-drag.

## Background / supersedes

`docs/superpowers/specs/2026-08-03-plot-flag-select-design.md` specified the
current drag-select behavior, armed only `when editable is true` (session
already open). This spec removes that precondition for the *trigger* — the
drag itself is now what opens the session — while leaving the drag-select
mechanics (rect overlay, `MIN_DRAG_PX`, `pxToIdx`, `FlagsPanel`
apply/poll flow) unchanged.

## Trigger and gesture

`SvgPlot.tsx` `handleRowMouseDown`: guard changes from `if (editable)` to
`if (canEdit)`. Plain mousedown (no shift/ctrl) arms the flag-drag whenever
the role permits editing, not just when a session is already open. Shift-drag
(X-zoom), ctrl-drag (Y-zoom), right-click undo, double-click redo, and
cmd+click undo are all unchanged.

**Session-open fires on mouseup, not mousedown**, gated behind the existing
`MIN_DRAG_PX` threshold check in the flag-drag `mouseup` handler — the same
place that already decides whether to commit `setFlagSelection`. Firing on
mousedown was rejected: mousedown alone can't distinguish a real drag from a
plain click, and a plain click already has an existing side effect (setting
the row's active variable) that must stay side-effect-free w.r.t. sessions.
So the sequence on a real drag (≥ `MIN_DRAG_PX`) is, both at mouseup:

1. If `!sessionOpen`: call `openSession()` (fire-and-forget, not awaited).
2. Unconditionally: `setFlagSelection(...)` with the drag's index range, same
   as today.

`FlagsPanel`'s apply buttons stay gated on `editable` (`sessionOpen &&
canEdit`), which is still false during the pending-open window — so a
selection can exist before the session finishes opening, but it can't be
flagged until `sessionOpen` actually flips true. No new synchronization
needed there.

## Session-open dedupe

`EditSessionContext.handleOpenSession` gains a guard so repeated calls
(e.g. two quick drags on different rows before the first request resolves)
don't fire overlapping requests: no-op if `sessionOpen` is already true, or
if a request is already in flight (tracked via a new `openingRef`). Callers
don't need their own guard — `SvgPlot` just calls `openSession()` whenever
`!sessionOpen` at drag-commit time.

## Failure handling

If `openSession()` rejects, `handleOpenSession`'s existing catch block
(`setSessionError(...)`) additionally calls `setFlagSelection(null)` —
discarding the optimistic selection rather than leaving a highlighted range
the user can't act on. `sessionError` still renders as a `role="alert"`
message, relocated from the old button block (now removed) to sit near the
plot / sidebar.

## Selection-clear guard fix

`SvgPlot`'s existing cleanup effect —

```ts
useEffect(() => {
  if (!editable) {
    setFlagSelection(null)
    setFlagDrag(null)
    flagDragStartRef.current = null
  }
}, [editable, setFlagSelection])
```

— currently fires the instant `editable` (`sessionOpen && canEdit`) is
false, which now includes the *entire* pending-open window right after a
drag commits a selection (since `sessionOpen` hasn't flipped yet). Left
as-is, it would immediately wipe the optimistic selection this feature just
set. Changed to trigger on `!canEdit` only (role loss, e.g. a live role
change) — the "editing stopped being allowed" case this effect actually
exists for. The other case it used to also cover, an explicit session close,
moves to an explicit `setFlagSelection(null)` in
`EditSessionContext.handleCloseSession`'s success path.

## Discoverability

- `FilesPage.tsx`: remove the `{!sessionOpen && <button>Open for
  editing</button>}` block entirely. `{sessionOpen && <button>Close
  session</button>}` and the `sessionError` alert stay.
- New passive hint text in the button's old slot: shown when `canEdit &&
  !sessionOpen`, reading "Drag on a plot to start editing." Not
  interactive — informational only.
- `FlagsPanel.tsx:79`: status text `'Open this file for editing to flag
  data'` (referenced the old button) changes to `'Drag on the plot to start
  editing'`, matching the new hint and removing the stale button reference.

## Out of scope

- Any change to `applyFlag` / job-poll flow, flag markers, X/Y zoom,
  undo/redo — all unchanged.
- Any change to `closeSession`'s trigger (stays an explicit button click;
  dragging never implicitly closes a session).
- Multi-row drag, or opening a session without a subsequent flag selection
  (a real drag always does both; there's no "just open, no selection" path).

## Testing

- `FilesPage.test.tsx`: existing assertions on the "Open for editing" button
  (7+ places) rewritten to drive drag gestures on `SvgPlot` instead, and to
  assert the hint text appears/disappears with `canEdit`/`sessionOpen`.
- `SvgPlot.test.tsx`: drag while `!sessionOpen` (and `canEdit`) calls
  `openSession` once and commits `flagSelection`; a click below
  `MIN_DRAG_PX` does neither; two rapid drags before the first `openSession`
  resolves only trigger one call (dedupe); a rejected `openSession` clears
  `flagSelection` and leaves `sessionError` set.
- `EditSessionContext` (or wherever it's unit-tested): `handleOpenSession`
  no-ops when already open or already opening; `handleCloseSession` success
  clears `flagSelection`.
