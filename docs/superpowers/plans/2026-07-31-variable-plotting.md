# Variable Plotting & QC Flagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting variables in a new sidebar picker renders one synced-zoom
time-series plot per variable on `/files`, colored by existing QC flag, with
drag-select-to-flag writing real QC flags into the file through the existing
edit/lock/audit machinery.

**Architecture:** Backend gains a read-only `/files/{filename}/data` endpoint
(values + ISO time + per-point flag char, missing-value masked) and a
`POST /edit/flag` write endpoint (same lock/job/audit pattern as `bulk_edit`,
targeting the shared SAMOS `flag` char variable via each variable's
`qcindex` attr). Frontend gets a new `PlotPicker` (sidebar, `/files` only,
mirrors the existing `ShipYearFilePicker`/`VariableBrowser` cascade pattern
without navigating), a `PlotSelectionContext` to share picker state between
`Sidebar` and `FilesPage` (siblings, not parent/child), and a `PlotView` that
renders one stacked Plotly figure (subplot grid, x-axes linked via `matches`
for true synced zoom/pan) with a flag toolbar per variable.

**Tech Stack:** FastAPI, netCDF4-python, SQLAlchemy (existing) + Plotly.js
via `react-plotly.js`'s factory API with the smaller `plotly.js-dist-min`
build (new).

**Implementation note on the approved mockup:** the mockup showed a flag
toolbar visually pinned under one plot. Because true synced zoom/pan across
multiple variables requires them to live in a *single* Plotly figure (Plotly
only links axes with `matches` within one figure, not across separate
component instances), the toolbars render as a list below the combined
figure instead, one entry per variable with an active selection, each
labeled with that variable's name. Functionally identical (per-variable
selection + flag controls), just not visually nested under literal separate
plot boxes.

---

### Task 1: AuditLog gains `new_value_str` for flag codes

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/routers/audit.py`
- Test: `server/tests/test_models.py`

- [ ] **Step 1: Write the failing test**

Append to `server/tests/test_models.py`:

```python
def test_audit_log_new_value_str(db_session, make_user):
    from datetime import datetime
    from app.models import AuditLog, Role

    user = make_user("flagger1", Role.qca)
    log = AuditLog(
        filename="shipx_2026-07-30",
        user_id=user.id,
        action="flag_edit",
        var_name="temperature",
        new_value_str="K",
        timestamp=datetime.utcnow(),
    )
    db_session.add(log)
    db_session.commit()
    db_session.refresh(log)
    assert log.new_value_str == "K"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && conda run -n svidat pytest tests/test_models.py::test_audit_log_new_value_str -v`
Expected: FAIL — `TypeError: 'new_value_str' is an invalid keyword argument for AuditLog`

- [ ] **Step 3: Add the column**

In `server/app/models.py`, in the `AuditLog` class, add after `new_value_scalar`:

```python
    new_value_str = Column(String, nullable=True)
```

(`String` is already imported at the top of the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && conda run -n svidat pytest tests/test_models.py::test_audit_log_new_value_str -v`
Expected: PASS (the pytest temp DB is created fresh via `Base.metadata.create_all`, so it picks up the new column automatically)

- [ ] **Step 5: Surface it in the audit history response**

In `server/app/routers/audit.py`, in `history()`, change:

```python
            "new_value": e.new_value_scalar,
```

to:

```python
            "new_value": e.new_value_scalar if e.new_value_scalar is not None else e.new_value_str,
```

- [ ] **Step 6: Migrate the real dev database**

Per `server/README.md`'s documented convention (PRAGMA `table_info` check +
conditional `ALTER TABLE`, same pattern as the earlier `avatar_path`
migration), run this once against the existing dev `server/svidat.db`:

```bash
cd server && conda run -n svidat python3 -c "
import sqlite3
conn = sqlite3.connect('svidat.db')
cols = [row[1] for row in conn.execute('PRAGMA table_info(audit_log)')]
if 'new_value_str' not in cols:
    conn.execute('ALTER TABLE audit_log ADD COLUMN new_value_str TEXT')
    conn.commit()
    print('migrated')
else:
    print('already migrated')
conn.close()
"
```

Expected output: `migrated` (or `already migrated` if run twice).

---

### Task 2: `netcdf_ops` — read variable data, write QC flags

**Files:**
- Modify: `server/app/netcdf_ops.py`
- Modify: `server/tests/conftest.py` (new fixture)
- Test: `server/tests/test_netcdf_ops.py`

- [ ] **Step 1: Add a synthetic QC fixture to conftest**

Append to `server/tests/conftest.py`:

```python
@pytest.fixture
def synthetic_nc_with_qc():
    def _make(filename: str = "shipx_2026-07-30"):
        raw_dir = Path(os.environ["DATA_DIR"]) / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        path = raw_dir / f"{filename}.nc"
        with netCDF4.Dataset(path, "w") as ds:
            ds.createDimension("time", 5)
            ds.createDimension("f_string", 2)

            time_var = ds.createVariable("time", "i4", ("time",))
            time_var[:] = np.array([0, 60, 120, 180, 240], dtype="i4")
            time_var.units = "minutes since 1-1-2025 00:00 UTC"

            temp_var = ds.createVariable("temperature", "f4", ("time",))
            temp_var[:] = np.array([10.0, -9999.0, 12.0, 13.0, 14.0], dtype="f4")
            temp_var.missing_value = -9999.0
            temp_var.qcindex = 1

            sal_var = ds.createVariable("salinity", "f4", ("time",))
            sal_var[:] = np.array([30.0, 31.0, 32.0, 33.0, 34.0], dtype="f4")
            sal_var.qcindex = 2

            flag_var = ds.createVariable("flag", "S1", ("time", "f_string"))
            flag_var[:, 0] = np.array([b"Z"] * 5, dtype="S1")
            flag_var[:, 1] = np.array([b"Z"] * 5, dtype="S1")
            flag_var.long_name = "quality control flags"
            flag_var.Z = "Good data"
            flag_var.K = "Suspect - visual"
        return path

    return _make
```

Add `import os` / `from pathlib import Path` are already present at the top
of `conftest.py` — no new imports needed for this fixture (`netCDF4` and
`np` are already imported there too).

- [ ] **Step 2: Write the failing tests**

Append to `server/tests/test_netcdf_ops.py`:

