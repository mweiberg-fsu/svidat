# Full-width Navbar + Resizable Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-width app shell — navbar spans the viewport, a resizable (200–400px, default 250px) left sidebar sits below it with a welcome/avatar header, nav links, and a ship→year→file cascading picker backed by a new backend catalog endpoint. Sidebar collapses to a horizontal strip under the navbar below 1024px. `/files` becomes a dedicated full-page version of the same picker plus the existing "My drafts" list.

**Architecture:** One new backend endpoint (`GET /files/catalog`, parses the `{SHIP}_{YYYYMMDD}v{VERSION}.nc` filename convention into a nested ship→year→files structure, scanned fresh per request). Frontend: a shared `useAvatar` hook (removes duplicated blob-URL-lifecycle code from `Navbar`/`ProfilePage`, used by the new `Sidebar` too), a shared `useCatalog` hook + `ShipYearFilePicker` component (used by both `Sidebar` and the rewritten `FilesPage`), and a CSS layout overhaul (drop the centered `#root` width constraint, full-width navbar, flex sidebar+main shell).

**Tech Stack:** Same as existing app — FastAPI backend, React/Vite/TS frontend, pytest/Vitest.

Design doc: `docs/superpowers/specs/2026-07-31-sidebar-layout-design.md`.

---

### Task 1: Backend catalog endpoint

**Files:**
- Modify: `server/app/routers/files.py`
- Test: `server/tests/test_files_routes.py`

- [ ] **Step 1: Write failing tests**

Append to `server/tests/test_files_routes.py`:
```python
def test_catalog_groups_by_ship_and_year(client, auth_header, synthetic_nc):
    synthetic_nc("KAQP_20250101v20001")
    synthetic_nc("KAQP_20250102v20001")
    synthetic_nc("KAQP_20260115v20001")
    synthetic_nc("WTDF_20250601v20001")
    headers = auth_header("cataloguser1", Role.user)

    resp = client.get("/files/catalog", headers=headers)
    assert resp.status_code == 200
    body = resp.json()

    assert set(body["KAQP"]["2025"]) == {"KAQP_20250101v20001", "KAQP_20250102v20001"}
    assert body["KAQP"]["2026"] == ["KAQP_20260115v20001"]
    assert body["WTDF"]["2025"] == ["WTDF_20250601v20001"]


def test_catalog_skips_non_matching_filenames(client, auth_header, synthetic_nc):
    synthetic_nc("KAQP_20250201v20001")
    synthetic_nc("not_a_ship_pattern_file")
    headers = auth_header("cataloguser2", Role.user)

    resp = client.get("/files/catalog", headers=headers)
    body = resp.json()

    assert "KAQP" in body
    all_files = [f for ship in body.values() for year_files in ship.values() for f in year_files]
    assert "not_a_ship_pattern_file" not in all_files


def test_catalog_accessible_to_all_roles(client, auth_header, synthetic_nc):
    synthetic_nc("KAQP_20250301v20001")
    for username, role in [("cataloguser3", Role.admin), ("cataloguser4", Role.qca), ("cataloguser5", Role.user)]:
        headers = auth_header(username, role)
        resp = client.get("/files/catalog", headers=headers)
        assert resp.status_code == 200


def test_catalog_empty_when_no_raw_dir(client, auth_header, tmp_path, monkeypatch):
    import app.storage as storage_module

    empty_dir = tmp_path / "empty_data_dir"
    monkeypatch.setattr(storage_module.settings, "data_dir", str(empty_dir))
    headers = auth_header("cataloguser6", Role.user)

    resp = client.get("/files/catalog", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {}
```

Note: `test_catalog_empty_when_no_raw_dir` monkeypatches `settings.data_dir` to a
directory that doesn't exist — confirm `storage.base_dir()` reads
`settings.data_dir` dynamically (it does: `return Path(settings.data_dir)`),
so this monkeypatch takes effect without needing to touch any other file.

- [ ] **Step 2: Run test to verify it fails**

Run: `conda activate svidat && cd /Users/ustropics/Documents/svidat/server && pytest tests/test_files_routes.py -v`
Expected: FAIL — 404 (no `/files/catalog` route yet)

- [ ] **Step 3: Implement**

