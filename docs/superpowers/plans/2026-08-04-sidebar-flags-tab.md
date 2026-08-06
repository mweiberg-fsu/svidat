# Sidebar Flags Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move flagging out of `SvgPlot`'s floating popover into a new "Flags" sidebar tab (alongside a "File Selection" tab), backed by a fixed 26-code list instead of file metadata.

**Architecture:** One new context (`EditSessionContext`) lifts session/edit-permission state and the pending flag selection out of `FilesPage`/`SvgPlot` local state so the sidebar (a sibling of the file page) can read and drive them. A new `FlagsPanel` component replaces `FlagToolbar` as the code-picker UI. A shared `FLAG_CODES` constant replaces the metadata-derived code list everywhere it's used (the new panel's button grid, and `SvgPlot`'s existing marker legend).

**Tech Stack:** React + TypeScript, React Context, Vitest + Testing Library. No new dependencies.

**No git repo:** `svidat/` has no `.git` anywhere, so there are no commit steps — each task ends with "mark task complete" instead.

---

## Reference: files this plan touches

- New: `client/src/constants/flagCodes.ts`
- New: `client/src/context/EditSessionContext.tsx`
- New: `client/src/components/FlagsPanel.tsx`
- New: `client/src/__tests__/flagCodes.test.ts`
- New: `client/src/__tests__/EditSessionContext.test.tsx`
- New: `client/src/__tests__/FlagsPanel.test.tsx`
- Modify: `client/src/components/ProtectedRoute.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/components/PlotPicker.tsx`
- Modify: `client/src/components/SvgPlot.tsx`
- Modify: `client/src/pages/FilesPage.tsx`
- Modify: `client/src/index.css`
- Modify: `client/src/__tests__/Sidebar.test.tsx`
- Modify: `client/src/__tests__/SvgPlot.test.tsx`
- Modify: `client/src/__tests__/FilesPage.test.tsx`
- Delete: `client/src/components/FlagToolbar.tsx`
- Delete: `client/src/__tests__/FlagToolbar.test.tsx`

---

### Task 1: Shared flag-codes constant

**Files:**
- Create: `client/src/constants/flagCodes.ts`
- Test: `client/src/__tests__/flagCodes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/flagCodes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FLAG_CODES } from '../constants/flagCodes'

describe('FLAG_CODES', () => {
  it('has exactly 26 entries, one per letter A-Z, each with a non-empty description', () => {
    expect(FLAG_CODES).toHaveLength(26)
    const codes = FLAG_CODES.map((f) => f.code)
    expect(new Set(codes).size).toBe(26)
    for (let i = 0; i < 26; i++) {
      expect(codes[i]).toBe(String.fromCharCode(65 + i))
    }
    for (const { description } of FLAG_CODES) {
      expect(description.length).toBeGreaterThan(0)
    }
  })

  it('includes the specific codes referenced elsewhere in the app', () => {
    const byCode = Object.fromEntries(FLAG_CODES.map((f) => [f.code, f.description]))
    expect(byCode.K).toBe('Suspect/Caution')
    expect(byCode.Z).toBe('Good data')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- flagCodes`
Expected: FAIL — `Cannot find module '../constants/flagCodes'`.

- [ ] **Step 3: Create the constant module**

Create `client/src/constants/flagCodes.ts`:

```ts
export interface FlagCode {
  code: string
  description: string
}

// Fixed QC flag scheme — not derived from file metadata (unlike the rest of
// this app's variable/dimension data). Every file uses the same 26 codes.
export const FLAG_CODES: FlagCode[] = [
  { code: 'A', description: 'Units added' },
  { code: 'B', description: 'Out of bounds' },
  { code: 'C', description: 'Time not sequential' },
  { code: 'D', description: 'Failed T>Tw>Td' },
  { code: 'E', description: 'True wind error' },
  { code: 'F', description: 'Unreal movement' },
  { code: 'G', description: 'Value > 4 s.d.' },
  { code: 'H', description: 'Discontinuity' },
  { code: 'I', description: 'Interesting feature' },
  { code: 'J', description: 'Bad data' },
  { code: 'K', description: 'Suspect/Caution' },
  { code: 'L', description: 'Land Error' },
  { code: 'M', description: 'Malfunction' },
  { code: 'N', description: 'In port' },
  { code: 'O', description: 'Multiple convers_units' },
  { code: 'P', description: 'Plat. position uncert.' },
  { code: 'Q', description: 'Questionable' },
  { code: 'R', description: 'Interpolated value' },
  { code: 'S', description: 'Spike' },
  { code: 'T', description: 'Time duplicate' },
  { code: 'U', description: 'Suspect from flagger' },
  { code: 'V', description: 'Spike from flagger' },
  { code: 'W', description: 'Undefined' },
  { code: 'X', description: 'Step from flagger' },
  { code: 'Y', description: "Suspect between X's" },
  { code: 'Z', description: 'Good data' },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- flagCodes`
Expected: PASS (2 tests).

- [ ] **Step 5: Mark task complete**

---

### Task 2: `EditSessionContext`

**Files:**
- Create: `client/src/context/EditSessionContext.tsx`
- Test: `client/src/__tests__/EditSessionContext.test.tsx`

This context replaces `FilesPage`'s local `sessionOpen`/`canEdit`/open-close-handler state (moved verbatim) and introduces the shared `flagSelection`/`flagAppliedAt` state that `SvgPlot` and the new `FlagsPanel` will both read/write. It nests inside `PlotSelectionProvider` (reads `file`/`variables` from `usePlotSelection()` internally) and inside `AuthProvider` (reads `role` from `useAuth()`).

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/EditSessionContext.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { AuthProvider } from '../context/AuthContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

function Consumer() {
  const {
    sessionOpen,
    canEdit,
    editable,
    sessionError,
    openSession,
    closeSession,
    flagSelection,
    setFlagSelection,
    flagAppliedAt,
    notifyFlagged,
  } = useEditSession()
  return (
    <div>
      <span>sessionOpen:{String(sessionOpen)}</span>
      <span>canEdit:{String(canEdit)}</span>
      <span>editable:{String(editable)}</span>
      <span>sessionError:{sessionError ?? 'none'}</span>
      <span>flagSelection:{flagSelection ? flagSelection.rangeLabel : 'none'}</span>
      <span>flagAppliedAt:{flagAppliedAt}</span>
      <button onClick={() => openSession()}>open</button>
      <button onClick={() => closeSession()}>close</button>
      <button
        onClick={() =>
          setFlagSelection({ varName: 'temperature', startIdx: 4, endIdx: 14, rangeLabel: '04:00–14:00' })
        }
      >
        select
      </button>
      <button onClick={() => setFlagSelection(null)}>clear</button>
      <button onClick={() => notifyFlagged()}>notify</button>
    </div>
  )
}

