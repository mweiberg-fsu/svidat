# Profile "Audit History" floating window — design

## Context

Audit history exists today only scoped to one open file: `AuditPanel.tsx`
(`{ filename, refreshSignal }` props) renders inside `FilesPage`, fetching
via `getAuditHistory(filename)` → `GET /audit/{filename}`. There is no
endpoint or UI for "everything I've done, across every file."

`ProfilePage.tsx` currently shows an avatar/upload card and (for
admin/qca) a "My drafts" list linking to `/files?file=...&source=draft`.
No modal, dialog, or portal pattern exists anywhere in this codebase —
this is the first. The closest precedent for drag interaction is
`Sidebar.tsx`'s resize handle (`onMouseDown` → `window` `mousemove`/
`mouseup` listeners, cleaned up on release).

## Goals

1. A new "Audit History" link on the Profile page, visible to every role.
2. Clicking it opens a floating window: draggable (via a header bar) and
   resizable (via a corner handle), **not** a blocking modal — no
   backdrop, the rest of the page stays interactive, closes via an X
   button only.
3. Shows the current user's own audit history across all files (not a
   global/all-users log) — newest first.
4. Each row shows which file it belongs to, linking to that file
   (`/files?file=...`, matching `ProfilePage`'s existing drafts-link
   pattern).
5. Revert works from this window, same as the per-file panel. For an
   entry whose file isn't currently open/locked by this user, attempting
   revert surfaces the server's existing 409 "no active edit lock for
   this file" error inline — no automatic lock acquisition.

## Non-goals

- Not a global, all-users audit trail — scoped to the logged-in user's
  own entries only.
- Not persisting window position/size across opens — resets to a default
  centered position each time it's opened.
- No pagination/filtering in this pass — full history in one scrollable
  list, matching `AuditPanel`'s existing unpaginated approach.

## Backend: new endpoint

`server/app/routers/audit.py` gets a new route:

```
GET /audit
```

Deliberately **not** `/audit/me` — the existing `/audit/{filename}` route
would otherwise need careful registration-order handling to avoid
swallowing a literal `"me"` as a filename (Starlette matches routes in
registration order; a path with no segment at all sidesteps the
ambiguity entirely rather than relying on ordering).

Behavior: filters `AuditLog.user_id == current_user.id`, orders
`timestamp.desc()` (newest-first — a recent-activity view, unlike the
per-file endpoint's chronological-ascending "story of this file"
ordering). Reuses the exact same per-entry serialization the existing
`history()` handler already has, with one addition: each entry also
includes `"filename": e.filename`, since entries here span multiple
files (the per-file endpoint doesn't need this — the caller already
knows the filename it asked for).

No role restriction — any authenticated user can see their own history.

## Frontend

### `client/src/api/client.ts`

New function:
```ts
export const getMyAuditHistory = () => apiFetch('/audit').then((r) => r.json())
```

### `client/src/api/types.ts`

`AuditEntry` gains an optional field: `filename?: string` — optional so
the existing per-file `AuditPanel` usage (which never sets or reads it)
is unaffected.

### New component: `client/src/components/AuditHistoryModal.tsx`

Props: `{ onClose: () => void }`.

- On mount, fetches via `getMyAuditHistory()`. List rendering mirrors
  `AuditPanel.tsx`'s existing `<ul>`/`<li>` structure and revert logic
  almost exactly (same `revertingId` in-flight tracking, same
  point_edit/bulk_edit-only revert-button gating, same inline
  `role="status"` error display) — the only addition is a filename link
  per row, styled/behaving like `ProfilePage`'s existing draft links
  (`href` + `onClick` `preventDefault` + `navigate(...)`).
- Positioning: `position: fixed`, default size/position computed once on
  mount (centered in the viewport). Drag: `onMouseDown` on the header bar
  starts a drag, tracked via `window` `mousemove`/`mouseup` listeners
  (removed on mouseup) — same shape as `Sidebar.tsx`'s existing resize
  handle, applied to position instead of width. Resize: a bottom-right
  corner handle, same event-listener shape, adjusting width/height with a
  minimum-size clamp (mirroring `Sidebar.tsx`'s `MIN_WIDTH`/`MAX_WIDTH`
  clamping idea, applied to both dimensions here). Both drag and resize
  clamp the window to stay at least partially within the viewport so it
  can't be dragged/resized out of reach.
- No backdrop element. No portal — `position: fixed` escapes normal
  document flow regardless of where it's mounted in the tree, and
  there's no existing portal convention in this codebase to match
  instead.
- Close: an X button in the header calls `onClose`. No Escape-key or
  outside-click dismissal (those are blocking-modal affordances; this
  is explicitly non-blocking, so the only "did the user mean to close
  this" signal is the explicit button).

### `client/src/pages/ProfilePage.tsx`

Adds local `const [showAuditHistory, setShowAuditHistory] = useState(false)`
and an "Audit History" link/button (visible to all roles, not gated like
the drafts section) that sets it to `true`. Conditionally renders
`<AuditHistoryModal onClose={() => setShowAuditHistory(false)} />` when
true.

## Testing

- Backend: a new test for `GET /audit` — returns only the calling user's
  entries (not other users'), includes `filename` per entry, ordered
  newest-first. A regression test confirming `/audit` and `/audit/{filename}`
  don't collide (e.g. hitting `/audit` never gets routed as if `{filename}`
  were empty/missing).
- No dedicated test for `getMyAuditHistory()` itself — `apiClient.test.ts`
  only tests `apiFetch`'s own mechanics (token attachment), not individual
  one-line wrapper functions like `getAuditHistory`/`getCatalog`/etc., and
  this new wrapper is the same shape as those. It's exercised indirectly
  through `AuditHistoryModal.test.tsx` mocking `apiClient.getMyAuditHistory`.
- `AuditHistoryModal.test.tsx` (new): renders entries with filenames,
  filename link navigates correctly, revert success refetches and clears
  the row's revert-button state, revert failure (409) shows the inline
  error, drag updates position via simulated mousedown/mousemove/mouseup,
  resize updates width/height the same way, close button calls `onClose`.
- `ProfilePage.test.tsx` (extends the existing file): Audit History link
  opens the modal; visible for all roles including `user`.
