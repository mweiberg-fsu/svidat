# Install Script Design

Date: 2026-08-06

## Purpose

svidat is being open-sourced. New users cloning the repo need a single, cross-platform
command to go from a fresh checkout to a running dev environment, without needing conda
pre-installed.

## Approach

A single stdlib-only Python script, `install.py`, at the repo root. One source of truth
that runs identically on macOS, Linux, and Windows via `python3 install.py` (or
`python install.py` on Windows) — avoids maintaining parallel bash/PowerShell scripts.

### Steps

1. **Preflight checks** — verify `python3` (>=3.10) and `node`/`npm` are on PATH. Exit
   with a clear message (no auto-install of these) if missing.
2. **Backend env** — create a venv at `server/.venv` (skip if it already exists), then
   `pip install -r server/requirements.txt` inside it. Plain venv, not conda — no extra
   install step for random GitHub users, and netCDF4 ships prebuilt wheels for the
   major platforms so pip alone is sufficient.
3. **Secret key** — generate a random `SECRET_KEY` and write it to `server/.env`.
   This requires a small change to `server/app/config.py`: add
   `model_config = SettingsConfigDict(env_file=".env")` to `Settings`, since
   pydantic-settings does not read `.env` files by default and today the class has no
   such config — `secret_key` silently stays at its insecure default otherwise.
4. **Frontend deps** — `npm install` in `client/`.
5. **Admin user** — interactive prompt ("Create admin user now? [Y/n]"); if yes, ask
   for username and a hidden password (`getpass`), then create the user via the venv's
   Python using the same `User`/`hash_password` call documented in CLAUDE.md.
6. **Next steps** — print OS-correct instructions: how to activate the venv and run
   `uvicorn app.main:app --reload --port 8000`, and how to run `npm run dev` in
   `client/`.

Idempotent: safe to re-run — skips venv creation if it exists, skips admin creation if
the username is already taken.

### start.sh update

`start.sh` currently activates a conda env (`svidat`) before running uvicorn. Since
`install.py` no longer sets up conda, `start.sh` is updated to activate
`server/.venv` instead. Still macOS/Linux (bash) only, as before — Windows users use
the manual commands printed by `install.py`.

## Out of scope

- Auto-installing Python, Node, or conda themselves.
- A native Windows run script (`.ps1`) — Windows users get printed manual commands.
- Rewriting or restructuring the README.
- Any changes to the DB migration story (still `Base.metadata.create_all`, no Alembic).

## Testing

Manual: run `python3 install.py` against a clean clone on macOS, confirm venv +
`.env` + `node_modules` + optional admin user are created, and that the printed
run commands work. No automated test suite for the installer itself (it's an
imperative setup script, not application code).