function SetFile({ file }: { file: string }) {
  const sel = usePlotSelection()
  return (
    <button data-testid="set-file" onClick={() => sel.setFile(file)}>
      set file
    </button>
  )
}

function renderWithRole(role: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <SetFile file="FILE_A" />
          <EditSessionProvider>
            <Consumer />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('EditSessionContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('canEdit reflects role; editable is false until a session is opened', () => {
    renderWithRole('qca')
    expect(screen.getByText('canEdit:true')).toBeInTheDocument()
    expect(screen.getByText('editable:false')).toBeInTheDocument()
  })

  it('canEdit is false for the user role', () => {
    renderWithRole('user')
    expect(screen.getByText('canEdit:false')).toBeInTheDocument()
  })

  it('opening a session sets sessionOpen and editable (for an eligible role)', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())
    expect(screen.getByText('editable:true')).toBeInTheDocument()
  })

  it('closing a session clears sessionOpen and editable', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())

    fireEvent.click(screen.getByText('close'))
    await waitFor(() => expect(screen.getByText('sessionOpen:false')).toBeInTheDocument())
    expect(screen.getByText('editable:false')).toBeInTheDocument()
  })

  it('a failed open surfaces sessionError and leaves sessionOpen false', async () => {
    vi.spyOn(apiClient, 'openSession').mockRejectedValue(new Error('locked by another user'))
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    fireEvent.click(screen.getByText('open'))
    await waitFor(() =>
      expect(screen.getByText('sessionError:locked by another user')).toBeInTheDocument()
    )
    expect(screen.getByText('sessionOpen:false')).toBeInTheDocument()
  })

  it('shares flagSelection and flagAppliedAt between consumers under the same provider', () => {
    renderWithRole('qca')
    expect(screen.getByText('flagSelection:none')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select'))
    expect(screen.getByText('flagSelection:04:00–14:00')).toBeInTheDocument()

    fireEvent.click(screen.getByText('clear'))
    expect(screen.getByText('flagSelection:none')).toBeInTheDocument()

    expect(screen.getByText('flagAppliedAt:0')).toBeInTheDocument()
    fireEvent.click(screen.getByText('notify'))
    expect(screen.getByText('flagAppliedAt:1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- EditSessionContext`
Expected: FAIL — `Cannot find module '../context/EditSessionContext'`.

- [ ] **Step 3: Create the context**

Create `client/src/context/EditSessionContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { closeSession, openSession } from '../api/client'
import { useAuth } from './AuthContext'
import { usePlotSelection } from './PlotSelectionContext'

export interface FlagSelection {
  varName: string
  startIdx: number
  endIdx: number
  rangeLabel: string
}

interface EditSessionState {
  sessionOpen: boolean
  canEdit: boolean
  editable: boolean
  sessionError: string | null
  openSession: () => Promise<void>
  closeSession: () => Promise<void>
  flagSelection: FlagSelection | null
  setFlagSelection: (selection: FlagSelection | null) => void
  flagAppliedAt: number
  notifyFlagged: () => void
}

const EditSessionContext = createContext<EditSessionState | undefined>(undefined)

export function EditSessionProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth()
  const { file, variables } = usePlotSelection()
  const [searchParams] = useSearchParams()
  const [sessionOpen, setSessionOpen] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [flagSelection, setFlagSelection] = useState<FlagSelection | null>(null)
  const [flagAppliedAt, setFlagAppliedAt] = useState(0)

  const canEdit = role === 'admin' || role === 'qca'
  const editable = sessionOpen && canEdit

  // A new file invalidates the current edit session — same as FilesPage's
  // original per-file session reset.
  useEffect(() => {
    setSessionOpen(false)
    setSessionError(null)
  }, [file])

  // A new file or variable set makes any pending flag selection meaningless
  // — same as SvgPlot's original [file, variables] reset.
  useEffect(() => {
    setFlagSelection(null)
  }, [file, variables])

  const handleOpenSession = async () => {
    if (!file) return
    setSessionError(null)
    try {
      const source = searchParams.get('source') ?? 'raw'
      await openSession(file, source)
      setSessionOpen(true)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'failed to open session')
    }
  }

  const handleCloseSession = async () => {
    if (!file) return
    setSessionError(null)
    try {
      await closeSession(file)
      setSessionOpen(false)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'failed to close session')
    }
  }

  const notifyFlagged = () => setFlagAppliedAt((v) => v + 1)

  return (
    <EditSessionContext.Provider
      value={{
        sessionOpen,
        canEdit,
        editable,
        sessionError,
        openSession: handleOpenSession,
        closeSession: handleCloseSession,
        flagSelection,
        setFlagSelection,
        flagAppliedAt,
        notifyFlagged,
      }}
    >
      {children}
    </EditSessionContext.Provider>
  )
}

export function useEditSession(): EditSessionState {
  const ctx = useContext(EditSessionContext)
  if (!ctx) {
    throw new Error('useEditSession must be used within EditSessionProvider')
  }
  return ctx
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- EditSessionContext`
Expected: PASS (6 tests).

- [ ] **Step 5: Mark task complete**

---

### Task 3: Wire `EditSessionProvider` into `ProtectedRoute`

**Files:**
- Modify: `client/src/components/ProtectedRoute.tsx`

No test file — this is pure wiring, covered indirectly by every test in later tasks that renders `Sidebar`/`FilesPage` together (not applicable here since `ProtectedRoute` itself has its own existing test file that doesn't need changes — it doesn't render deep enough to hit a missing-provider error, verified in Step 3 below).

- [ ] **Step 1: Add the provider**

Modify `client/src/components/ProtectedRoute.tsx`:

```tsx
import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Navbar } from './Navbar'
import { Sidebar } from './Sidebar'
import { useAuth } from '../context/AuthContext'
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
import { EditSessionProvider } from '../context/EditSessionContext'
import type { Role } from '../api/types'

export function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode
  roles: Role[]
}) {
  const { token, role } = useAuth()
  if (!token || !role) {
    return <Navigate to="/login" replace />
  }
  if (!roles.includes(role)) {
    return <Navigate to="/login" replace />
  }
  return (
    <PlotSelectionProvider>
      <EditSessionProvider>
        <div className="app-shell">
          <Navbar />
          <div className="app-body">
            <Sidebar />
            <main className="app-main">{children}</main>
          </div>
        </div>
      </EditSessionProvider>
    </PlotSelectionProvider>
  )
}
```

- [ ] **Step 2: Run the existing `ProtectedRoute` suite**

Run: `cd client && npm test -- ProtectedRoute`
Expected: PASS (3 tests, unchanged — `ProtectedRoute.test.tsx` doesn't assert on `Sidebar`/`FilesPage` internals that would need `EditSessionProvider` directly, only on the shell rendering).

- [ ] **Step 3: Mark task complete**

---

### Task 4: `FlagsPanel` component

**Files:**
- Create: `client/src/components/FlagsPanel.tsx`
- Test: `client/src/__tests__/FlagsPanel.test.tsx`
- Modify: `client/src/index.css` (new styles, additive only)

This migrates `FlagToolbar`'s apply/poll logic (see `client/src/components/FlagToolbar.tsx:59-89` for the exact chain being carried over) into a persistent panel instead of a floating popover, and switches from metadata-derived codes to the fixed `FLAG_CODES` list.

- [ ] **Step 1: Write the failing tests**

Create `client/src/__tests__/FlagsPanel.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FlagsPanel } from '../components/FlagsPanel'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { AuthProvider } from '../context/AuthContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

// Drives file + session + selection state directly — FlagsPanel only cares
// about the resulting context values, not how they got set (the real app
// sets them via FilesPage's "Open for editing" button and SvgPlot's drag
// gesture, both covered in their own test files).
function Driver() {
  const sel = usePlotSelection()
  const { openSession, setFlagSelection } = useEditSession()
  return (
    <div>
      <button onClick={() => sel.setFile('FILE_A')}>set file</button>
      <button onClick={() => openSession()}>open session</button>
      <button
        onClick={() =>
          setFlagSelection({
            varName: 'temperature',
            startIdx: 4,
            endIdx: 14,
            rangeLabel: '04:00:00–14:00:00',
          })
        }
      >
        select
      </button>
      <button onClick={() => setFlagSelection(null)}>clear</button>
    </div>
  )
}

function renderPanel(role: string = 'qca') {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Driver />
            <FlagsPanel />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

async function selectAndMakeEditable() {
  fireEvent.click(screen.getByText('set file'))
  vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
  fireEvent.click(screen.getByText('open session'))
  await waitFor(() => expect(screen.getByText('A-Units added')).not.toBeDisabled())
  fireEvent.click(screen.getByText('select'))
}

describe('FlagsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders all 26 flag code buttons', () => {
    renderPanel()
    expect(screen.getByText('A-Units added')).toBeInTheDocument()
    expect(screen.getByText('K-Suspect/Caution')).toBeInTheDocument()
    expect(screen.getByText('Z-Good data')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^[A-Z]-/ })).toHaveLength(26)
  })

  it('shows the permission hint and disables codes when not editable', () => {
    renderPanel()
    expect(screen.getByText('A-Units added')).toBeDisabled()
    expect(screen.getByText('Open this file for editing to flag data')).toBeInTheDocument()
  })

  it('shows the selection hint once editable but before a selection is made', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    renderPanel()
    fireEvent.click(screen.getByText('set file'))
    fireEvent.click(screen.getByText('open session'))
    await waitFor(() =>
      expect(screen.getByText('Select points on the plot to flag them')).toBeInTheDocument()
    )
    expect(screen.getByText('A-Units added')).toBeDisabled()
  })

  it('keeps codes disabled when a selection exists but the file is not editable', () => {
    renderPanel()
    fireEvent.click(screen.getByText('set file'))
    fireEvent.click(screen.getByText('select'))
    expect(screen.getByText('A-Units added')).toBeDisabled()
  })

  it('enables codes and shows the range once both editable and selected', async () => {
    await selectAndMakeEditable()
    expect(screen.getByText('A-Units added')).not.toBeDisabled()
    expect(screen.getByText('04:00:00–14:00:00 — 11 points selected')).toBeInTheDocument()
  })

  it('applies a flag code, polls the job, and clears the selection on success', async () => {
    const applyFlagSpy = vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-1' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'done',
      error: null,
      result: { audit_id: 1 },
    })
    await selectAndMakeEditable()

    fireEvent.click(screen.getByText('K-Suspect/Caution'))

    await waitFor(() =>
      expect(applyFlagSpy).toHaveBeenCalledWith('FILE_A', 'temperature', 4, 14, 'K')
    )
    await waitFor(
      () => expect(screen.getByText('Select points on the plot to flag them')).toBeInTheDocument(),
      { timeout: 2000 }
    )
  })

  it('shows an inline error and keeps the selection when the job fails', async () => {
    vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-2' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'failed',
      error: 'invalid flag_code',
      result: null,
    })
    await selectAndMakeEditable()

    fireEvent.click(screen.getByText('K-Suspect/Caution'))

    await waitFor(
      () => expect(screen.getByText('Error: invalid flag_code')).toBeInTheDocument(),
      { timeout: 2000 }
    )
    expect(screen.getByText('04:00:00–14:00:00 — 11 points selected')).toBeInTheDocument()
  })

  it('"Clear selection" clears without calling the API', async () => {
    const applyFlagSpy = vi.spyOn(apiClient, 'applyFlag')
    await selectAndMakeEditable()

    fireEvent.click(screen.getByText('Clear selection'))

    expect(screen.getByText('Select points on the plot to flag them')).toBeInTheDocument()
    expect(applyFlagSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- FlagsPanel`
Expected: FAIL — `Cannot find module '../components/FlagsPanel'`.

- [ ] **Step 3: Create `FlagsPanel.tsx`**

Create `client/src/components/FlagsPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { applyFlag, jobStatus } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { FLAG_CODES } from '../constants/flagCodes'

const FLAG_POLL_INTERVAL_MS = 300
const FLAG_POLL_TIMEOUT_MS = 30000

export function FlagsPanel() {
  const { file } = usePlotSelection()
  const { editable, flagSelection, setFlagSelection, notifyFlagged } = useEditSession()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // A changed (or cleared) selection invalidates any previous apply error —
  // same lifetime FlagToolbar's error had (it unmounted on cancel/apply).
  useEffect(() => {
    setError(null)
  }, [flagSelection])

  const handleApply = async (code: string) => {
    if (!flagSelection) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await applyFlag(
        file,
        flagSelection.varName,
        flagSelection.startIdx,
        flagSelection.endIdx,
        code
      )
      const start = Date.now()
      while (Date.now() - start < FLAG_POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, FLAG_POLL_INTERVAL_MS))
        if (!isMountedRef.current) return
        const jobResult = await jobStatus(result.job_id)
        if (!isMountedRef.current) return
        if (jobResult.status === 'done') {
          setFlagSelection(null)
          notifyFlagged()
          return
        }
        if (jobResult.status === 'failed') {
          setError(jobResult.error ?? 'Flag apply failed')
          return
        }
      }
      setError('Flag apply still running — try again later')
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  const disabled = !editable || !flagSelection || submitting
  const pointCount = flagSelection ? flagSelection.endIdx - flagSelection.startIdx + 1 : 0

  return (
    <div className="sidebar-flags-panel">
      <p className="sidebar-flags-panel-status">
        {flagSelection
          ? `${flagSelection.rangeLabel} — ${pointCount} points selected`
          : editable
            ? 'Select points on the plot to flag them'
            : 'Open this file for editing to flag data'}
      </p>
      <div className="sidebar-flags-panel-grid">
        {FLAG_CODES.map(({ code, description }) => (
          <button key={code} onClick={() => handleApply(code)} disabled={disabled}>
            {code}-{description}
          </button>
        ))}
      </div>
      <button
        className="sidebar-flags-panel-clear"
        onClick={() => setFlagSelection(null)}
        disabled={disabled}
      >
        Clear selection
      </button>
      {error && <p role="status">Error: {error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Add CSS**

Append to `client/src/index.css` (after the existing `.plot-flag-toolbar` rules, ~line 477):

```css
.sidebar-flags-panel {
  padding: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sidebar-flags-panel-status {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
  margin: 0;
}

.sidebar-flags-panel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.sidebar-flags-panel-grid button {
  text-align: left;
  padding: 4px 6px;
  border: 1px solid var(--border);
  background: var(--code-bg);
  color: var(--text-h);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-flags-panel-grid button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sidebar-flags-panel-clear {
  align-self: flex-start;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npm test -- FlagsPanel`
Expected: PASS (8 tests).

- [ ] **Step 6: Mark task complete**

---

### Task 5: Sidebar tabs

**Files:**
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/components/PlotPicker.tsx`
- Modify: `client/src/index.css`
- Modify: `client/src/__tests__/Sidebar.test.tsx`

Adds the tab switcher, auto-switches to "Flags" when a selection resolves, and removes `PlotPicker`'s now-redundant `<legend>File Selection</legend>` (the tab button says the same thing — confirmed via `grep` that `PlotPicker.test.tsx` doesn't depend on that legend text).

- [ ] **Step 1: Update `Sidebar.test.tsx`**

Every existing test renders `<Sidebar/>` directly, which will now call `useEditSession()` unconditionally — all render call sites need `<EditSessionProvider>` added, even the ones that don't currently wrap `<PlotSelectionProvider>` (that one stays optional/added only where `PlotPicker` actually mounts, same as today; `EditSessionProvider` is required everywhere `Sidebar` renders).

Replace the full contents of `client/src/__tests__/Sidebar.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

function renderSidebar(role: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Sidebar />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
  })

  it('shows welcome message with username', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('qca')
    expect(screen.getByText('testuser')).toBeInTheDocument()
    expect(screen.getByText('Welcome')).toBeInTheDocument()
  })

  it('shows Admin link only for admin role', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('admin')
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('hides Admin link for non-admin role', () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderSidebar('qca')
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('renders no tabs outside /files', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/profile']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('testuser')).toBeInTheDocument())
    expect(screen.queryByRole('tab', { name: 'File Selection' })).not.toBeInTheDocument()
  })

  it('renders File Selection and Flags tabs on /files, File Selection active by default', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: 'File Selection' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Flags' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'File Selection' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Flags' })).toHaveAttribute('aria-selected', 'false')
    // File Selection tab active by default -> PlotPicker's Ship label visible.
    expect(screen.getByText('Ship')).toBeInTheDocument()
  })

  it('clicking the Flags tab switches panels', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Flags' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: 'Flags' }))

    expect(screen.getByRole('tab', { name: 'Flags' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('A-Units added')).toBeInTheDocument()
    expect(screen.queryByText('Ship')).not.toBeInTheDocument()
  })

  it('auto-switches to the Flags tab when a flag selection resolves', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    function SelectDriver() {
      const { setFlagSelection } = useEditSession()
      return (
        <button
          onClick={() =>
            setFlagSelection({ varName: 'temperature', startIdx: 4, endIdx: 14, rangeLabel: 'x' })
          }
        >
          resolve selection
        </button>
      )
    }

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SelectDriver />
              <Sidebar />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: 'File Selection' })).toHaveAttribute('aria-selected', 'true'))

    fireEvent.click(screen.getByText('resolve selection'))

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Flags' })).toHaveAttribute('aria-selected', 'true')
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- Sidebar`
Expected: FAIL — no `role="tab"` elements exist yet (current `Sidebar.tsx` has no tabs), and `EditSessionProvider` import path works but `Sidebar` doesn't consume it yet so `select`-driven auto-switch assertions fail too.

- [ ] **Step 3: Remove `PlotPicker`'s redundant legend**

Modify `client/src/components/PlotPicker.tsx` — remove this line (the tab button added below now conveys the same label):

```tsx
      <legend>File Selection</legend>
```

- [ ] **Step 4: Add tabs to `Sidebar.tsx`**

Replace the full contents of `client/src/components/Sidebar.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEditSession } from '../context/EditSessionContext'
import { useAvatar } from '../hooks/useAvatar'
import { PlotPicker } from './PlotPicker'
import { FlagsPanel } from './FlagsPanel'

const MIN_WIDTH = 200
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 250

type SidebarTab = 'files' | 'flags'

export function Sidebar() {
  const { username, role, id, avatarVersion } = useAuth()
  const { flagSelection } = useEditSession()
  const avatarUrl = useAvatar(id, avatarVersion)
  const navigate = useNavigate()
  const location = useLocation()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [activeTab, setActiveTab] = useState<SidebarTab>('files')
  const draggingRef = useRef(false)

  // Mirrors the old popover's "appears once you resolve a drag" behavior —
  // now surfaces as switching to the tab that shows the code picker.
  useEffect(() => {
    if (flagSelection) setActiveTab('flags')
  }, [flagSelection])

  const handleMouseDown = () => {
    draggingRef.current = true
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
      setWidth(next)
    }
    const handleMouseUp = () => {
      draggingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-welcome">
        {avatarUrl ? (
          <img className="sidebar-welcome-avatar" src={avatarUrl} alt="avatar" width={36} height={36} />
        ) : (
          <span className="sidebar-welcome-avatar sidebar-welcome-avatar-placeholder" aria-hidden="true" />
        )}
        <div className="sidebar-welcome-text">
          Welcome
          <b>{username}</b>
        </div>
      </div>
      <div className="sidebar-links">
        <a
          href="/files"
          onClick={(e) => {
            e.preventDefault()
            navigate('/files')
          }}
        >
          Plots
        </a>
        {role === 'admin' && (
          <a
            href="/admin/users"
            onClick={(e) => {
              e.preventDefault()
              navigate('/admin/users')
            }}
          >
            Admin
          </a>
        )}
        <a
          href="/profile"
          onClick={(e) => {
            e.preventDefault()
            navigate('/profile')
          }}
        >
          Profile
        </a>
      </div>
      {location.pathname === '/files' && (
        <>
          <div className="sidebar-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'files'}
              className={activeTab === 'files' ? 'sidebar-tab active' : 'sidebar-tab'}
              onClick={() => setActiveTab('files')}
            >
              File Selection
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'flags'}
              className={activeTab === 'flags' ? 'sidebar-tab active' : 'sidebar-tab'}
              onClick={() => setActiveTab('flags')}
            >
              Flags
            </button>
          </div>
          <div className="sidebar-tab-panel">
            {activeTab === 'files' ? <PlotPicker /> : <FlagsPanel />}
          </div>
        </>
      )}
      <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />
    </aside>
  )
}
```

- [ ] **Step 5: Update CSS**

In `client/src/index.css`, replace the `/* Sidebar plot picker (reuses .sidebar-picker's label/select styling) */` block (~lines 478-519) — rename `.sidebar-plot-picker` to `.sidebar-tab-panel` (now hosts either `PlotPicker` or `FlagsPanel`) and add the new tab-button styles:

```css
/* Sidebar tabs */

.sidebar-tabs {
  display: flex;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.sidebar-tab {
  flex: 1;
  padding: 10px 8px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
}

.sidebar-tab.active {
  color: var(--text-h);
  border-bottom-color: var(--accent-border);
}

/* Sidebar tab panel (reuses .sidebar-picker's label/select styling) */

.sidebar-tab-panel {
  padding: 16px;
}

.sidebar-tab-panel fieldset {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-tab-panel label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
}

.sidebar-tab-panel select {
  background: var(--code-bg);
  border: 1px solid var(--border);
  color: var(--text-h);
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
}
```

(The old block had a `.sidebar-plot-picker legend` rule — dropped, since `PlotPicker`'s `<legend>` was removed in Step 3. `.sidebar-flags-panel`'s own padding/border-top from Task 4 stays as-is; `.sidebar-tab-panel` no longer needs its own `border-top` since `.sidebar-tabs` already has one directly above it.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd client && npm test -- Sidebar`
Expected: PASS (8 tests).

- [ ] **Step 7: Run the `PlotPicker` suite to confirm the legend removal didn't break it**

Run: `cd client && npm test -- PlotPicker`
Expected: PASS (unchanged — confirmed in this task's intro that no test depends on the legend text).

- [ ] **Step 8: Mark task complete**

---

### Task 6: `SvgPlot.tsx` — use context, drop the popover

**Files:**
- Modify: `client/src/components/SvgPlot.tsx`
- Modify: `client/src/__tests__/SvgPlot.test.tsx`

This is the largest task. `SvgPlot` currently declares its own `flagSelection` state and renders `FlagToolbar`; both go away in favor of `EditSessionContext`. Read `client/src/components/SvgPlot.tsx` in its current state before starting — line numbers below are as of the version that already has the magenta-highlight feature (`computeModeCode`, `buildFlagSegments`, `computeTightBand`, `computeDragHighlightRange` all already exist; this task does not touch those four functions).

- [ ] **Step 1: Update the test file's shared helper and imports**

In `client/src/__tests__/SvgPlot.test.tsx`, add the `EditSessionProvider` import and wrap it into the shared `renderSvgPlot` helper (used by the majority of tests):

```tsx
import { useState } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SvgPlot } from '../components/SvgPlot'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { AuthProvider } from '../context/AuthContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

function Setup({ file, variables }: { file: string; variables: string[] }) {
  const sel = usePlotSelection()
  return (
    <>
      <button data-testid="set-file" onClick={() => sel.setFile(file)}>
        set file
      </button>
      <button data-testid="set-variables" onClick={() => sel.setVariables(variables)}>
        set variables
      </button>
    </>
  )
}

function renderSvgPlot(file: string, variables: string[]) {
  setToken('tok')
  localStorage.setItem('svidat_role', 'qca')
  localStorage.setItem('svidat_username', 'testuser')
  const utils = render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <Setup file={file} variables={variables} />
            <SvgPlot />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
  // Separate clicks (separate commits) — setFile clears `vars`, so setting
  // both search params in the same event handler would race against that.
  fireEvent.click(screen.getByTestId('set-file'))
  fireEvent.click(screen.getByTestId('set-variables'))
  return utils
}
```

`EditSessionProvider` needs `useAuth()` (role) and `usePlotSelection()` (file) — the `AuthProvider`/localStorage role-setting lines are new here (previously this test file never needed a role, since `editable` was just a plain boolean prop). Every test using `renderSvgPlot` gets this for free.

- [ ] **Step 2: Wrap the remaining manual-render tests with `AuthProvider` + `EditSessionProvider`**

The following tests build their own `render(...)` tree instead of using `renderSvgPlot` and need the same two providers added, plus `setToken`/role setup. For each, wrap the existing `<MemoryRouter><PlotSelectionProvider>...` tree with `<AuthProvider>` outside and `<EditSessionProvider>` directly inside `<PlotSelectionProvider>` (matching the pattern in Step 1), and add `setToken('tok'); localStorage.setItem('svidat_role', 'qca'); localStorage.setItem('svidat_username', 'testuser')` near the top of the test body (before `render(...)`):

- `'shows the empty state with no file/variables selected'`
- `'resets the active row when the file changes'`
- `'resets the zoom window when the file changes'`

Example for `'shows the empty state with no file/variables selected'` — before:

```tsx
  it('shows the empty state with no file/variables selected', () => {
    render(
      <MemoryRouter>
        <PlotSelectionProvider>
          <SvgPlot />
        </PlotSelectionProvider>
      </MemoryRouter>
    )
    expect(
      screen.getByText('Select variables in the sidebar to view plots.')
    ).toBeInTheDocument()
  })
```

After:

```tsx
  it('shows the empty state with no file/variables selected', () => {
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    expect(
      screen.getByText('Select variables in the sidebar to view plots.')
    ).toBeInTheDocument()
  })
```

Apply the same `<AuthProvider>...<EditSessionProvider>` wrapping (outside `MemoryRouter`, inside `PlotSelectionProvider`, respectively) plus the three `setToken`/`localStorage` lines to `'resets the active row when the file changes'` and `'resets the zoom window when the file changes'`, leaving everything else in those two tests (the `SwitchFile` helper component, all assertions) unchanged.

- [ ] **Step 3: Update the `editable`/magenta-band tests — wrap providers, drop `onFlagged`, rewrite dialog assertions**

These five tests already build their own manual render tree with `editable` (and the now-removed `onFlagged` prop). For each: add the same `AuthProvider`/`EditSessionProvider` wrapping and role setup as Step 2, remove `onFlagged={() => {}}` from every `<SvgPlot editable .../>` (and `<SvgPlot editable={editable} onFlagged={() => {}} />` in the one test using a local `editable` toggle), and replace any `screen.queryByRole('dialog')`/`screen.getByRole('dialog')` assertion with an equivalent check against the magenta highlight rect (`container.querySelector('rect[fill="#ff00ff"]')`), since there is no more popover/dialog anywhere in the app.

Full replacement for `'shows a translucent magenta band tight around the selected values once the drag resolves'`:

```tsx
  it('shows a translucent magenta band tight around the selected values once the drag resolves', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot editable />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    await waitFor(() => expect(container.querySelector('rect[fill="#ff00ff"]')).toBeInTheDocument())

    const band = container.querySelector('rect[fill="#ff00ff"]')
    expect(band).toBeInTheDocument()
    expect(band?.getAttribute('opacity')).toBe('0.15')
    expect(Number(band?.getAttribute('x'))).toBeCloseTo(pxForIndex(4, 18), 1)
    expect(Number(band?.getAttribute('width'))).toBeCloseTo(pxForIndex(14, 18) - pxForIndex(4, 18), 1)
    expect(Number(band?.getAttribute('height'))).toBeLessThan(138)
  })
```

Note the `getFileMetadata` mock from the original version is dropped — it was only ever incidental (SvgPlot's metadata fetch failure is silently caught, `.catch(() => {})`) and had nothing to do with the magenta band; removing it shortens the test without changing what it verifies.

Apply the same three changes (provider wrap + role setup, drop `getFileMetadata` mock, `dialog` → `rect[fill="#ff00ff"]`) to `'clamps the highlight band to the plot area when padding would push it past the edge'` and `'shows the magenta band live while dragging, before the selection resolves, replacing the old blue rubber-band'` — both already assert on `rect[fill="#ff00ff"]` for their core logic, so only the provider wrap/role setup/dropped-mock changes apply, no assertion rewrite needed there.

For `'editable plain-drag shorter than the minimum drag distance is ignored'`, replace the final assertion and provider wrap:

```tsx
  it('editable plain-drag shorter than the minimum drag distance is ignored', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot editable />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 202 })
    fireEvent.mouseUp(window, { clientX: 202 })

    expect(container.querySelector('rect[fill="#ff00ff"]')).not.toBeInTheDocument()
  })
```

For `'flipping editable to false mid-drag does not open the flag toolbar on mouseup'`, rename it to `'flipping editable to false mid-drag does not leave a flag selection on mouseup'`, drop the `onFlagged={() => {}}` occurrence inside the local `Wrapper` component's `<SvgPlot editable={editable} onFlagged={() => {}} />` (becomes `<SvgPlot editable={editable} />`), wrap providers, and swap the final assertion:

```tsx
  it('flipping editable to false mid-drag does not leave a flag selection on mouseup', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    function Wrapper() {
      const [editable, setEditable] = useState(true)
      return (
        <>
          <button data-testid="toggle-editable" onClick={() => setEditable(false)}>
            toggle
          </button>
          <SvgPlot editable={editable} />
        </>
      )
    }

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <Wrapper />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })

    fireEvent.click(screen.getByTestId('toggle-editable'))

    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    expect(container.querySelector('rect[fill="#ff00ff"]')).not.toBeInTheDocument()
  })
```

For `'ctrl+drag with editable=true zooms the Y-axis and does not also open the flag toolbar'`, rename to `'ctrl+drag with editable=true zooms the Y-axis and does not also start a flag selection'`, drop `onFlagged={() => {}}`, wrap providers, swap the assertion:

```tsx
  it('ctrl+drag with editable=true zooms the Y-axis and does not also start a flag selection', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot editable />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    const ticksOf = () => Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)
    expect(ticksOf()).toEqual(expect.arrayContaining(['0', '5', '10', '15', '20']))

    fireEvent.mouseDown(svg, { clientY: 60, ctrlKey: true })
    fireEvent.mouseMove(window, { clientY: 130 })
    fireEvent.mouseUp(window, { clientY: 130 })

    expect(ticksOf()).not.toEqual(expect.arrayContaining(['0', '5', '10', '15', '20']))
    expect(container.querySelector('rect[fill="#ff00ff"]')).not.toBeInTheDocument()
  })
