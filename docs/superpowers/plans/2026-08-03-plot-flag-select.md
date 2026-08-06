# Plot Drag-to-Flag Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a qca/admin user plain-drag a box on `SvgPlot` to select a range of points on one variable, pick a flag code from a popover, and apply it via the existing `/edit/flag` job — with previously-flagged points shown as colored markers on the chart. Merge `FilesPage`/`DataViewerPage` into one page so the chart, edit session, manual edit form, and audit log all live together.

**Architecture:** `SvgPlot` gains a third drag gesture (plain mousedown+drag, no modifier) alongside its existing shift-drag/ctrl-drag zoom gestures, armed only when a new `editable` prop is true. On mouseup past the drag threshold it opens a new `FlagToolbar` popover (a small new component) anchored under the drag box; picking a code calls the already-implemented `applyFlag`/`jobStatus` API, and on success `SvgPlot` refetches its data and calls an `onFlagged` callback. Flagged points render as colored circles (mode flag code per row = normal, everything else gets a marker), computed by a new pure helper inside `SvgPlot.tsx`. `FilesPage` absorbs `DataViewerPage`'s session-open/close + `EditForm` + `AuditPanel`, `DataViewerPage.tsx` and its route are deleted, and `ProfilePage`'s draft-file link is fixed to point at the surviving route.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, react-router-dom v7. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-03-plot-flag-select-design.md`

Note on git: this working directory is not currently a git repository (earlier
plans here had commit steps; that repo state is gone). Per user direction,
this plan has no `git add`/`git commit` steps — just implement, test, verify,
move to the next task.

---

## Reference: current file state

**`src/components/SvgPlot.tsx`** (812 lines) — the interactive chart. Relevant
existing pieces this plan touches:

- Line 27: `const ZOOM_BOX_FILL = 'rgba(37, 99, 235, 0.15)'` — reused as-is for
  the new flag-drag box (same visual as the zoom boxes, per spec).
- Lines 91–104: `buildPath` — last existing helper before this plan's new
  `buildFlagMarkers` helper is inserted after it.
- Lines 302–312: `YDragStart` interface + the comment above `ViewSnapshot` —
  this plan's new `FlagDragStart` interface goes here, same shape/pattern.
- Line 322: `export function SvgPlot() {` — gains `editable`/`onFlagged` props.
- Lines 340–343: `xDragStartRef`, `yDragStartRef`, `undoStackRef`,
  `redoStackRef` — this plan adds `flagDragStartRef` alongside, plus
  `flagDrag`/`flagSelection` state near the other `useState` calls above.
- Lines 384–389: the effect that resets `xRange`/`yOverrides`/undo-redo
  stacks when `file`/`variables` change — extended to also clear
  `flagSelection`.
- Lines 451–487: the `xDrag` mousemove/mouseup effect (shift-drag). This
  plan's new flag-drag effect is modeled on this one and sits right after the
  `yDrag` effect (line 536).
- Lines 538–541: early returns for no-file/no-data.
- Line 543: `const [startIdx, endIdx] = xRange ?? [0, data.time.length - 1]`.
- Lines 549–570: `handleRowMouseDown` — currently branches on `e.shiftKey`
  then `e.ctrlKey`; this plan adds a third branch for `editable` with neither
  held.
- Lines 612–812: the row-rendering `.map()`. Line 617 computes `scale`; this
  plan adds a `flagMarkers` computation right after it. Lines 774–805 are the
  clipped `<g>` containing the line path and the existing xDrag/yDrag zoom-box
  rects — this plan adds the flag-drag box and marker circles there. Line 807
  closes the row `<div>` — this plan adds the `FlagToolbar` popover right
  before it and a `position: relative` inline style on that `<div>` (line
  633) so the popover can anchor to it.

**`src/api/client.ts`** — `applyFlag` (lines 144–160) and `jobStatus` (line
85–86) already exist and are already unused by any component; no changes
needed here. Same for the `flags: string[] | null` field on `VariableSeries`
(`src/api/types.ts:48–51`) and `FileMetadata.variables[name].attrs:
Record<string, unknown>` (`src/api/types.ts:9–14`), which is where the file's
flag-code definitions live (e.g. `{ Z: "Good data", K: "Suspect - visual" }`
on the `flag` variable's own attrs).

**`src/pages/FilesPage.tsx`** (current, full file):

```tsx
import { SvgPlot } from '../components/SvgPlot'

export function FilesPage() {
  return (
    <div>
      <SvgPlot />
    </div>
  )
}
```

**`src/pages/DataViewerPage.tsx`** (current, full file — being deleted, logic
absorbed into `FilesPage.tsx`):

```tsx
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { closeSession, getFileMetadata, openSession } from '../api/client'
import type { FileMetadata } from '../api/types'
import { EditForm } from '../components/EditForm'
import { AuditPanel } from '../components/AuditPanel'

export function DataViewerPage() {
  const { filename } = useParams<{ filename: string }>()
  const [searchParams] = useSearchParams()
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auditRefreshKey, setAuditRefreshKey] = useState(0)

  useEffect(() => {
    if (!filename) return
    getFileMetadata(filename).then(setMetadata)
  }, [filename])

  const handleOpenSession = async () => {
    if (!filename) return
    setError(null)
    try {
      const source = searchParams.get('source') ?? 'raw'
      await openSession(filename, source)
      setSessionOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to open session')
    }
  }

  const handleCloseSession = async () => {
    if (!filename) return
    setError(null)
    try {
      await closeSession(filename)
      setSessionOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to close session')
    }
  }

  if (!filename) return null

  return (
    <div>
      <h1>{filename}</h1>
      {!sessionOpen && <button onClick={handleOpenSession}>Open for editing</button>}
      {sessionOpen && <button onClick={handleCloseSession}>Close session</button>}
      {error && <p role="alert">{error}</p>}
      {metadata && (
        <table>
          {/* ... variable list table, dropped in the merge — the chart plus
              EditForm's own variable dropdown supersede it, per the design
              doc's page composition (no table listed there) ... */}
        </table>
      )}
      {sessionOpen && metadata && (
        <>
          <EditForm
            filename={filename}
            variables={Object.keys(metadata.variables)}
            onChanged={() => setAuditRefreshKey((k) => k + 1)}
          />
          <AuditPanel filename={filename} refreshSignal={auditRefreshKey} />
        </>
      )}
    </div>
  )
}
```

**`src/App.tsx`** (current, full file) — the `/files/:filename` route (lines
24–31) and the `DataViewerPage` import (line 6) are removed:

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { FilesPage } from './pages/FilesPage'
import { DataViewerPage } from './pages/DataViewerPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { ProfilePage } from './pages/ProfilePage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/files"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <FilesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/files/:filename"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <DataViewerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/files" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
```

