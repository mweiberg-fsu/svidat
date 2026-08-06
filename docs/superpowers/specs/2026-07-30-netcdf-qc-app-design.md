# svidat — NetCDF QC Web App Design

Date: 2026-07-30

## Purpose

Web app for browsing, viewing, and editing large (GB+) netCDF ship data files
(pattern: `{ship}_{date}.nc`) with role-based access, per-user draft/publish
workflow, and full audit trail with revert.

## Architecture

Monolith: FastAPI backend + React (Vite + TypeScript) frontend, single server
process. SQLite for users/roles/audit log/locks. netCDF4-python for direct
in-place variable edits (point writes to a var slice without rewriting the
whole file — required for GB+ scale). Bulk edits run in a background thread;
frontend polls a job-status endpoint.

Rationale: matches current team/scale (single editor per file, moderate
concurrent load). Upgrade path if needed later: SQLite → Postgres, thread →
Celery/Redis job queue. Not built now (YAGNI) — revisit if bulk-edit load or
concurrent-user count grows.

### Storage layout (local filesystem)

```
data/
  raw/{ship}_{date}.nc                          # original source, read-only
  temp/{username}/{ship}_{date}_temp.nc         # per-user scratch, persists for recovery
  drafts/{username}/v250/{ship}_{date}_v250.nc  # per-user saved draft
  published/{ship}_{date}_v300.nc               # shared final, overwritten on republish
```

Versioning is a fixed two-stage convention, not incrementing: `v250` = saved
draft, `v300` = published/final. Filenames stay literal `_v250`/`_v300`.

## Roles

- **admin** — full privileges, manage user accounts/roles, can edit files,
  can browse/resume any user's draft or recovery temp
- **QCA** (quality control analyst) — can edit files (temp/save/publish
  workflow), can browse/resume any user's draft or recovery temp
- **User** — view/browse only, no edit/save/publish rights

## Components

### Backend (FastAPI)

- `auth` — login, JWT session, role-check middleware
- `users` — admin CRUD on accounts/roles
- `files` — list raw files, list drafts (own; all for admin/QCA), file
  metadata (vars/dims/shape) via chunked read (xarray), no full-file load
- `session` — open file for edit: copies chosen source (raw, own/other's
  v250, or own/other's recovery temp) into `temp/{username}/...`, acquires
  live-edit lock; close releases lock (temp file itself persists)
- `edit` — point edit (var + indices + value) and bulk edit (var + range +
  op) endpoints; writes directly to the user's temp file; logs every change
  to audit DB
- `save` — copy temp → `drafts/{username}/v250/...` (overwrites that user's
  prior v250)
- `publish` — copy temp (current live state, v250 not required) →
  `published/...v300.nc` (overwrites existing v300 if present)
- `jobs` — background bulk-edit status polling
- `audit` — per-file edit history; revert endpoint (writes old value back,
  logs the revert as a new audit entry — history is never deleted)

### Frontend (React + Vite + TS)

- Login page
- File browser: raw files + draft list (own, or all for admin/QCA)
- Data viewer: vars/dims/metadata, value grid/plot
- Edit UI: point-edit form, bulk-edit form
- Save / Publish actions
- Audit history panel with revert button
- Admin: user management page

## Data Flow

**Open**: user picks raw file, a v250 draft, or a recovery temp (own, or —
for admin/QCA — another user's) → backend checks live-edit lock → copies
chosen source into `temp/{username}/{ship}_{date}_temp.nc` → lock recorded
(file, user, timestamp) → frontend loads metadata/values via chunked reads.

**Edit**: frontend sends point/bulk edit → backend writes directly into the
temp file's target variable slice (netCDF4 in-place write) → audit row
logged (user, var, indices/range, old value, new value, timestamp). Bulk
edits run in a background thread, return a job id; frontend polls
`/jobs/{id}`.

**Save**: copy temp → `drafts/{username}/v250/...`, overwriting that user's
previous v250 for this file.

**Publish**: copy temp (current live edit state, independent of whether a
v250 save happened) → `published/{ship}_{date}_v300.nc`, overwriting if it
already exists. Audit row marks the publish event.

**Close**: release live-edit lock. Temp file is *not* discarded — it persists
under `temp/{username}/...` as a recovery point, offered on next open of that
file ("resume unsaved session").

**Revert**: pick an audit row → write its old value back into the target
file → log the revert itself as a new audit entry (append-only history).

## Error Handling

- Lock conflict (another user has the live-edit lock) → 409, frontend shows
  who's editing and since when
- Edit with invalid indices/dim mismatch → 400 with specific var/index
  detail, no partial write
- Bulk edit job fails partway → job marked failed; completed per-cell writes
  are already in the audit log, so user can inspect and revert the completed
  portion
- Save/publish I/O failure (disk full, permissions) → 500; write goes to a
  temp path first with atomic rename on success, so no partial/corrupt file
  is left in `drafts/` or `published/`
- Revert on a missing or already-reverted audit row → 409, no-op

## Testing

- Backend unit tests: point/bulk edit logic against small synthetic .nc
  fixtures, audit log correctness, revert round-trip, lock acquire/release,
  role-permission checks (User blocked from edit/save/publish endpoints)
- Backend integration: full save/publish flow against real netCDF4 (not
  mocked) — file I/O correctness is the main risk area
- Frontend: component tests for edit forms and audit panel; one E2E happy
  path (login → open → edit → save → publish)

## Out of Scope (v1)

- Concurrent multi-user live editing of the same file (single live-edit lock
  per file, per current requirements)
- Cloud object storage (local filesystem only)
- Job queue infra (Celery/Redis) — background thread is sufficient at
  current scale; revisit if it isn't