```

- [ ] **Step 4: Delete the three fully-obsolete popover tests**

Delete these three tests entirely from `client/src/__tests__/SvgPlot.test.tsx` (their behavior either no longer exists — the popover — or is re-covered by `FlagsPanel.test.tsx`/new tests added in Step 5 below):

- `'plain drag does not open the flag toolbar when not editable'` — replaced by a new test in Step 5.
- `'editable plain-drag opens the flag toolbar with codes from file metadata'` — codes are no longer metadata-driven (covered by `FlagsPanel.test.tsx`'s `'renders all 26 flag code buttons'`); the "resolves a selection with the right rangeLabel" part is replaced by a new test in Step 5.
- `'cancelling the flag toolbar clears the selection'` — the Cancel button was `FlagToolbar`'s; equivalent "Clear selection" coverage is in `FlagsPanel.test.tsx`.
- `'applying a flag refetches the variable data and calls onFlagged'` — the apply/poll chain is now `FlagsPanel`'s (covered there); the "refetches variable data" part is replaced by a new test in Step 5.

- [ ] **Step 5: Add three new tests replacing the deleted ones' unique coverage**

Add these after the (renamed) `'ctrl+drag with editable=true zooms the Y-axis and does not also start a flag selection'` test, before `'draws a colored marker...'`:

```tsx
  it('plain drag does not start a flag selection when not editable', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    expect(container.querySelector('rect[fill="#ff00ff"]')).not.toBeInTheDocument()
  })

  it('a resolved drag sets flagSelection in context with the correct rangeLabel', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    function SelectionReadout() {
      const { flagSelection } = useEditSession()
      return (
        <span data-testid="selection-readout">
          {flagSelection
            ? `${flagSelection.varName}:${flagSelection.startIdx}-${flagSelection.endIdx}:${flagSelection.rangeLabel}`
            : 'none'}
        </span>
      )
    }

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SelectionReadout />
              <SvgPlot editable />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    expect(screen.getByTestId('selection-readout')).toHaveTextContent(
      'temperature:4-14:04:00:00–14:00:00'
    )
  })

  it('refetches variable data when flagAppliedAt increments', async () => {
    const time = hourlyTimes(18)
    const getVariableDataSpy = vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    function NotifyButton() {
      const { notifyFlagged } = useEditSession()
      return <button onClick={() => notifyFlagged()}>notify flagged</button>
    }

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <NotifyButton />
              <SvgPlot />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())
    expect(getVariableDataSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('notify flagged'))

    await waitFor(() => expect(getVariableDataSpy).toHaveBeenCalledTimes(2))
  })