```python
def test_get_variable_data_masks_missing_and_converts_time(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    result = netcdf_ops.get_variable_data(path, ["temperature", "salinity"])

    assert result["time"][0].startswith("2025-01-01")
    assert len(result["time"]) == 5

    temp = result["variables"]["temperature"]
    assert temp["values"][0] == pytest.approx(10.0)
    assert temp["values"][1] is None  # masked missing_value
    assert temp["flags"] == ["Z", "Z", "Z", "Z", "Z"]

    sal = result["variables"]["salinity"]
    assert sal["values"][1] == pytest.approx(31.0)


def test_get_variable_data_unknown_variable_raises_keyerror(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    with pytest.raises(KeyError):
        netcdf_ops.get_variable_data(path, ["not_a_variable"])


def test_write_flags_sets_range_and_returns_old(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    old = netcdf_ops.write_flags(path, "temperature", 1, 3, "K")
    assert [v.decode() if isinstance(v, bytes) else v for v in old] == ["Z", "Z"]

    result = netcdf_ops.get_variable_data(path, ["temperature", "salinity"])
    assert result["variables"]["temperature"]["flags"] == ["Z", "K", "K", "Z", "Z"]
    # salinity's own qcindex column (2) must be untouched
    assert result["variables"]["salinity"]["flags"] == ["Z", "Z", "Z", "Z", "Z"]


def test_write_flags_rejects_unknown_code(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    with pytest.raises(ValueError):
        netcdf_ops.write_flags(path, "temperature", 0, 1, "Q")


def test_write_flags_rejects_var_without_qcindex(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    with pytest.raises(ValueError):
        netcdf_ops.write_flags(path, "flag", 0, 1, "K")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && conda run -n svidat pytest tests/test_netcdf_ops.py -k "variable_data or write_flags" -v`
Expected: FAIL — `AttributeError: module 'app.netcdf_ops' has no attribute 'get_variable_data'`

- [ ] **Step 4: Implement `get_variable_data` and `write_flags`**

In `server/app/netcdf_ops.py`, change the top import line to also pull in
`netCDF4.num2date`, then append both functions at the end of the file:

```python
def get_variable_data(path, var_names: List[str]) -> Dict[str, Any]:
    with netCDF4.Dataset(path, "r") as ds:
        ds.set_auto_mask(False)

        if "time" not in ds.variables:
            raise KeyError("time")
        time_var = ds.variables["time"]
        time_values = netCDF4.num2date(
            time_var[:],
            units=time_var.units,
            only_use_cftime_datetimes=False,
            only_use_python_datetimes=True,
        )
        time_iso = [t.isoformat() for t in time_values]

        flag_var = ds.variables.get("flag")

        result_vars: Dict[str, Any] = {}
        for name in var_names:
            if name not in ds.variables:
                raise KeyError(name)
            var = ds.variables[name]
            attrs = set(var.ncattrs())
            values = np.array(var[:], dtype=float)

            mask = np.zeros(values.shape, dtype=bool)
            if "missing_value" in attrs:
                mask |= np.isclose(values, float(var.getncattr("missing_value")))
            if "special_value" in attrs:
                mask |= np.isclose(values, float(var.getncattr("special_value")))
            value_list = [None if m else float(v) for v, m in zip(values, mask)]

            flags = None
            if flag_var is not None and "qcindex" in attrs:
                qcindex = int(var.getncattr("qcindex"))
                flag_col = flag_var[:, qcindex - 1]
                flags = [
                    f.decode() if isinstance(f, bytes) else str(f) for f in flag_col
                ]

            result_vars[name] = {"values": value_list, "flags": flags}

    return {"time": time_iso, "variables": result_vars}


def write_flags(
    path, var_name: str, start_idx: int, end_idx: int, flag_code: str
) -> np.ndarray:
    if len(flag_code) != 1:
        raise ValueError(f"flag_code must be a single character: {flag_code!r}")
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        if var_name not in ds.variables:
            raise KeyError(var_name)
        var = ds.variables[var_name]
        if "qcindex" not in var.ncattrs():
            raise ValueError(f"variable '{var_name}' has no qcindex attr")
        qcindex = int(var.getncattr("qcindex"))

        flag_var = ds.variables["flag"]
        valid_codes = {
            a for a in flag_var.ncattrs() if len(a) == 1 and a.isalpha() and a.isupper()
        }
        if flag_code not in valid_codes:
            raise ValueError(
                f"invalid flag_code {flag_code!r}, must be one of {sorted(valid_codes)}"
            )

        col = qcindex - 1
        old_values = np.array(flag_var[start_idx:end_idx, col])
        flag_var[start_idx:end_idx, col] = np.array(
            [flag_code.encode()] * (end_idx - start_idx), dtype="S1"
        )
    return old_values
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && conda run -n svidat pytest tests/test_netcdf_ops.py -v`
Expected: PASS, all tests including pre-existing ones in the file.

---

### Task 3: `GET /files/{filename}/data` route

