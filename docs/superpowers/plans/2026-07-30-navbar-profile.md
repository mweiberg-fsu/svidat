# Navbar + Profile/Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent navbar (SVIDAT logo, username+avatar dropdown, Admin link for admins, Log out) to every authenticated page, backed by real avatar image upload via a new `/profile` page.

**Architecture:** Backend gains a nullable `avatar_path` column on `User`, a `GET /users/me` endpoint (frontend currently has no way to learn its own numeric user id), and `POST /users/me/avatar` / `GET /users/{user_id}/avatar` for upload/serving (auth-required, fetched as blob URLs since `<img src>` can't carry an Authorization header). Frontend gains `AuthContext.id`/`avatarVersion`, a `Navbar` component rendered by `ProtectedRoute` (one change point), and a `ProfilePage`.

**Tech Stack:** Same as existing app — FastAPI/SQLAlchemy/SQLite backend, React/Vite/TS frontend, pytest/Vitest.

Design doc: `docs/superpowers/specs/2026-07-30-navbar-profile-design.md`.

---

### Task 1: User model avatar_path column + dev DB migration

**Files:**
- Modify: `server/app/models.py`
- Test: `server/tests/test_models.py`

- [ ] **Step 1: Write failing test**

Append to `server/tests/test_models.py`:
```python
def test_user_avatar_path_column_defaults_to_none():
    db = SessionLocal()
    try:
        user = User(username="avatarcol1", password_hash="hashed", role=Role.user)
        db.add(user)
        db.commit()
        db.refresh(user)
        assert user.avatar_path is None
    finally:
        db.query(User).filter(User.username == "avatarcol1").delete()
        db.commit()
        db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `conda activate svidat && cd /Users/ustropics/Documents/svidat/server && pytest tests/test_models.py -v`
Expected: FAIL — `AttributeError` on `user.avatar_path` (column doesn't exist).

- [ ] **Step 3: Add the column**

In `server/app/models.py`, in the `User` class, add after `role`:
```python
    avatar_path = Column(String, nullable=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Migrate the existing dev database**

The real dev DB (`server/svidat.db`, already has `admin`/`testviewer` rows from
manual testing) is NOT a fresh test DB — `Base.metadata.create_all` does not
alter existing tables, so the new column must be added by hand, once,
idempotently, so existing users/credentials survive:

```bash
conda activate svidat && cd /Users/ustropics/Documents/svidat/server && python -c "
import sqlite3
conn = sqlite3.connect('svidat.db')
cols = [row[1] for row in conn.execute('PRAGMA table_info(users)')]
if 'avatar_path' not in cols:
    conn.execute('ALTER TABLE users ADD COLUMN avatar_path VARCHAR')
    conn.commit()
    print('migrated')
else:
    print('already migrated')
conn.close()
"
```
Run this and confirm it prints `migrated` (or `already migrated` if run twice — it must be safe to re-run).

- [ ] **Step 6 (SKIP — no git)**

---

### Task 2: Avatar storage path helper

**Files:**
- Modify: `server/app/storage.py`
- Test: `server/tests/test_storage.py`

- [ ] **Step 1: Write failing test**

Append to `server/tests/test_storage.py`:
```python
def test_avatar_path_layout():
    assert storage.avatar_path(1, "png") == storage.base_dir() / "avatars" / "1.png"
    assert storage.avatar_path(42, "jpg") == storage.base_dir() / "avatars" / "42.jpg"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_storage.py -v`
Expected: FAIL — `AttributeError: module 'app.storage' has no attribute 'avatar_path'`

- [ ] **Step 3: Implement**

Add to `server/app/storage.py`:
```python
def avatar_path(user_id: int, ext: str) -> Path:
    return base_dir() / "avatars" / f"{user_id}.{ext}"
```
No `validate_segment` call needed here — `user_id` is always a DB-sourced
int (never raw user string input) and `ext` is always drawn from a fixed
server-side whitelist by the caller before this function is invoked, not
taken directly from client input.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_storage.py -v`
Expected: PASS

- [ ] **Step 5 (SKIP — no git)**

---

### Task 3: GET /users/me endpoint

**Files:**
- Modify: `server/app/routers/users.py`
- Test: `server/tests/test_users_routes.py`

- [ ] **Step 1: Write failing test**

Append to `server/tests/test_users_routes.py`:
```python
def test_get_me_returns_current_user(client, auth_header):
    headers = auth_header("meuser1", Role.qca)
    resp = client.get("/users/me", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "meuser1"
    assert body["role"] == "qca"
    assert body["id"] > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_users_routes.py -v`
Expected: FAIL — 404 (no `/users/me` route yet)

- [ ] **Step 3: Implement**

In `server/app/routers/users.py`, add `get_current_user` to the existing
`from app.deps import require_role` import line (making it
`from app.deps import get_current_user, require_role`), then add:
```python
@router.get("/me", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)):
    return user
```
Place this ABOVE the existing `GET ""` (`list_users`) route in the file —
order doesn't affect routing here (no path collision, `/me` vs `` are
distinct), but keep related "self" endpoints grouped together for
readability, ahead of the admin-only CRUD block.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_users_routes.py -v`
Expected: PASS

- [ ] **Step 5 (SKIP — no git)**

---

### Task 4: Avatar upload + serve endpoints

**Files:**
- Modify: `server/app/routers/users.py`
- Test: `server/tests/test_users_routes.py`

- [ ] **Step 1: Write failing tests**

Append to `server/tests/test_users_routes.py`:
```python
def test_avatar_upload_and_fetch_roundtrip(client, auth_header):
    headers = auth_header("avatareditor1", Role.qca)
    me = client.get("/users/me", headers=headers).json()

    png_bytes = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    resp = client.post(
        "/users/me/avatar",
        files={"file": ("photo.png", png_bytes, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 200

    fetch_resp = client.get(f"/users/{me['id']}/avatar", headers=headers)
    assert fetch_resp.status_code == 200
    assert fetch_resp.content == png_bytes


def test_avatar_upload_rejects_bad_content_type(client, auth_header):
    headers = auth_header("avatareditor2", Role.qca)
    resp = client.post(
        "/users/me/avatar",
        files={"file": ("evil.txt", b"not an image", "text/plain")},
        headers=headers,
    )
    assert resp.status_code == 400


def test_avatar_upload_rejects_oversized_file(client, auth_header):
    headers = auth_header("avatareditor3", Role.qca)
    big = b"0" * (2 * 1024 * 1024 + 1)
    resp = client.post(
        "/users/me/avatar",
        files={"file": ("big.png", big, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 400


def test_avatar_fetch_404_before_upload(client, auth_header):
    headers = auth_header("avatareditor4", Role.qca)
    me = client.get("/users/me", headers=headers).json()
    resp = client.get(f"/users/{me['id']}/avatar", headers=headers)
    assert resp.status_code == 404


def test_avatar_reupload_replaces_old_file(client, auth_header):
    headers = auth_header("avatareditor5", Role.qca)
    me = client.get("/users/me", headers=headers).json()

    client.post(
        "/users/me/avatar",
        files={"file": ("a.png", b"first" * 20, "image/png")},
        headers=headers,
    )
    client.post(
        "/users/me/avatar",
        files={"file": ("b.jpg", b"second" * 20, "image/jpeg")},
        headers=headers,
    )

    from app import storage

    png_path = storage.avatar_path(me["id"], "png")
    jpg_path = storage.avatar_path(me["id"], "jpg")
    assert not png_path.exists()
    assert jpg_path.exists()

    fetch_resp = client.get(f"/users/{me['id']}/avatar", headers=headers)
    assert fetch_resp.content == b"second" * 20
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_users_routes.py -v`
Expected: FAIL — 404s (no `/users/me/avatar` or `/users/{id}/avatar` routes yet)

- [ ] **Step 3: Implement**

Add these imports at the top of `server/app/routers/users.py` (merge with
existing imports, don't duplicate):
```python
from fastapi import File, UploadFile
from fastapi.responses import FileResponse

from app import storage
```

Add below the `get_me` route:
```python
ALLOWED_AVATAR_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_AVATAR_BYTES = 2 * 1024 * 1024


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ext = ALLOWED_AVATAR_TYPES.get(file.content_type)
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"unsupported image type: {file.content_type}",
        )
    contents = await file.read()
    if len(contents) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="image exceeds 2MB limit"
        )

    if user.avatar_path:
        old_path = storage.base_dir() / user.avatar_path
        if old_path.exists():
            old_path.unlink()

    path = storage.avatar_path(user.id, ext)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)

    user.avatar_path = str(path.relative_to(storage.base_dir()))
    db.commit()
    return {"avatar_path": user.avatar_path}


@router.get("/{user_id}/avatar")
def get_avatar(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    target = db.query(User).filter(User.id == user_id).first()
    if target is None or not target.avatar_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no avatar set"
        )
    path = storage.base_dir() / target.avatar_path
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no avatar set"
        )
    content_type = next(
        (ct for ct, e in ALLOWED_AVATAR_TYPES.items() if target.avatar_path.endswith(f".{e}")),
        "application/octet-stream",
    )
    return FileResponse(path, media_type=content_type)
```

Note: `GET /{user_id}/avatar` sits below `GET /me` and `GET ""` — since
`/me` and `""` are literal, non-parameterized paths, FastAPI matches them
before falling through to the `{user_id}` pattern regardless of
declaration order in this case, but keep `/me` declared above
`/{user_id}/avatar` in the file for readability anyway.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_users_routes.py -v`
Expected: PASS (all previous + 5 new)

- [ ] **Step 5 (SKIP — no git)**

---

### Task 5: Frontend — API client, types, AuthContext extension

**Files:**
- Modify: `client/src/api/types.ts`
- Modify: `client/src/api/client.ts`
- Modify: `client/src/context/AuthContext.tsx`
- Modify: `client/src/pages/LoginPage.tsx`

- [ ] **Step 1: Add types**

Append to `client/src/api/types.ts`:
```typescript
export interface CurrentUser {
  id: number
  username: string
  role: Role
}
```

- [ ] **Step 2: Add API client functions**

Append to `client/src/api/client.ts`:
```typescript
export const getCurrentUser = (): Promise<CurrentUser> =>
  apiFetch('/users/me').then((r) => r.json())

export const uploadAvatar = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(`${BASE_URL}/users/me/avatar`, {
    method: 'POST',
    body: form,
    headers,
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}: upload failed`)
    return r.json()
  })
}

export const fetchAvatarBlobUrl = async (userId: number): Promise<string | null> => {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${BASE_URL}/users/${userId}/avatar`, { headers })
  if (!response.ok) return null
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}
```
`uploadAvatar` deliberately does NOT use `apiFetch` — `apiFetch` always sets
`Content-Type: application/json`, which would break `FormData`'s own
multipart boundary header. This mirrors `login()`'s existing precedent of
bypassing `apiFetch` for the same class of reason (its body isn't JSON).
`fetchAvatarBlobUrl` also bypasses `apiFetch` because a 404 (no avatar set)
is an expected, normal outcome here — it should resolve to `null`, not throw
the way `apiFetch` throws on every non-2xx response.

- [ ] **Step 3: Extend AuthContext**

Modify `client/src/context/AuthContext.tsx` — replace its full content:
```typescript
import { createContext, useContext, useState, type ReactNode } from 'react'
import { clearToken, getToken, setToken } from '../api/client'
import type { Role } from '../api/types'

const ROLE_KEY = 'svidat_role'
const USERNAME_KEY = 'svidat_username'
const ID_KEY = 'svidat_id'

interface AuthState {
  token: string | null
  role: Role | null
  username: string | null
  id: number | null
  avatarVersion: number
  login: (token: string, role: Role, username: string, id: number) => void
  logout: () => void
  bumpAvatarVersion: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken())
  const [role, setRole] = useState<Role | null>(
    (localStorage.getItem(ROLE_KEY) as Role | null) ?? null
  )
  const [username, setUsername] = useState<string | null>(localStorage.getItem(USERNAME_KEY))
  const [id, setId] = useState<number | null>(() => {
    const stored = localStorage.getItem(ID_KEY)
    return stored ? parseInt(stored, 10) : null
  })
  const [avatarVersion, setAvatarVersion] = useState(0)

  const login = (newToken: string, newRole: Role, newUsername: string, newId: number) => {
    setToken(newToken)
    localStorage.setItem(ROLE_KEY, newRole)
    localStorage.setItem(USERNAME_KEY, newUsername)
    localStorage.setItem(ID_KEY, String(newId))
    setTokenState(newToken)
    setRole(newRole)
    setUsername(newUsername)
    setId(newId)
  }

  const logout = () => {
    clearToken()
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(USERNAME_KEY)
    localStorage.removeItem(ID_KEY)
    setTokenState(null)
    setRole(null)
    setUsername(null)
    setId(null)
  }

  const bumpAvatarVersion = () => setAvatarVersion((v) => v + 1)

  return (
    <AuthContext.Provider
      value={{ token, role, username, id, avatarVersion, login, logout, bumpAvatarVersion }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
```

- [ ] **Step 4: Update LoginPage to fetch and store the user's id**

Modify `client/src/pages/LoginPage.tsx` — change the import line and
`handleSubmit`:
```typescript
import { getCurrentUser, login, setToken } from '../api/client'
```
(replace the existing `import { login } from '../api/client'` line with
the above, adding `getCurrentUser` and `setToken`)

```typescript
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const response = await login(username, password)
      setToken(response.access_token)
      const me = await getCurrentUser()
      auth.login(response.access_token, response.role as Role, me.username, me.id)
      navigate('/files')
    } catch {
      setError('Invalid username or password')
    }
  }
```
(replace the existing `handleSubmit` body with the above — note `setToken`
is called BEFORE `getCurrentUser()`, since `apiFetch` reads the token from
localStorage and `/users/me` requires auth)

- [ ] **Step 5: Run existing tests to confirm no regressions**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass (existing `ProtectedRoute.test.tsx` tests still pass — they
don't set `svidat_id`, so `id` stays `null` in those tests, which is a valid
state, not a crash)

- [ ] **Step 6 (SKIP — no git)**

---

### Task 6: Navbar component

**Files:**
- Create: `client/src/components/Navbar.tsx`
- Modify: `client/src/components/ProtectedRoute.tsx`
- Test: `client/src/__tests__/Navbar.test.tsx`

- [ ] **Step 1: Write failing test**

Create `client/src/__tests__/Navbar.test.tsx`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Navbar } from '../components/Navbar'
import { AuthProvider } from '../context/AuthContext'
import { setToken, getToken } from '../api/client'

function renderNavbar(role: string) {
  localStorage.clear()
  setToken('tok')
  localStorage.setItem('svidat_role', role)
  localStorage.setItem('svidat_username', 'testuser')
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('Navbar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows username and opens dropdown on click', () => {
    renderNavbar('qca')
    expect(screen.getByText('testuser')).toBeInTheDocument()
    fireEvent.click(screen.getByText('testuser'))
    expect(screen.getByText('Log out')).toBeInTheDocument()
    expect(screen.getByText('Profile')).toBeInTheDocument()
  })

  it('shows Admin link only for admin role', () => {
    renderNavbar('admin')
    fireEvent.click(screen.getByText('testuser'))
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('hides Admin link for non-admin role', () => {
    renderNavbar('qca')
    fireEvent.click(screen.getByText('testuser'))
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('logout clears the stored token', () => {
    renderNavbar('qca')
    fireEvent.click(screen.getByText('testuser'))
    fireEvent.click(screen.getByText('Log out'))
    expect(getToken()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../components/Navbar'`

- [ ] **Step 3: Implement Navbar**

Create `client/src/components/Navbar.tsx`:
```typescript
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAvatarBlobUrl } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function Navbar() {
  const { username, role, id, avatarVersion, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const navigate = useNavigate()
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (id == null) return
    let cancelled = false
    fetchAvatarBlobUrl(id).then((url) => {
      if (cancelled) return
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

  const goTo = (path: string) => {
    setOpen(false)
    navigate(path)
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav>
      <button onClick={() => goTo('/files')}>
        SVI<span>DAT</span>
      </button>
      <div>
        <button onClick={() => setOpen((o) => !o)}>
          <span>{username}</span>
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" width={28} height={28} />
          ) : (
            <span aria-hidden="true">●</span>
          )}
        </button>
        {open && (
          <div role="menu">
            <div>
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" width={32} height={32} />
              ) : (
                <span aria-hidden="true">●</span>
              )}
              <div>{username}</div>
              <div>{role}</div>
            </div>
            <button onClick={() => goTo('/profile')}>Profile</button>
            {role === 'admin' && <button onClick={() => goTo('/admin/users')}>Admin</button>}
            <button onClick={handleLogout}>Log out</button>
          </div>
        )}
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 new Navbar tests)

- [ ] **Step 5: Wire Navbar into ProtectedRoute**

Modify `client/src/components/ProtectedRoute.tsx` — replace entirely:
```typescript
import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Navbar } from './Navbar'
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
      {children}
    </>
  )
}
```

- [ ] **Step 6: Run FULL suite**

Run: `npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass — confirm `ProtectedRoute.test.tsx`'s existing tests
still pass with `Navbar` now rendering alongside `children` (they assert on
`screen.getByText('private content')`, which is unaffected by the added
navbar markup).

