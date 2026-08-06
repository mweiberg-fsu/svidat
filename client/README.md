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

## Test

    npm test