**`src/pages/ProfilePage.tsx`** — the draft-file link at lines 74/77 currently
reads `` `/files/${encodeURIComponent(f)}?source=draft` `` (the path-param
route being deleted, and not actually wired to any chart/session UI even
today). Fixed to the query-param scheme `PlotSelectionContext` already uses.

**`src/context/PlotSelectionContext.tsx`** and **`src/components/PlotPicker.tsx`**
are unchanged by this plan — file/variable selection stays exactly as today
(`?ship=&year=&file=&vars=` query params, `PlotPicker` in `Sidebar`, shown
only on `/files`).

**Test conventions already established** (from `src/__tests__/SvgPlot.test.tsx`,
`src/__tests__/EditForm.test.tsx`, `src/__tests__/FilesPage.test.tsx`):
`vi.spyOn(apiClient, 'fnName')` per test, `vi.restoreAllMocks()` in
`beforeEach`, `hourlyTimes(n)` / `pxForIndex(idx, lastIdx)` helpers already in
`SvgPlot.test.tsx` for building synthetic time series and pixel coordinates,
a `Setup` component in that file that renders `set-file`/`set-variables`
buttons wired to `usePlotSelection()` for driving selection in tests. No test
in this codebase currently exercises a job-polling loop (`bulkEdit`'s is
untested) — this plan establishes that pattern for the first time in
`FlagToolbar.test.tsx`, using real timers with a generous `waitFor` timeout
rather than fake timers.

---

### Task 1: `FlagToolbar` component

**Files:**
- Create: `src/components/FlagToolbar.tsx`
- Test: `src/__tests__/FlagToolbar.test.tsx`

Self-contained popover: shows the selected point count, one button per flag
code, a Cancel button, applies a flag via `applyFlag` + polls `jobStatus`
(same 300ms/30s poll shape `EditForm`'s bulk-edit already uses), reports
success/failure to its parent via callbacks. No dependency on `SvgPlot` — built
and tested standalone first.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/FlagToolbar.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FlagToolbar } from '../components/FlagToolbar'
import * as apiClient from '../api/client'

