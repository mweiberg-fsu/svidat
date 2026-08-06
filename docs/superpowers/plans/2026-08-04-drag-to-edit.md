# Drag-to-Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Open for editing" button with an implicit trigger — a qca/admin user's first drag-select gesture on a plot row opens the edit session and commits the flag selection in one motion.

**Architecture:** `SvgPlot`'s plain-drag gesture already exists (drag-select for flagging); its arming condition moves from a passed-down `editable` prop to the `canEdit` role check read directly off `EditSessionContext` (which `SvgPlot` already consumes via `useEditSession()`). On drag-commit (mouseup, past `MIN_DRAG_PX`), if no session is open yet, `SvgPlot` fires `openSession()` (context-owned, fire-and-forget) alongside its existing `setFlagSelection(...)` call. `EditSessionContext` gains a dedupe guard against overlapping open requests, and clears any pending `flagSelection` on open-failure or explicit close.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, no new dependencies.

**Repo note:** This directory (`svidat/`) has no `.git` anywhere — there is no repo to commit to. Every task below ends with "verify tests pass" instead of a commit step. If you want git history for this work, run `git init` first and say so; the plan doesn't assume it.

---

## Task 1: `EditSessionContext` — dedupe + clear-on-fail + clear-on-close

**Files:**
- Modify: `src/context/EditSessionContext.tsx`
- Test: `src/__tests__/EditSessionContext.test.tsx`

