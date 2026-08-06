# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

svidat: a netCDF QC (quality control) web app. FastAPI backend (`server/`) manages netCDF files, users, and audit history; a Vite/React/TypeScript frontend (`client/`) lets users browse, plot, and hand-edit variable data in those files.

## Commands

### Backend (`server/`)

```bash
conda activate svidat
cd server
pip install -r requirements.txt        # setup
uvicorn app.main:app --reload --port 8000   # run
pytest -v                              # all tests (70+)
pytest tests/test_edit_routes.py -v    # single file
pytest tests/test_edit_routes.py::test_point_edit_updates_value -v  # single test
```

First run creates `svidat.db` (SQLite) and the `data/` tree (`raw/`, `temp/`, `drafts/`, `published/`, `audit_blobs/`, `avatars/`) under `DATA_DIR` (see `app/config.py`, overridable via env var or `.env`).

No seeded admin user — create one directly:

```bash
python -c "
from app.database import SessionLocal
from app.models import User, Role
from app.security import hash_password
db = SessionLocal()
db.add(User(username='admin', password_hash=hash_password('CHANGE_ME'), role=Role.admin))
db.commit()
"
```

### Frontend (`client/`)

```bash
cd client
npm install
npm run dev       # dev server (expects backend at http://localhost:8000)
npm run build     # tsc -b && vite build
npm run lint      # oxlint
npm test          # vitest run
npx vitest run src/__tests__/EditForm.test.tsx   # single test file
```

### Both together

`./start.sh` builds the frontend and runs backend (uvicorn) + frontend (`vite preview`) as production-like processes, using conda env `svidat`. Override ports via `BACKEND_PORT`/`FRONTEND_PORT` env vars.

## Architecture

### File versioning / workflow pipeline

A netCDF file moves through fixed storage stages, each with its own path helper in `app/storage.py`:

1. **raw** (`raw/{filename}.nc`) — original upload, read-only source.
2. **temp** (`temp/{username}/{filename}_temp.nc`) — a user's working copy, created when they open an edit session; all point/bulk/flag edits write here.
3. **draft** (`drafts/{username}/v250/{filename}_v250.nc`) — created by `POST /save`, copies temp → draft.
4. **published** (`published/{filename}_v300.nc`) — created by `POST /publish`, copies temp → published.

Every path helper validates path segments (`storage.validate_segment`) to block traversal (`/`, `\`, `.`, `..`) since filenames/usernames come from request input.

### Session locking (two independent layers)

- **DB-level edit lock** (`app/models.Lock`, `app/session_lock.require_lock`): one row per filename; only the user holding the lock (acquired via `POST /session/{filename}/open`) may edit or save/publish that file. Enforced at the route level before any write.
- **In-process write mutex** (`app/file_locks.py`): a `threading.Lock` per filename (keyed `nc:{filename}`), held only around the actual netCDF read/write/copy call. This exists separately from the DB lock to serialize concurrent writes within one server process (e.g. a background job and a request racing on the same file).

Both must be considered together when touching edit/save/publish code — the DB lock is an authorization check, the file mutex is a concurrency primitive.

### Background jobs

Bulk edits and flag edits (`app/routers/edit.py` `/edit/bulk`, `/edit/flag`) run on a background thread via `app/jobs.py` (in-memory job registry, not persisted). The route returns a `job_id` immediately; poll `GET /edit/jobs/{job_id}`. Inside the job, a **new** `SessionLocal()` is opened (the request-scoped `db` session from `Depends(get_db)` is not thread-safe to reuse). Point edits, by contrast, are synchronous and use the request's own `db` session.

### Audit log + revert

Every mutation (`point_edit`, `bulk_edit`, `flag_edit`, `save`, `publish`) writes an `AuditLog` row (`app/models.py`). Scalar edits store `old_value_scalar`/`new_value_scalar` inline; bulk/flag edits store the pre-edit array in a `.npy` blob (`storage.audit_blob_path`, referenced by `old_value_ref`) since the "old value" is a whole slice, not a scalar. `POST /audit/{audit_id}/revert` reads that blob (or scalar) back and writes it over the current temp file, then marks the log `reverted`.

### Migrations

No Alembic — `Base.metadata.create_all` only adds missing tables, never alters existing ones. Adding a column to `app/models.py` requires a hand-written idempotent migration (`PRAGMA table_info` check + conditional `ALTER TABLE`) against any existing `svidat.db`, following the pattern used for the `avatar_path` column — otherwise a running dev DB silently drifts from what the code expects.

### Roles

Three roles (`app/models.Role`): `admin` (full access, manages users), `qca` (edit/save/publish), `user` (view only). Enforced backend-side via `app/deps.require_role(*roles)` per-route, and frontend-side via `ProtectedRoute` (`client/src/components/ProtectedRoute.tsx`) gating routes in `App.tsx`.

### netCDF quirks (`app/netcdf_ops.py`)

Some source files (SAMOS convention) use a non-padded, non-ISO `M-D-YYYY` reference date in their `time` units attribute (e.g. `"minutes since 1-1-1980 00:00 UTC"`). `netCDF4.num2date` expects ISO-ordered `YYYY-MM-DD` and misparses/rejects the other form, so `_normalize_time_units` rewrites it before use. `set_auto_mask(False)` is used throughout reads so masked values come back as raw fill values rather than numpy masked arrays.

### Frontend structure

- `src/api/client.ts` — single hand-written fetch wrapper (`apiFetch`) plus one function per backend endpoint; JWT is stored in `localStorage` and attached as `Authorization: Bearer`. `BASE_URL` is hardcoded to `http://localhost:8000`.
- `src/context/` — three contexts compose to drive the file-editing UI: `AuthContext` (JWT/role), `PlotSelectionContext` (which file/variables are selected), `EditSessionContext` (open/close edit session against the backend lock, current flag selection). `EditSessionContext` depends on both `AuthContext` and `PlotSelectionContext`, and resets its state on file/variable changes — check its effects before adding new session-dependent state.
- Routes (`src/App.tsx`): `/login`, `/files` (browse), `/files/:filename`-style editing lives inside `FilesPage`, `/profile`, `/admin/users` (admin only), `/` redirects to `/files`.
- Tests colocated in `src/__tests__/`, using vitest + jsdom + Testing Library (`src/setupTests.ts`).

## Planning docs

`docs/superpowers/plans/` and `docs/superpowers/specs/` contain dated design/plan docs for past features (sidebar layout, drag-to-edit, audit history modal, flag highlighting, etc.) — check there for the rationale behind existing UI/UX decisions before redesigning them.