const flagCodes = [
  { code: 'Z', description: 'Good data' },
  { code: 'K', description: 'Suspect - visual' },
]

function renderToolbar(overrides: Partial<Parameters<typeof FlagToolbar>[0]> = {}) {
  const onApplied = vi.fn()
  const onCancel = vi.fn()
  const utils = render(
    <FlagToolbar
      filename="FILE_A"
      varName="temperature"
      startIdx={4}
      endIdx={14}
      rangeLabel="04:00:00–14:00:00"
      flagCodes={flagCodes}
      onApplied={onApplied}
      onCancel={onCancel}
      {...overrides}
    />
  )
  return { ...utils, onApplied, onCancel }
}

describe('FlagToolbar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the range, point count, and one button per flag code', () => {
    renderToolbar()
    expect(screen.getByText('04:00:00–14:00:00 — 11 points selected')).toBeInTheDocument()
    expect(screen.getByText('Z — Good data')).toBeInTheDocument()
    expect(screen.getByText('K — Suspect - visual')).toBeInTheDocument()
  })

  it('calls onCancel when Cancel is clicked', () => {
    const { onCancel } = renderToolbar()
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel on Escape', () => {
    const { onCancel } = renderToolbar()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when clicking outside the toolbar', () => {
    const { onCancel } = renderToolbar()
    fireEvent.mouseDown(document.body)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel when clicking inside the toolbar', () => {
    const { onCancel } = renderToolbar()
    fireEvent.mouseDown(screen.getByText('Z — Good data'))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('applies a flag code, polls the job, and calls onApplied when done', async () => {
    const applyFlagSpy = vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-1' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'done',
      error: null,
      result: { audit_id: 1 },
    })
    const { onApplied } = renderToolbar()

    fireEvent.click(screen.getByText('K — Suspect - visual'))

    await waitFor(() =>
      expect(applyFlagSpy).toHaveBeenCalledWith('FILE_A', 'temperature', 4, 14, 'K')
    )
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1), { timeout: 2000 })
  })

  it('shows an inline error and keeps the selection when the job fails', async () => {
    vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-2' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'failed',
      error: 'invalid flag_code',
      result: null,
    })
    const { onApplied } = renderToolbar()

    fireEvent.click(screen.getByText('K — Suspect - visual'))

    await waitFor(
      () => expect(screen.getByText('Error: invalid flag_code')).toBeInTheDocument(),
      { timeout: 2000 }
    )
    expect(onApplied).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests, confirm they fail with "Cannot find module"**

Run: `npm test -- src/__tests__/FlagToolbar.test.tsx`
Expected: FAIL — `Cannot find module '../components/FlagToolbar'`

- [ ] **Step 3: Implement `FlagToolbar`**

Create `src/components/FlagToolbar.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { applyFlag, jobStatus } from '../api/client'

const FLAG_POLL_INTERVAL_MS = 300
const FLAG_POLL_TIMEOUT_MS = 30000

export function FlagToolbar({
  filename,
  varName,
  startIdx,
  endIdx,
  rangeLabel,
  flagCodes,
  onApplied,
  onCancel,
}: {
  filename: string
  varName: string
  startIdx: number
  endIdx: number
  rangeLabel: string
  flagCodes: { code: string; description: string }[]
  onApplied: () => void
  onCancel: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  // "Clicking outside the popover cancels" (per spec) — a native listener
  // on `document` rather than the row's React `onClick` because the
  // popover can be dismissed by a click anywhere on the page, not just
  // inside this row.
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onCancel])

  const handleApply = async (code: string) => {
    setSubmitting(true)
    setError(null)
    try {
      const result = await applyFlag(filename, varName, startIdx, endIdx, code)
      const start = Date.now()
      while (Date.now() - start < FLAG_POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, FLAG_POLL_INTERVAL_MS))
        if (!isMountedRef.current) return
        const jobResult = await jobStatus(result.job_id)
        if (!isMountedRef.current) return
        if (jobResult.status === 'done') {
          onApplied()
          return
        }
        if (jobResult.status === 'failed') {
          setError(jobResult.error ?? 'flag apply failed')
          setSubmitting(false)
          return
        }
      }
      setError('flag apply still running — try again later')
      setSubmitting(false)
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : String(err))
        setSubmitting(false)
      }
    }
  }

  const pointCount = endIdx - startIdx + 1

  return (
    <div className="plot-flag-toolbar" role="dialog" aria-label="Apply flag" ref={containerRef}>
      <span className="label">
        {rangeLabel} — {pointCount} points selected
      </span>
      {flagCodes.map(({ code, description }) => (
        <button key={code} onClick={() => handleApply(code)} disabled={submitting}>
          {code} — {description}
        </button>
      ))}
      <button onClick={onCancel} disabled={submitting}>
        Cancel
      </button>
      {error && <p role="status">Error: {error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm test -- src/__tests__/FlagToolbar.test.tsx`