```

- [ ] **Step 6: Rewrite the legend test to use the shared `FLAG_CODES` constant**

Replace `'shows a legend entry for a non-dominant flag code present in the row'`:

```tsx
  it('shows a legend entry for a non-dominant flag code present in the row', async () => {
    const time = hourlyTimes(18)
    const flags = time.map((_, i) => (i === 5 ? 'K' : 'Z'))
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const kDescription = FLAG_CODES.find((f) => f.code === 'K')!.description
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`K — ${kDescription}`))).toBeInTheDocument()
    )
  })
```

Add the import at the top of the file alongside the other imports:

```tsx
import { FLAG_CODES } from '../constants/flagCodes'
```

Delete the now-unused `getFileMetadata` mock from this test (the legend no longer reads file metadata for descriptions) — the full test body above already omits it.

- [ ] **Step 7: Update `SvgPlot.tsx` itself**

Now make the component match what the rewritten tests expect. In `client/src/components/SvgPlot.tsx`:

Remove the `FlagToolbar` import (line 5):

```tsx
import { FlagToolbar } from './FlagToolbar'
```

Add the `EditSessionContext` and `FLAG_CODES` imports in its place:

```tsx
import { useEditSession } from '../context/EditSessionContext'
import { FLAG_CODES } from '../constants/flagCodes'
```

Remove the local `FlagSelection` interface and `FlagCode` interface (currently ~lines 496-506):

```tsx
interface FlagSelection {
  varName: string
  startIdx: number
  endIdx: number
  anchorPx: number
}

