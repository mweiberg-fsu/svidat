# svidat — Navbar + Profile/Avatar Design

Date: 2026-07-30

## Purpose

Add a persistent navbar to every authenticated page: SVIDAT logo (links home),
account trigger (username + avatar image), dropdown (profile info, Profile
link, Admin link for admins only, Log out). Avatars are real uploaded images,
set via a new `/profile` page.

## Navbar

Layout: logo left ("SVI**DAT**", accent-colored second half, links to
`/files`), account trigger right (`username` text + circular avatar image +
caret), click opens a dropdown.

Dropdown contents — same structure for every role, one role-conditional line:
- Header: avatar (larger) + username + role
- "Profile" link → `/profile` (all roles)
- "Admin" link → `/admin/users` (admin role only, conditionally rendered)
- "Log out" → calls `AuthContext.logout()`, navigates to `/login`

No avatar uploaded yet → gradient placeholder circle (purple gradient
matching the app's accent color), no initials.

**Where it renders:** `ProtectedRoute` itself renders `<Navbar />` above its
children once authorized (one change point, not duplicated across four
pages). Not rendered on `/login` (only reached when `ProtectedRoute` hasn't
authorized yet, or user isn't logged in).

## Avatar: real image upload

### Backend

- `User` model gains `avatar_path: Column(String, nullable=True)` — relative
  path under `data/avatars/`.
- **Dev DB migration note:** the existing `server/svidat.db` already has a
  `users` table (created during earlier manual testing, with `admin`/
  `testviewer` rows). `Base.metadata.create_all` does NOT alter existing
  tables. The implementer must run `ALTER TABLE users ADD COLUMN
  avatar_path VARCHAR` against `server/svidat.db` directly (one-time, by
  hand or a small script) so existing rows/credentials survive — do not
  delete and recreate the dev DB.
- `POST /users/me/avatar` — any authenticated user (self-service, not
  admin-gated), multipart file upload. Validates `Content-Type` is one of
  `image/png`, `image/jpeg`, `image/webp`, `image/gif` (rejects others with
  400), enforces a 2MB size cap (400 if exceeded). Stores to
  `data/avatars/{user_id}.{ext}` (extension derived from the validated
  content-type, not the client-supplied filename — never trust that for
  extension/path purposes), overwriting any prior upload. Updates
  `User.avatar_path`.
- `GET /users/{user_id}/avatar` — any authenticated user (avatars aren't
  sensitive; read access isn't restricted to self). 404 if no avatar set.
  Returns the image file (`FileResponse` with the stored content-type).

### Frontend

- New page `client/src/pages/ProfilePage.tsx` (route `/profile`, protected,
  all roles): shows current avatar (or placeholder), username, role, and an
  "Upload photo" file input/button. On successful upload, bumps a shared
  "avatar version" so the navbar's avatar image refreshes immediately
  without a page reload.
- `AuthContext` gains `avatarVersion: number` + `bumpAvatarVersion()`,
  following the same pattern already used for `EditForm`/`AuditPanel`'s
  `refreshSignal` coordination. `ProfilePage` calls `bumpAvatarVersion()`
  after a successful upload; `Navbar`'s avatar `<img>` includes
  `avatarVersion` in its cache-busting fetch so it updates without a reload.
- Avatar images require an `Authorization` header (same as every other
  endpoint) — `<img src>` can't send custom headers, so both `Navbar` and
  `ProfilePage` fetch the image via the existing `apiFetch` helper and
  render it as a `Blob` object URL, not a raw `<img src="/users/.../avatar">`.
  Object URLs are revoked on unmount/re-fetch to avoid leaking memory.
- `client/src/components/Navbar.tsx`: logo, account trigger, dropdown,
  fetches own avatar via `GET /users/me/avatar`-equivalent (uses
  `AuthContext`'s stored user id — note: `AuthContext` currently stores
  `username` but not numeric user id; this needs adding since the avatar
  endpoint is keyed by id, not username — `login()` response doesn't
  currently include the id either, so `LoginPage`/`AuthContext` need a
  small extension to fetch/store the logged-in user's id after login,
  e.g. via a new lightweight `GET /users/me` endpoint returning the
  current user's `id`/`username`/`role`).

### New backend need surfaced by the above

- `GET /users/me` — any authenticated user, returns their own
  `{id, username, role}`. Needed because avatar endpoints are keyed by
  numeric user id, and nothing currently exposes the logged-in user's own
  id to the frontend (JWT only carries `sub`=username, `role`).

## Error handling

- Upload: wrong content-type or oversized file → 400 with a clear detail
  message, surfaced in `ProfilePage`'s existing status-message pattern.
- Missing avatar → 404, frontend treats this as "show placeholder", not an
  error state.
- Same try/catch + status-message conventions established in
  `EditForm`/`AuditPanel`/`AdminUsersPage` apply to `ProfilePage` and
  `Navbar`.

## Testing

- Backend: unit tests for `POST /users/me/avatar` (valid upload succeeds
  and overwrites, wrong content-type 400, oversized file 400), `GET
  /users/{id}/avatar` (200 with correct bytes after upload, 404 before any
  upload), `GET /users/me` (returns correct id/username/role for the
  caller).
- Frontend: component test for `Navbar` (renders logo/username, dropdown
  opens/closes, Admin link present only for admin role, logout calls
  `AuthContext.logout()`), component test for `ProfilePage` (renders
  current info, upload triggers the API call and bumps avatar version).

## Out of scope

- Editing username/password from the profile page (not requested).
- Cropping/resizing uploaded images (stored as-is; a very large but
  under-2MB image renders at whatever size the `<img>`/CSS constrains it
  to — acceptable for this app's scale).
- Avatars for anyone other than the account itself (no admin-sets-others'-
  avatar flow).