Expected: PASS (5 tests)

---

### Task 2: Wire the flag-drag gesture into `SvgPlot`

**Files:**
- Modify: `src/components/SvgPlot.tsx`
- Test: `src/__tests__/SvgPlot.test.tsx`

Adds the `editable`/`onFlagged` props, the plain-drag gesture, and renders
`FlagToolbar` on selection. No marker rendering yet (Task 3).

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/SvgPlot.test.tsx` (inside the existing `describe('SvgPlot', ...)` block, after the last test):

```tsx
  it('plain drag does not open the flag toolbar when not editable', async () => {
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

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('editable plain-drag opens the flag toolbar with codes from file metadata', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: {
          dims: ['time', 'f_string'],
          shape: [19, 2],
          dtype: 'S1',
          attrs: { long_name: 'quality control flags', Z: 'Good data', K: 'Suspect - visual' },
        },
      },
      dimensions: {},
      global_attrs: {},
    })

    const { container } = render(
      <MemoryRouter>
        <PlotSelectionProvider>
          <Setup file="FILE_A" variables={['temperature']} />
          <SvgPlot editable onFlagged={() => {}} />
        </PlotSelectionProvider>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    await waitFor(() => expect(screen.getByText('Z — Good data')).toBeInTheDocument())
    expect(screen.getByText('K — Suspect - visual')).toBeInTheDocument()
    expect(screen.getByText('04:00:00–14:00:00 — 11 points selected')).toBeInTheDocument()
  })

  it('editable plain-drag shorter than the minimum drag distance is ignored', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { flag: { dims: [], shape: [], dtype: 'S1', attrs: { Z: 'Good data' } } },
      dimensions: {},
      global_attrs: {},
    })

    const { container } = render(
      <MemoryRouter>
        <PlotSelectionProvider>
          <Setup file="FILE_A" variables={['temperature']} />
          <SvgPlot editable onFlagged={() => {}} />
        </PlotSelectionProvider>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 202 })
    fireEvent.mouseUp(window, { clientX: 202 })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelling the flag toolbar clears the selection', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { flag: { dims: [], shape: [], dtype: 'S1', attrs: { Z: 'Good data' } } },
      dimensions: {},
      global_attrs: {},
    })

    const { container } = render(
      <MemoryRouter>
        <PlotSelectionProvider>
          <Setup file="FILE_A" variables={['temperature']} />
          <SvgPlot editable onFlagged={() => {}} />
        </PlotSelectionProvider>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('applying a flag refetches the variable data and calls onFlagged', async () => {
    const time = hourlyTimes(18)
    const getVariableDataSpy = vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: [], shape: [], dtype: 'S1', attrs: { Z: 'Good data', K: 'Suspect - visual' } },
      },
      dimensions: {},
      global_attrs: {},
    })
    vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-1' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'done',
      error: null,
      result: { audit_id: 1 },
    })
    const onFlagged = vi.fn()

    const { container } = render(
      <MemoryRouter>
        <PlotSelectionProvider>
          <Setup file="FILE_A" variables={['temperature']} />
          <SvgPlot editable onFlagged={onFlagged} />
        </PlotSelectionProvider>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByTestId('set-variables'))
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    await waitFor(() => expect(screen.getByText('K — Suspect - visual')).toBeInTheDocument())

    fireEvent.click(screen.getByText('K — Suspect - visual'))

    await waitFor(() => expect(onFlagged).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(getVariableDataSpy).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test -- src/__tests__/SvgPlot.test.tsx`
Expected: FAIL — `editable`/`onFlagged` don't exist on `SvgPlot`'s props, no
`role="dialog"` ever renders.

- [ ] **Step 3: Implement the gesture in `SvgPlot.tsx`**

Add the import, right after the existing imports at the top of the file:

```tsx
import { FlagToolbar } from './FlagToolbar'
```

Add a new color constant next to `ZOOM_BOX_FILL` (line 27):

```tsx
const ZOOM_BOX_FILL = 'rgba(37, 99, 235, 0.15)'
const FLAG_MARKER_COLORS = [
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
  '#7c3aed',
  '#db2777',
  '#4b5563',
]
```

(`FLAG_MARKER_COLORS` isn't used until Task 3, but lives here with the other
color constants.)

Add a `FlagDragStart` interface right after `YDragStart` (after line 312, before the `ViewSnapshot` type comment):

```tsx
// Same idea for one plain-drag (flag-select) gesture — no modifier key,
// only armed when `editable` is true. `varName`/`startIdx`/`endIdx` are
// captured at mousedown (mirroring XDragStart) so mouseup can turn the
// pixel range back into a data-index range without depending on
// render-time closures.
interface FlagDragStart {
  originLeft: number
  startPx: number
  varName: string
  startIdx: number
  endIdx: number
}

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

Change the component signature (line 322) to accept props, with a default so
existing no-prop usages (`<SvgPlot />`) keep working:

```tsx
export function SvgPlot({
  editable = false,
  onFlagged,
}: {
  editable?: boolean
  onFlagged?: () => void
} = {}) {
```

Add new refs/state next to the existing ones (after line 343,
`const redoStackRef = useRef<ViewSnapshot[]>([])`):

```tsx
  const flagDragStartRef = useRef<FlagDragStart | null>(null)
  const [flagDrag, setFlagDrag] = useState<{
    varName: string
    startPx: number
    currentPx: number
  } | null>(null)
  const [flagSelection, setFlagSelection] = useState<FlagSelection | null>(null)
```

Extend the file/variables reset effect (lines 384–389) to also clear
`flagSelection`:

```tsx
  useEffect(() => {
    setXRange(null)
    setYOverrides({})
    undoStackRef.current = []
    redoStackRef.current = []
    setFlagSelection(null)
  }, [file, variables])
```

Add a new effect right after the `yDrag` effect ends (after line 536, before
the `if (!file || variables.length === 0)` early return on line 538):

```tsx
  // Runs for the duration of one plain-drag (flag-select) gesture — same
  // shape as the X/Y-zoom effects above, but opens a flag *selection*
  // (rendered as a FlagToolbar) instead of changing the view.
  useEffect(() => {
    if (!flagDrag) return
    const handleMouseMove = (e: MouseEvent) => {
      const start = flagDragStartRef.current
      if (!start) return
      setFlagDrag({
        varName: start.varName,
        startPx: start.startPx,
        currentPx: e.clientX - start.originLeft,
      })
    }
    const handleMouseUp = (e: MouseEvent) => {
      const start = flagDragStartRef.current
      flagDragStartRef.current = null
      setFlagDrag(null)
      if (!start || !data) return
      const currentPx = e.clientX - start.originLeft
      if (Math.abs(currentPx - start.startPx) < MIN_DRAG_PX) return

      const innerWidth = plotWidth - MARGIN.left - MARGIN.right
      const span = start.endIdx - start.startIdx || 1
      const idxAtPx = (px: number) => {
        const idx = start.startIdx + Math.round(((px - MARGIN.left) / innerWidth) * span)
        return Math.max(0, Math.min(idx, data.time.length - 1))
      }
      const selStart = idxAtPx(Math.min(start.startPx, currentPx))
      const selEnd = idxAtPx(Math.max(start.startPx, currentPx))
      if (selEnd - selStart < 1) return

      setFlagSelection({
        varName: start.varName,
        startIdx: selStart,
        endIdx: selEnd,
        anchorPx: (Math.min(start.startPx, currentPx) + Math.max(start.startPx, currentPx)) / 2,
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagDrag])

  // Clears any open flag selection if editing stops being allowed mid-drag
  // (e.g. the session closes while the popover is open).
  useEffect(() => {
    if (!editable) setFlagSelection(null)
  }, [editable])
```

Add a `refetchData` function and the `flagCodes` derivation right after
`titlePrefix` is computed (after line 547, before `handleRowMouseDown`):

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

Add the flag-drag branch to `handleRowMouseDown` (lines 549–570), as a third
branch after the existing `if (e.ctrlKey)` block:

```tsx
  const handleRowMouseDown = (
    e: ReactMouseEvent<SVGSVGElement>,
    varName: string,
    scaleMin: number,
    scaleMax: number
  ) => {
    if (e.shiftKey) {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientX - rect.left
      xDragStartRef.current = { originLeft: rect.left, startPx, startIdx, endIdx }
      setXDrag({ startPx, currentPx: startPx })
      return
    }
    if (e.ctrlKey) {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientY - rect.top
      yDragStartRef.current = { varName, originTop: rect.top, startPx, scaleMin, scaleMax }
      setYDrag({ varName, startPx, currentPx: startPx })
      return
    }
    if (editable) {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientX - rect.left
      flagDragStartRef.current = { originLeft: rect.left, startPx, varName, startIdx, endIdx }
      setFlagDrag({ varName, startPx, currentPx: startPx })
    }
  }
```

(Only the added `if (editable)` block and the `return` on the `ctrlKey`
branch — needed so a plain click still falls through to the row's own
`onClick` handler for activation, unaffected either way — are new; the
`shiftKey`/`ctrlKey` bodies are unchanged from today.)

Add `position: 'relative'` to the row `<div>` (line 633–651) so the popover
can anchor to it, and render the popover after the `<svg>` closes (before the
row `<div>` closes on line 807):

```tsx
          <div
            key={varName}
            className="svg-plot-row"
            style={{ position: 'relative' }}
            onClick={(e) => {
              if (e.metaKey) {
                undoOnce()
                return
              }
              if (!e.shiftKey && !e.ctrlKey) setActiveVariable(varName)
            }}
            onDoubleClick={(e) => {
              e.preventDefault()
              redoOnce()
            }}
            onContextMenu={handleRowContextMenu}
            role="button"
            tabIndex={0}
            aria-pressed={isActive}
          >
            <svg ...>
              {/* ...unchanged... */}
            </svg>
            {flagSelection && flagSelection.varName === varName && (
              <div
                style={{
                  position: 'absolute',
                  left: flagSelection.anchorPx,
                  top: rowHeight,
                  transform: 'translateX(-50%)',
                  zIndex: 10,
                }}
              >
                <FlagToolbar
                  filename={file}
                  varName={varName}
                  startIdx={flagSelection.startIdx}
                  endIdx={flagSelection.endIdx}
                  rangeLabel={`${data.time[flagSelection.startIdx].slice(11, 19)}–${data.time[
                    flagSelection.endIdx
                  ].slice(11, 19)}`}
                  flagCodes={flagCodes}
                  onApplied={() => {
                    setFlagSelection(null)
                    refetchData()
                    onFlagged?.()
                  }}
                  onCancel={() => setFlagSelection(null)}
                />
              </div>
            )}
          </div>
```

Finally, add the flag-drag overlay rect inside the clipped `<g>` (lines
774–805), right after the existing `yDrag` rect block and before the `</g>`
close:

```tsx
                {yDrag && yDrag.varName === varName && (
                  <rect
                    x={MARGIN.left}
                    y={Math.min(yDrag.startPx, yDrag.currentPx)}
                    width={plotWidth - MARGIN.left - MARGIN.right}
                    height={Math.abs(yDrag.currentPx - yDrag.startPx)}
                    fill={ZOOM_BOX_FILL}
                    stroke={ACTIVE_COLOR}
                    strokeDasharray="4 2"
                  />
                )}

                {flagDrag && flagDrag.varName === varName && (
                  <rect
                    x={Math.min(flagDrag.startPx, flagDrag.currentPx)}
                    y={MARGIN.top}
                    width={Math.abs(flagDrag.currentPx - flagDrag.startPx)}
                    height={rowHeight - MARGIN.top - MARGIN.bottom}
                    fill={ZOOM_BOX_FILL}
                    stroke={ACTIVE_COLOR}
                    strokeDasharray="4 2"
                  />
                )}
              </g>
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm test -- src/__tests__/SvgPlot.test.tsx`
Expected: PASS (all existing tests + the 5 new ones from Step 1)

---

### Task 3: Flag markers and legend

**Files:**
- Modify: `src/components/SvgPlot.tsx`
- Test: `src/__tests__/SvgPlot.test.tsx`

Adds `buildFlagMarkers` (a pure helper: given a row's `flags` and `values`
arrays and the visible `[startIdx, endIdx]` window, returns which points get a
marker and what color) and wires it into rendering, plus a one-line legend.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/SvgPlot.test.tsx`:

```tsx
  it("draws a colored marker for points whose flag differs from the row's dominant flag", async () => {
    const time = hourlyTimes(18)
    const flags = time.map((_, i) => (i === 5 || i === 6 ? 'K' : 'Z'))
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    expect(container.querySelectorAll('circle').length).toBe(2)
  })

  it('draws no markers or legend when every point shares the same flag', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    expect(container.querySelectorAll('circle').length).toBe(0)
  })

  it('shows a legend entry for a non-dominant flag code present in the row', async () => {
    const time = hourlyTimes(18)
    const flags = time.map((_, i) => (i === 5 ? 'K' : 'Z'))
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: [], shape: [], dtype: 'S1', attrs: { Z: 'Good data', K: 'Suspect - visual' } },
      },
      dimensions: {},
      global_attrs: {},
    })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByText(/K — Suspect - visual/)).toBeInTheDocument()
    )
  })
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test -- src/__tests__/SvgPlot.test.tsx`
Expected: FAIL — no `<circle>` elements render, no legend text.

- [ ] **Step 3: Implement `buildFlagMarkers` and wire it into rendering**

Add the helper right after `buildPath` (after line 104), along with the
`FlagMarker` interface:

```tsx
interface FlagMarker {
  idx: number
  code: string
  color: string
}

