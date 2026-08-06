# Variable Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ship→year→file→variables (multi-select) browsing tool to the `/files` page — purely informational, no navigation, no editing, helps the user identify variables before running their own separate netCDF reader/writer script.

**Architecture:** One new, self-contained frontend component (`VariableBrowser.tsx`) with its own local ship/year/file/variables cascading state, reusing the existing `useCatalog` hook and `getFileMetadata` API function — no backend changes. Deliberately NOT built on top of `ShipYearFilePicker` (that component navigates on file selection, which must stay unchanged for the existing edit workflow).

**Tech Stack:** Same as existing app — React/Vite/TS frontend, Vitest.

Design doc: `docs/superpowers/specs/2026-07-31-variable-browser-design.md`.

---

### Task 1: VariableBrowser component

**Files:**
- Create: `client/src/components/VariableBrowser.tsx`
- Test: `client/src/__tests__/VariableBrowser.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `client/src/__tests__/VariableBrowser.test.tsx`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VariableBrowser } from '../components/VariableBrowser'
import * as apiClient from '../api/client'

describe('VariableBrowser', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('cascades ship -> year -> file and resets downstream selections', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'], '2026': ['KAQP_20260115v20001'] },
      WTDF: { '2025': ['WTDF_20250601v20001'] },
    })
    render(<VariableBrowser />)

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'WTDF' } })

    const yearSelect = screen.getByLabelText('Year') as HTMLSelectElement
    expect(yearSelect.value).toBe('')
  })

  it('fetches metadata and shows selected variable details in a table', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        temperature: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
        salinity: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
      },
      dimensions: { time: 5 },
    })

    render(<VariableBrowser />)

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })

    await waitFor(() => expect(screen.getByLabelText('Variables')).toBeInTheDocument())

    const variablesSelect = screen.getByLabelText('Variables') as HTMLSelectElement
    const option = Array.from(variablesSelect.options).find((o) => o.value === 'temperature')!
    option.selected = true
    fireEvent.change(variablesSelect)

    await waitFor(() => expect(screen.getByText('float32')).toBeInTheDocument())
    expect(screen.getByText('time')).toBeInTheDocument()
  })

  it('clears variables when file changes', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001', 'KAQP_20250102v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: { temperature: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} } },
      dimensions: { time: 5 },
    })

    render(<VariableBrowser />)
    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })
    await waitFor(() => expect(screen.getByLabelText('Variables')).toBeInTheDocument())

    const variablesSelect = screen.getByLabelText('Variables') as HTMLSelectElement
    const option = Array.from(variablesSelect.options).find((o) => o.value === 'temperature')!
    option.selected = true
    fireEvent.change(variablesSelect)
    await waitFor(() => expect(screen.getByText('float32')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250102v20001' } })
    await waitFor(() => expect(screen.queryByText('float32')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test`
Expected: FAIL — `Cannot find module '../components/VariableBrowser'`

- [ ] **Step 3: Implement VariableBrowser**

Create `client/src/components/VariableBrowser.tsx`:
```typescript
import { useEffect, useState, type ChangeEvent } from 'react'
import { getFileMetadata } from '../api/client'
import { useCatalog } from '../hooks/useCatalog'
import type { FileMetadata } from '../api/types'

export function VariableBrowser() {
  const { catalog, error: catalogError } = useCatalog()
  const [ship, setShip] = useState('')
  const [year, setYear] = useState('')
  const [file, setFile] = useState('')
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [selectedVars, setSelectedVars] = useState<string[]>([])

  const ships = catalog ? Object.keys(catalog).sort() : []
  const years = ship && catalog ? Object.keys(catalog[ship] ?? {}).sort() : []
  const files = ship && year && catalog ? catalog[ship]?.[year] ?? [] : []
  const variableNames = metadata ? Object.keys(metadata.variables).sort() : []

  useEffect(() => {
    if (!file) {
      setMetadata(null)
      setSelectedVars([])
      return
    }
    setMetadataError(null)
    setSelectedVars([])
    getFileMetadata(file)
      .then(setMetadata)
      .catch((err) => setMetadataError(err instanceof Error ? err.message : String(err)))
  }, [file])

  const handleShipChange = (value: string) => {
    setShip(value)
    setYear('')
    setFile('')
  }

  const handleYearChange = (value: string) => {
    setYear(value)
    setFile('')
  }

  const handleVariablesChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const values = Array.from(e.target.selectedOptions).map((o) => o.value)
    setSelectedVars(values)
  }

  return (
    <div className="variable-browser">
      {catalogError && <p role="status">Error: {catalogError}</p>}
      {catalog && (
        <>
          <label>
            Ship
            <select value={ship} onChange={(e) => handleShipChange(e.target.value)}>
              <option value="">Select ship</option>
              {ships.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select
              value={year}
              onChange={(e) => handleYearChange(e.target.value)}
              disabled={!ship}
            >
              <option value="">Select year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label>
            File
            <select
              value={file}
              onChange={(e) => setFile(e.target.value)}
              disabled={!year}
            >
              <option value="">Select file</option>
              {files.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {metadataError && <p role="status">Error: {metadataError}</p>}
      {metadata && (
        <label>
          Variables
          <select
            multiple
            value={selectedVars}
            onChange={handleVariablesChange}
            size={Math.min(8, Math.max(3, variableNames.length))}
          >
            {variableNames.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedVars.length > 0 && metadata && (
        <table>
          <thead>
            <tr>
              <th>Variable</th>
              <th>Dims</th>
              <th>Shape</th>
              <th>Dtype</th>
            </tr>
          </thead>
          <tbody>
            {selectedVars.map((v) => (
              <tr key={v}>
                <td>{v}</td>
                <td>{metadata.variables[v].dims.join(', ')}</td>
                <td>{metadata.variables[v].shape.join(', ')}</td>
                <td>{metadata.variables[v].dtype}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```
