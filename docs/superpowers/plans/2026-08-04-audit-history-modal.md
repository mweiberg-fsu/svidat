# Profile Audit History Floating Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Audit History" link on the Profile page that opens a draggable, resizable, non-blocking floating window listing the current user's own audit entries across all files, with revert support.

**Architecture:** One new backend endpoint (`GET /audit`, user-scoped, newest-first, includes `filename` per entry — the per-file endpoint doesn't need this since the caller already knows the filename). One new frontend component, `AuditHistoryModal`, built in two passes (static list/revert first, then drag+resize), wired into `ProfilePage` behind a simple boolean toggle. No portal, no backdrop — `position: fixed` and a close button are enough for a non-blocking floating window.

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + TypeScript + Vitest/Testing Library (frontend). No new dependencies.

**No git repo:** `svidat/` has no `.git` anywhere — no commit steps; each task ends with "mark task complete" instead.

---

## Reference: files this plan touches

- Modify: `server/app/routers/audit.py`
- New test cases in: `server/tests/test_audit_routes.py`
- Modify: `client/src/api/client.ts`
- Modify: `client/src/api/types.ts`
- New: `client/src/components/AuditHistoryModal.tsx`
- New: `client/src/__tests__/AuditHistoryModal.test.tsx`
- Modify: `client/src/pages/ProfilePage.tsx`
- Modify: `client/src/__tests__/ProfilePage.test.tsx`
- Modify: `client/src/index.css`

---

### Task 1: Backend `GET /audit` endpoint

**Files:**
- Modify: `server/app/routers/audit.py`
- Test: `server/tests/test_audit_routes.py`

The existing router only has `GET /audit/{filename}` (per-file) and `POST /audit/{audit_id}/revert`. This adds a third route with no path segment (`GET /audit`) — deliberately not `/audit/me`, since Starlette matches routes in registration order and `/audit/{filename}` would otherwise need careful ordering to avoid treating a literal `"me"` as a filename. A bare `/audit` can't collide with `/audit/{filename}` at all, so ordering doesn't matter.

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/test_audit_routes.py`, after the existing `test_history_visible_to_non_admin_with_usernames` test:

```python
def test_my_history_returns_only_my_entries_newest_first(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-09-01")
    synthetic_nc("shipx_2026-09-02")
    mine = auth_header("audituser9", Role.qca)
    other = auth_header("audituser10", Role.qca)

    client.post("/session/shipx_2026-09-01/open", params={"source": "raw"}, headers=mine)
    client.post(
        "/edit/point",
        json={"filename": "shipx_2026-09-01", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=mine,
    )
    client.post("/session/shipx_2026-09-02/open", params={"source": "raw"}, headers=mine)
    client.post(
        "/edit/point",
        json={"filename": "shipx_2026-09-02", "var_name": "temperature", "indices": [0], "value": 2.0},
        headers=mine,
    )
    # A different user's edit on one of the same files — must not appear.
    client.post("/session/shipx_2026-09-01/close", headers=mine)
    client.post("/session/shipx_2026-09-01/open", params={"source": "raw"}, headers=other)
    client.post(
        "/edit/point",
        json={"filename": "shipx_2026-09-01", "var_name": "temperature", "indices": [1], "value": 3.0},
        headers=other,
    )

    resp = client.get("/audit", headers=mine)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 2
    assert all(e["username"] == "audituser9" for e in entries)
    # Newest first — the shipx_2026-09-02 edit happened after the
    # shipx_2026-09-01 one.
    assert entries[0]["filename"] == "shipx_2026-09-02"
    assert entries[1]["filename"] == "shipx_2026-09-01"


def test_my_history_empty_for_a_user_with_no_edits(client, auth_header):
    headers = auth_header("audituser11", Role.user)
    resp = client.get("/audit", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_audit_and_audit_filename_routes_do_not_collide(client, auth_header, synthetic_nc):
    synthetic_nc("audit")  # a file literally named "audit" — the trickiest
    # possible collision case between GET /audit and GET /audit/{filename}.
    headers = auth_header("audituser12", Role.qca)
    client.post("/session/audit/open", params={"source": "raw"}, headers=headers)
    client.post(
        "/edit/point",
        json={"filename": "audit", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=headers,
    )

    my_history = client.get("/audit", headers=headers)
    assert my_history.status_code == 200
    assert len(my_history.json()) == 1

    file_history = client.get("/audit/audit", headers=headers)
    assert file_history.status_code == 200
    assert len(file_history.json()) == 1
    assert file_history.json()[0]["filename"] if "filename" in file_history.json()[0] else True
```

(The last assertion in `test_audit_and_audit_filename_routes_do_not_collide` is intentionally lenient about whether `filename` is present in the per-file response — that endpoint isn't required to add it, per this task's scope; the meaningful assertions are the two status codes and lengths, proving both routes work independently even when a real file is named exactly `"audit"`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pytest tests/test_audit_routes.py -v`
Expected: the three new tests FAIL (`404 Not Found` on `GET /audit` — no such route yet); all existing tests still PASS.

- [ ] **Step 3: Add the endpoint**

In `server/app/routers/audit.py`, add this route. Placement: directly above the existing `@router.get("/{filename}")` (not required for correctness since `/audit` can't collide with `/audit/{filename}`, but keeping the more-specific-looking route first reads better):

```python
@router.get("")
def my_history(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    entries = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == user.id)
        .order_by(AuditLog.timestamp.desc())
        .all()
    )
    return [
        {
            "id": e.id,
            "filename": e.filename,
            "user_id": e.user_id,
            "username": user.username,
            "action": e.action,
            "var_name": e.var_name,
            "old_value": e.old_value_scalar,
            "new_value": e.new_value_scalar if e.new_value_scalar is not None else e.new_value_str,
            "reverted": e.reverted,
            "timestamp": e.timestamp.isoformat(),
        }
        for e in entries
    ]
```

Note: `@router.get("")` (empty string), not `@router.get("/")` — the router's prefix is already `/audit`, so an empty path here maps to exactly `GET /audit` with no trailing slash, matching the tests above (`client.get("/audit", ...)`). Since every entry is already filtered to `user.id`, `username` is always the requesting user's own username — no need for the per-file endpoint's user-id-set lookup/join.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pytest tests/test_audit_routes.py -v`
Expected: all PASS (existing 7 + 3 new = 10).

- [ ] **Step 5: Run the full backend suite**

Run: `cd server && pytest -v`
Expected: all PASS (no regressions elsewhere).

- [ ] **Step 6: Mark task complete**

---

### Task 2: Frontend plumbing + `AuditHistoryModal` core (list + revert, fixed position)

**Files:**
- Modify: `client/src/api/client.ts`
- Modify: `client/src/api/types.ts`
- Create: `client/src/components/AuditHistoryModal.tsx`
- Test: `client/src/__tests__/AuditHistoryModal.test.tsx`

This pass builds the modal's data/list/revert logic — closely mirroring `client/src/components/AuditPanel.tsx`'s existing `refresh`/`handleRevert` shape — with a fixed default position/size. Drag and resize come in Task 3, kept separate so this task's tests aren't tangled up with mouse-event simulation.

- [ ] **Step 1: Add the API client function and type field**

In `client/src/api/client.ts`, add directly after the existing `revertAuditEntry` (~line 94):

```ts
export const getMyAuditHistory = () => apiFetch('/audit').then((r) => r.json())
```

In `client/src/api/types.ts`, add one field to the existing `AuditEntry` interface:

```ts
export interface AuditEntry {
  id: number
  filename?: string
  user_id: number
  username: string | null
  action: string
  var_name: string | null
  old_value: number | null
  new_value: number | string | null
  reverted: boolean
  timestamp: string
}
```

(`filename` is optional — the per-file `AuditPanel`/`getAuditHistory` path never sets or reads it, only the new `getMyAuditHistory` path does.)

- [ ] **Step 2: Write the failing tests**

Create `client/src/__tests__/AuditHistoryModal.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuditHistoryModal } from '../components/AuditHistoryModal'
import * as apiClient from '../api/client'
import type { AuditEntry } from '../api/types'

const entries: AuditEntry[] = [
  {
    id: 1,
    filename: 'shipx_2026-08-01',
    user_id: 1,
    username: 'testuser',
    action: 'point_edit',
    var_name: 'temperature',
    old_value: 10,
    new_value: 12,
    reverted: false,
    timestamp: '2026-08-03T14:02:00',
  },
  {
    id: 2,
    filename: 'shipx_2026-07-30',
    user_id: 1,
    username: 'testuser',
    action: 'bulk_edit',
    var_name: 'salinity',
    old_value: null,
    new_value: null,
    reverted: true,
    timestamp: '2026-08-02T09:11:00',
  },
]

function renderModal(onClose = vi.fn()) {
  const utils = render(
    <MemoryRouter>
      <AuditHistoryModal onClose={onClose} />
    </MemoryRouter>
  )
  return { ...utils, onClose }
}

describe('AuditHistoryModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches and lists the current user's audit entries with filename links", async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    renderModal()

    await waitFor(() => expect(screen.getByText('shipx_2026-08-01')).toBeInTheDocument())
    expect(screen.getByText('shipx_2026-08-01').closest('a')).toHaveAttribute(
      'href',
      '/files?file=shipx_2026-08-01'
    )
    expect(screen.getByText('shipx_2026-07-30')).toBeInTheDocument()
  })

  it('shows Revert for a non-reverted point_edit and Reverted for an already-reverted entry', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    renderModal()

    await waitFor(() => expect(screen.getByText('Revert')).toBeInTheDocument())
    expect(screen.getByText('Reverted')).toBeInTheDocument()
  })

  it('shows an empty-state message when there are no entries', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    renderModal()

    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())
  })

  it('reverts an entry and refetches on success', async () => {
    const getSpy = vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    const revertSpy = vi
      .spyOn(apiClient, 'revertAuditEntry')
      .mockResolvedValue({ status: 'reverted' })
    renderModal()
    await waitFor(() => expect(screen.getByText('Revert')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Revert'))

    await waitFor(() => expect(revertSpy).toHaveBeenCalledWith(1))
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2))
  })

  it('shows an inline error when revert fails', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    vi.spyOn(apiClient, 'revertAuditEntry').mockRejectedValue(
      new Error('409: no active edit lock for this file')
    )
    renderModal()
    await waitFor(() => expect(screen.getByText('Revert')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Revert'))

    await waitFor(() =>
      expect(
        screen.getByText('Error: 409: no active edit lock for this file')
      ).toBeInTheDocument()
    )
  })

  it('calls onClose when the close button is clicked', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    const { onClose } = renderModal()
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd client && npm test -- AuditHistoryModal`
Expected: FAIL — `Cannot find module '../components/AuditHistoryModal'`.

- [ ] **Step 4: Create `AuditHistoryModal.tsx`**

Create `client/src/components/AuditHistoryModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyAuditHistory, revertAuditEntry } from '../api/client'
import type { AuditEntry } from '../api/types'

const DEFAULT_WIDTH = 600
const DEFAULT_HEIGHT = 420

export function AuditHistoryModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [revertingId, setRevertingId] = useState<number | null>(null)
  const [position] = useState(() => ({
    top: Math.max(0, (window.innerHeight - DEFAULT_HEIGHT) / 2),
    left: Math.max(0, (window.innerWidth - DEFAULT_WIDTH) / 2),
  }))
  const [size] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })

  const refresh = () => {
    getMyAuditHistory()
      .then(setEntries)
      .catch((err) => {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  useEffect(refresh, [])

  const handleRevert = async (id: number) => {
    setRevertingId(id)
    try {
      await revertAuditEntry(id)
      refresh()
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRevertingId(null)
    }
  }

  return (
    <div
      className="audit-history-modal"
      style={{ top: position.top, left: position.left, width: size.width, height: size.height }}
    >
      <div className="audit-history-modal-header">
        <span>Audit History</span>
        <button
          type="button"
          className="audit-history-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>
      </div>
      <div className="audit-history-modal-body">
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              {e.timestamp} —{' '}
              <a
                href={`/files?file=${encodeURIComponent(e.filename ?? '')}`}
                onClick={(ev) => {
                  ev.preventDefault()
                  navigate(`/files?file=${encodeURIComponent(e.filename ?? '')}`)
                }}
              >
                {e.filename}
              </a>{' '}
              — {e.action} {e.var_name ?? ''} {e.old_value ?? ''} → {e.new_value ?? ''}
              {e.action !== 'point_edit' && e.action !== 'bulk_edit' ? null : e.reverted ? (
                <span> Reverted</span>
              ) : (
                <button onClick={() => handleRevert(e.id)} disabled={revertingId === e.id}>
                  Revert
                </button>
              )}
            </li>
          ))}
        </ul>
        {entries.length === 0 && !status && <p>No edits yet.</p>}
        {status && <p role="status">{status}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npm test -- AuditHistoryModal`
Expected: PASS (6 tests).

- [ ] **Step 6: Mark task complete**

---

### Task 3: Drag + resize

**Files:**
- Modify: `client/src/components/AuditHistoryModal.tsx`
- Modify: `client/src/__tests__/AuditHistoryModal.test.tsx`

Same event-listener shape as `client/src/components/Sidebar.tsx`'s existing resize handle (`onMouseDown` → `window` `mousemove`/`mouseup` listeners, removed on release) — applied to position (drag, via the header) and to size (resize, via a corner handle). Since this test file uses component *state* (not `getBoundingClientRect`, which jsdom always reports as zero) to track position/size, drag/resize assertions here don't hit the same jsdom-measurement limitation `SvgPlot.test.tsx` works around elsewhere in this codebase — a plain `clientX`/`clientY` delta is enough.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/__tests__/AuditHistoryModal.test.tsx`, after the existing `'calls onClose when the close button is clicked'` test:

```tsx
  it('drags to a new position via the header', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    const { container } = renderModal()
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    const modal = container.querySelector('.audit-history-modal') as HTMLElement
    const header = container.querySelector('.audit-history-modal-header') as HTMLElement
    const startTop = parseFloat(modal.style.top)
    const startLeft = parseFloat(modal.style.left)

    fireEvent.mouseDown(header, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 130 })
    fireEvent.mouseUp(window, { clientX: 150, clientY: 130 })

    expect(parseFloat(modal.style.left)).toBeCloseTo(startLeft + 50, 1)
    expect(parseFloat(modal.style.top)).toBeCloseTo(startTop + 30, 1)
  })

  it('does not move once the drag ends (mouseup detaches the listeners)', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    const { container } = renderModal()
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    const modal = container.querySelector('.audit-history-modal') as HTMLElement
    const header = container.querySelector('.audit-history-modal-header') as HTMLElement

    fireEvent.mouseDown(header, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 130 })
    fireEvent.mouseUp(window, { clientX: 150, clientY: 130 })
    const afterFirstDrag = { top: modal.style.top, left: modal.style.left }

    fireEvent.mouseMove(window, { clientX: 999, clientY: 999 })

    expect(modal.style.top).toBe(afterFirstDrag.top)
    expect(modal.style.left).toBe(afterFirstDrag.left)
  })

  it('resizes via the corner handle, clamped to a minimum size', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    const { container } = renderModal()
    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    const modal = container.querySelector('.audit-history-modal') as HTMLElement
    const handle = container.querySelector('.audit-history-modal-resize-handle') as HTMLElement
    const startWidth = parseFloat(modal.style.width)
    const startHeight = parseFloat(modal.style.height)

    fireEvent.mouseDown(handle, { clientX: 500, clientY: 400 })
    fireEvent.mouseMove(window, { clientX: 560, clientY: 440 })
    fireEvent.mouseUp(window, { clientX: 560, clientY: 440 })

    expect(parseFloat(modal.style.width)).toBeCloseTo(startWidth + 60, 1)
    expect(parseFloat(modal.style.height)).toBeCloseTo(startHeight + 40, 1)

    // Shrinking past the minimum clamps rather than going smaller.
    fireEvent.mouseDown(handle, { clientX: 560, clientY: 440 })
    fireEvent.mouseMove(window, { clientX: -2000, clientY: -2000 })
    fireEvent.mouseUp(window, { clientX: -2000, clientY: -2000 })

    expect(parseFloat(modal.style.width)).toBe(360)
    expect(parseFloat(modal.style.height)).toBe(240)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- AuditHistoryModal`
Expected: FAIL — the 3 new tests fail (no `.audit-history-modal-resize-handle` exists yet, header mousedown does nothing); the 6 existing tests still PASS.

- [ ] **Step 3: Add drag and resize to `AuditHistoryModal.tsx`**

Replace the imports at the top:

```tsx
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyAuditHistory, revertAuditEntry } from '../api/client'
import type { AuditEntry } from '../api/types'

const DEFAULT_WIDTH = 600
const DEFAULT_HEIGHT = 420
const MIN_WIDTH = 360
const MIN_HEIGHT = 240
```

Replace the `position`/`size` state declarations (currently plain `useState` with no setter used) with mutable versions, and add drag/resize refs and handlers, right after the existing `revertingId` state:

```tsx
  const [position, setPosition] = useState(() => ({
    top: Math.max(0, (window.innerHeight - DEFAULT_HEIGHT) / 2),
    left: Math.max(0, (window.innerWidth - DEFAULT_WIDTH) / 2),
  }))
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const draggingRef = useRef(false)
  const resizingRef = useRef(false)
```

Add these two handlers, right after `handleRevert`:

```tsx
  const handleHeaderMouseDown = (e: ReactMouseEvent) => {
    draggingRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startTop = position.top
    const startLeft = position.left
    const handleMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const deltaX = ev.clientX - startX
      const deltaY = ev.clientY - startY
      const maxLeft = window.innerWidth - 40
      const maxTop = window.innerHeight - 40
      setPosition({
        top: Math.min(maxTop, Math.max(0, startTop + deltaY)),
        left: Math.min(maxLeft, Math.max(0, startLeft + deltaX)),
      })
    }
    const handleMouseUp = () => {
      draggingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const handleResizeMouseDown = (e: ReactMouseEvent) => {
    e.stopPropagation()
    resizingRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startWidth = size.width
    const startHeight = size.height
    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const deltaX = ev.clientX - startX
      const deltaY = ev.clientY - startY
      setSize({
        width: Math.max(MIN_WIDTH, startWidth + deltaX),
        height: Math.max(MIN_HEIGHT, startHeight + deltaY),
      })
    }
    const handleMouseUp = () => {
      resizingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }
```

Update the header JSX to wire up the drag handler, and add the resize handle as the last child of the root div:

```tsx
      <div className="audit-history-modal-header" onMouseDown={handleHeaderMouseDown}>
        <span>Audit History</span>
        <button
          type="button"
          className="audit-history-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>
      </div>
      <div className="audit-history-modal-body">
        {/* ...unchanged... */}
      </div>
      <div className="audit-history-modal-resize-handle" onMouseDown={handleResizeMouseDown} />
```

(The close button's own `onClick` still fires normally — `onMouseDown` on the header only starts a drag on the header bar itself; nothing prevents the button's click. `stopPropagation` on the resize handle's `onMouseDown` keeps a resize-drag from starting a header-drag too, since the handle could visually overlap the header's hit area depending on final CSS — harmless whether or not they actually overlap, cheap to keep.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test -- AuditHistoryModal`
Expected: PASS (9 tests).

- [ ] **Step 5: Mark task complete**

---

### Task 4: Wire into `ProfilePage`, add CSS

**Files:**
- Modify: `client/src/pages/ProfilePage.tsx`
- Modify: `client/src/__tests__/ProfilePage.test.tsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: Write the failing tests**

Add to `client/src/__tests__/ProfilePage.test.tsx`, after the existing `'hides My drafts section for user role'` test:

```tsx
  it('shows an Audit History link for every role, including user', async () => {
    localStorage.setItem('svidat_role', 'user')
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('Profile')).toBeInTheDocument())
    expect(screen.getByText('Audit History')).toBeInTheDocument()
  })

  it('opens the audit history modal when the link is clicked, and closes it', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('Profile')).toBeInTheDocument())
    expect(screen.queryByText('No edits yet.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Audit History'))

    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Close'))

    expect(screen.queryByText('No edits yet.')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- ProfilePage`
Expected: FAIL — the 2 new tests fail (no "Audit History" text exists yet); the 4 existing tests still PASS.

- [ ] **Step 3: Update `ProfilePage.tsx`**

Replace the full contents of `client/src/pages/ProfilePage.tsx`:

```tsx
import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDrafts, uploadAvatar } from '../api/client'
import { useAvatar } from '../hooks/useAvatar'
import { useAuth } from '../context/AuthContext'
import { AuditHistoryModal } from '../components/AuditHistoryModal'