// A row's flag markers: the mode (most common) flag code is "normal" and
// gets no marker; every other point in [startIdx, endIdx] that has a
// non-null value gets a marker, colored by first-appearance order across
// the row's *full* flags array (not just the visible window) so a color
// stays assigned to the same code as the user zooms in and out.
function buildFlagMarkers(
  flags: string[] | null,
  values: (number | null)[],
  startIdx: number,
  endIdx: number
): { markers: FlagMarker[]; legendCodes: string[] } {
  if (!flags) return { markers: [], legendCodes: [] }

  const counts = new Map<string, number>()
  for (const f of flags) counts.set(f, (counts.get(f) ?? 0) + 1)
  if (counts.size <= 1) return { markers: [], legendCodes: [] }

  let modeCode = ''
  let modeCount = -1
  for (const [code, count] of counts) {
    if (count > modeCount) {
      modeCode = code
      modeCount = count
    }
  }

  const colorForCode = new Map<string, string>()
  const legendCodes: string[] = []
  for (const f of flags) {
    if (f === modeCode) continue
    if (!colorForCode.has(f)) {
      colorForCode.set(f, FLAG_MARKER_COLORS[legendCodes.length % FLAG_MARKER_COLORS.length])
      legendCodes.push(f)
    }
  }

  const markers: FlagMarker[] = []
  for (let i = startIdx; i <= endIdx; i++) {
    const f = flags[i]
    if (f === undefined || f === modeCode) continue
    if (values[i] === null || values[i] === undefined) continue
    markers.push({ idx: i, code: f, color: colorForCode.get(f)! })
  }
  return { markers, legendCodes }
}
```

In the row-rendering `.map()`, right after `scale` is computed (after line
624), compute this row's markers:

```tsx
        const flagMarkers = buildFlagMarkers(series.flags, series.values, startIdx, endIdx)
