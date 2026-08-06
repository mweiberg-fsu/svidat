# Flag-edit revert support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `flag_edit` audit-log entries revertible, so the Revert button already shown for `point_edit`/`bulk_edit` rows in both audit views also appears — and works — for `flag_edit` rows.

**Architecture:** Add a `restore_flags` netCDF write path mirroring the existing `restore_bulk`, wire it into `audit.py`'s `revert()` endpoint as a third branch alongside `point_edit`/`bulk_edit`, then widen the two frontend action-gating checks that currently hide the Revert button for anything other than `point_edit`/`bulk_edit`.

**Tech Stack:** FastAPI, SQLAlchemy, netCDF4/numpy (backend); React + TypeScript, Vitest + Testing Library (frontend); pytest (backend tests).

**Note:** This project directory has no git repository — commit steps are intentionally omitted from this plan. Verify each task via its test run before moving to the next.

---

### Task 1: `restore_flags` in `netcdf_ops.py`

**Files:**
- Modify: `server/app/netcdf_ops.py`
- Test: `server/tests/test_netcdf_ops.py`

- [ ] **Step 1: Write the failing test**

Add to the end of `server/tests/test_netcdf_ops.py`:

```python
def test_restore_flags_restores_previous_values(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    old = netcdf_ops.write_flags(path, "temperature", 1, 3, "K")
    netcdf_ops.restore_flags(path, "temperature", 1, 3, old)

    result = netcdf_ops.get_variable_data(path, ["temperature"])
    assert result["variables"]["temperature"]["flags"] == ["Z", "Z", "Z", "Z", "Z"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && conda activate svidat && pytest tests/test_netcdf_ops.py::test_restore_flags_restores_previous_values -v`
Expected: FAIL with `AttributeError: module 'app.netcdf_ops' has no attribute 'restore_flags'`

- [ ] **Step 3: Factor out the qcindex/column lookup and add `restore_flags`**

