# svidat — Move Audit History Link to Sidebar

Date: 2026-08-05

## Purpose

Move the "Audit History" trigger from `ProfilePage` into `Sidebar`, so it's
reachable from any page (Files/Admin/Profile all share one mounted
`Sidebar`), not just the Profile page.

## Background

`docs/superpowers/specs/2026-08-04-audit-history-modal-design.md` built
`AuditHistoryModal.tsx` — a floating, draggable, resizable, non-blocking
window showing the current user's own audit history — triggered today by a
button on `ProfilePage.tsx`. That component is unchanged by this spec; only
*where the trigger lives* changes.

## Change

- `Sidebar.tsx`: add `const [showAuditHistory, setShowAuditHistory] =
  useState(false)`. In the `sidebar-links` block, add an "Audit History"
  link/button immediately after the existing "Profile" link — unconditional
  (all roles), matching today's every-role visibility. Clicking it sets
  `showAuditHistory` true. Render `{showAuditHistory && <AuditHistoryModal
  onClose={() => setShowAuditHistory(false)} />}` once, e.g. right after the
  resize handle at the bottom of the `<aside>`.
- `ProfilePage.tsx`: remove the `showAuditHistory` state, the "Audit
  History" button, the `<AuditHistoryModal>` render, and the now-unused
  `AuditHistoryModal` import.
- No change to `AuditHistoryModal.tsx` itself, `getMyAuditHistory`, or any
  backend route.

## Testing

- `Sidebar.test.tsx`: Audit History link renders for every role (add a case
  alongside the existing role-gated-link tests); clicking it opens the
  modal (assert on a value only the modal renders, e.g. `'No edits yet.'`
  after `getMyAuditHistory` resolves empty); the close button closes it.
- `ProfilePage.test.tsx`: remove the two existing tests
  (`'shows an Audit History link for every role, including user'` and
  `'opens the audit history modal when the link is clicked, and closes
  it'`) — that behavior now lives in `Sidebar.test.tsx`. No new ProfilePage
  tests needed; nothing else about the page changes.
- `AuditHistoryModal.test.tsx`: unchanged — it renders the component
  directly, independent of which page mounts it.

## Out of scope

- Any change to the modal's drag/resize/positioning/revert behavior.
- Gating the link by role (it stays visible to everyone, as today).
- Scoping the link's visibility to a specific route — it shows on every
  page, same as the rest of `sidebar-links`.