```

Inside the clipped `<g>` (lines 774–805), add the marker circles right after
the `<path>` element (before the `xDrag` rect block):

```tsx
                <path
                  d={buildPath(series.values, scale, startIdx, endIdx)}
                  fill="none"
                  stroke={lineColor}
                  strokeWidth={1}
                />

                {flagMarkers.markers.map((m) => (
                  <circle
                    key={m.idx}
                    cx={scale.x(m.idx)}
                    cy={scale.y(series.values[m.idx] as number)}
                    r={3}
                    fill={m.color}
                  />
                ))}
```

Add the legend text, rendered as a sibling of the title `<text>` (after line
680, right after the title `</text>` closes):

```tsx
              <text
                x={MARGIN.left + (plotWidth - MARGIN.left - MARGIN.right) / 2}
                y={16}
                textAnchor="middle"
                fontSize={13}
                fill={axisColor}
              >
                {titlePrefix ? `${titlePrefix}: ${varName}` : varName}
              </text>

              {flagMarkers.legendCodes.length > 0 && (
                <text
                  x={plotWidth - MARGIN.right}
                  y={16}
                  textAnchor="end"
                  fontSize={11}
                  fill={tickLabelColor}
                >
                  {flagMarkers.legendCodes
                    .map(
                      (code) =>
                        `● ${code} — ${flagCodes.find((f) => f.code === code)?.description ?? code}`
                    )
                    .join('   ')}
                </text>
              )}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm test -- src/__tests__/SvgPlot.test.tsx`
Expected: PASS (full file — all tests from Tasks 2 and 3, plus everything
that existed before this plan)

---

### Task 4: Merge `FilesPage`/`DataViewerPage`, delete the old route

**Files:**
- Modify: `src/pages/FilesPage.tsx`
- Modify: `src/App.tsx`
- Delete: `src/pages/DataViewerPage.tsx`
- Modify: `src/__tests__/FilesPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/__tests__/FilesPage.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilesPage } from '../pages/FilesPage'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
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
          <FilesPage />
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
          <SetFile file={file} />
          <FilesPage />
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
})
```

- [ ] **Step 2: Run the tests, confirm the new ones fail**

Run: `npm test -- src/__tests__/FilesPage.test.tsx`
Expected: FAIL — no "Open for editing" button renders today (`FilesPage` only
renders `SvgPlot`).

- [ ] **Step 3: Implement the merged `FilesPage`**

Replace the full contents of `src/pages/FilesPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { closeSession, getFileMetadata, openSession } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useAuth } from '../context/AuthContext'
import { SvgPlot } from '../components/SvgPlot'
import { EditForm } from '../components/EditForm'
import { AuditPanel } from '../components/AuditPanel'
import type { FileMetadata } from '../api/types'