Note: the `File` `<select>` here stays controlled to the actual `file` state
(unlike `ShipYearFilePicker`'s deliberately-always-blank file select) —
there's no navigation-away here, so reflecting the real current selection
is correct and intended.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 new VariableBrowser tests)

- [ ] **Step 5: Run FULL suite**

Run: `npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass

- [ ] **Step 6 (SKIP — no git)**

## Context

This intentionally does NOT reuse `ShipYearFilePicker` — that component's
`onSelectFile` callback exists specifically to trigger navigation
(`Sidebar`/`FilesPage`'s existing "Browse by ship" section both navigate to
`/files/{filename}` on file pick, core to the edit workflow). Changing that
behavior would break existing, already-tested functionality. This is a
deliberate, small amount of duplication (the ship/year/file cascading
derivation logic) in exchange for correctly isolating a component with
fundamentally different behavior (no navigation, reveals a 4th step
instead).

## Before You Begin

Ask now if anything is unclear.

## Your Job

1. TDD: write tests first, confirm correct failure, implement, confirm pass
2. Run FULL suite
3. Self-review
4. Report back

Work from `/Users/ustropics/Documents/svidat/client/`.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test/build command + actual output (paste real output)
- Files created
- Self-review findings
- Concerns

---

### Task 2: Wire VariableBrowser into FilesPage

**Files:**
- Modify: `client/src/pages/FilesPage.tsx`

- [ ] **Step 1: Add the new section**

In `client/src/pages/FilesPage.tsx`, add the import:
```typescript
import { VariableBrowser } from '../components/VariableBrowser'
```

Add a new `<section>` after the existing "Browse by ship" section (before
the role-gated "My drafts" section, order doesn't functionally matter but
keep the two ship/year/file-based tools adjacent for readability):
```typescript
      <section>
        <h2>Variable browser</h2>
        <VariableBrowser />
      </section>
```

- [ ] **Step 2: Run FULL suite**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass — confirm `FilesPage.test.tsx`'s 3 existing tests still
pass (they don't mock `getFileMetadata`, so `VariableBrowser`'s metadata
fetch won't fire until a file is selected, which none of those tests do —
confirm no unexpected console errors from the added component being
present-but-inert in those tests).

- [ ] **Step 3 (SKIP — no git)**

## Context

This is the only integration point — `VariableBrowser` is fully
self-contained (own catalog fetch, own state), so no other file needs to
change.

## Before You Begin

Ask now if anything is unclear.

## Your Job

1. Apply the change
2. Run FULL suite, check for console warnings in FilesPage tests specifically
3. Self-review
4. Report back

Work from `/Users/ustropics/Documents/svidat/client/`.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test/build command + actual output (paste real output)
- Files modified
- Self-review findings
- Concerns

---

### Task 3: Live smoke test

- [ ] **Step 1**

Start backend and frontend dev servers. Log in, go to `/files`. Confirm the
new "Variable browser" section renders below "Browse by ship". Pick a real
ship/year/file (e.g. KAQP / 2025 / any file) and confirm the Variables
multi-select populates with that file's real variable names. Select 2+
variables (ctrl/cmd-click for multi-select) and confirm a table appears
showing each selected variable's dims/shape/dtype. Change the file
selection and confirm the variable table clears. Confirm nothing navigates
away at any point in this flow.