interface FlagCode {
  code: string
  description: string
}
```

(`FlagDragStart` just above stays — unrelated, still local to the live-drag gesture.)

In the component body, remove the local `flagSelection` state declaration:

```tsx
  const [flagSelection, setFlagSelection] = useState<FlagSelection | null>(null)
```

and destructure it from context instead, right after the existing `usePlotSelection()` call:

```tsx
  const { file, variables } = usePlotSelection()
  const { flagSelection, setFlagSelection, flagAppliedAt } = useEditSession()
```

Remove `setFlagSelection(null)` from the existing `[file, variables]` reset effect (that reset now lives inside `EditSessionContext` itself):

```tsx
  useEffect(() => {
    setXRange(null)
    setYOverrides({})
    undoStackRef.current = []
    redoStackRef.current = []
    setFlagSelection(null)
  }, [file, variables])
```

becomes:

```tsx
  useEffect(() => {
    setXRange(null)
    setYOverrides({})
    undoStackRef.current = []
    redoStackRef.current = []
  }, [file, variables])
```

Add a new effect (right after the primary `getVariableData` fetch effect) that refetches on `flagAppliedAt`:

```tsx
  // A flag was just applied (from FlagsPanel, via context) — refetch so the
  // plot reflects it. Guarded on `flagAppliedAt === 0` (its initial value)
  // so this doesn't double-fetch alongside the effect above on mount.
  useEffect(() => {
    if (flagAppliedAt === 0) return
    if (!file || variables.length === 0) return
    let cancelled = false
    getVariableData(file, variables).then((result) => {
      if (!cancelled) setData(result)
    })
    return () => {
      cancelled = true
    }
  }, [flagAppliedAt])