In `server/app/netcdf_ops.py`, replace the existing `write_flags` function with this (adds a private `_flag_column` helper used by both `write_flags` and the new `restore_flags`; `write_flags`'s behavior — exceptions, messages — is unchanged):

```python
def _flag_column(ds, var_name: str) -> int:
    if var_name not in ds.variables:
        raise KeyError(var_name)
    var = ds.variables[var_name]
    if "qcindex" not in var.ncattrs():
        raise ValueError(f"variable '{var_name}' has no qcindex attr")
    qcindex = int(var.getncattr("qcindex"))
    if qcindex < 1:
        raise ValueError(f"invalid qcindex {qcindex} for variable '{var_name}'")
    return qcindex - 1


def write_flags(
    path, var_name: str, start_idx: int, end_idx: int, flag_code: str
) -> np.ndarray:
    if len(flag_code) != 1:
        raise ValueError(f"flag_code must be a single character: {flag_code!r}")
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        col = _flag_column(ds, var_name)

        flag_var = ds.variables["flag"]
        valid_codes = {
            a for a in flag_var.ncattrs() if len(a) == 1 and a.isalpha() and a.isupper()
        }
        if flag_code not in valid_codes:
            raise ValueError(
                f"invalid flag_code {flag_code!r}, must be one of {sorted(valid_codes)}"
            )

        old_values = np.array(flag_var[start_idx:end_idx, col])
        flag_var[start_idx:end_idx, col] = np.array(
            [flag_code.encode()] * (end_idx - start_idx), dtype="S1"
        )
    return old_values


def restore_flags(
    path, var_name: str, start_idx: int, end_idx: int, old_values: np.ndarray
) -> None:
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        col = _flag_column(ds, var_name)
        flag_var = ds.variables["flag"]
        flag_var[start_idx:end_idx, col] = old_values
```

- [ ] **Step 4: Run the new test, then the full file, to verify pass with no regressions**

Run: `cd server && conda activate svidat && pytest tests/test_netcdf_ops.py -v`
Expected: all tests PASS, including `test_restore_flags_restores_previous_values` and the pre-existing `test_write_flags_*` tests (unchanged behavior after the refactor).

---

### Task 2: `flag_edit` branch in `audit.py`'s `revert()`

**Files:**
- Modify: `server/app/routers/audit.py:69-140` (the `revert()` function)
- Test: `server/tests/test_audit_routes.py`

- [ ] **Step 1: Write the failing test**

Add to the end of `server/tests/test_audit_routes.py`:

```python
def test_revert_flag_edit_restores_values(client, auth_header, synthetic_nc_with_qc):
    import time

    synthetic_nc_with_qc("shipx_2026-08-31")
    headers = auth_header("audituser13", Role.qca)
    client.post("/session/shipx_2026-08-31/open", params={"source": "raw"}, headers=headers)
    flag_resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-31",
            "var_name": "temperature",
            "start_time_idx": 1,
            "end_time_idx": 3,
            "flag_code": "K",
        },
        headers=headers,
    )
    job_id = flag_resp.json()["job_id"]

    deadline = time.time() + 2
    audit_id = None
    while time.time() < deadline:
        job_resp = client.get(f"/edit/jobs/{job_id}", headers=headers)
        body = job_resp.json()
        if body["status"] == "done":
            audit_id = body["result"]["audit_id"]
            break
        time.sleep(0.02)
    assert audit_id is not None

    data_before = client.get(
        "/files/shipx_2026-08-31/data", params={"vars": "temperature"}, headers=headers
    )
    assert data_before.json()["variables"]["temperature"]["flags"] == ["Z", "K", "K", "Z", "Z"]

    resp = client.post(f"/audit/{audit_id}/revert", headers=headers)
    assert resp.status_code == 200

    data_after = client.get(
        "/files/shipx_2026-08-31/data", params={"vars": "temperature"}, headers=headers
    )
    assert data_after.json()["variables"]["temperature"]["flags"] == ["Z", "Z", "Z", "Z", "Z"]

    entries = client.get("/audit/shipx_2026-08-31", headers=headers).json()
    flag_entry = next(e for e in entries if e["id"] == audit_id)
    assert flag_entry["reverted"] is True


def test_revert_flag_edit_already_reverted_returns_409(client, auth_header, synthetic_nc_with_qc):
    import time

    synthetic_nc_with_qc("shipx_2026-09-03")
    headers = auth_header("audituser14", Role.qca)
    client.post("/session/shipx_2026-09-03/open", params={"source": "raw"}, headers=headers)
    flag_resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-09-03",
            "var_name": "temperature",
            "start_time_idx": 0,
            "end_time_idx": 1,
            "flag_code": "K",
        },
        headers=headers,
    )
    job_id = flag_resp.json()["job_id"]

    deadline = time.time() + 2
    audit_id = None
    while time.time() < deadline:
        job_resp = client.get(f"/edit/jobs/{job_id}", headers=headers)
        body = job_resp.json()
        if body["status"] == "done":
            audit_id = body["result"]["audit_id"]
            break
        time.sleep(0.02)
    assert audit_id is not None

    client.post(f"/audit/{audit_id}/revert", headers=headers)
    resp = client.post(f"/audit/{audit_id}/revert", headers=headers)
    assert resp.status_code == 409
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && conda activate svidat && pytest tests/test_audit_routes.py::test_revert_flag_edit_restores_values tests/test_audit_routes.py::test_revert_flag_edit_already_reverted_returns_409 -v`
Expected: FAIL — `test_revert_flag_edit_restores_values` fails at the first revert call with a 400 ("entry not revertible"); `test_revert_flag_edit_already_reverted_returns_409` fails the same way on its first revert call (both first calls currently 400 rather than 200).

- [ ] **Step 3: Implement the `flag_edit` revert branch**

In `server/app/routers/audit.py`, the `revert()` function currently has:

```python
    if entry.action not in ("point_edit", "bulk_edit"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="entry not revertible"
        )
```

Change to:

```python
    if entry.action not in ("point_edit", "bulk_edit", "flag_edit"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="entry not revertible"
        )
```

Further down, the function has:

```python
    if entry.action == "point_edit":
        indices = json.loads(entry.indices_json)
        try:
            with file_write_lock(f"nc:{entry.filename}"):
                netcdf_ops.restore_point(path, entry.var_name, indices, entry.old_value_scalar)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"could not revert: {exc}"
            )
        new_log = AuditLog(
            filename=entry.filename,
            user_id=user.id,
            action="revert",
            var_name=entry.var_name,
            indices_json=entry.indices_json,
            old_value_scalar=entry.new_value_scalar,
            new_value_scalar=entry.old_value_scalar,
        )
    else:
        slices = [tuple(pair) for pair in json.loads(entry.indices_json)]
        try:
            old_values = np.load(entry.old_value_ref)
            with file_write_lock(f"nc:{entry.filename}"):
                netcdf_ops.restore_bulk(path, entry.var_name, slices, old_values)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"could not revert: {exc}"
            )
        new_log = AuditLog(
            filename=entry.filename,
            user_id=user.id,
            action="revert",
            var_name=entry.var_name,
            indices_json=entry.indices_json,
            old_value_ref=entry.old_value_ref,
        )
```

Change the trailing `else:` to `elif entry.action == "bulk_edit":` and add a new `else:` branch for `flag_edit` immediately after it:

```python
    if entry.action == "point_edit":
        indices = json.loads(entry.indices_json)
        try:
            with file_write_lock(f"nc:{entry.filename}"):
                netcdf_ops.restore_point(path, entry.var_name, indices, entry.old_value_scalar)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"could not revert: {exc}"
            )
        new_log = AuditLog(
            filename=entry.filename,
            user_id=user.id,
            action="revert",
            var_name=entry.var_name,
            indices_json=entry.indices_json,
            old_value_scalar=entry.new_value_scalar,
            new_value_scalar=entry.old_value_scalar,
        )
    elif entry.action == "bulk_edit":
        slices = [tuple(pair) for pair in json.loads(entry.indices_json)]
        try:
            old_values = np.load(entry.old_value_ref)
            with file_write_lock(f"nc:{entry.filename}"):
                netcdf_ops.restore_bulk(path, entry.var_name, slices, old_values)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"could not revert: {exc}"
            )
        new_log = AuditLog(
            filename=entry.filename,
            user_id=user.id,
            action="revert",
            var_name=entry.var_name,
            indices_json=entry.indices_json,
            old_value_ref=entry.old_value_ref,
        )
    else:  # flag_edit
        start_idx, end_idx = json.loads(entry.indices_json)
        try:
            old_values = np.load(entry.old_value_ref)
            with file_write_lock(f"nc:{entry.filename}"):
                netcdf_ops.restore_flags(path, entry.var_name, start_idx, end_idx, old_values)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"could not revert: {exc}"
            )
        new_log = AuditLog(
            filename=entry.filename,
            user_id=user.id,
            action="revert",
            var_name=entry.var_name,
            indices_json=entry.indices_json,
            old_value_ref=entry.old_value_ref,
        )
```

No other part of `revert()` changes — the lock checks, session checks, the atomic `reverted` claim, and the final `db.add(new_log)` / `db.commit()` all already operate generically on `new_log` regardless of which branch built it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && conda activate svidat && pytest tests/test_audit_routes.py -v`
Expected: all tests PASS, including the two new ones and every pre-existing `point_edit`/`bulk_edit` revert test (unaffected by the `if/elif/else` restructure).

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `cd server && conda activate svidat && pytest -v`
Expected: all tests PASS.

---

### Task 3: Widen the Revert-button gating in `AuditHistoryModal.tsx`

**Files:**
- Modify: `client/src/components/AuditHistoryModal.tsx:129`
- Test: `client/src/__tests__/AuditHistoryModal.test.tsx`

- [ ] **Step 1: Write the failing test**

In `client/src/__tests__/AuditHistoryModal.test.tsx`, add a `flag_edit` entry to the shared `entries` array (after the existing `bulk_edit` entry, before the closing `]`):

```tsx
  {
    id: 3,
    filename: 'shipx_2026-08-27',
    user_id: 1,
    username: 'testuser',
    action: 'flag_edit',
    var_name: 'temperature',
    old_value: null,
    new_value: 'K',
    reverted: false,
    timestamp: '2026-08-04T10:00:00',
  },