Add to `server/app/routers/files.py` (add `import re` and `from collections import
defaultdict` to the top imports; add this route — placement relative to the
existing `/raw`, `/drafts`, `/{filename}/metadata` routes doesn't matter
since `/catalog` is a distinct literal path segment, no collision):

```python
CATALOG_FILENAME_RE = re.compile(r"^([A-Za-z0-9]+)_(\d{4})\d{4}v\d+$")


@router.get("/catalog")
def file_catalog(_: User = Depends(get_current_user)):
    raw_dir = storage.base_dir() / "raw"
    if not raw_dir.exists():
        return {}

    catalog: dict = defaultdict(lambda: defaultdict(list))
    for path in raw_dir.glob("*.nc"):
        stem = path.stem
        match = CATALOG_FILENAME_RE.match(stem)
        if not match:
            continue
        ship, year = match.group(1), match.group(2)
        catalog[ship][year].append(stem)

    return {
        ship: {year: sorted(files) for year, files in sorted(years.items())}
        for ship, years in sorted(catalog.items())
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_files_routes.py -v`
Expected: PASS (all previous + 4 new)

- [ ] **Step 5 (SKIP — no git)**

## Context

`synthetic_nc(filename)` (the existing conftest.py fixture) already writes a
real netCDF file to `{DATA_DIR}/raw/{filename}.nc` — reuse it as-is for these
tests, it accepts any filename string. The regex `^([A-Za-z0-9]+)_(\d{4})\d{4}v\d+$`
requires: alphanumeric ship code, underscore, exactly an 8-digit date (first
4 digits captured as year), literal `v`, digits, matched against the filename
stem (no `.nc`). Verified against all 105,833 real downloaded files: 105,832
match, the one non-match (`shipx_2026-07-30`, a manual test file with dashes
instead of an 8-digit run) is correctly excluded, not an error.

## Before You Begin

Ask now if anything is unclear.

## Your Job

1. TDD: write test first, confirm correct failure, implement, confirm pass
2. Run FULL backend suite to confirm no regressions
3. Self-review
4. Report back

Work from `/Users/ustropics/Documents/svidat/` (backend commands: `conda activate svidat &&` prefix, from `server/`).

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test command + actual output for FULL suite (paste real output)
- Files modified
- Self-review findings
- Concerns

---

### Task 2: Shared `useAvatar` hook (refactor)

**Files:**
- Create: `client/src/hooks/useAvatar.ts`
- Modify: `client/src/components/Navbar.tsx`
- Modify: `client/src/pages/ProfilePage.tsx`
- Test: `client/src/__tests__/useAvatar.test.ts`

- [ ] **Step 1: Write failing test**

Create `client/src/__tests__/useAvatar.test.ts`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAvatar } from '../hooks/useAvatar'
import * as apiClient from '../api/client'