```

In the mouseup handler for the plain-drag gesture (inside the `useEffect(() => { if (!flagDrag) return ...`, currently building `{ varName, startIdx: selStart, endIdx: selEnd, anchorPx: ... }`), replace the `setFlagSelection` call:

```tsx
      setFlagSelection({
        varName: start.varName,
        startIdx: selStart,
        endIdx: selEnd,
        anchorPx: (Math.min(start.startPx, currentPx) + Math.max(start.startPx, currentPx)) / 2,
      })
```

becomes:

```tsx
      setFlagSelection({
        varName: start.varName,
        startIdx: selStart,
        endIdx: selEnd,
        rangeLabel: `${data.time[selStart].slice(11, 19)}–${data.time[selEnd].slice(11, 19)}`,
      })
```

Remove the `refetchData` local function and the `flagVar`/`flagAttrs`/`flagCodes` block (both currently sit between the `titlePrefix` line and `handleRowMouseDown`):

```tsx
  const refetchData = () => {
    if (!file || variables.length === 0) return
    getVariableData(file, variables).then(setData)
  }

  const flagVar = metadata?.variables.flag
  const flagAttrs = flagVar?.attrs
  const flagCodes: FlagCode[] = flagAttrs
    ? Object.entries(flagAttrs)
        .filter(([key]) => /^[A-Z]$/.test(key))
        .map(([code, description]) => ({ code, description: String(description) }))
    : []
```

Delete this whole block — nothing references `refetchData`, `flagVar`, `flagAttrs`, or the local `flagCodes` after this task.

Update the legend's description lookup (currently `flagCodes.find((f) => f.code === code)?.description ?? code`, inside the `flagMarkers.legendCodes.map(...)` block) to use the imported `FLAG_CODES` constant instead:

```tsx
                        `● ${code} — ${flagCodes.find((f) => f.code === code)?.description ?? code}`
```

becomes:

```tsx
                        `● ${code} — ${FLAG_CODES.find((f) => f.code === code)?.description ?? code}`
```

Remove the whole `{flagSelection && flagSelection.varName === varName && (<div style={{...}}><FlagToolbar .../></div>)}` JSX block (currently the last thing before the row's closing `</div>`, right after the `</svg>` close tag) — nothing replaces it in `SvgPlot`'s own JSX; the code-picker UI now lives entirely in `FlagsPanel`.

Update the component's prop signature to drop `onFlagged`:

```tsx
export function SvgPlot({
  editable = false,
  onFlagged,
}: {
  editable?: boolean
  onFlagged?: () => void
} = {}) {
```

becomes:

```tsx
export function SvgPlot({
  editable = false,
}: {
  editable?: boolean
} = {}) {
```

- [ ] **Step 8: Run the full `SvgPlot` suite**

Run: `cd client && npm test -- SvgPlot`
Expected: PASS — all kept/modified tests plus the three new ones (net test count: 35 original − 4 deleted + 3 added = 34).

- [ ] **Step 9: Mark task complete**

---

### Task 7: `FilesPage.tsx` — source session state from context

**Files:**
- Modify: `client/src/pages/FilesPage.tsx`
- Modify: `client/src/__tests__/FilesPage.test.tsx`

- [ ] **Step 1: Update `FilesPage.test.tsx`'s render helpers**

`FilesPage` will now call `useEditSession()` unconditionally, so both render helpers need `EditSessionProvider` added. Replace the full contents of `client/src/__tests__/FilesPage.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilesPage } from '../pages/FilesPage'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { EditSessionProvider, useEditSession } from '../context/EditSessionContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

function SetFile({ file }: { file: string }) {
  const sel = usePlotSelection()
  return (
    <button data-testid="set-file" onClick={() => sel.setFile(file)}>
      set file
    </button>
  )
}

function renderFilesPage(role: string = 'qca') {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <FilesPage />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

function renderFilesPageWithFile(role: string, file: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
  localStorage.setItem('svidat_username', 'testuser')
  const utils = render(
    <AuthProvider>
      <MemoryRouter>
        <PlotSelectionProvider>
          <EditSessionProvider>
            <SetFile file={file} />
            <FilesPage />
          </EditSessionProvider>
        </PlotSelectionProvider>
      </MemoryRouter>
    </AuthProvider>
  )
  fireEvent.click(screen.getByTestId('set-file'))
  return utils
}

describe('FilesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the empty state before any variables are selected', () => {
    renderFilesPage()
    expect(
      screen.getByText('Select variables in the sidebar to view plots.')
    ).toBeInTheDocument()
  })

  it('shows the Open for editing button for qca once a file is selected', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {},
      dimensions: {},
      global_attrs: {},
    })
    renderFilesPageWithFile('qca', 'FILE_A')
    await waitFor(() => expect(screen.getByText('Open for editing')).toBeInTheDocument())
  })

  it('hides the Open for editing button for user role', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {},
      dimensions: {},
      global_attrs: {},
    })
    renderFilesPageWithFile('user', 'FILE_A')
    await waitFor(() => expect(apiClient.getFileMetadata).toHaveBeenCalledWith('FILE_A'))
    expect(screen.queryByText('Open for editing')).not.toBeInTheDocument()
  })

  it('opens a session and shows the edit form and audit panel', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { temperature: { dims: ['time'], shape: [10], dtype: 'f4', attrs: {} } },
      dimensions: {},
      global_attrs: {},
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([])

    renderFilesPageWithFile('qca', 'FILE_A')
    await waitFor(() => expect(screen.getByText('Open for editing')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Open for editing'))

    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Audit history')).toBeInTheDocument()
  })

  it('closes a session and hides the edit form again', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { temperature: { dims: ['time'], shape: [10], dtype: 'f4', attrs: {} } },
      dimensions: {},
      global_attrs: {},
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([])

    renderFilesPageWithFile('qca', 'FILE_A')
    await waitFor(() => expect(screen.getByText('Open for editing')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Open for editing'))
    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Close session'))
    await waitFor(() => expect(screen.getByText('Open for editing')).toBeInTheDocument())
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })

  it('bumps the audit panel refresh signal when flagAppliedAt increments', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { temperature: { dims: ['time'], shape: [10], dtype: 'f4', attrs: {} } },
      dimensions: {},
      global_attrs: {},
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    const getAuditHistorySpy = vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([])

    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    function NotifyButton() {
      const { notifyFlagged } = useEditSession()
      return <button onClick={() => notifyFlagged()}>notify flagged</button>
    }

    render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <SetFile file="FILE_A" />
              <NotifyButton />
              <FilesPage />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    await waitFor(() => expect(screen.getByText('Open for editing')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Open for editing'))
    await waitFor(() => expect(screen.getByText('Audit history')).toBeInTheDocument())
    await waitFor(() => expect(getAuditHistorySpy).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('notify flagged'))

    await waitFor(() => expect(getAuditHistorySpy).toHaveBeenCalledTimes(2))
  })
})
```

This test renders its own tree directly (instead of using `renderFilesPageWithFile`) since it needs to insert `NotifyButton` into the provider stack alongside `FilesPage` and `SetFile` — it does its own `localStorage`/`setToken`/role setup rather than reusing the helper, matching the pattern the other manually-rendered tests in this plan already use.

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `cd client && npm test -- FilesPage`
Expected: FAIL on the new `'bumps the audit panel refresh signal...'` test (`getAuditHistorySpy` only called once — `FilesPage` doesn't react to `flagAppliedAt` yet); the other five tests still PASS unchanged.

- [ ] **Step 3: Update `FilesPage.tsx`**

Replace the full contents of `client/src/pages/FilesPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { getFileMetadata } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useEditSession } from '../context/EditSessionContext'
import { SvgPlot } from '../components/SvgPlot'
import { EditForm } from '../components/EditForm'
import { AuditPanel } from '../components/AuditPanel'
import type { FileMetadata } from '../api/types'