**Files:**
- Modify: `server/app/routers/files.py`
- Test: `server/tests/test_files_routes.py`

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/test_files_routes.py`:

```python
def test_file_data_returns_values_and_flags(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-20")
    headers = auth_header("dataviewer1", Role.user)
    resp = client.get(
        "/files/shipx_2026-08-20/data",
        params={"vars": "temperature,salinity"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["time"]) == 5
    assert body["variables"]["temperature"]["values"][1] is None
    assert body["variables"]["salinity"]["flags"] == ["Z", "Z", "Z", "Z", "Z"]


def test_file_data_unknown_variable_returns_400(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-21")
    headers = auth_header("dataviewer2", Role.user)
    resp = client.get(
        "/files/shipx_2026-08-21/data",
        params={"vars": "not_a_variable"},
        headers=headers,
    )
    assert resp.status_code == 400


def test_file_data_missing_file_returns_404(client, auth_header):
    headers = auth_header("dataviewer3", Role.user)
    resp = client.get(
        "/files/does_not_exist_2026/data", params={"vars": "temperature"}, headers=headers
    )
    assert resp.status_code == 404
```

`test_files_routes.py` already imports `Role` at the top
(`from app.models import Role`), so no import changes are needed for these
tests — also add `synthetic_nc_with_qc` as a parameter where used above;
it comes from the `conftest.py` fixture added in Task 2 and is
automatically available to every test file in `server/tests/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && conda run -n svidat pytest tests/test_files_routes.py -k "file_data" -v`
Expected: FAIL — 404 "Not Found" (route doesn't exist yet)

- [ ] **Step 3: Add the route**

In `server/app/routers/files.py`, append at the end of the file:

```python
@router.get("/{filename}/data")
def file_data(filename: str, vars: str, _: User = Depends(get_current_user)):
    var_names = [v for v in vars.split(",") if v]
    if not var_names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="vars is required"
        )
    try:
        path = storage.raw_path(filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="file not found"
        )
    try:
        return netcdf_ops.get_variable_data(path, var_names)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"unknown variable: {exc}"
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && conda run -n svidat pytest tests/test_files_routes.py -v`
Expected: PASS, all tests including pre-existing ones in the file.

---

### Task 4: `POST /edit/flag` route

**Files:**
- Modify: `server/app/schemas.py`
- Modify: `server/app/routers/edit.py`
- Test: `server/tests/test_edit_routes.py`

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/test_edit_routes.py`:

```python
def test_flag_edit_writes_flag_and_logs_audit(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-22")
    headers = auth_header("flageditor1", Role.qca)
    client.post("/session/shipx_2026-08-22/open", params={"source": "raw"}, headers=headers)

    resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-22",
            "var_name": "temperature",
            "start_time_idx": 1,
            "end_time_idx": 3,
            "flag_code": "K",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]

    result = _wait_for_job(client, headers, job_id)
    assert result["status"] == "done"

    data_resp = client.get(
        "/files/shipx_2026-08-22/data", params={"vars": "temperature"}, headers=headers
    )
    assert data_resp.json()["variables"]["temperature"]["flags"] == ["Z", "K", "K", "Z", "Z"]

    audit_resp = client.get("/audit/shipx_2026-08-22", headers=headers)
    entries = audit_resp.json()
    flag_entries = [e for e in entries if e["action"] == "flag_edit"]
    assert len(flag_entries) == 1
    assert flag_entries[0]["new_value"] == "K"


def test_flag_edit_requires_open_session(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-23")
    headers = auth_header("flageditor2", Role.qca)
    resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-23",
            "var_name": "temperature",
            "start_time_idx": 0,
            "end_time_idx": 1,
            "flag_code": "K",
        },
        headers=headers,
    )
    assert resp.status_code in (404, 409)


def test_regular_user_cannot_flag_edit(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-24")
    headers = auth_header("viewer6", Role.user)
    resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-24",
            "var_name": "temperature",
            "start_time_idx": 0,
            "end_time_idx": 1,
            "flag_code": "K",
        },
        headers=headers,
    )
    assert resp.status_code == 403


def test_flag_edit_invalid_code_fails_job(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-25")
    headers = auth_header("flageditor3", Role.qca)
    client.post("/session/shipx_2026-08-25/open", params={"source": "raw"}, headers=headers)
    resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-25",
            "var_name": "temperature",
            "start_time_idx": 0,
            "end_time_idx": 1,
            "flag_code": "Q",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    result = _wait_for_job(client, headers, job_id)
    assert result["status"] == "failed"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && conda run -n svidat pytest tests/test_edit_routes.py -k "flag_edit" -v`
Expected: FAIL — 404 "Not Found" (route doesn't exist yet)

- [ ] **Step 3: Add the schema**

In `server/app/schemas.py`, append:

```python
class FlagEditRequest(BaseModel):
    filename: str
    var_name: str
    start_time_idx: int
    end_time_idx: int
    flag_code: str
```

- [ ] **Step 4: Add the route**

In `server/app/routers/edit.py`, change the schema import line to:

```python
from app.schemas import BulkEditRequest, FlagEditRequest, PointEditRequest
```

Then append at the end of the file:

```python
@router.post("/flag")
def flag_edit(
    payload: FlagEditRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    try:
        path = storage.temp_path(user.username, payload.filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    require_lock(db, payload.filename, user)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )

    user_id = user.id

    def run_flag_edit() -> dict:
        with file_write_lock(f"nc:{payload.filename}"):
            old_values = netcdf_ops.write_flags(
                path,
                payload.var_name,
                payload.start_time_idx,
                payload.end_time_idx,
                payload.flag_code,
            )
        job_db = SessionLocal()
        try:
            log = AuditLog(
                filename=payload.filename,
                user_id=user_id,
                action="flag_edit",
                var_name=payload.var_name,
                indices_json=json.dumps([payload.start_time_idx, payload.end_time_idx]),
                new_value_str=payload.flag_code,
            )
            job_db.add(log)
            job_db.commit()
            job_db.refresh(log)

            blob_path = storage.audit_blob_path(log.id)
            blob_path.parent.mkdir(parents=True, exist_ok=True)
            np.save(blob_path, old_values)
            log.old_value_ref = str(blob_path)
            job_db.commit()
            return {"audit_id": log.id}
        finally:
            job_db.close()

    job_id = jobs.submit_job(run_flag_edit)
    return {"job_id": job_id}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && conda run -n svidat pytest tests/test_edit_routes.py -v`
Expected: PASS, all tests including pre-existing ones in the file.

- [ ] **Step 6: Run the full backend suite**

Run: `cd server && conda run -n svidat pytest -v`
Expected: PASS, all tests in the whole suite.

---

### Task 5: Frontend API client + types

**Files:**
- Modify: `client/src/api/types.ts`
- Modify: `client/src/api/client.ts`

- [ ] **Step 1: Add types**

In `client/src/api/types.ts`, append:

```typescript
export interface VariableSeries {
  values: (number | null)[]
  flags: string[] | null
}

export interface VariableDataResponse {
  time: string[]
  variables: Record<string, VariableSeries>
}
```

Change the existing `AuditEntry` interface's `new_value` field from:

```typescript
  new_value: number | null
```

to:

```typescript
  new_value: number | string | null
```

- [ ] **Step 2: Add client functions**

In `client/src/api/client.ts`, append:

```typescript
export const getVariableData = (
  filename: string,
  varNames: string[]
): Promise<VariableDataResponse> => {
  const params = new URLSearchParams({ vars: varNames.join(',') })
  return apiFetch(`/files/${encodeURIComponent(filename)}/data?${params.toString()}`).then((r) =>
    r.json()
  )
}

export const applyFlag = (
  filename: string,
  varName: string,
  startTimeIdx: number,
  endTimeIdx: number,
  flagCode: string
) =>
  apiFetch('/edit/flag', {
    method: 'POST',
    body: JSON.stringify({
      filename,
      var_name: varName,
      start_time_idx: startTimeIdx,
      end_time_idx: endTimeIdx,
      flag_code: flagCode,
    }),
  }).then((r) => r.json())
```

Change the top import line from:

```typescript
import type { CurrentUser, Catalog } from './types'
```

to:

```typescript
import type { CurrentUser, Catalog, VariableDataResponse } from './types'
```

- [ ] **Step 3: Type-check**

Run: `cd client && npm run build`
Expected: PASS (this is a types-only change, no runtime tests apply — `tsc -b` in the build script is the check)

---

### Task 6: Plotly dependency + typed wrapper component

**Files:**
- Modify: `client/package.json`
- Create: `client/src/components/PlotlyPlot.tsx`
- Create: `client/src/types/plotly.d.ts`

- [ ] **Step 1: Install dependencies**

Run: `cd client && npm install plotly.js-dist-min@^2.35.2 react-plotly.js@^2.6.0`

This adds both to `dependencies` in `package.json`.

- [ ] **Step 2: Add ambient types**

Create `client/src/types/plotly.d.ts`:

```typescript
declare module 'plotly.js-dist-min' {
  const Plotly: unknown
  export default Plotly
}

declare module 'react-plotly.js/factory' {
  import type { ComponentType } from 'react'

  export interface PlotlySelectedPoint {
    curveNumber: number
    pointIndex?: number
    pointNumber?: number
  }

  export interface PlotlySelectedEvent {
    points: PlotlySelectedPoint[]
  }

  export interface PlotlyPlotProps {
    data: unknown[]
    layout: Record<string, unknown>
    config?: Record<string, unknown>
    style?: React.CSSProperties
    useResizeHandler?: boolean
    onSelected?: (event: PlotlySelectedEvent | undefined) => void
  }

  const createPlotlyComponent: (plotly: unknown) => ComponentType<PlotlyPlotProps>
  export default createPlotlyComponent
}
```

- [ ] **Step 3: Create the wrapper component**

Create `client/src/components/PlotlyPlot.tsx`:

```typescript
import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'

export const PlotlyPlot = createPlotlyComponent(Plotly)
export type {
  PlotlyPlotProps,
  PlotlySelectedEvent,
  PlotlySelectedPoint,
} from 'react-plotly.js/factory'
```

This isolates the untyped third-party boundary in one file. `PlotView`
(Task 11) imports `PlotlyPlot` from here, and tests mock this module
directly instead of dealing with real Plotly/WebGL rendering in jsdom.

- [ ] **Step 4: Verify the build picks it up**

Run: `cd client && npm run build`
Expected: PASS

---

### Task 7: `PlotSelectionContext`

**Files:**
- Create: `client/src/context/PlotSelectionContext.tsx`
- Modify: `client/src/components/ProtectedRoute.tsx`
- Test: `client/src/__tests__/PlotSelectionContext.test.tsx`

`Sidebar` and the routed page (`FilesPage`) are siblings under
`ProtectedRoute`, not parent/child, so picker state (ship/year/file/selected
variables) needs a context to cross between them — same shape as
`AuthContext`.

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/PlotSelectionContext.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'

function Consumer() {
  const { file, setFile, variables, setVariables } = usePlotSelection()
  return (
    <div>
      <span>file:{file}</span>
      <span>variables:{variables.join(',')}</span>
      <button onClick={() => setFile('KAQP_20250101v20001')}>set file</button>
      <button onClick={() => setVariables(['CNDC', 'SSPS'])}>set variables</button>
    </div>
  )
}

describe('PlotSelectionContext', () => {
  it('shares state between consumers under the same provider', () => {
    render(
      <PlotSelectionProvider>
        <Consumer />
      </PlotSelectionProvider>
    )
    expect(screen.getByText('file:')).toBeInTheDocument()
    fireEvent.click(screen.getByText('set file'))
    expect(screen.getByText('file:KAQP_20250101v20001')).toBeInTheDocument()
    fireEvent.click(screen.getByText('set variables'))
    expect(screen.getByText('variables:CNDC,SSPS')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- PlotSelectionContext`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the context**

Create `client/src/context/PlotSelectionContext.tsx`:

```typescript
import { createContext, useContext, useState, type ReactNode } from 'react'

interface PlotSelectionState {
  ship: string
  year: string
  file: string
  variables: string[]
  setShip: (value: string) => void
  setYear: (value: string) => void
  setFile: (value: string) => void
  setVariables: (value: string[]) => void
}

const PlotSelectionContext = createContext<PlotSelectionState | undefined>(undefined)

export function PlotSelectionProvider({ children }: { children: ReactNode }) {
  const [ship, setShip] = useState('')
  const [year, setYear] = useState('')
  const [file, setFile] = useState('')
  const [variables, setVariables] = useState<string[]>([])

  return (
    <PlotSelectionContext.Provider
      value={{ ship, year, file, variables, setShip, setYear, setFile, setVariables }}
    >
      {children}
    </PlotSelectionContext.Provider>
  )
}

export function usePlotSelection(): PlotSelectionState {
  const ctx = useContext(PlotSelectionContext)
  if (!ctx) {
    throw new Error('usePlotSelection must be used within PlotSelectionProvider')
  }
  return ctx
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- PlotSelectionContext`
Expected: PASS

- [ ] **Step 5: Wire the provider into ProtectedRoute**

In `client/src/components/ProtectedRoute.tsx`, add the import:

```typescript
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
```

Change the returned JSX from:

```typescript
  return (
    <>
      <Navbar />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">{children}</main>
      </div>
    </>
  )
```

to:

```typescript
  return (
    <PlotSelectionProvider>
      <Navbar />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">{children}</main>
      </div>
    </PlotSelectionProvider>
  )
```

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd client && npm test`
Expected: PASS (pre-existing `ProtectedRoute`-dependent tests should be
unaffected — the provider only adds context, no new required props)

---

### Task 8: `PlotPicker` component, wired into `Sidebar`

**Files:**
- Create: `client/src/components/PlotPicker.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Test: `client/src/__tests__/PlotPicker.test.tsx`
- Modify: `client/src/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/__tests__/PlotPicker.test.tsx`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PlotPicker } from '../components/PlotPicker'
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
import * as apiClient from '../api/client'

function renderPicker() {
  return render(
    <PlotSelectionProvider>
      <PlotPicker />
    </PlotSelectionProvider>
  )
}

describe('PlotPicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('cascades ship -> year -> file and resets downstream selections', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'], '2026': ['KAQP_20260115v20001'] },
      WTDF: { '2025': ['WTDF_20250601v20001'] },
    })
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'WTDF' } })

    const yearSelect = screen.getByLabelText('Year') as HTMLSelectElement
    expect(yearSelect.value).toBe('')
  })

  it('only offers 1-D time-series variables, excluding flag/history', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({
      KAQP: { '2025': ['KAQP_20250101v20001'] },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        temperature: { dims: ['time'], shape: [5], dtype: 'float32', attrs: {} },
        flag: { dims: ['time', 'f_string'], shape: [5, 2], dtype: '|S1', attrs: {} },
        history: { dims: ['h_num', 'h_string'], shape: [1, 2], dtype: '|S1', attrs: {} },
      },
      dimensions: { time: 5, f_string: 2, h_num: 1, h_string: 2 },
    })
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('Ship')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Ship'), { target: { value: 'KAQP' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'KAQP_20250101v20001' } })

    await waitFor(() => expect(screen.getByLabelText('Variables')).toBeInTheDocument())
    const variablesSelect = screen.getByLabelText('Variables') as HTMLSelectElement
    const optionValues = Array.from(variablesSelect.options).map((o) => o.value)
    expect(optionValues).toEqual(['temperature'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- PlotPicker`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `PlotPicker`**

Create `client/src/components/PlotPicker.tsx`:

```typescript
import { useEffect, useState, type ChangeEvent } from 'react'
import { getFileMetadata } from '../api/client'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { useCatalog } from '../hooks/useCatalog'
import type { FileMetadata } from '../api/types'

export function PlotPicker() {
  const { catalog, error: catalogError } = useCatalog()
  const { ship, year, file, variables, setShip, setYear, setFile, setVariables } =
    usePlotSelection()
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)

  const ships = catalog ? Object.keys(catalog).sort() : []
  const years = ship && catalog ? Object.keys(catalog[ship] ?? {}).sort() : []
  const files = ship && year && catalog ? catalog[ship]?.[year] ?? [] : []
  const variableNames = metadata
    ? Object.keys(metadata.variables)
        .filter((v) => {
          const dims = metadata.variables[v].dims
          return dims.length === 1 && dims[0] === 'time' && v !== 'flag'
        })
        .sort()
    : []

  useEffect(() => {
    if (!file) {
      setMetadata(null)
      setVariables([])
      return
    }
    let cancelled = false
    setMetadataError(null)
    setVariables([])
    getFileMetadata(file)
      .then((result) => {
        if (cancelled) return
        setMetadata(result)
      })
      .catch((err) => {
        if (cancelled) return
        setMetadataError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setVariables(Array.from(e.target.selectedOptions).map((o) => o.value))
  }

  return (
    <fieldset className="plot-picker">
      <legend>Plot variables</legend>
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
            value={variables}
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
    </fieldset>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test -- PlotPicker`
Expected: PASS

- [ ] **Step 5: Wire into `Sidebar`, conditional on `/files`**

In `client/src/components/Sidebar.tsx`, add imports:

```typescript
import { useLocation, useNavigate } from 'react-router-dom'
import { PlotPicker } from './PlotPicker'
```

(replace the existing `import { useNavigate } from 'react-router-dom'` line
with the combined one above).

Add, right after `const navigate = useNavigate()`:

```typescript
  const location = useLocation()
```

Change the sidebar-picker block from:

```typescript
      <div className="sidebar-picker">
        {error && <p role="status">Error: {error}</p>}
        {catalog && (
          <ShipYearFilePicker
            catalog={catalog}
            onSelectFile={(filename) => navigate(`/files/${encodeURIComponent(filename)}`)}
          />
        )}
      </div>
```

to:

```typescript
      <div className="sidebar-picker">
        {error && <p role="status">Error: {error}</p>}
        {catalog && (
          <ShipYearFilePicker
            catalog={catalog}
            onSelectFile={(filename) => navigate(`/files/${encodeURIComponent(filename)}`)}
          />
        )}
      </div>
      {location.pathname === '/files' && (
        <div className="sidebar-plot-picker">
          <PlotPicker />
        </div>
      )}
```

- [ ] **Step 6: Update `Sidebar.test.tsx`**

Add this test to the `describe('Sidebar', ...)` block in
`client/src/__tests__/Sidebar.test.tsx`:

```typescript
  it('renders PlotPicker only on /files', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/profile']}>
          <Sidebar />
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('testuser')).toBeInTheDocument())
    expect(screen.queryByText('Plot variables')).not.toBeInTheDocument()
  })
```

`Sidebar` needs `PlotSelectionProvider` in context wherever `PlotPicker`
actually renders (i.e. the `/files` case) — the existing `renderSidebar`
helper's `MemoryRouter` default entry is `/` unless overridden, so the
current `renderSidebar` calls used by other tests in this file don't hit
`/files` and won't render `PlotPicker`, meaning they don't need the
provider. Add one more test that does render it at `/files`, wrapped in the
provider:

```typescript
  it('renders Plot variables picker on /files', async () => {
    vi.spyOn(apiClient, 'getCatalog').mockResolvedValue({})
    localStorage.clear()
    setToken('tok')
    localStorage.setItem('svidat_role', 'qca')
    localStorage.setItem('svidat_username', 'testuser')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/files']}>
          <PlotSelectionProvider>
            <Sidebar />
          </PlotSelectionProvider>
        </MemoryRouter>
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByText('Plot variables')).toBeInTheDocument())
  })
```

Add the import at the top of the file:

```typescript
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
```

- [ ] **Step 7: Run the Sidebar tests**

Run: `cd client && npm test -- Sidebar`
Expected: PASS, all tests in the file.

---

### Task 9: Move "My drafts" from `FilesPage` to `ProfilePage`

**Files:**
- Modify: `client/src/pages/ProfilePage.tsx`
- Test: `client/src/__tests__/ProfilePage.test.tsx`

- [ ] **Step 1: Write the failing tests**

`client/src/__tests__/ProfilePage.test.tsx` currently has no shared render
helper — each test inline-renders `<AuthProvider><ProfilePage /></AuthProvider>`
and a `beforeEach` hardcodes `svidat_role` to `qca` in `localStorage`. Once
`ProfilePage` adds navigation (Step 3 below) it needs a `MemoryRouter` too.

Change the top imports from:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProfilePage } from '../pages/ProfilePage'
import { AuthProvider } from '../context/AuthContext'
import * as apiClient from '../api/client'
```

to:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProfilePage } from '../pages/ProfilePage'
import { AuthProvider } from '../context/AuthContext'
import * as apiClient from '../api/client'
```

Wrap the two existing `render(<AuthProvider><ProfilePage /></AuthProvider>)`
calls in each of the two existing tests with `<MemoryRouter>` too, i.e.
change both occurrences of:

```typescript
    render(
      <AuthProvider>
        <ProfilePage />
      </AuthProvider>
    )
```

to:

```typescript
    render(
      <AuthProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthProvider>
    )
```

Then add two new tests inside the existing `describe` block:

```typescript
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
    expect(screen.getByText('shipx_2026-07-30')).toBeInTheDocument()
  })

  it('hides My drafts section for user role', async () => {
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
    expect(screen.queryByText('My drafts')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- ProfilePage`
Expected: FAIL — "My drafts" text not found

- [ ] **Step 3: Add the drafts section to `ProfilePage`**

In `client/src/pages/ProfilePage.tsx`, change the imports from:

```typescript
import { useState, type ChangeEvent } from 'react'
import { uploadAvatar } from '../api/client'
import { useAvatar } from '../hooks/useAvatar'
import { useAuth } from '../context/AuthContext'
```

to:

```typescript
import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDrafts, uploadAvatar } from '../api/client'
import { useAvatar } from '../hooks/useAvatar'
import { useAuth } from '../context/AuthContext'
```

Inside the `ProfilePage` function, after the existing `const [uploading,
setUploading] = useState(false)` line, add:

```typescript
  const [drafts, setDrafts] = useState<string[]>([])
  const [draftsError, setDraftsError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (role === 'admin' || role === 'qca') {
      listDrafts()
        .then(setDrafts)
        .catch((err) => setDraftsError(err instanceof Error ? err.message : String(err)))
    }
  }, [role])
```

Change the returned JSX's closing structure from:

```typescript
        {status && <p role="status" className="profile-status">{status}</p>}
      </div>
    </div>
  )
}
```

to:

```typescript
        {status && <p role="status" className="profile-status">{status}</p>}
      </div>
      {(role === 'admin' || role === 'qca') && (
        <section className="profile-drafts">
          <h2>My drafts</h2>
          {draftsError && <p role="status">Error: {draftsError}</p>}
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test -- ProfilePage`
Expected: PASS, all tests in the file.

---

### Task 10: Rewrite `FilesPage`, remove old `VariableBrowser`

**Files:**
- Modify: `client/src/pages/FilesPage.tsx`
- Delete: `client/src/components/VariableBrowser.tsx`
- Delete: `client/src/__tests__/VariableBrowser.test.tsx`
- Modify: `client/src/__tests__/FilesPage.test.tsx`

`PlotView` itself is built in Task 11 — this task wires `FilesPage` to
render it (import added now, component created next task; do Task 10 and
Task 11 back to back so the app isn't left in a broken intermediate state
if you're executing tasks one at a time with test runs between).

- [ ] **Step 1: Delete the superseded component and its test**

Delete `client/src/components/VariableBrowser.tsx` and
`client/src/__tests__/VariableBrowser.test.tsx` — its functionality is
fully replaced by `PlotPicker` (Task 8) + `PlotView` (Task 11).

- [ ] **Step 2: Rewrite `FilesPage.test.tsx`**

Replace the full contents of `client/src/__tests__/FilesPage.test.tsx`
with:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilesPage } from '../pages/FilesPage'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider } from '../context/PlotSelectionContext'
import { setToken } from '../api/client'

function renderFilesPage() {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', 'qca')
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
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npm test -- FilesPage`
Expected: FAIL — empty state text not found (old `FilesPage` still has
"Browse by ship" etc.)

- [ ] **Step 4: Rewrite `FilesPage`**

Replace the full contents of `client/src/pages/FilesPage.tsx` with:

```typescript
import { PlotView } from '../components/PlotView'

export function FilesPage() {
  return (
    <div>
      <h1>Files</h1>
      <PlotView />
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it still fails for the right reason**

Run: `cd client && npm test -- FilesPage`
Expected: FAIL — `Cannot find module '../components/PlotView'` (expected,
built next task)

Do not consider Task 10 complete until Task 11 exists and this test passes
— proceed directly to Task 11.

---

### Task 11: `PlotView` — the plot canvas + flag toolbar

**Files:**
- Create: `client/src/components/PlotView.tsx`
- Test: `client/src/__tests__/PlotView.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/__tests__/PlotView.test.tsx`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PlotView } from '../components/PlotView'
import { AuthProvider } from '../context/AuthContext'
import { PlotSelectionProvider, usePlotSelection } from '../context/PlotSelectionContext'
import { setToken } from '../api/client'
import * as apiClient from '../api/client'

vi.mock('../components/PlotlyPlot', () => ({
  PlotlyPlot: (props: { onSelected?: (e: unknown) => void; data: unknown[] }) => (
    <div data-testid="plotly-plot">
      traces:{props.data.length}
      <button
        onClick={() =>
          props.onSelected?.({
            points: [
              { curveNumber: 0, pointIndex: 1 },
              { curveNumber: 0, pointIndex: 2 },
            ],
          })
        }
      >
        simulate select
      </button>
    </div>
  ),
}))

function Setup({ file, variables }: { file: string; variables: string[] }) {
  const sel = usePlotSelection()
  return (
    <button
      data-testid="apply-selection"
      onClick={() => {
        sel.setFile(file)
        sel.setVariables(variables)
      }}
    >
      apply
    </button>
  )
}

function renderPlotView(role: string, file: string, variables: string[]) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
  localStorage.setItem('svidat_username', 'testuser')
  const utils = render(
    <AuthProvider>
      <PlotSelectionProvider>
        <Setup file={file} variables={variables} />
        <PlotView />
      </PlotSelectionProvider>
    </AuthProvider>
  )
  fireEvent.click(screen.getByTestId('apply-selection'))
  return utils
}

describe('PlotView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the empty state with no file/variables selected', () => {
    render(
      <AuthProvider>
        <PlotSelectionProvider>
          <PlotView />
        </PlotSelectionProvider>
      </AuthProvider>
    )
    expect(
      screen.getByText('Select variables in the sidebar to view plots.')
    ).toBeInTheDocument()
  })

  it('fetches data and renders one combined plot for the selected variables', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: {
        temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'K'] },
        salinity: { values: [30, 31, 32], flags: ['Z', 'Z', 'Z'] },
      },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: {
          dims: ['time', 'f_string'],
          shape: [3, 2],
          dtype: '|S1',
          attrs: { Z: 'Good data', K: 'Suspect - visual' },
        },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature', 'salinity'])

    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())
    expect(screen.getByText('traces:2')).toBeInTheDocument()
  })

  it('flag controls are disabled until an edit session is opened', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: { temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data' } },
      },
      dimensions: {},
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    fireEvent.click(screen.getByText('simulate select'))
    expect(screen.queryByText('Apply Flag')).not.toBeInTheDocument()
    expect(screen.getByText('Open for editing')).toBeInTheDocument()
  })

  it('applies a flag and refetches data on success', async () => {
    vi.spyOn(apiClient, 'getVariableData').mockResolvedValue({
      time: ['2025-01-01T00:00:00', '2025-01-01T00:01:00', '2025-01-01T00:02:00'],
      variables: { temperature: { values: [10, 11, 12], flags: ['Z', 'Z', 'Z'] } },
    })
    vi.spyOn(apiClient, 'getFileMetadata').mockResolvedValue({
      variables: {
        flag: { dims: ['time', 'f_string'], shape: [3, 2], dtype: '|S1', attrs: { Z: 'Good data', K: 'Suspect - visual' } },
      },
      dimensions: {},
    })
    vi.spyOn(apiClient, 'openSession').mockResolvedValue({ temp_path: '/tmp/x' })
    vi.spyOn(apiClient, 'applyFlag').mockResolvedValue({ job_id: 'job-1' })
    vi.spyOn(apiClient, 'jobStatus').mockResolvedValue({
      status: 'done',
      error: null,
      result: { audit_id: 1 },
    })

    renderPlotView('qca', 'KAQP_20250101v20001', ['temperature'])
    await waitFor(() => expect(screen.getByTestId('plotly-plot')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Open for editing'))
    await waitFor(() => expect(screen.getByText('Editing session open')).toBeInTheDocument())

    fireEvent.click(screen.getByText('simulate select'))
    await waitFor(() => expect(screen.getByText('Apply Flag')).toBeInTheDocument())

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'K' } })
    fireEvent.click(screen.getByText('Apply Flag'))

    await waitFor(() => expect(screen.getByText('Flag applied')).toBeInTheDocument())
    expect(apiClient.applyFlag).toHaveBeenCalledWith(
      'KAQP_20250101v20001',
      'temperature',
      1,
      3,
      'K'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- PlotView`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `PlotView`**

Create `client/src/components/PlotView.tsx`:

```typescript
import { useEffect, useState } from 'react'
import {
  applyFlag,
  getFileMetadata,
  getVariableData,
  jobStatus,
  openSession,
} from '../api/client'
import { useAuth } from '../context/AuthContext'
import { usePlotSelection } from '../context/PlotSelectionContext'
import { PlotlyPlot, type PlotlySelectedEvent } from './PlotlyPlot'
import type { FileMetadata, VariableDataResponse } from '../api/types'

const DEFAULT_COLOR = '#aa3bff'
const FLAG_COLOR = '#f87171'
const JOB_POLL_INTERVAL_MS = 300
const JOB_POLL_TIMEOUT_MS = 30000

interface Selection {
  startIdx: number
  endIdx: number
}

export function PlotView() {
  const { file, variables } = usePlotSelection()
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'qca'

  const [data, setData] = useState<VariableDataResponse | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Record<string, Selection | undefined>>({})
  const [flagCode, setFlagCode] = useState<Record<string, string>>({})
  const [flagStatus, setFlagStatus] = useState<Record<string, string | null>>({})
  const [applying, setApplying] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setSessionOpen(false)
    setSessionError(null)
    setSelection({})
  }, [file])

  useEffect(() => {
    if (!file || variables.length === 0) {
      setData(null)
      return
    }
    let cancelled = false
    setDataError(null)
    getVariableData(file, variables)
      .then((result) => {
        if (cancelled) return
        setData(result)
      })
      .catch((err) => {
        if (cancelled) return
        setDataError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [file, variables])

  useEffect(() => {
    if (!file) {
      setMetadata(null)
      return
    }
    let cancelled = false
    getFileMetadata(file)
      .then((result) => {
        if (cancelled) return
        setMetadata(result)
      })
      .catch(() => {
        // metadata is only used for flag-code descriptions; a failure here
        // shouldn't block plotting, which already surfaces its own error.
      })
    return () => {
      cancelled = true
    }
  }, [file])

  if (!file || variables.length === 0) {
    return <p className="plot-empty-state">Select variables in the sidebar to view plots.</p>
  }

  const handleOpenSession = async () => {
    setSessionError(null)
    try {
      await openSession(file, 'raw')
      setSessionOpen(true)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'failed to open session')
    }
  }

  const handleSelected = (evt: PlotlySelectedEvent | undefined) => {
    if (!evt || !evt.points || evt.points.length === 0) return
    const byVar: Record<string, number[]> = {}
    for (const p of evt.points) {
      const varName = variables[p.curveNumber]
      if (!varName) continue
      const idx = p.pointIndex !== undefined ? p.pointIndex : p.pointNumber
      if (idx === undefined) continue
      byVar[varName] = byVar[varName] ?? []
      byVar[varName].push(idx)
    }
    setSelection((prev) => {
      const next = { ...prev }
      for (const [varName, idxs] of Object.entries(byVar)) {
        idxs.sort((a, b) => a - b)
        next[varName] = { startIdx: idxs[0], endIdx: idxs[idxs.length - 1] + 1 }
      }
      return next
    })
  }

  const handleApplyFlag = async (varName: string) => {
    const sel = selection[varName]
    const code = flagCode[varName]
    if (!sel || !code) return
    setApplying((a) => ({ ...a, [varName]: true }))
    setFlagStatus((s) => ({ ...s, [varName]: null }))
    try {
      const submitted = await applyFlag(file, varName, sel.startIdx, sel.endIdx, code)
      const startTime = Date.now()
      let finished = false
      while (Date.now() - startTime < JOB_POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS))
        const result = await jobStatus(submitted.job_id)
        if (result.status === 'done') {
          finished = true
          break
        }
        if (result.status === 'failed') {
          setFlagStatus((s) => ({ ...s, [varName]: `Error: ${result.error}` }))
          return
        }
      }
      if (!finished) {
        setFlagStatus((s) => ({ ...s, [varName]: 'Still running — check back later' }))
        return
      }
      const refreshed = await getVariableData(file, variables)
      setData(refreshed)
      setSelection((prev) => ({ ...prev, [varName]: undefined }))
      setFlagStatus((s) => ({ ...s, [varName]: 'Flag applied' }))
    } catch (err) {
      setFlagStatus((s) => ({
        ...s,
        [varName]: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }))
    } finally {
      setApplying((a) => ({ ...a, [varName]: false }))
    }
  }

  const flagCodes = metadata?.variables.flag
    ? Object.entries(metadata.variables.flag.attrs).filter(([code]) => /^[A-Z]$/.test(code))
    : []

  const traces = data
    ? variables.map((varName, i) => {
        const series = data.variables[varName]
        const colors = series?.flags
          ? series.flags.map((f) => (f === 'Z' ? DEFAULT_COLOR : FLAG_COLOR))
          : DEFAULT_COLOR
        const suffix = i === 0 ? '' : `${i + 1}`
        return {
          x: data.time,
          y: series?.values ?? [],
          type: 'scattergl',
          mode: 'lines+markers',
          marker: { color: colors, size: 4 },
          line: { color: DEFAULT_COLOR },
          name: varName,
          xaxis: `x${suffix}`,
          yaxis: `y${suffix}`,
        }
      })
    : []

  const layout: Record<string, unknown> = {
    grid: { rows: variables.length, columns: 1, pattern: 'independent' },
    height: 260 * variables.length,
    dragmode: 'select',
    showlegend: false,
    margin: { t: 30, b: 30, l: 60, r: 20 },
  }
  variables.forEach((varName, i) => {
    const suffix = i === 0 ? '' : `${i + 1}`
    layout[`xaxis${suffix}`] = {
      matches: 'x',
      title: i === variables.length - 1 ? { text: 'Time' } : undefined,
    }
    layout[`yaxis${suffix}`] = { title: { text: varName } }
  })

  return (
    <div className="plot-view">
      {canEdit && (
        <div className="plot-session-bar">
          {!sessionOpen && <button onClick={handleOpenSession}>Open for editing</button>}
          {sessionOpen && <span className="plot-session-status">Editing session open</span>}
          {sessionError && <p role="status">Error: {sessionError}</p>}
        </div>
      )}
      {dataError && <p role="status">Error: {dataError}</p>}
      {data && (
        <PlotlyPlot
          data={traces}
          layout={layout}
          config={{ displaylogo: false }}
          style={{ width: '100%' }}
          useResizeHandler
          onSelected={handleSelected}
        />
      )}
      {sessionOpen &&
        variables.map((varName) => {
          const sel = selection[varName]
          if (!sel || !data) return null
          return (
            <div key={varName} className="plot-flag-toolbar">
              <span className="label">
                {varName} — selected {data.time[sel.startIdx]} to{' '}
                {data.time[sel.endIdx - 1]} ({sel.endIdx - sel.startIdx} points)
              </span>
              <select
                value={flagCode[varName] ?? ''}
                onChange={(e) => setFlagCode((c) => ({ ...c, [varName]: e.target.value }))}
              >
                <option value="">Select flag</option>
                {flagCodes.map(([code, desc]) => (
                  <option key={code} value={code}>
                    {code} — {String(desc)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => handleApplyFlag(varName)}
                disabled={!flagCode[varName] || applying[varName]}
              >
                Apply Flag
              </button>
              {flagStatus[varName] && <p role="status">{flagStatus[varName]}</p>}
            </div>
          )
        })}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test -- PlotView`
Expected: PASS

- [ ] **Step 5: Run the FilesPage test from Task 10 now that PlotView exists**

Run: `cd client && npm test -- FilesPage`
Expected: PASS

- [ ] **Step 6: Run the full frontend suite**

Run: `cd client && npm test`
Expected: PASS, all tests in the project.

- [ ] **Step 7: Type-check and build**

Run: `cd client && npm run build`
Expected: PASS

---

### Task 12: CSS

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Add styles**

Append to `client/src/index.css`:

```css
/* Plot view */

.plot-empty-state {
  color: var(--text);
  padding: 24px 0;
}

.plot-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.plot-session-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.plot-session-status {
  color: var(--text-h);
  font-size: 13px;
}

.plot-flag-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--accent-border);
  background: var(--accent-bg);
  border-radius: 8px;
  font-size: 13px;
}

/* Sidebar plot picker (reuses .sidebar-picker's label/select styling) */

.sidebar-plot-picker {
  padding: 16px;
  border-top: 1px solid var(--border);
}

.sidebar-plot-picker fieldset {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-plot-picker legend {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
  padding: 0;
  margin-bottom: 4px;
}

.sidebar-plot-picker label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
}

.sidebar-plot-picker select {
  background: var(--code-bg);
  border: 1px solid var(--border);
  color: var(--text-h);
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
  text-transform: none;
  letter-spacing: normal;
}

/* Profile drafts section */

.profile-drafts {
  max-width: 360px;
  margin: 16px auto 0;
  text-align: left;
}
```

- [ ] **Step 2: Visual check**

No automated test for CSS — verified in Task 13's live smoke test.

---

### Task 13: Live smoke test

**Files:** none (manual verification only)

- [ ] **Step 1: Start both dev servers**

```bash
cd server && conda activate svidat && uvicorn app.main:app --port 8000 &
cd client && npm run build && npm run preview -- --port 4173 &
```

(preview mode required — dev mode's HMR needs `unsafe-eval`, which this
environment's CSP blocks; established earlier this session.)

- [ ] **Step 2: Log in and reach `/files`**

Navigate to `http://localhost:4173/login`, log in as `admin` / `samos1234`,
confirm redirect to `/files`.

- [ ] **Step 3: Verify layout**

Confirm: no "Browse by ship" or "My drafts" on `/files` main area (My
drafts should now be on `/profile` instead). Confirm empty-state text
"Select variables in the sidebar to view plots." shows in the main area.
Confirm a "Plot variables" fieldset (ship/year/file/variables) appears in
the sidebar, below the existing edit picker.

- [ ] **Step 4: Select variables, verify plots**

Pick a real ship/year/file (e.g. KAQP / 2025 / any file) in the sidebar's
"Plot variables" picker, select 2+ variables. Confirm one stacked plot per
variable renders in the main area, each with real data. Confirm zooming or
panning one plot moves the others in sync (shared time axis). Confirm any
point whose existing flag isn't `Z` renders in the highlight color (may not
be present in the sample file — note either way).

- [ ] **Step 5: Verify flag write path**

Confirm no flag toolbar appears yet (no session open). Click "Open for
editing" — confirm it succeeds (reuses the existing session-open endpoint).
Drag-select a time range on one of the plots. Confirm a flag toolbar
appears for that variable with the correct point count and time range,
populated with real flag-code options (letter + description) from the
file. Pick a code, click "Apply Flag". Confirm it succeeds, the toolbar
clears, and the plot's colors update to reflect the new flag on that range
(re-fetch happened).

- [ ] **Step 6: Verify audit trail**

Navigate to `/files/{filename}` (the classic edit page) for the same file,
confirm the audit panel shows a `flag_edit` entry with the correct variable
name and flag code.

- [ ] **Step 7: Verify My drafts moved correctly**

Navigate to `/profile`. Confirm "My drafts" section appears there
(admin/qca only) with correct draft links.

- [ ] **Step 8: Stop the dev servers**

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN -t | xargs -r kill
lsof -nP -iTCP:4173 -sTCP:LISTEN -t | xargs -r kill
```