```

Then add a new test case, right after the existing `'shows Revert for a non-reverted point_edit and Reverted for an already-reverted entry'` test:

```tsx
  it('shows Revert for a non-reverted flag_edit entry', async () => {
    vi.spyOn(apiClient, 'getMyAuditHistory').mockResolvedValue(entries)
    renderModal()

    await waitFor(() => expect(screen.getAllByText('Revert')).toHaveLength(2))
  })
```

(Two `Revert` buttons now: one for the `point_edit` entry, one for the new `flag_edit` entry — the `bulk_edit` entry stays `reverted: true` and shows "Reverted" instead.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/AuditHistoryModal.test.tsx -t "shows Revert for a non-reverted flag_edit entry"`
Expected: FAIL — only one `Revert` button found (the `flag_edit` row currently renders nothing).

- [ ] **Step 3: Widen the gating condition**

In `client/src/components/AuditHistoryModal.tsx`, find:

```tsx
              {e.action !== 'point_edit' && e.action !== 'bulk_edit' ? null : e.reverted ? (
```

Change to:

```tsx
              {e.action !== 'point_edit' && e.action !== 'bulk_edit' && e.action !== 'flag_edit'
                ? null
                : e.reverted ? (
```

Note the closing of that ternary further down (the `)}` after the `<button>...</button>`) does not need to change — only the condition expression.