- [ ] **Step 7 (SKIP — no git)**

---

### Task 7: Profile page

**Files:**
- Create: `client/src/pages/ProfilePage.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/__tests__/ProfilePage.test.tsx`

- [ ] **Step 1: Write failing test**

Create `client/src/__tests__/ProfilePage.test.tsx`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProfilePage } from '../pages/ProfilePage'
import { AuthProvider } from '../context/AuthContext'
import * as apiClient from '../api/client'

describe('ProfilePage', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('svidat_id', '1')
    localStorage.setItem('svidat_username', 'testuser')
    localStorage.setItem('svidat_role', 'qca')
    vi.restoreAllMocks()
  })

  it('uploads a photo and shows a success status', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    const uploadSpy = vi
      .spyOn(apiClient, 'uploadAvatar')
      .mockResolvedValue({ avatar_path: 'avatars/1.png' })

    render(
      <AuthProvider>
        <ProfilePage />
      </AuthProvider>
    )

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const input = screen.getByLabelText('Upload photo')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith(file))
    await waitFor(() => expect(screen.getByText('Photo updated')).toBeInTheDocument())
  })

  it('shows an error status when upload fails', async () => {
    vi.spyOn(apiClient, 'fetchAvatarBlobUrl').mockResolvedValue(null)
    vi.spyOn(apiClient, 'uploadAvatar').mockRejectedValue(new Error('400: upload failed'))

    render(
      <AuthProvider>
        <ProfilePage />
      </AuthProvider>
    )

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload photo'), { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByText('Error: 400: upload failed')).toBeInTheDocument()
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pages/ProfilePage'`

- [ ] **Step 3: Implement ProfilePage**

Create `client/src/pages/ProfilePage.tsx`:
```typescript
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { fetchAvatarBlobUrl, uploadAvatar } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function ProfilePage() {
  const { id, username, role, avatarVersion, bumpAvatarVersion } = useAuth()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (id == null) return
    let cancelled = false
    fetchAvatarBlobUrl(id).then((url) => {
      if (cancelled) return
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = url
      setAvatarUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [id, avatarVersion])

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setStatus(null)
    try {
      await uploadAvatar(file)
      bumpAvatarVersion()
      setStatus('Photo updated')
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <h1>Profile</h1>
      {avatarUrl ? (
        <img src={avatarUrl} alt="avatar" width={80} height={80} />
      ) : (
        <span aria-hidden="true">●</span>
      )}
      <p>Username: {username}</p>
      <p>Role: {role}</p>
      <label>
        Upload photo
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFileChange}
          disabled={uploading}
        />
      </label>
      {status && <p role="status">{status}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 new ProfilePage tests)

- [ ] **Step 5: Wire the route**

Modify `client/src/App.tsx` — add the import and a new `<Route>`:
```typescript
import { ProfilePage } from './pages/ProfilePage'
```
(add alongside the other page imports)

```typescript
          <Route
            path="/profile"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
```
(add alongside the other `<Route>` entries, before the `/admin/users` route
or after `/files/:filename` — order among sibling `<Route>`s doesn't affect
matching here since none of the paths overlap)

- [ ] **Step 6: Run FULL suite**

Run: `npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass

- [ ] **Step 7 (SKIP — no git)**

---

### Task 8: Full backend + frontend test run, then live smoke test

- [ ] **Step 1: Backend**

Run: `conda activate svidat && cd /Users/ustropics/Documents/svidat/server && pytest -v`
Expected: all pass (70 prior + new tests from Tasks 1, 3, 4)

- [ ] **Step 2: Frontend**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test && npx tsc -b --noEmit && npm run build`
Expected: all pass (12 prior + new tests from Tasks 6, 7)

- [ ] **Step 3: Live smoke test**

Start backend (`uvicorn app.main:app --port 8000` from `server/`, conda env
active) and frontend (`npm run dev` from `client/`). Log in as `admin` /
`samos1234`. Confirm: navbar shows on `/files` with logo + username +
placeholder avatar circle. Click the account trigger — dropdown shows
avatar/username/role, "Profile", "Admin" (since logged in as admin), "Log
out". Go to `/profile`, upload a real small PNG/JPEG — confirm the navbar's
avatar updates to the uploaded photo without a page reload. Log out —
confirm redirect to `/login` and that the token is actually cleared (a
direct navigation to `/files` afterward redirects back to `/login`). Log
back in as a non-admin (or create one via `/admin/users` first) and confirm
the dropdown has no "Admin" line.