export function ProfilePage() {
  const { id, username, role, avatarVersion, bumpAvatarVersion } = useAuth()
  const avatarUrl = useAvatar(id, avatarVersion)
  const [status, setStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [drafts, setDrafts] = useState<string[]>([])
  const [draftsError, setDraftsError] = useState<string | null>(null)
  const [showAuditHistory, setShowAuditHistory] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (role === 'admin' || role === 'qca') {
      listDrafts()
        .then(setDrafts)
        .catch((err) => setDraftsError(err instanceof Error ? err.message : String(err)))
    }
  }, [role])

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setStatus(null)
    try {
      await uploadAvatar(file)
      bumpAvatarVersion()
      setStatus('Photo updated')
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="profile-page">
      <h1>Profile</h1>
      <div className="profile-card">
        {avatarUrl ? (
          <img className="profile-avatar" src={avatarUrl} alt="avatar" width={80} height={80} />
        ) : (
          <span className="profile-avatar profile-avatar-placeholder" aria-hidden="true" />
        )}
        <p className="profile-row">
          <b>Username:</b> {username}
        </p>
        <p className="profile-row">
          <b>Role:</b> {role}
        </p>
        <label className="profile-upload-label">
          Upload photo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </label>
        {status && <p role="status" className="profile-status">{status}</p>}
      </div>
      <button
        type="button"
        className="profile-audit-history-link"
        onClick={() => setShowAuditHistory(true)}
      >
        Audit History
      </button>
      {(role === 'admin' || role === 'qca') && (
        <section className="profile-drafts">
          <h2>My drafts</h2>
          {draftsError && <p role="status">Error: {draftsError}</p>}
          <ul>
            {drafts.map((f) => (
              <li key={f}>
                <a
                  href={`/files?file=${encodeURIComponent(f)}&source=draft`}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(`/files?file=${encodeURIComponent(f)}&source=draft`)
                  }}
                >
                  {f}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {showAuditHistory && <AuditHistoryModal onClose={() => setShowAuditHistory(false)} />}
    </div>
  )
}
```

Two changes from the current file: the `AuditHistoryModal` import + `showAuditHistory` state, and the new `<button className="profile-audit-history-link">` + conditional `<AuditHistoryModal>` render — everything else (avatar/upload card, drafts section) is unchanged.

- [ ] **Step 4: Add CSS**

Append to `client/src/index.css` (at the end of the file, or after the existing `.profile-*` rules if you find them — search for `.profile-drafts` to locate that section):

```css
.profile-audit-history-link {
  background: none;
  border: none;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  text-align: left;
  margin: 8px 0;
}

.profile-audit-history-link:hover {
  color: var(--text-h);
}

.audit-history-modal {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  z-index: 100;
  overflow: hidden;
}

.audit-history-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-weight: bold;
  font-size: 13px;
  color: var(--text-h);
  cursor: move;
  user-select: none;
}

.audit-history-modal-close {
  background: none;
  border: none;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  color: var(--text);
}

.audit-history-modal-close:hover {
  color: var(--text-h);
}

.audit-history-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 12px;
}

.audit-history-modal-body ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.audit-history-modal-body li {
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}

.audit-history-modal-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npm test -- ProfilePage`
Expected: PASS (6 tests).

- [ ] **Step 6: Mark task complete**

---

## Final verification

- [ ] `cd server && pytest -v` — all PASS.
- [ ] `cd client && npm test` — all PASS.
- [ ] `cd client && npx tsc -b` — clean.
- [ ] `cd client && npm run lint` — clean (no new warnings beyond the 3 pre-existing `react(only-export-components)` ones in `AuthContext.tsx`/`PlotSelectionContext.tsx`/`EditSessionContext.tsx`).