- [ ] **Step 4: Run the full test file to verify it passes with no regressions**

Run: `cd client && npx vitest run src/__tests__/AuditHistoryModal.test.tsx`
Expected: all tests PASS.

---

### Task 4: Widen the Revert-button gating in `AuditPanel.tsx`

**Files:**
- Modify: `client/src/components/AuditPanel.tsx:47`
- Test: `client/src/__tests__/AuditPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

In `client/src/__tests__/AuditPanel.test.tsx`, add a new test case at the end of the `describe` block, before the closing `})`:

```tsx
  it('shows a Revert button for a non-reverted flag_edit entry', async () => {
    const flagEntry: AuditEntry = {
      id: 2,
      user_id: 1,
      username: 'audituser1',
      action: 'flag_edit',
      var_name: 'temperature',
      old_value: null,
      new_value: 'K',
      reverted: false,
      timestamp: '2026-08-04T10:00:00',
    }
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([flagEntry])

    render(<AuditPanel filename="shipx_2026-08-27" refreshSignal={0} />)

    await waitFor(() => expect(screen.getByText('Revert')).toBeInTheDocument())
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/AuditPanel.test.tsx -t "shows a Revert button for a non-reverted flag_edit entry"`
Expected: FAIL — the `flag_edit` row currently renders nothing, so no "Revert" text is found.

- [ ] **Step 3: Widen the gating condition**

In `client/src/components/AuditPanel.tsx`, find:

```tsx
            {e.action !== 'point_edit' && e.action !== 'bulk_edit' ? null : e.reverted ? (
```

Change to:

```tsx
            {e.action !== 'point_edit' && e.action !== 'bulk_edit' && e.action !== 'flag_edit'
              ? null
              : e.reverted ? (
```

- [ ] **Step 4: Run the full test file to verify it passes with no regressions**

Run: `cd client && npx vitest run src/__tests__/AuditPanel.test.tsx`
Expected: all tests PASS.

---

### Task 5: Full verification pass

- [ ] **Step 1: Run the full backend suite**

Run: `cd server && conda activate svidat && pytest -v`
Expected: all tests PASS (should now be 70+ pre-existing plus 3 new: `test_restore_flags_restores_previous_values`, `test_revert_flag_edit_restores_values`, `test_revert_flag_edit_already_reverted_returns_409`).

- [ ] **Step 2: Run the full frontend suite**

Run: `cd client && npm test`
Expected: all tests PASS.

- [ ] **Step 3: Run the frontend lint and typecheck**

Run: `cd client && npm run lint && npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Manual spot-check against the real `svidat.db`**

The 8 pre-existing `flag_edit` entries found in `server/svidat.db` during earlier investigation (ids 5–12, filenames `KAQP_20250101v20001`, `KAQP_20080103v20001`, `KCEJ_20080105v20001` ×3, `KAQP_20090101v20001`, `KAQP_20130124v20001`, `KAQP_20070101v20001`) should now show a working Revert button in the Audit History modal (open a session for one of those files first, since revert requires an active lock — the existing 409 "no active edit lock for this file" behavior is unchanged and expected if no session is open).