The context's `handleOpenSession`/`handleCloseSession` need three behavior changes that `SvgPlot` (Task 2) will depend on: (1) `handleOpenSession` no-ops if a session is already open or a request is already in flight, so two quick drags before the first request resolves don't fire overlapping calls; (2) a failed open clears any `flagSelection` that was optimistically set; (3) a successful close clears `flagSelection` too (this used to happen as a side effect of `SvgPlot`'s `!editable` cleanup effect, which Task 2 narrows to role-loss only).

- [ ] **Step 1: Write the three failing tests**

Add to `src/__tests__/EditSessionContext.test.tsx`, inside the existing `describe('EditSessionContext', ...)` block, after the `'a failed open surfaces sessionError and leaves sessionOpen false'` test:

```tsx
  it('a failed open also clears any pending flagSelection', async () => {
    vi.spyOn(apiClient, 'openSession').mockRejectedValue(new Error('locked by another user'))
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    fireEvent.click(screen.getByText('select'))
    expect(screen.getByText('flagSelection:04:00–14:00')).toBeInTheDocument()

    fireEvent.click(screen.getByText('open'))
    await waitFor(() =>
      expect(screen.getByText('sessionError:locked by another user')).toBeInTheDocument()
    )
    expect(screen.getByText('flagSelection:none')).toBeInTheDocument()
  })

  it('a successful close also clears any pending flagSelection', async () => {
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
    vi.spyOn(apiClient, 'closeSession').mockResolvedValue({ status: 'closed' })
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))
    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())

    fireEvent.click(screen.getByText('select'))
    expect(screen.getByText('flagSelection:04:00–14:00')).toBeInTheDocument()

    fireEvent.click(screen.getByText('close'))
    await waitFor(() => expect(screen.getByText('sessionOpen:false')).toBeInTheDocument())
    expect(screen.getByText('flagSelection:none')).toBeInTheDocument()
  })

  it('does not fire a second open request while one is already in flight', async () => {
    let resolveOpen: (v: { status: string }) => void = () => {}
    const openSpy = vi.spyOn(apiClient, 'openSession').mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve
      })
    )
    renderWithRole('qca')
    fireEvent.click(screen.getByTestId('set-file'))

    fireEvent.click(screen.getByText('open'))
    fireEvent.click(screen.getByText('open'))
    fireEvent.click(screen.getByText('open'))
    expect(openSpy).toHaveBeenCalledTimes(1)

    resolveOpen({ status: 'opened' })
    await waitFor(() => expect(screen.getByText('sessionOpen:true')).toBeInTheDocument())

    fireEvent.click(screen.getByText('open'))
    expect(openSpy).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/EditSessionContext.test.tsx`
Expected: the 2 new "clears" tests FAIL (`flagSelection:none` not found — still shows `04:00–14:00`); the dedupe test currently PASSES by accident (nothing stops 3 real calls today, but the mock never resolves so `openSpy` genuinely is only called... actually check: today's code has no guard, so all 3 clicks call `openSession` — expect `toHaveBeenCalledTimes(1)` to FAIL with `3`).

- [ ] **Step 3: Implement the guard + clears**

In `src/context/EditSessionContext.tsx`, add a ref import and the guard:

```tsx
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
```

Replace `handleOpenSession` and `handleCloseSession`:

```tsx
  const openingRef = useRef(false)

  const handleOpenSession = async () => {
    if (!file) return
    if (sessionOpen || openingRef.current) return
    openingRef.current = true
    setSessionError(null)
    try {
      const source = searchParams.get('source') ?? 'raw'
      await openSession(file, source)
      setSessionOpen(true)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'failed to open session')
      setFlagSelection(null)
    } finally {
      openingRef.current = false
    }
  }

  const handleCloseSession = async () => {
    if (!file) return
    setSessionError(null)
    try {
      await closeSession(file)
      setSessionOpen(false)
      setFlagSelection(null)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'failed to close session')
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/EditSessionContext.test.tsx`
Expected: all tests PASS, including the pre-existing ones (the guard doesn't change behavior for a single open/close cycle).

- [ ] **Step 5: Verify tests pass, no commit (no git repo in this directory)**

---

## Task 2: `SvgPlot` — drag arms on `canEdit`, opens session on commit

**Files:**
- Modify: `src/components/SvgPlot.tsx`
- Test: `src/__tests__/SvgPlot.test.tsx`

`SvgPlot` currently takes `editable` as a prop (computed by `FilesPage` as `sessionOpen && canEdit`) and uses it in exactly two places: the plain-drag arming check, and a cleanup effect that clears `flagDrag`/`flagSelection` when editing stops being allowed. Both need `canEdit` instead (read directly from `useEditSession()`, which `SvgPlot` already calls) so the drag can arm — and a selection can be optimistically set — *before* a session exists. After this change nothing in the file reads the `editable` prop anymore, so it's removed from the component's signature entirely (dead parameter).

This task also rewrites every `SvgPlot.test.tsx` call site that currently passes `<SvgPlot editable />` to simulate "session already open" — since arming now depends on role (`canEdit`, always true for the `'qca'` role these tests already set via `localStorage`), those call sites work unchanged with the prop simply removed, **except** wherever the test needs `apiClient.openSession` mocked (every drag-commit now fires it) and the one test that specifically exercised toggling `editable` off mid-drag, which is replaced with a same-shaped test against the real `canEdit` signal (role loss).

- [ ] **Step 1: Update call sites that pass `editable`, and mock `openSession` where a real commit happens**

In `src/__tests__/SvgPlot.test.tsx`:

Remove the `editable` prop from these five call sites (all currently read `<SvgPlot editable />`): the tests named `'shows a translucent magenta band tight around the selected values once the drag resolves'`, `'clamps the highlight band to the plot area when padding would push it past the edge'`, `'shows the magenta band live while dragging, before the selection resolves, replacing the old blue rubber-band'`, `'editable plain-drag shorter than the minimum drag distance is ignored'`, `'ctrl+drag with editable=true zooms the Y-axis and does not also start a flag selection'`, and `'a resolved drag sets flagSelection in context with the correct rangeLabel'` — change each `<SvgPlot editable />` to `<SvgPlot />`.

In each of those tests that ends with a *committed* drag (i.e. every one except `'ctrl+drag with editable=true...'`, which is a Y-zoom and never reaches the flag-drag commit path, and except `'editable plain-drag shorter than the minimum drag distance is ignored'`, which stays under `MIN_DRAG_PX` and never commits), add a mock for `apiClient.openSession` right alongside the existing `getVariableData` mock, so the fire-and-forget call has something to resolve rather than hitting a real (failing) fetch:

```tsx
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })
```

This applies to: `'shows a translucent magenta band tight around the selected values once the drag resolves'`, `'clamps the highlight band to the plot area when padding would push it past the edge'`, `'shows the magenta band live while dragging, before the selection resolves, replacing the old blue rubber-band'` (commits on the trailing `mouseUp`), and `'a resolved drag sets flagSelection in context with the correct rangeLabel'`.

- [ ] **Step 2: Replace the editable-prop-toggle test with a canEdit (role-loss) version**

Replace the entire `'flipping editable to false mid-drag does not leave a flag selection on mouseup'` test with:

```tsx
  it('a rejected session-open clears the flag selection on commit', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    vi.spyOn(apiClient, 'openSession').mockRejectedValue(new Error('locked'))
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')

    const { container } = render(
      <AuthProvider>
        <MemoryRouter>
          <PlotSelectionProvider>
            <EditSessionProvider>
              <Setup file="FILE_A" variables={['temperature']} />
              <SvgPlot />
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

    await waitFor(() =>
      expect(container.querySelector('rect[fill="#ff00ff"]')).not.toBeInTheDocument()
    )
  })
```

(This covers the same "a selection shouldn't survive when editing turns out not to be possible" intent as the old test, but through the real failure path this feature introduces — a rejected `openSession` — rather than an artificial prop toggle that no longer has meaning once `editable` is gone.)

- [ ] **Step 3: Add tests for the new drag-opens-session behavior**

Add these three tests at the end of the `describe('SvgPlot', ...)` block, after the existing flag-selection tests:

```tsx
  it('a plain drag past the threshold opens the session when one is not already open', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    const openSpy = vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })

    expect(openSpy).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(container.querySelector('rect[fill="#ff00ff"]')).toBeInTheDocument()
    )
  })

  it('a click below the drag threshold does not open a session', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    const openSpy = vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 202 })
    fireEvent.mouseUp(window, { clientX: 202 })

    expect(openSpy).not.toHaveBeenCalled()
  })

  it('does not re-open a session on a second drag once one is already open', async () => {
    const time = hourlyTimes(18)
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time,
      variables: { temperature: { values: time.map((_, i) => i), flags: time.map(() => 'Z') } },
    })
    const openSpy = vi.spyOn(apiClient, 'openSession').mockResolvedValue({ status: 'opened' })

    const { container } = renderSvgPlot('FILE_A', ['temperature'])
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())

    const svg = container.querySelector('svg')!
    fireEvent.mouseDown(svg, { clientX: pxForIndex(4, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(14, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(14, 18) })
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1))

    fireEvent.mouseDown(svg, { clientX: pxForIndex(0, 18) })
    fireEvent.mouseMove(window, { clientX: pxForIndex(3, 18) })
    fireEvent.mouseUp(window, { clientX: pxForIndex(3, 18) })

    expect(openSpy).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 4: Run tests to verify the new/changed ones fail**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/SvgPlot.test.tsx`
Expected: FAIL — `SvgPlot` doesn't accept an `editable`-less call today in a way that arms the drag (role alone doesn't arm it yet), so the three new tests and the replaced rejected-open test fail; the five prop-removed call sites also fail since dropping `editable` currently means the drag never arms at all (today's guard is the prop, not `canEdit`).

- [ ] **Step 5: Implement the `SvgPlot` changes**

In `src/components/SvgPlot.tsx`, update the doc comment above `interface FlagDragStart` (around line 484):

```ts
// Same idea for one plain-drag (flag-select) gesture — no modifier key,
// armed whenever `canEdit` is true (role permits editing), independent of
// whether a session is already open — a drag that commits while no session
// is open fires `openSession()` itself. `varName`/`startIdx`/`endIdx` are
// captured at mousedown (mirroring XDragStart) so mouseup can turn the
// pixel range back into a data-index range without depending on
// render-time closures.
```

Remove the `editable` prop from the component signature:

```tsx
export function SvgPlot() {
  const { file, variables } = usePlotSelection()
  const { canEdit, sessionOpen, openSession, flagSelection, setFlagSelection, flagAppliedAt } =
    useEditSession()
```

In the flag-drag effect's `handleMouseUp` (the one keyed off `[flagDrag]`), insert the session-open call right before the existing `setFlagSelection`:

```tsx
      if (selEnd - selStart < 1) return

      if (!sessionOpen) {
        openSession()
      }

      setFlagSelection({
        varName: start.varName,
        startIdx: selStart,
        endIdx: selEnd,
        rangeLabel: `${data.time[selStart].slice(11, 19)}–${data.time[selEnd].slice(11, 19)}`,
      })
```

Update the cleanup effect's comment and condition:

```tsx
  // Clears any in-flight drag state if the role stops permitting edits (e.g.
  // a live role change mid-drag). An explicit session close clears
  // flagSelection itself — see EditSessionContext.handleCloseSession — since
  // by the time a session is open, sessionOpen briefly going false again
  // (right after this feature's optimistic open) must NOT wipe a selection
  // that was just set while the open request is still in flight.
  useEffect(() => {
    if (!canEdit) {
      setFlagSelection(null)
      setFlagDrag(null)
      flagDragStartRef.current = null
    }
  }, [canEdit, setFlagSelection])
```

Update `handleRowMouseDown`'s plain-drag branch:

```tsx
    if (canEdit) {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const startPx = e.clientX - rect.left
      flagDragStartRef.current = { originLeft: rect.left, startPx, varName, startIdx, endIdx }
      setFlagDrag({ varName, startPx, currentPx: startPx })
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/SvgPlot.test.tsx`
Expected: all tests PASS.

- [ ] **Step 7: Verify tests pass, no commit (no git repo in this directory)**

---

## Task 3: `FilesPage` — remove the button, add the hint

**Files:**
- Modify: `src/pages/FilesPage.tsx`
- Test: `src/__tests__/FilesPage.test.tsx`

`FilesPage` no longer needs to pass `editable` to `SvgPlot` (Task 2 removed that prop) and no longer renders an "Open for editing" button — it renders a passive hint instead, shown whenever `canEdit && !sessionOpen`. The existing tests that click that button to open a session are rewritten to open the session directly through the context (mirroring the file's own existing `NotifyButton` test-harness pattern) — `FilesPage`'s own responsibility here is only "does it show the right things for the current session state," not "does dragging open a session" (that's fully covered by `SvgPlot.test.tsx` in Task 2).

- [ ] **Step 1: Rewrite the failing tests**

Replace the full contents of `src/__tests__/FilesPage.test.tsx` with:

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

function OpenSessionButton() {
  const { openSession } = useEditSession()
  return (
    <button data-testid="open-session" onClick={() => openSession()}>
      open session
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
            <OpenSessionButton />
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

  it('shows the drag-to-edit hint for qca once a file is selected', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {},
      dimensions: {},
      global_attrs: {},
    })
    renderFilesPageWithFile('qca', 'FILE_A')
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )
  })

  it('hides the drag-to-edit hint for user role', async () => {
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {},
      dimensions: {},
      global_attrs: {},
    })
    renderFilesPageWithFile('user', 'FILE_A')
    await waitFor(() => expect(apiClient.getFileMetadata).toHaveBeenCalledWith('FILE_A'))
    expect(screen.queryByText('Drag on a plot to start editing.')).not.toBeInTheDocument()
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
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )

    fireEvent.click(screen.getByTestId('open-session'))

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
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Close session')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Close session'))
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )
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
              <OpenSessionButton />
              <NotifyButton />
              <FilesPage />
            </EditSessionProvider>
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    fireEvent.click(screen.getByTestId('set-file'))
    await waitFor(() =>
      expect(screen.getByText('Drag on a plot to start editing.')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByTestId('open-session'))
    await waitFor(() => expect(screen.getByText('Audit history')).toBeInTheDocument())
    await waitFor(() => expect(getAuditHistorySpy).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('notify flagged'))

    await waitFor(() => expect(getAuditHistorySpy).toHaveBeenCalledTimes(2))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/FilesPage.test.tsx`
Expected: FAIL — `'Drag on a plot to start editing.'` doesn't exist yet; `FilesPage` still renders the old button.

- [ ] **Step 3: Implement the `FilesPage` changes**

Replace the body of `src/pages/FilesPage.tsx`'s `return`:

```tsx
  return (
    <div>
      {file && canEdit && (
        <div>
          {!sessionOpen && <p>Drag on a plot to start editing.</p>}
          {sessionOpen && <button onClick={closeSession}>Close session</button>}
          {sessionError && <p role="alert">{sessionError}</p>}
        </div>
      )}
      <SvgPlot />
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
```

And drop `editable` and `openSession` from the destructured hook result at the top of the component (`openSession` is no longer called from `FilesPage` — it's `SvgPlot`'s job now via the drag):

```tsx
  const { sessionOpen, canEdit, sessionError, closeSession, flagAppliedAt } = useEditSession()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/FilesPage.test.tsx`
Expected: all tests PASS.

- [ ] **Step 5: Verify tests pass, no commit (no git repo in this directory)**

---

## Task 4: `FlagsPanel` — update the stale hint text

**Files:**
- Modify: `src/components/FlagsPanel.tsx`
- Test: `src/__tests__/FlagsPanel.test.tsx`

`FlagsPanel.tsx:79` still tells the user to "Open this file for editing" — a button that no longer exists after Task 3. One-line text change.

- [ ] **Step 1: Update the failing test**

In `src/__tests__/FlagsPanel.test.tsx`, find the assertion `expect(screen.getByText('Open this file for editing to flag data')).toBeInTheDocument()` (around line 85) and change the expected string to:

```tsx
    expect(screen.getByText('Drag on the plot to start editing')).toBeInTheDocument()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/FlagsPanel.test.tsx`
Expected: FAIL — the component still renders the old string.

- [ ] **Step 3: Update the component text**

In `src/components/FlagsPanel.tsx`, line 79, change:

```tsx
            : 'Open this file for editing to flag data'}
```

to:

```tsx
            : 'Drag on the plot to start editing'}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run src/__tests__/FlagsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify tests pass, no commit (no git repo in this directory)**

---

## Task 5: Full test suite + manual smoke check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/ustropics/Documents/svidat/client && npx vitest run`
Expected: all tests PASS, no leftover references to "Open for editing" anywhere.

- [ ] **Step 2: Grep for any missed references to the old button text**

Run: `grep -rn "Open for editing\|Open this file for editing" /Users/ustropics/Documents/svidat/client/src`
Expected: no matches.

- [ ] **Step 3: Manual smoke test in the running app**

Start the dev server (`npm run dev` from `/Users/ustropics/Documents/svidat/client`, or use whatever this project's existing `run` workflow is), log in as a qca/admin user, select a file and a variable, and drag across a plot row without clicking any button first. Confirm: the drag shows the live magenta band, the session opens (Close session button appears, sidebar flag buttons become enabled), and the dragged range is selected and ready to flag. Also confirm a plain click (no drag) still just highlights the row's axes blue and does not open a session.