describe('useAvatar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when id is null', () => {
    const fetchSpy = vi.spyOn(apiClient, 'fetchAvatarBlobUrl')
    const { result } = renderHook(() => useAvatar(null, 0))
    expect(result.current).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches and returns the avatar URL for a given id', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue('blob:fake-url')
    const { result } = renderHook(() => useAvatar(1, 0))
    await waitFor(() => expect(result.current).toBe('blob:fake-url'))
  })

  it('refetches when avatarVersion changes', async () => {
    const fetchSpy = vi
      .spyOn(apiClient, 'fetchAvatarBlobUrl')
      .mockResolvedValueOnce('blob:v0')
      .mockResolvedValueOnce('blob:v1')

    const { result, rerender } = renderHook(({ version }) => useAvatar(1, version), {
      initialProps: { version: 0 },
    })
    await waitFor(() => expect(result.current).toBe('blob:v0'))

    rerender({ version: 1 })
    await waitFor(() => expect(result.current).toBe('blob:v1'))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test`
Expected: FAIL — `Cannot find module '../hooks/useAvatar'`

- [ ] **Step 3: Implement the hook**

Create `client/src/hooks/useAvatar.ts`:
```typescript
import { useEffect, useRef, useState } from 'react'
import { fetchAvatarBlobUrl } from '../api/client'

export function useAvatar(id: number | null, avatarVersion: number): string | null {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (id == null) return
    let cancelled = false
    fetchAvatarBlobUrl(id).then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url)
        return
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = url
      setAvatarUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [id, avatarVersion])

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  return avatarUrl
}
```
(This is exactly `Navbar.tsx`'s already-reviewed, leak-fixed effect pair,
extracted verbatim into a hook — no behavior change, just deduplication.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 new useAvatar tests)

- [ ] **Step 5: Refactor Navbar to use the hook**

In `client/src/components/Navbar.tsx`: remove the local `avatarUrl` state,
the `objectUrlRef`, and both `useEffect` blocks that manage them. Replace
with:
```typescript
import { useAvatar } from '../hooks/useAvatar'
// ...
const avatarUrl = useAvatar(id, avatarVersion)
```
Remove the now-unused `useRef`/`useEffect` imports if nothing else in the
file needs them (check — `useState`/`useNavigate` are still needed for
`open`/navigation). Everything else in the component (the JSX rendering
`avatarUrl`) stays unchanged.

- [ ] **Step 6: Refactor ProfilePage to use the hook**

Same refactor in `client/src/pages/ProfilePage.tsx` — remove the local
avatar-fetching state/effects, replace with `const avatarUrl = useAvatar(id,
avatarVersion)`.

- [ ] **Step 7: Run FULL suite**

Run: `npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass — confirm `Navbar.test.tsx`'s 4 tests and
`ProfilePage.test.tsx`'s 2 tests still pass unchanged (the hook preserves
identical behavior, so no test assertions should need to change).

- [ ] **Step 8 (SKIP — no git)**

## Context

This is a pure refactor — extracting already-correct, already-reviewed logic
into a shared hook so `Sidebar` (Task 5) doesn't become a third copy-paste of
the same subtle blob-URL-lifecycle code. No behavior change; existing
`Navbar.test.tsx`/`ProfilePage.test.tsx` tests are the regression check.

## Before You Begin

Ask now if anything is unclear.

## Your Job

1. TDD the hook itself first (write test, confirm failure, implement, confirm pass)
2. Refactor `Navbar.tsx` and `ProfilePage.tsx` to use it
3. Run FULL suite, confirm the pre-existing Navbar/ProfilePage tests still pass unchanged
4. Self-review — confirm no behavior drift (compare the hook's code to what was removed from each file)
5. Report back

Work from `/Users/ustropics/Documents/svidat/client/`.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test/build command + actual output (paste real output)
- Files created/modified
- Self-review findings
- Concerns

---

### Task 3: Frontend catalog API + shared picker component

**Files:**
- Modify: `client/src/api/types.ts`
- Modify: `client/src/api/client.ts`
- Create: `client/src/hooks/useCatalog.ts`
- Create: `client/src/components/ShipYearFilePicker.tsx`
- Test: `client/src/__tests__/ShipYearFilePicker.test.tsx`

- [ ] **Step 1: Add the catalog type**

Append to `client/src/api/types.ts`:
```typescript
export type Catalog = Record<string, Record<string, string[]>>
```

- [ ] **Step 2: Add the API client function**

Append to `client/src/api/client.ts`:
```typescript
export const getCatalog = (): Promise<Catalog> => apiFetch('/files/catalog').then((r) => r.json())
```
(Add `Catalog` to the existing `import type { CurrentUser } from './types'` line, making it `import type { CurrentUser, Catalog } from './types'`.)

- [ ] **Step 3: Implement useCatalog hook**

Create `client/src/hooks/useCatalog.ts`:
```typescript
import { useEffect, useState } from 'react'
import { getCatalog } from '../api/client'
import type { Catalog } from '../api/types'

export function useCatalog(): { catalog: Catalog | null; error: string | null } {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return { catalog, error }
}
```

- [ ] **Step 4: Write failing test for ShipYearFilePicker**

Create `client/src/__tests__/ShipYearFilePicker.test.tsx`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ShipYearFilePicker } from '../components/ShipYearFilePicker'
import type { Catalog } from '../api/types'

const catalog: Catalog = {
  KAQP: {
    '2025': ['KAQP_20250101v20001', 'KAQP_20250102v20001'],
    '2026': ['KAQP_20260115v20001'],
  },
  WTDF: {
    '2025': ['WTDF_20250601v20001'],
  },
}

