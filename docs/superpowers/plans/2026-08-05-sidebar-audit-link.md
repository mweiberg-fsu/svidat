# Sidebar Audit History Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "Audit History" trigger from `ProfilePage` to `Sidebar`, so the floating `AuditHistoryModal` is reachable from any page, not just Profile.

**Architecture:** `Sidebar.tsx` gains the same `showAuditHistory` state + conditional `<AuditHistoryModal>` render that `ProfilePage.tsx` has today, plus a link in `sidebar-links` right after "Profile". `ProfilePage.tsx` loses all three. `AuditHistoryModal.tsx` itself is untouched — it's a self-contained `{ onClose }` component, indifferent to which parent mounts it.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, no new dependencies.

**Repo note:** `svidat/` has no `.git` anywhere — no repo to commit to. Tasks end with "verify tests pass" instead of a commit step.

---

## Task 1: Add the link + modal to `Sidebar`

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Test: `src/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/Sidebar.test.tsx`, inside the existing `describe('Sidebar', ...)` block, after the `'hides Admin link for non-admin role'` test:

```tsx
  it('shows an Audit History link for every role, including user', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('user')
    expect(screen.getByText('Audit History')).toBeInTheDocument()
  })

  it('opens the audit history modal when the link is clicked, and closes it', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue([])
    renderSidebar('qca')
    expect(screen.queryByText('No edits yet.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Audit History'))

    await waitFor(() => expect(screen.getByText('No edits yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Close'))

    expect(screen.queryByText('No edits yet.')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: FAIL — `'Audit History'` doesn't exist in `Sidebar` yet.

- [ ] **Step 3: Add CSS for the new link**

`.sidebar-links a` (in `src/index.css`) styles the three existing nav
anchors; the new item is a `<button>` (it opens a modal, not a route, so
it isn't a real link) and needs its own rule to match that look rather than
rendering as a default browser button. Add, right after the existing
`.sidebar-links a:hover` rule (around line 372):

```css
.sidebar-audit-history-link {
  background: none;
  border: none;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  text-align: left;
  font-family: inherit;
}

.sidebar-audit-history-link:hover {
  color: var(--text-h);
}
```

- [ ] **Step 4: Implement the component change**

In `src/components/Sidebar.tsx`, add the import and state:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEditSession } from '../context/EditSessionContext'
import { useAvatar } from '../hooks/useAvatar'
import { PlotPicker } from './PlotPicker'
import { FlagsPanel } from './FlagsPanel'
import { AuditHistoryModal } from './AuditHistoryModal'
```

```tsx
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [activeTab, setActiveTab] = useState<SidebarTab>('files')
  const [showAuditHistory, setShowAuditHistory] = useState(false)
  const draggingRef = useRef(false)
```

Add the link right after the "Profile" `<a>` inside `sidebar-links`:

```tsx
        <a
          href="/profile"
          onClick={(e) => {
            e.preventDefault()
            navigate('/profile')
          }}
        >
          Profile
        </a>
        <button
          type="button"
          className="sidebar-audit-history-link"
          onClick={() => setShowAuditHistory(true)}
        >
          Audit History
        </button>
      </div>
```

Render the modal once, after the resize handle at the bottom of the `<aside>`:

```tsx
      <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />
      {showAuditHistory && (
        <AuditHistoryModal onClose={() => setShowAuditHistory(false)} />
      )}
    </aside>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Verify tests pass, no commit (no git repo in this directory)**

---

## Task 2: Remove the link + modal from `ProfilePage`

**Files:**
- Modify: `src/pages/ProfilePage.tsx`
- Test: `src/__tests__/ProfilePage.test.tsx`

- [ ] **Step 1: Remove the now-obsolete tests**

In `src/__tests__/ProfilePage.test.tsx`, delete these two tests in full (they cover behavior that Task 1 moved to `Sidebar.test.tsx`):

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

- [ ] **Step 2: Run tests to verify the remaining suite still passes**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/ProfilePage.test.tsx`
Expected: PASS (the remaining tests don't touch Audit History and are unaffected; this step just confirms the deletion didn't leave a dangling reference).

- [ ] **Step 3: Remove the link + modal from the component**

In `src/pages/ProfilePage.tsx`, remove the `AuditHistoryModal` import:

```tsx
import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDrafts, uploadAvatar } from '../api/client'
import { useAvatar } from '../hooks/useAvatar'
import { useAuth } from '../context/AuthContext'
```

Remove the `showAuditHistory` state:

```tsx
  const [status, setStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [drafts, setDrafts] = useState<string[]>([])
  const [draftsError, setDraftsError] = useState<string | null>(null)
  const navigate = useNavigate()
```

Remove the button and the modal render, so the JSX ends after the drafts section:

```tsx
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
    </div>
  )
}
```

(This deletes the `<button className="profile-audit-history-link">...</button>` block that sat between the `profile-card` div and the drafts `section`, and the trailing `{showAuditHistory && <AuditHistoryModal .../>}` line.)

- [ ] **Step 4: Delete the now-dead CSS rule**

In `src/index.css`, remove the `.profile-audit-history-link` and
`.profile-audit-history-link:hover` rules (around lines 546–559) — nothing
references that class anymore after Step 3; its replacement,
`.sidebar-audit-history-link`, was added in Task 1 Step 3.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/ProfilePage.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Verify tests pass, no commit (no git repo in this directory)**

---

## Task 3: Full suite + manual smoke check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run`
Expected: all tests PASS.

- [ ] **Step 2: Grep for any leftover reference to the old ProfilePage class name**

Run: `grep -rn "profile-audit-history-link" /Users/ustropics/Documents/svidat/client/src`
Expected: no matches (Task 2 Step 4 deleted the rule; nothing else should reference it).

- [ ] **Step 3: Manual smoke test in the running app**

Start the dev server (`npm run dev` from `/Users/ustropics/Documents/svidat/client`), log in as any role, confirm "Audit History" appears in the sidebar under "Profile" on every page (Files, Admin if admin, Profile), clicking it opens the floating modal, dragging/resizing/reverting/closing all still work, and the Profile page itself no longer shows its own Audit History button.
