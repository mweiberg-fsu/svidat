# svidat backend

FastAPI service for the svidat netCDF QC app.

## Setup

    conda activate svidat
    cd server
    pip install -r requirements.txt

## Run

    conda activate svidat
    cd server
    uvicorn app.main:app --reload --port 8000

First run creates `svidat.db` (SQLite) and the `data/` directory tree
(`raw/`, `temp/`, `drafts/`, `published/`, `audit_blobs/`) under the working
directory, per `DATA_DIR` in `app/config.py` (override via env var or `.env`).

There is no seeded admin user yet — create the first one directly:

    python -c "
    from app.database import SessionLocal
    from app.models import User, Role
    from app.security import hash_password
    db = SessionLocal()
    db.add(User(username='admin', password_hash=hash_password('CHANGE_ME'), role=Role.admin))
    db.commit()
    "

## Test

    conda activate svidat
    cd server
    pytest -v

70 tests, covering models, security, netCDF read/write/restore, storage path
validation, auth, roles, session locking, point/bulk edit, background jobs,
save/publish, and audit history/revert.

## Architecture notes

- Roles: `admin` (full access, manages users), `qca` (edit/save/publish),
  `user` (view only).
- Single-editor-per-file locking (`app/session_lock.py`) plus a per-process
  write mutex (`app/file_locks.py`) serialize actual netCDF writes.
- Bulk edits run in a background thread (`app/jobs.py`); poll
  `GET /edit/jobs/{job_id}` for status.
- Full API surface: `/auth`, `/users`, `/files`, `/session`, `/edit`,
  `/save`, `/publish`, `/audit`. See `app/routers/` for route-level detail.

## Schema changes / migrations

There's no Alembic (or similar) migration tool yet — `Base.metadata.create_all`
only creates missing tables, it never alters existing ones. If you add a
column to a model in `app/models.py`, the fresh `pytest` temp DB picks it up
automatically, but any existing `svidat.db` (e.g. a running dev instance)
will NOT — you must write and run a small idempotent migration (PRAGMA
`table_info` check + conditional `ALTER TABLE`, same pattern used for the
`avatar_path` column) against it by hand, or existing data will silently be
out of sync with what the code expects.