describe('ShipYearFilePicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('populates years when a ship is selected, and files when a year is selected', () => {
    const onSelectFile = vi.fn()
    render(<ShipYearFilePicker catalog={catalog} onSelectFile={onSelectFile} />)

    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), {
      target: { value: 'KAQP_20250101v20001' },
    })

    expect(onSelectFile).toHaveBeenCalledWith('KAQP_20250101v20001')
  })

  it('resets year and file selection when ship changes', () => {
    const onSelectFile = vi.fn()
    render(<ShipYearFilePicker catalog={catalog} onSelectFile={onSelectFile} />)

    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'WTDF' } })

    const yearSelect = screen.getByLabelText('Year') as HTMLSelectElement
    expect(yearSelect.value).toBe('')
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../components/ShipYearFilePicker'`

- [ ] **Step 6: Implement ShipYearFilePicker**

Create `client/src/components/ShipYearFilePicker.tsx`:
```typescript
import { useState } from 'react'
import type { Catalog } from '../api/types'

export function ShipYearFilePicker({
  catalog,
  onSelectFile,
}: {
  catalog: Catalog
  onSelectFile: (filename: string) => void
}) {
  const [ship, setShip] = useState('')
  const [year, setYear] = useState('')

  const ships = Object.keys(catalog).sort()
  const years = ship ? Object.keys(catalog[ship] ?? {}).sort() : []
  const files = ship && year ? catalog[ship]?.[year] ?? [] : []

  const handleShipChange = (value: string) => {
    setShip(value)
    setYear('')
  }

  const handleYearChange = (value: string) => {
    setYear(value)
  }

  const handleFileChange = (value: string) => {
    if (value) onSelectFile(value)
  }

  return (
    <div className="ship-year-file-picker">
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
          value=""
          onChange={(e) => handleFileChange(e.target.value)}
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
    </div>
  )
}
```
Note the File `<select>` is deliberately kept controlled to always show
`""` (a placeholder) rather than the last-picked file — selecting a file
immediately navigates away (via `onSelectFile`) in both consumers (Sidebar,
FilesPage), so there's no meaningful "currently selected file" state to
reflect back into this dropdown after the fact.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 new ShipYearFilePicker tests)

- [ ] **Step 8: Run FULL suite**