export function FilesPage() {
  const { file, variables } = usePlotSelection()
  const { role } = useAuth()
  const [searchParams] = useSearchParams()
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auditRefreshKey, setAuditRefreshKey] = useState(0)

  const canEdit = role === 'admin' || role === 'qca'

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
    setSessionOpen(false)
    setError(null)
  }, [file])

  const handleOpenSession = async () => {
    if (!file) return
    setError(null)
    try {
      const source = searchParams.get('source') ?? 'raw'
      await openSession(file, source)
      setSessionOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to open session')
    }
  }

  const handleCloseSession = async () => {
    if (!file) return
    setError(null)
    try {
      await closeSession(file)
      setSessionOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to close session')
    }
  }

  return (
    <div>
      {file && canEdit && (
        <div>
          {!sessionOpen && <button onClick={handleOpenSession}>Open for editing</button>}
          {sessionOpen && <button onClick={handleCloseSession}>Close session</button>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      <SvgPlot
        editable={sessionOpen && canEdit}
        onFlagged={() => setAuditRefreshKey((k) => k + 1)}
      />
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

Delete `src/pages/DataViewerPage.tsx`:

Run: `rm src/pages/DataViewerPage.tsx`

Update `src/App.tsx` — remove the `DataViewerPage` import and the
`/files/:filename` route:

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { FilesPage } from './pages/FilesPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { ProfilePage } from './pages/ProfilePage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/files"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <FilesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/files" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm test -- src/__tests__/FilesPage.test.tsx`
Expected: PASS (5 tests)

---

### Task 5: Fix `ProfilePage`'s draft-file link

**Files:**
- Modify: `src/pages/ProfilePage.tsx:74,77`
- Modify: `src/__tests__/ProfilePage.test.tsx`

- [ ] **Step 1: Write the failing assertion**

In `src/__tests__/ProfilePage.test.tsx`, extend the existing `'shows My
drafts section for qca/admin roles'` test:

```tsx
  it('shows My drafts section for qca/admin roles', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'listDrafts').mockResolvedValue(['shipx_2026-07-30'])
    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('My drafts')).toBeInTheDocument())
    const link = screen.getByText('shipx_2026-07-30')
    expect(link.closest('a')).toHaveAttribute(
      'href',
      '/files?file=shipx_2026-07-30&source=draft'
    )
  })
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm test -- src/__tests__/ProfilePage.test.tsx`
Expected: FAIL — current href is `/files/shipx_2026-07-30?source=draft`.

- [ ] **Step 3: Fix the link**

In `src/pages/ProfilePage.tsx`, replace both occurrences (the `href` and the
`navigate` call inside `onClick`) in the drafts list:

```tsx
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
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm test -- src/__tests__/ProfilePage.test.tsx`
Expected: PASS (4 tests)

---

### Task 6: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, every test file (including `FlagToolbar`, `SvgPlot`,
`FilesPage`, `ProfilePage`, and everything untouched by this plan) green.

- [ ] **Step 2: Type-check and build**

Run: `npm run build`
Expected: PASS — `tsc -b` catches any stray reference to the deleted
`DataViewerPage` or a prop-shape mismatch; `vite build` confirms the bundle
still produces.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS, no new oxlint warnings/errors introduced by this plan's
changes.
