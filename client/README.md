# svidat frontend

Vite + React + TypeScript client for the svidat netCDF QC app.

## Setup

    cd client
    npm install

## Run

    npm run dev

Requires the backend running at `http://localhost:8000` (see `server/README.md`).

## Routes

- `/login` - sign in against the backend's JWT auth endpoint
- `/files` - browse uploaded netCDF files (admin, qca, user)
- `/files/:filename` - inspect and QC-edit a single file's data (admin, qca, user)
- `/admin/users` - manage user accounts (admin only)
- `/` - redirects to `/files`

Authentication is handled by `AuthContext`, which stores the JWT issued by
the backend on login. Route access is gated by role (`admin` / `qca` /
`user`) via the `ProtectedRoute` component, which redirects unauthenticated
or under-privileged users to `/login`.

## Google / Microsoft OAuth login

Set two env vars (Vite `.env` or the shell) to show the "Sign in with
Google"/"Sign in with Microsoft" buttons on `/login`:

    VITE_GOOGLE_CLIENT_ID=<google oauth client id>
    VITE_MS_CLIENT_ID=<microsoft entra app (client) id>

Both are public client IDs, safe to ship client-side — matching env vars
(`GOOGLE_CLIENT_ID`/`MICROSOFT_CLIENT_ID`) must also be set on the backend,
see `server/README.md`. Either button is hidden entirely if its client ID
env var is unset (no partial/broken UI). The admin-only allowlist that
controls which email domains may auto-create an account through these
buttons is managed from `/admin/users`.

## Test

    npm test