export function FilesPage() {
  const { file } = usePlotSelection()
  const { sessionOpen, canEdit, editable, sessionError, openSession, closeSession, flagAppliedAt } =
    useEditSession()
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [auditRefreshKey, setAuditRefreshKey] = useState(0)

  useEffect(() => {
    if (!file) {
      setMetadata(null)
      return
    }
    let cancelled = false
    getFileMetadata(file).then((result) => {
      if (!cancelled) setMetadata(result)
    })
    return () => {
      cancelled = true
    }
  }, [file])

  useEffect(() => {
    if (flagAppliedAt === 0) return
    setAuditRefreshKey((k) => k + 1)
  }, [flagAppliedAt])

  return (
    <div>
      {file && canEdit && (
        <div>
          {!sessionOpen && <button onClick={openSession}>Open for editing</button>}
          {sessionOpen && <button onClick={closeSession}>Close session</button>}
          {sessionError && <p role="alert">{sessionError}</p>}
        </div>
      )}
      <SvgPlot editable={editable} />
      {sessionOpen && metadata && (
        <>
          <EditForm
            filename={file}
            variables={Object.keys(metadata.variables)}
            onChanged={() => setAuditRefreshKey((k) => k + 1)}
          />
          <AuditPanel filename={file} refreshSignal={auditRefreshKey} />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test -- FilesPage`
Expected: PASS (6 tests).

- [ ] **Step 5: Mark task complete**

---

### Task 8: Delete `FlagToolbar` and final verification

**Files:**
- Delete: `client/src/components/FlagToolbar.tsx`
- Delete: `client/src/__tests__/FlagToolbar.test.tsx`

- [ ] **Step 1: Confirm nothing still imports `FlagToolbar`**

Run: `cd client && grep -rn "FlagToolbar" src/`
Expected: no output (Task 6, Step 7 already removed `SvgPlot.tsx`'s import and usage).

- [ ] **Step 2: Delete the files**

```bash
rm client/src/components/FlagToolbar.tsx
rm client/src/__tests__/FlagToolbar.test.tsx
```

- [ ] **Step 3: Run the full client test suite**

Run: `cd client && npm test`
Expected: all PASS.

- [ ] **Step 4: Run typecheck**

Run: `cd client && npx tsc -b`
Expected: no errors (in particular: no leftover references to the deleted `FlagCode`/`FlagSelection` local interfaces, `refetchData`, or `onFlagged`).

- [ ] **Step 5: Run lint**

Run: `cd client && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 6: Mark task complete**

---

## Final verification

- [ ] `cd client && npm test` — all PASS.
- [ ] `cd client && npx tsc -b` — clean.
- [ ] `cd client && npm run lint` — clean.
- [ ] Manually confirm (by reading the final `Sidebar.tsx`) that `location.pathname === '/files'` still gates the whole tab block, matching the original `PlotPicker`-only gating.