Run: `npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass

- [ ] **Step 9 (SKIP — no git)**

## Context

`ShipYearFilePicker` is deliberately presentational/reusable — it takes an
already-fetched `catalog` as a prop rather than fetching it itself, so both
`Sidebar` (Task 5) and `FilesPage` (Task 7) can each call `useCatalog()`
once and pass the result down, without embedding fetch logic or navigation
logic inside the shared component itself (navigation is the caller's job,
via the `onSelectFile` callback).

## Before You Begin

Ask now if anything is unclear.

## Your Job

1. Add the type + API function (no test needed for these trivial additions, consistent with how `getCurrentUser` etc. were added without dedicated tests)
2. TDD `ShipYearFilePicker`: write test first, confirm failure, implement, confirm pass
3. Implement `useCatalog` (no dedicated test — it's a thin fetch wrapper, exercised indirectly once `Sidebar`/`FilesPage` use it in later tasks; if you think a test is warranted, add one, your call)
4. Run FULL suite
5. Self-review
6. Report back

Work from `/Users/ustropics/Documents/svidat/client/`.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test/build command + actual output (paste real output)
- Files created/modified
- Self-review findings
- Concerns

---

### Task 4: Layout CSS overhaul

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Remove the centered/constrained root layout**

In `client/src/index.css`, find the `#root` rule:
```css
#root {
  width: 1126px;
  max-width: 100%;
  margin: 0 auto;
  text-align: center;
  border-inline: 1px solid var(--border);
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
```
Replace it with a full-width version (drop the fixed width/centering/
border, keep the flex-column shell so the navbar stacks above the
sidebar+main row):
```css
#root {
  width: 100%;
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
```
Note: dropping `text-align: center` here means existing pages that relied
on inherited centered text (most of this app's pages render bare
left-aligned-by-default content already via block elements, but check
`LoginPage.tsx`, `FileBrowserPage.tsx` etc. render reasonably — this is a
visual check to do during Task 8's live smoke test, not something to chase
via unit tests, since Vitest/jsdom doesn't evaluate real layout).

- [ ] **Step 2: Add the app-body shell and sidebar styles**

Append to `client/src/index.css`:
```css
/* App shell: navbar (full width, already styled) + sidebar + main */

.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.app-main {
  flex: 1;
  min-width: 0;
  padding: 24px;
  overflow-x: auto;
}

.sidebar {
  width: 250px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: relative;
  text-align: left;
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: ew-resize;
  z-index: 5;
}

.sidebar-welcome {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.sidebar-welcome-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
}

.sidebar-welcome-avatar-placeholder {
  display: inline-block;
  background: linear-gradient(135deg, var(--accent), var(--accent-border));
}

.sidebar-welcome-text {
  color: var(--text);
  font-size: 13px;
}

.sidebar-welcome-text b {
  display: block;
  color: var(--text-h);
  font-size: 14px;
}

.sidebar-links {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.sidebar-links a {
  color: var(--text);
  font-size: 13px;
  text-decoration: none;
}

.sidebar-links a:hover {
  color: var(--text-h);
}

.sidebar-picker {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-picker label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
}

.sidebar-picker select {
  background: var(--code-bg);
  border: 1px solid var(--border);
  color: var(--text-h);
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
  text-transform: none;
  letter-spacing: normal;
}

@media (max-width: 1024px) {
  .app-body {
    flex-direction: column;
  }

  .sidebar {
    width: 100% !important;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .sidebar-resize-handle {
    display: none;
  }

  .sidebar-links {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 14px;
  }
}
```
Note the `width: 100% !important` on `.sidebar` at the mobile breakpoint —
this overrides whatever inline `style="width: Npx"` the resize feature
(Task 5) sets on the element, since inline styles otherwise beat media-query
class rules. This is the one place `!important` is used in this file;
necessary because the resize handle sets an inline style directly on the
same element the media query needs to override.

- [ ] **Step 3: Run FULL suite**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass (CSS-only change, shouldn't affect any test — this step
is a regression check, not expected to catch anything, but run it anyway)

- [ ] **Step 4 (SKIP — no git)**

## Context

Pure CSS addition/modification — no component changes in this task. The
new classes (`.sidebar`, `.app-body`, `.app-main`, etc.) aren't used by any
component yet (Task 5 builds `Sidebar.tsx` using them, Task 6 wires it in) —
that's fine, unused CSS classes don't break anything or fail any test.

## Before You Begin

Ask now if anything is unclear.

## Your Job

1. Apply both CSS changes exactly as given
2. Run FULL suite to confirm no regressions
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

### Task 5: Sidebar component

**Files:**
- Create: `client/src/components/Sidebar.tsx`
- Test: `client/src/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Write failing test**

Create `client/src/__tests__/Sidebar.test.tsx`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { AuthProvider } from '../context/AuthContext'
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
        <Sidebar />
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

  it('renders the ship/year/file picker once the catalog loads', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    renderSidebar('qca')
    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../components/Sidebar'`

- [ ] **Step 3: Implement Sidebar**

Create `client/src/components/Sidebar.tsx`:
```typescript
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAvatar } from '../hooks/useAvatar'
import { useCatalog } from '../hooks/useCatalog'
import { ShipYearFilePicker } from './ShipYearFilePicker'

const MIN_WIDTH = 200
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 250

export function Sidebar() {
  const { username, role, id, avatarVersion } = useAuth()
  const avatarUrl = useAvatar(id, avatarVersion)
  const { catalog, error } = useCatalog()
  const navigate = useNavigate()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const draggingRef = useRef(false)

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
          Files
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
      <div className="sidebar-picker">
        {error && <p role="status">Error: {error}</p>}
        {catalog && (
          <ShipYearFilePicker
            catalog={catalog}
            onSelectFile={(filename) => navigate(`/files/${encodeURIComponent(filename)}`)}
          />
        )}
      </div>
      <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />
    </aside>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 new Sidebar tests)

- [ ] **Step 5: Run FULL suite**

Run: `npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass

- [ ] **Step 6 (SKIP — no git)**

## Context

The resize handle uses raw `window.addEventListener('mousemove'/'mouseup')`
rather than React synthetic events, since dragging needs to keep tracking
the mouse even when it moves off the small handle element itself — this is
the standard pattern for drag-resize UIs. `e.clientX` as the new width is a
simplification that assumes the sidebar starts at the left edge of the
viewport (true here, since it's the leftmost element in the flex row) —
works correctly for this layout, would need adjusting if the sidebar were
ever nested deeper.

## Before You Begin

Ask now if anything is unclear.

## Your Job

1. TDD: write test first, confirm correct failure, implement, confirm pass
2. Run FULL suite
3. Self-review — specifically check the resize handler doesn't leak
   `window` listeners (confirm `handleMouseUp` always removes both listeners
   it added, even if the drag is very short)
4. Report back

Work from `/Users/ustropics/Documents/svidat/client/`.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test/build command + actual output (paste real output)
- Files created/modified
- Self-review findings
- Concerns

---

### Task 6: Wire Sidebar into the app shell

**Files:**
- Modify: `client/src/components/ProtectedRoute.tsx`

- [ ] **Step 1: Update ProtectedRoute**

Replace `client/src/components/ProtectedRoute.tsx` entirely:
```typescript
import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Navbar } from './Navbar'
import { Sidebar } from './Sidebar'
import { useAuth } from '../context/AuthContext'
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
    <>
      <Navbar />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">{children}</main>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Run FULL suite**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass — confirm `ProtectedRoute.test.tsx`'s 3 existing tests
still pass (they assert on text content only, unaffected by the new
`.app-body`/`.app-main` wrapper divs). Sidebar will attempt to fetch the
catalog in these tests too (no `getCatalog` mock in that test file) —
confirm this doesn't break anything: `useCatalog`'s fetch failure just sets
`error` state, doesn't throw synchronously, so the component still renders
fine even if the network call itself fails/rejects in the jsdom test
environment. Check the actual test output for any unexpected console
errors/warnings and report them even if the tests still pass.

- [ ] **Step 3 (SKIP — no git)**

## Context

This is the single wiring point — same pattern as when `Navbar` was first
added to `ProtectedRoute`. Every protected page now automatically gets the
full navbar+sidebar+main shell with no per-page changes needed.

## Before You Begin

Ask now if anything is unclear.

## Your Job

1. Apply the change
2. Run FULL suite, pay attention to `ProtectedRoute.test.tsx` specifically and report on any console warnings even if tests pass
3. Self-review
4. Report back

Work from `/Users/ustropics/Documents/svidat/client/`.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test/build command + actual output (paste real output, including any console warnings from the ProtectedRoute tests)
- Files modified
- Self-review findings
- Concerns

---

### Task 7: FilesPage rewrite (was FileBrowserPage)

**Files:**
- Create: `client/src/pages/FilesPage.tsx`
- Delete: `client/src/pages/FileBrowserPage.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/__tests__/FilesPage.test.tsx`

- [ ] **Step 1: Write failing test**

Create `client/src/__tests__/FilesPage.test.tsx`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilesPage } from '../pages/FilesPage'
import { AuthProvider } from '../context/AuthContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

function renderFilesPage(role: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <FilesPage />
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('FilesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the ship/year/file picker once the catalog loads', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    vi.spyOn(apiClient, 'listDrafts').mockResolvedValue([])
    renderFilesPage('qca')
    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
  })

  it('shows My drafts section for qca/admin roles', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    vi.spyOn(apiClient, 'listDrafts').mockResolvedValue(['shipx_2026-07-30'])
    renderFilesPage('qca')
    await waitFor(() => expect(screen.getByText('My drafts')).toBeInTheDocument())
    expect(screen.getByText('shipx_2026-07-30')).toBeInTheDocument()
  })

  it('hides My drafts section for user role', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    renderFilesPage('user')
    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    expect(screen.queryByText('My drafts')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pages/FilesPage'`

- [ ] **Step 3: Implement FilesPage**

Create `client/src/pages/FilesPage.tsx`:
```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDrafts } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useCatalog } from '../hooks/useCatalog'
import { ShipYearFilePicker } from '../components/ShipYearFilePicker'

export function FilesPage() {
  const { role } = useAuth()
  const { catalog, error } = useCatalog()
  const [drafts, setDrafts] = useState<string[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    if (role === 'admin' || role === 'qca') {
      listDrafts().then(setDrafts)
    }
  }, [role])

  return (
    <div>
      <h1>Files</h1>
      <section>
        <h2>Browse by ship</h2>
        {error && <p role="status">Error: {error}</p>}
        {catalog && (
          <ShipYearFilePicker
            catalog={catalog}
            onSelectFile={(filename) => navigate(`/files/${encodeURIComponent(filename)}`)}
          />
        )}
      </section>
      {(role === 'admin' || role === 'qca') && (
        <section>
          <h2>My drafts</h2>
          <ul>
            {drafts.map((f) => (
              <li key={f}>
                <a
                  href={`/files/${encodeURIComponent(f)}?source=draft`}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(`/files/${encodeURIComponent(f)}?source=draft`)
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 new FilesPage tests)

- [ ] **Step 5: Remove the old FileBrowserPage and update routing**

Delete `client/src/pages/FileBrowserPage.tsx` (its old raw-files listing is
now redundant — the new `Sidebar`/`FilesPage` ship→year→file picker covers
the same "browse raw files" purpose, and "My drafts" is preserved in the
new `FilesPage`).

In `client/src/App.tsx`: change `import { FileBrowserPage } from
'./pages/FileBrowserPage'` to `import { FilesPage } from
'./pages/FilesPage'`, and update the `/files` route's element from
`<FileBrowserPage />` to `<FilesPage />`.

- [ ] **Step 6: Run FULL suite**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass — confirm no leftover references to `FileBrowserPage`
anywhere (grep the `src/` tree to be sure) and that the build doesn't warn
about an unused/missing import.

- [ ] **Step 7 (SKIP — no git)**

## Context

The old `FileBrowserPage`'s "Raw files" flat list is fully superseded by the
ship→year→file picker (same underlying data — `/files/raw`'s flat filename
list vs `/files/catalog`'s grouped version — just a better UI for 105k
files than one giant flat `<ul>`). "My drafts" is preserved unchanged since
the catalog only covers raw files, not drafts (per the design doc's explicit
call to avoid regressing that feature).

## Before You Begin

Ask now if anything is unclear.

## Your Job

1. TDD: write test first, confirm correct failure, implement, confirm pass
2. Delete the old page, update routing
3. Run FULL suite, grep for leftover `FileBrowserPage` references
4. Self-review
5. Report back

Work from `/Users/ustropics/Documents/svidat/client/`.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test/build command + actual output (paste real output)
- Files created/modified/deleted
- Self-review findings (confirm no leftover FileBrowserPage references)
- Concerns

---

### Task 8: Full suite + live smoke test

- [ ] **Step 1: Backend**

Run: `conda activate svidat && cd /Users/ustropics/Documents/svidat/server && pytest -v`
Expected: all pass (80 prior + 4 new catalog tests)

- [ ] **Step 2: Frontend**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass (18 prior + new tests from Tasks 2, 3, 5, 7)

- [ ] **Step 3: Live smoke test**

Start backend and frontend dev servers. Log in as `admin`. Confirm: navbar
spans the full window width (no centered/bordered constraint visible).
Sidebar renders below it at ~250px with the welcome header (avatar +
"admin"), Files/Admin/Profile links, and the three ship/year/file dropdowns
— populated with real data from the 105k downloaded files. Pick a ship,
confirm the year dropdown populates; pick a year, confirm the file dropdown
populates; pick a file, confirm it navigates to that file's `DataViewerPage`.
Drag the sidebar's right edge and confirm it resizes smoothly within the
200–400px range and stays clamped at the extremes. Resize the browser
window below 1024px width and confirm the sidebar collapses into a
horizontal strip under the navbar (links wrap into a row, dropdowns stack
below, no resize handle visible). Visit `/files` directly and confirm the
same ship/year/file picker renders there too, plus the "My drafts" section
below it. Confirm `/files/:filename`, `/profile`, `/admin/users` all still
render correctly with the new shell around them.
