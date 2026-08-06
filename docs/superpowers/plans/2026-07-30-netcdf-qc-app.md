# svidat NetCDF QC App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the svidat web app — FastAPI backend + React/Vite/TS frontend — for role-gated browsing, editing, and versioned save/publish of large netCDF ship data files, with full audit trail and revert.

**Architecture:** Monolith FastAPI backend (SQLite for users/roles/audit/locks, netCDF4-python for in-place variable writes, in-process background thread for bulk-edit jobs) behind a Vite/React/TypeScript frontend. Local filesystem storage under `data/{raw,temp,drafts,published}`. See design doc: `docs/superpowers/specs/2026-07-30-netcdf-qc-app-design.md`.

**Tech Stack:** Python 3.9.13 (conda env `svidat`), FastAPI, SQLAlchemy, pydantic-settings, python-jose, passlib[bcrypt], netCDF4, numpy, pytest, httpx. React 18, Vite, TypeScript, React Router, Vitest, @testing-library/react.

---

## Repo layout after this plan

```
svidat/
  server/
    requirements.txt
    app/
      __init__.py
      main.py
      config.py
      database.py
      models.py
      schemas.py
      security.py
      deps.py
      storage.py
      netcdf_ops.py
      jobs.py
      routers/
        __init__.py
        auth.py
        users.py
        files.py
        session.py
        edit.py
        workflow.py
        audit.py
    tests/
      conftest.py
      test_security.py
      test_netcdf_ops.py
      test_auth_routes.py
      test_roles.py
      test_session_locks.py
      test_edit_routes.py
      test_workflow_routes.py
      test_audit_routes.py
  client/
    (Vite React-TS scaffold)
    src/
      api/client.ts
      api/types.ts
      context/AuthContext.tsx
      components/ProtectedRoute.tsx
      components/EditForm.tsx
      components/AuditPanel.tsx
      pages/LoginPage.tsx
      pages/FileBrowserPage.tsx
      pages/DataViewerPage.tsx
      pages/AdminUsersPage.tsx
      App.tsx
      main.tsx
    src/__tests__/
      ProtectedRoute.test.tsx
      EditForm.test.tsx
      AuditPanel.test.tsx
  docs/superpowers/specs/2026-07-30-netcdf-qc-app-design.md
  docs/superpowers/plans/2026-07-30-netcdf-qc-app.md
```

All backend commands below assume `conda activate svidat &&` prefix (Python 3.9.13 env already created) and working directory `/Users/ustropics/Documents/svidat/server` unless noted. All frontend commands assume `/Users/ustropics/Documents/svidat/client`.

---

### Task 1: Backend scaffold & config

**Files:**
- Create: `server/requirements.txt`
- Create: `server/app/__init__.py`
- Create: `server/app/config.py`
- Create: `server/app/main.py`
- Create: `server/tests/__init__.py`
- Create: `server/tests/conftest.py` (partial — env setup only, extended in later tasks)
- Create: `server/pytest.ini`

- [ ] **Step 1: Create requirements.txt**

```
fastapi==0.104.1
uvicorn[standard]==0.24.0
sqlalchemy==2.0.23
pydantic==2.5.0
pydantic-settings==2.1.0
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
netCDF4==1.6.5
numpy==1.24.4
pytest==7.4.3
httpx==0.25.1
python-multipart==0.0.6
```

- [ ] **Step 2: Install dependencies**

Run: `conda activate svidat && cd /Users/ustropics/Documents/svidat/server && pip install -r requirements.txt`
Expected: all packages install cleanly. If `netCDF4` fails to build a wheel, run `brew install hdf5 netcdf` first, then retry.

- [ ] **Step 3: Create app package and config**

`server/app/__init__.py`:
```python
```

`server/app/config.py`:
```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    data_dir: str = "./data"
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    database_url: str = "sqlite:///./svidat.db"


settings = Settings()
```

- [ ] **Step 4: Create minimal FastAPI app with health check**

`server/app/main.py`:
```python
from fastapi import FastAPI

app = FastAPI(title="svidat")


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Set up pytest config and test env fixture**

`server/pytest.ini`:
```ini
[pytest]
testpaths = tests
```

`server/tests/__init__.py`:
```python
```

`server/tests/conftest.py`:
```python
import os
import tempfile
from pathlib import Path

_TEST_DIR = Path(tempfile.mkdtemp(prefix="svidat_test_"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DIR / 'test.db'}"
os.environ["DATA_DIR"] = str(_TEST_DIR / "data")
os.environ["SECRET_KEY"] = "test-secret"
```

- [ ] **Step 6: Write and run a smoke test for the health endpoint**

`server/tests/test_health.py`:
```python
from fastapi.testclient import TestClient

from app.main import app


def test_health():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

Run: `conda activate svidat && cd /Users/ustropics/Documents/svidat/server && pytest tests/test_health.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/requirements.txt server/app server/tests server/pytest.ini
git commit -m "feat: backend scaffold with health check"
```

(Skip if not using git per earlier decision — otherwise this establishes the baseline.)

---

### Task 2: Database models

**Files:**
- Create: `server/app/database.py`
- Create: `server/app/models.py`
- Test: `server/tests/test_models.py`

- [ ] **Step 1: Write failing test for model creation and constraints**

`server/tests/test_models.py`:
```python
from app.database import Base, engine, SessionLocal
from app.models import User, Role, Lock, AuditLog


def setup_module(_module):
    Base.metadata.create_all(bind=engine)


def test_create_user_and_query():
    db = SessionLocal()
    try:
        user = User(username="alice", password_hash="hashed", role=Role.qca)
        db.add(user)
        db.commit()
        db.refresh(user)

        found = db.query(User).filter(User.username == "alice").first()
        assert found is not None
        assert found.role == Role.qca
    finally:
        db.query(User).filter(User.username == "alice").delete()
        db.commit()
        db.close()


def test_lock_and_audit_log_relate_to_user():
    db = SessionLocal()
    try:
        user = User(username="bob", password_hash="hashed", role=Role.admin)
        db.add(user)
        db.commit()
        db.refresh(user)

        lock = Lock(filename="shipx_2026-07-30", user_id=user.id)
        log = AuditLog(filename="shipx_2026-07-30", user_id=user.id, action="point_edit")
        db.add_all([lock, log])
        db.commit()

        assert db.query(Lock).filter(Lock.user_id == user.id).count() == 1
        assert db.query(AuditLog).filter(AuditLog.user_id == user.id).count() == 1
    finally:
        db.query(Lock).filter(Lock.user_id == user.id).delete()
        db.query(AuditLog).filter(AuditLog.user_id == user.id).delete()
        db.query(User).filter(User.id == user.id).delete()
        db.commit()
        db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.database'`

- [ ] **Step 3: Implement database.py**

`server/app/database.py`:
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings

engine = create_engine(
    settings.database_url, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 4: Implement models.py**

`server/app/models.py`:
```python
import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from app.database import Base


class Role(str, enum.Enum):
    admin = "admin"
    qca = "qca"
    user = "user"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(Enum(Role), nullable=False, default=Role.user)
    created_at = Column(DateTime, default=datetime.utcnow)

    audit_entries = relationship("AuditLog", back_populates="user")


class Lock(Base):
    __tablename__ = "locks"

    id = Column(Integer, primary_key=True)
    filename = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    acquired_at = Column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    filename = Column(String, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String, nullable=False)  # point_edit | bulk_edit | revert | save | publish
    var_name = Column(String, nullable=True)
    indices_json = Column(String, nullable=True)
    old_value_scalar = Column(Float, nullable=True)
    new_value_scalar = Column(Float, nullable=True)
    old_value_ref = Column(String, nullable=True)
    new_value_ref = Column(String, nullable=True)
    reverted = Column(Boolean, default=False)
    timestamp = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="audit_entries")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/app/database.py server/app/models.py server/tests/test_models.py
git commit -m "feat: SQLAlchemy models for users, locks, audit log"
```

---

### Task 3: Security (password hashing + JWT)

**Files:**
- Create: `server/app/security.py`
- Test: `server/tests/test_security.py`

- [ ] **Step 1: Write failing tests**

`server/tests/test_security.py`:
```python
import time

import pytest

from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_hash_and_verify_password():
    hashed = hash_password("s3cret!")
    assert hashed != "s3cret!"
    assert verify_password("s3cret!", hashed)
    assert not verify_password("wrong", hashed)


def test_create_and_decode_token():
    token = create_access_token("alice", "qca")
    payload = decode_access_token(token)
    assert payload["sub"] == "alice"
    assert payload["role"] == "qca"


def test_decode_invalid_token_raises():
    with pytest.raises(ValueError):
        decode_access_token("not-a-real-token")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_security.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.security'`

- [ ] **Step 3: Implement security.py**

`server/app/security.py`:
```python
from datetime import datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(username: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("invalid token") from exc
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_security.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add server/app/security.py server/tests/test_security.py
git commit -m "feat: password hashing and JWT helpers"
```

---

### Task 4: netCDF ops module

**Files:**
- Create: `server/app/netcdf_ops.py`
- Test: `server/tests/test_netcdf_ops.py`

- [ ] **Step 1: Write failing tests using a synthetic netCDF fixture**

`server/tests/test_netcdf_ops.py`:
```python
import netCDF4
import numpy as np
import pytest

from app import netcdf_ops


@pytest.fixture
def nc_file(tmp_path):
    path = tmp_path / "shipx_2026-07-30.nc"
    with netCDF4.Dataset(path, "w") as ds:
        ds.createDimension("time", 5)
        var = ds.createVariable("temperature", "f4", ("time",))
        var[:] = np.array([10.0, 11.0, 12.0, 13.0, 14.0], dtype="f4")
        var.units = "degC"
    return path


def test_get_metadata(nc_file):
    meta = netcdf_ops.get_metadata(nc_file)
    assert meta["dimensions"]["time"] == 5
    assert meta["variables"]["temperature"]["shape"] == [5]
    assert meta["variables"]["temperature"]["attrs"]["units"] == "degC"


def test_read_and_write_point(nc_file):
    old = netcdf_ops.write_point(nc_file, "temperature", [2], 99.0)
    assert old == pytest.approx(12.0)
    assert netcdf_ops.read_point(nc_file, "temperature", [2]) == pytest.approx(99.0)


def test_write_bulk_add(nc_file):
    old_values = netcdf_ops.write_bulk(nc_file, "temperature", [(1, 4)], 1.0, "add")
    assert list(old_values) == pytest.approx([11.0, 12.0, 13.0])
    new_values = [netcdf_ops.read_point(nc_file, "temperature", [i]) for i in range(1, 4)]
    assert new_values == pytest.approx([12.0, 13.0, 14.0])


def test_restore_point_and_bulk(nc_file):
    netcdf_ops.write_point(nc_file, "temperature", [0], 0.0)
    netcdf_ops.restore_point(nc_file, "temperature", [0], 10.0)
    assert netcdf_ops.read_point(nc_file, "temperature", [0]) == pytest.approx(10.0)

    old_values = netcdf_ops.write_bulk(nc_file, "temperature", [(3, 5)], 5.0, "set")
    netcdf_ops.restore_bulk(nc_file, "temperature", [(3, 5)], old_values)
    restored = [netcdf_ops.read_point(nc_file, "temperature", [i]) for i in range(3, 5)]
    assert restored == pytest.approx(list(old_values))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_netcdf_ops.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.netcdf_ops'`

- [ ] **Step 3: Implement netcdf_ops.py**

`server/app/netcdf_ops.py`:
```python
from typing import Any, Dict, List, Tuple

import netCDF4
import numpy as np


def get_metadata(path) -> Dict[str, Any]:
    with netCDF4.Dataset(path, "r") as ds:
        variables = {}
        for name, var in ds.variables.items():
            variables[name] = {
                "dims": list(var.dimensions),
                "shape": list(var.shape),
                "dtype": str(var.dtype),
                "attrs": {attr: var.getncattr(attr) for attr in var.ncattrs()},
            }
        dimensions = {name: len(dim) for name, dim in ds.dimensions.items()}
    return {"variables": variables, "dimensions": dimensions}


def read_point(path, var_name: str, indices: List[int]) -> float:
    with netCDF4.Dataset(path, "r") as ds:
        return float(ds.variables[var_name][tuple(indices)])


def write_point(path, var_name: str, indices: List[int], value: float) -> float:
    with netCDF4.Dataset(path, "r+") as ds:
        variable = ds.variables[var_name]
        old_value = float(variable[tuple(indices)])
        variable[tuple(indices)] = value
    return old_value


def write_bulk(
    path, var_name: str, slices: List[Tuple[int, int]], value: float, op: str
) -> np.ndarray:
    index = tuple(slice(start, stop) for start, stop in slices)
    with netCDF4.Dataset(path, "r+") as ds:
        variable = ds.variables[var_name]
        old_values = np.array(variable[index])
        if op == "set":
            new_values = np.full(old_values.shape, value)
        elif op == "add":
            new_values = old_values + value
        elif op == "multiply":
            new_values = old_values * value
        else:
            raise ValueError(f"unknown bulk op: {op}")
        variable[index] = new_values
    return old_values


def restore_point(path, var_name: str, indices: List[int], old_value: float) -> None:
    with netCDF4.Dataset(path, "r+") as ds:
        ds.variables[var_name][tuple(indices)] = old_value


def restore_bulk(
    path, var_name: str, slices: List[Tuple[int, int]], old_values: np.ndarray
) -> None:
    index = tuple(slice(start, stop) for start, stop in slices)
    with netCDF4.Dataset(path, "r+") as ds:
        ds.variables[var_name][index] = old_values
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_netcdf_ops.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add server/app/netcdf_ops.py server/tests/test_netcdf_ops.py
git commit -m "feat: netCDF point and bulk read/write/restore ops"
```

---

### Task 5: Storage path helpers

**Files:**
- Create: `server/app/storage.py`
- Test: `server/tests/test_storage.py`

- [ ] **Step 1: Write failing tests**

`server/tests/test_storage.py`:
```python
import os

from app import storage


def test_paths_use_data_dir():
    assert storage.raw_path("shipx_2026-07-30") == storage.base_dir() / "raw" / "shipx_2026-07-30.nc"
    assert storage.temp_path("alice", "shipx_2026-07-30") == (
        storage.base_dir() / "temp" / "alice" / "shipx_2026-07-30_temp.nc"
    )
    assert storage.draft_path("alice", "shipx_2026-07-30") == (
        storage.base_dir() / "drafts" / "alice" / "v250" / "shipx_2026-07-30_v250.nc"
    )
    assert storage.published_path("shipx_2026-07-30") == (
        storage.base_dir() / "published" / "shipx_2026-07-30_v300.nc"
    )


def test_atomic_copy_creates_dest_and_no_partial_on_failure(tmp_path):
    src = tmp_path / "source.nc"
    src.write_bytes(b"fake netcdf bytes")
    dst = tmp_path / "nested" / "dir" / "dest.nc"

    storage.atomic_copy(src, dst)

    assert dst.exists()
    assert dst.read_bytes() == b"fake netcdf bytes"
    assert not (dst.parent / (dst.name + ".tmp")).exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_storage.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.storage'`

- [ ] **Step 3: Implement storage.py**

`server/app/storage.py`:
```python
import os
import shutil
from pathlib import Path

from app.config import settings


def base_dir() -> Path:
    return Path(settings.data_dir)


def raw_path(filename: str) -> Path:
    return base_dir() / "raw" / f"{filename}.nc"


def temp_path(username: str, filename: str) -> Path:
    return base_dir() / "temp" / username / f"{filename}_temp.nc"


def draft_path(username: str, filename: str) -> Path:
    return base_dir() / "drafts" / username / "v250" / f"{filename}_v250.nc"


def published_path(filename: str) -> Path:
    return base_dir() / "published" / f"{filename}_v300.nc"


def audit_blob_path(audit_id: int) -> Path:
    return base_dir() / "audit_blobs" / f"{audit_id}.npy"


def atomic_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp_dst = dst.with_suffix(dst.suffix + ".tmp")
    shutil.copyfile(src, tmp_dst)
    os.replace(tmp_dst, dst)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_storage.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add server/app/storage.py server/tests/test_storage.py
git commit -m "feat: filesystem path helpers and atomic copy"
```

---

### Task 6: Auth dependencies

**Files:**
- Create: `server/app/schemas.py`
- Create: `server/app/deps.py`
- Modify: `server/tests/conftest.py` (add DB/client/user fixtures)
- Test: `server/tests/test_deps.py`

- [ ] **Step 1: Extend conftest.py with shared fixtures**

`server/tests/conftest.py` (replace previous content entirely):
```python
import os
import tempfile
from pathlib import Path

_TEST_DIR = Path(tempfile.mkdtemp(prefix="svidat_test_"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DIR / 'test.db'}"
os.environ["DATA_DIR"] = str(_TEST_DIR / "data")
os.environ["SECRET_KEY"] = "test-secret"

import netCDF4
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Role, User
from app.security import hash_password

Base.metadata.create_all(bind=engine)


@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def make_user(db_session):
    def _make(username: str, role: Role, password: str = "pass1234"):
        user = User(username=username, password_hash=hash_password(password), role=role)
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        return user

    return _make


@pytest.fixture
def auth_header(client, make_user):
    def _login(username: str, role: Role, password: str = "pass1234"):
        make_user(username, role, password)
        resp = client.post("/auth/login", data={"username": username, "password": password})
        assert resp.status_code == 200, resp.text
        token = resp.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _login


@pytest.fixture
def synthetic_nc():
    def _make(filename: str = "shipx_2026-07-30"):
        raw_dir = Path(os.environ["DATA_DIR"]) / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        path = raw_dir / f"{filename}.nc"
        with netCDF4.Dataset(path, "w") as ds:
            ds.createDimension("time", 5)
            var = ds.createVariable("temperature", "f4", ("time",))
            var[:] = np.array([10.0, 11.0, 12.0, 13.0, 14.0], dtype="f4")
        return filename

    return _make
```

Note: importing `app.main` here requires `main.py` to already define routers used by later tasks — Task 1's minimal `main.py` (health check only) is enough for this fixture file to import successfully right now.

- [ ] **Step 2: Write failing tests for schemas and deps**

`server/tests/test_deps.py`:
```python
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.deps import get_current_user, require_role
from app.models import Role


def _build_test_app():
    test_app = FastAPI()

    @test_app.get("/whoami")
    def whoami(user=Depends(get_current_user)):
        return {"username": user.username, "role": user.role.value}

    @test_app.get("/admin-only")
    def admin_only(user=Depends(require_role(Role.admin))):
        return {"username": user.username}

    return test_app


def test_get_current_user_valid_token(make_user):
    from app.security import create_access_token

    make_user("carol", Role.user)
    token = create_access_token("carol", Role.user.value)

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"username": "carol", "role": "user"}


def test_get_current_user_invalid_token_401():
    test_client = TestClient(_build_test_app())
    resp = test_client.get("/whoami", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


def test_require_role_blocks_wrong_role(make_user):
    from app.security import create_access_token

    make_user("dave", Role.user)
    token = create_access_token("dave", Role.user.value)

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_require_role_allows_correct_role(make_user):
    from app.security import create_access_token

    make_user("erin", Role.admin)
    token = create_access_token("erin", Role.admin.value)

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_deps.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.deps'`

- [ ] **Step 4: Implement schemas.py and deps.py**

`server/app/schemas.py`:
```python
from typing import List

from pydantic import BaseModel

from app.models import Role


class UserCreate(BaseModel):
    username: str
    password: str
    role: Role


class UserOut(BaseModel):
    id: int
    username: str
    role: Role

    class Config:
        from_attributes = True


class PointEditRequest(BaseModel):
    filename: str
    var_name: str
    indices: List[int]
    value: float


class BulkEditRequest(BaseModel):
    filename: str
    var_name: str
    slices: List[List[int]]
    op: str
    value: float


class SaveRequest(BaseModel):
    filename: str


class PublishRequest(BaseModel):
    filename: str
```

`server/app/deps.py`:
```python
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Role, User
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    try:
        payload = decode_access_token(token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )
    username = payload.get("sub")
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found"
        )
    return user


def require_role(*roles: Role):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="insufficient role"
            )
        return user

    return checker
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_deps.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add server/app/schemas.py server/app/deps.py server/tests/conftest.py server/tests/test_deps.py
git commit -m "feat: auth dependency for current user and role checks"
```

---

### Task 7: Auth route (login)

**Files:**
- Create: `server/app/routers/__init__.py`
- Create: `server/app/routers/auth.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_auth_routes.py`

- [ ] **Step 1: Write failing test**

`server/tests/test_auth_routes.py`:
```python
from app.models import Role


def test_login_success(client, make_user):
    make_user("frank", Role.qca, password="hunter22")
    resp = client.post("/auth/login", data={"username": "frank", "password": "hunter22"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "qca"
    assert body["token_type"] == "bearer"
    assert body["access_token"]


def test_login_wrong_password(client, make_user):
    make_user("gail", Role.user, password="correcthorse")
    resp = client.post("/auth/login", data={"username": "gail", "password": "wrong"})
    assert resp.status_code == 401


def test_login_unknown_user(client):
    resp = client.post("/auth/login", data={"username": "nobody", "password": "x"})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_auth_routes.py -v`
Expected: FAIL — 404s (no `/auth/login` route registered yet)

- [ ] **Step 3: Implement auth router**

`server/app/routers/__init__.py`:
```python
```

`server/app/routers/auth.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.username == form_data.username).first()
    if user is None or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid username or password",
        )
    token = create_access_token(user.username, user.role.value)
    return {"access_token": token, "token_type": "bearer", "role": user.role.value}
```

- [ ] **Step 4: Wire router into main.py**

`server/app/main.py` (replace entirely):
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import auth

Base.metadata.create_all(bind=engine)

app = FastAPI(title="svidat")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_auth_routes.py -v`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**

```bash
git add server/app/routers/__init__.py server/app/routers/auth.py server/app/main.py server/tests/test_auth_routes.py
git commit -m "feat: login route issuing JWT"
```

---

### Task 8: Users route (admin CRUD)

**Files:**
- Create: `server/app/routers/users.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_users_routes.py`

- [ ] **Step 1: Write failing tests**

`server/tests/test_users_routes.py`:
```python
from app.models import Role


def test_admin_can_create_and_list_users(client, auth_header):
    headers = auth_header("admin1", Role.admin)

    resp = client.post(
        "/users", json={"username": "newqca", "password": "pw12345", "role": "qca"}, headers=headers
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["username"] == "newqca"

    resp = client.get("/users", headers=headers)
    assert resp.status_code == 200
    usernames = [u["username"] for u in resp.json()]
    assert "newqca" in usernames


def test_non_admin_cannot_create_user(client, auth_header):
    headers = auth_header("regular1", Role.user)
    resp = client.post(
        "/users", json={"username": "x", "password": "pw12345", "role": "user"}, headers=headers
    )
    assert resp.status_code == 403


def test_duplicate_username_conflict(client, auth_header):
    headers = auth_header("admin2", Role.admin)
    client.post("/users", json={"username": "dupe", "password": "pw12345", "role": "user"}, headers=headers)
    resp = client.post("/users", json={"username": "dupe", "password": "pw12345", "role": "user"}, headers=headers)
    assert resp.status_code == 409


def test_admin_can_delete_user(client, auth_header):
    headers = auth_header("admin3", Role.admin)
    create_resp = client.post(
        "/users", json={"username": "todelete", "password": "pw12345", "role": "user"}, headers=headers
    )
    user_id = create_resp.json()["id"]

    resp = client.delete(f"/users/{user_id}", headers=headers)
    assert resp.status_code == 204

    resp = client.get("/users", headers=headers)
    assert "todelete" not in [u["username"] for u in resp.json()]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_users_routes.py -v`
Expected: FAIL — 404s (no `/users` route yet)

- [ ] **Step 3: Implement users router**

`server/app/routers/users.py`:
```python
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_role
from app.models import Role, User
from app.schemas import UserCreate, UserOut
from app.security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db), _: User = Depends(require_role(Role.admin))
):
    return db.query(User).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="username taken"
        )
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
        )
    db.delete(user)
    db.commit()
```

- [ ] **Step 4: Register router in main.py**

`server/app/main.py` — update imports and includes:
```python
from app.routers import auth, users
```
and add:
```python
app.include_router(users.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_users_routes.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add server/app/routers/users.py server/app/main.py server/tests/test_users_routes.py
git commit -m "feat: admin user management routes"
```

---

### Task 9: Files route (list raw/drafts + metadata)

**Files:**
- Create: `server/app/routers/files.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_files_routes.py`

- [ ] **Step 1: Write failing tests**

`server/tests/test_files_routes.py`:
```python
from app.models import Role
from app import storage


def test_list_raw_files(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-07-30")
    headers = auth_header("viewer1", Role.user)
    resp = client.get("/files/raw", headers=headers)
    assert resp.status_code == 200
    assert "shipx_2026-07-30" in resp.json()


def test_file_metadata(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-07-31")
    headers = auth_header("viewer2", Role.user)
    resp = client.get("/files/shipx_2026-07-31/metadata", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["dimensions"]["time"] == 5
    assert "temperature" in body["variables"]


def test_metadata_404_for_missing_file(client, auth_header):
    headers = auth_header("viewer3", Role.user)
    resp = client.get("/files/does-not-exist/metadata", headers=headers)
    assert resp.status_code == 404


def test_list_own_drafts_only_for_regular_user(client, auth_header):
    headers_owner = auth_header("owner1", Role.qca)
    draft = storage.draft_path("owner1", "shipx_2026-08-01")
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_bytes(b"fake")

    resp = client.get("/files/drafts", headers=headers_owner)
    assert resp.status_code == 200
    assert "shipx_2026-08-01" in resp.json()

    headers_other = auth_header("other1", Role.user)
    resp = client.get("/files/drafts", params={"username": "owner1"}, headers=headers_other)
    assert resp.status_code == 403


def test_admin_can_list_others_drafts(client, auth_header):
    headers_owner = auth_header("owner2", Role.qca)
    draft = storage.draft_path("owner2", "shipx_2026-08-02")
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_bytes(b"fake")

    headers_admin = auth_header("admin4", Role.admin)
    resp = client.get("/files/drafts", params={"username": "owner2"}, headers=headers_admin)
    assert resp.status_code == 200
    assert "shipx_2026-08-02" in resp.json()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_files_routes.py -v`
Expected: FAIL — 404s (no `/files/*` routes yet)

- [ ] **Step 3: Implement files router**

`server/app/routers/files.py`:
```python
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app import netcdf_ops, storage
from app.deps import get_current_user
from app.models import Role, User

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/raw")
def list_raw(_: User = Depends(get_current_user)):
    raw_dir = storage.base_dir() / "raw"
    if not raw_dir.exists():
        return []
    return sorted(p.stem for p in raw_dir.glob("*.nc"))


@router.get("/drafts")
def list_drafts(
    username: Optional[str] = None, user: User = Depends(get_current_user)
):
    target = username or user.username
    if target != user.username and user.role not in (Role.admin, Role.qca):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="cannot view another user's drafts",
        )
    draft_dir = storage.base_dir() / "drafts" / target / "v250"
    if not draft_dir.exists():
        return []
    return sorted(p.stem.replace("_v250", "") for p in draft_dir.glob("*_v250.nc"))


@router.get("/{filename}/metadata")
def file_metadata(filename: str, _: User = Depends(get_current_user)):
    path = storage.raw_path(filename)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="file not found"
        )
    return netcdf_ops.get_metadata(path)
```

- [ ] **Step 4: Register router in main.py**

Update imports to `from app.routers import auth, files, users` and add `app.include_router(files.router)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_files_routes.py -v`
Expected: PASS (5 passed)

- [ ] **Step 6: Commit**

```bash
git add server/app/routers/files.py server/app/main.py server/tests/test_files_routes.py
git commit -m "feat: file listing and metadata routes"
```

---

### Task 10: Session route (open/close + locking)

**Files:**
- Create: `server/app/routers/session.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_session_locks.py`

- [ ] **Step 1: Write failing tests**

`server/tests/test_session_locks.py`:
```python
from app.models import Role
from app import storage


def test_open_session_copies_raw_to_temp(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-05")
    headers = auth_header("editor1", Role.qca)

    resp = client.post("/session/shipx_2026-08-05/open", params={"source": "raw"}, headers=headers)
    assert resp.status_code == 200
    temp = storage.temp_path("editor1", "shipx_2026-08-05")
    assert temp.exists()


def test_second_user_blocked_while_locked(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-06")
    headers_a = auth_header("editor2", Role.qca)
    headers_b = auth_header("editor3", Role.qca)

    resp = client.post("/session/shipx_2026-08-06/open", params={"source": "raw"}, headers=headers_a)
    assert resp.status_code == 200

    resp = client.post("/session/shipx_2026-08-06/open", params={"source": "raw"}, headers=headers_b)
    assert resp.status_code == 409


def test_close_releases_lock_for_next_editor(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-07")
    headers_a = auth_header("editor4", Role.qca)
    headers_b = auth_header("editor5", Role.qca)

    client.post("/session/shipx_2026-08-07/open", params={"source": "raw"}, headers=headers_a)
    resp = client.post("/session/shipx_2026-08-07/close", headers=headers_a)
    assert resp.status_code == 200

    resp = client.post("/session/shipx_2026-08-07/open", params={"source": "raw"}, headers=headers_b)
    assert resp.status_code == 200


def test_reopen_same_user_keeps_existing_temp_for_recovery(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-08")
    headers = auth_header("editor6", Role.qca)

    client.post("/session/shipx_2026-08-08/open", params={"source": "raw"}, headers=headers)
    temp = storage.temp_path("editor6", "shipx_2026-08-08")
    temp.write_bytes(b"edited-marker")
    client.post("/session/shipx_2026-08-08/close", headers=headers)

    client.post("/session/shipx_2026-08-08/open", params={"source": "raw"}, headers=headers)
    assert temp.read_bytes() == b"edited-marker"


def test_regular_user_cannot_open_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-09")
    headers = auth_header("viewer4", Role.user)
    resp = client.post("/session/shipx_2026-08-09/open", params={"source": "raw"}, headers=headers)
    assert resp.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_session_locks.py -v`
Expected: FAIL — 404s (no `/session/*` routes yet)

- [ ] **Step 3: Implement session router**

`server/app/routers/session.py`:
```python
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import storage
from app.database import get_db
from app.deps import require_role
from app.models import Lock, Role, User

router = APIRouter(prefix="/session", tags=["session"])


@router.post("/{filename}/open")
def open_session(
    filename: str,
    source: str = "raw",
    source_username: Optional[str] = None,
    force: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    existing_lock = db.query(Lock).filter(Lock.filename == filename).first()
    if existing_lock and existing_lock.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"locked by user_id={existing_lock.user_id} "
                f"since {existing_lock.acquired_at.isoformat()}"
            ),
        )
    if existing_lock is None:
        db.add(Lock(filename=filename, user_id=user.id, acquired_at=datetime.utcnow()))
        db.commit()

    dst = storage.temp_path(user.username, filename)
    if not dst.exists() or force:
        if source == "raw":
            src = storage.raw_path(filename)
        elif source == "draft":
            src = storage.draft_path(source_username or user.username, filename)
        elif source == "temp":
            src = storage.temp_path(source_username or user.username, filename)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="invalid source"
            )
        if not src.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="source file not found"
            )
        storage.atomic_copy(src, dst)
    return {"temp_path": str(dst)}


@router.post("/{filename}/close")
def close_session(
    filename: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    lock = (
        db.query(Lock)
        .filter(Lock.filename == filename, Lock.user_id == user.id)
        .first()
    )
    if lock:
        db.delete(lock)
        db.commit()
    return {"status": "closed"}
```

- [ ] **Step 4: Register router in main.py**

Update imports to `from app.routers import auth, files, session, users` and add `app.include_router(session.router)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_session_locks.py -v`
Expected: PASS (5 passed)

- [ ] **Step 6: Commit**

```bash
git add server/app/routers/session.py server/app/main.py server/tests/test_session_locks.py
git commit -m "feat: session open/close with single-editor locking"
```

---

### Task 11: Point edit route

**Files:**
- Create: `server/app/routers/edit.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_edit_routes.py` (point edit tests only — bulk added in Task 12)

- [ ] **Step 1: Write failing tests**

`server/tests/test_edit_routes.py`:
```python
from app.models import Role


def test_point_edit_writes_value_and_logs_audit(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-10")
    headers = auth_header("pointeditor1", Role.qca)
    client.post("/session/shipx_2026-08-10/open", params={"source": "raw"}, headers=headers)

    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-10", "var_name": "temperature", "indices": [1], "value": 42.0},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["old_value"] == 11.0
    assert body["new_value"] == 42.0
    assert body["audit_id"] > 0


def test_point_edit_requires_open_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-11")
    headers = auth_header("pointeditor2", Role.qca)
    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-11", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=headers,
    )
    assert resp.status_code in (404, 409)


def test_regular_user_cannot_point_edit(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-12")
    headers = auth_header("viewer5", Role.user)
    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-12", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=headers,
    )
    assert resp.status_code == 403


def test_point_edit_invalid_var_name_returns_400(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-12b")
    headers = auth_header("pointeditor3", Role.qca)
    client.post("/session/shipx_2026-08-12b/open", params={"source": "raw"}, headers=headers)
    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-12b", "var_name": "not_a_variable", "indices": [0], "value": 1.0},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "not_a_variable" in resp.json()["detail"]


def test_point_edit_out_of_range_index_returns_400(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-12c")
    headers = auth_header("pointeditor4", Role.qca)
    client.post("/session/shipx_2026-08-12c/open", params={"source": "raw"}, headers=headers)
    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-12c", "var_name": "temperature", "indices": [99], "value": 1.0},
        headers=headers,
    )
    assert resp.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_edit_routes.py -v`
Expected: FAIL — 404s (no `/edit/point` route yet)

- [ ] **Step 3: Implement edit router (point edit only)**

`server/app/routers/edit.py`:
```python
import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import netcdf_ops, storage
from app.database import get_db
from app.deps import require_role
from app.models import AuditLog, Lock, Role, User
from app.schemas import PointEditRequest

router = APIRouter(prefix="/edit", tags=["edit"])


def _require_lock(db: Session, filename: str, user: User) -> None:
    lock = db.query(Lock).filter(Lock.filename == filename).first()
    if lock is None or lock.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="no active edit lock for this file",
        )


@router.post("/point")
def point_edit(
    payload: PointEditRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    _require_lock(db, payload.filename, user)
    path = storage.temp_path(user.username, payload.filename)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )

    try:
        old_value = netcdf_ops.write_point(path, payload.var_name, payload.indices, payload.value)
    except (KeyError, IndexError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"invalid edit for var '{payload.var_name}': {exc}",
        )

    log = AuditLog(
        filename=payload.filename,
        user_id=user.id,
        action="point_edit",
        var_name=payload.var_name,
        indices_json=json.dumps(payload.indices),
        old_value_scalar=old_value,
        new_value_scalar=payload.value,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return {"audit_id": log.id, "old_value": old_value, "new_value": payload.value}
```

- [ ] **Step 4: Register router in main.py**

Update imports to `from app.routers import auth, edit, files, session, users` and add `app.include_router(edit.router)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_edit_routes.py -v`
Expected: PASS (5 passed)

- [ ] **Step 6: Commit**

```bash
git add server/app/routers/edit.py server/app/main.py server/tests/test_edit_routes.py
git commit -m "feat: point edit route with audit logging"
```

---

### Task 12: Jobs runner + bulk edit route

**Files:**
- Create: `server/app/jobs.py`
- Modify: `server/app/routers/edit.py` (add bulk edit + job status)
- Modify: `server/app/main.py`
- Modify: `server/tests/test_edit_routes.py` (append bulk edit tests)
- Test: `server/tests/test_jobs.py`

- [ ] **Step 1: Write failing test for jobs module**

`server/tests/test_jobs.py`:
```python
import time

from app import jobs


def test_submit_job_runs_and_completes():
    def target():
        return {"value": 42}

    job_id = jobs.submit_job(target)
    deadline = time.time() + 2
    while time.time() < deadline:
        job = jobs.get_job(job_id)
        if job.status == jobs.JobStatus.done:
            break
        time.sleep(0.01)

    job = jobs.get_job(job_id)
    assert job.status == jobs.JobStatus.done
    assert job.result == {"value": 42}


def test_submit_job_captures_failure():
    def target():
        raise ValueError("boom")

    job_id = jobs.submit_job(target)
    deadline = time.time() + 2
    while time.time() < deadline:
        job = jobs.get_job(job_id)
        if job.status == jobs.JobStatus.failed:
            break
        time.sleep(0.01)

    job = jobs.get_job(job_id)
    assert job.status == jobs.JobStatus.failed
    assert "boom" in job.error


def test_get_unknown_job_returns_none():
    assert jobs.get_job("does-not-exist") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_jobs.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.jobs'`

- [ ] **Step 3: Implement jobs.py**

`server/app/jobs.py`:
```python
import threading
import uuid
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Dict, Optional


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


@dataclass
class Job:
    id: str
    status: JobStatus = JobStatus.pending
    error: Optional[str] = None
    result: Optional[dict] = None


_jobs: Dict[str, Job] = {}
_lock = threading.Lock()


def submit_job(target: Callable[[], dict]) -> str:
    job_id = str(uuid.uuid4())
    job = Job(id=job_id, status=JobStatus.pending)
    with _lock:
        _jobs[job_id] = job

    def runner():
        job.status = JobStatus.running
        try:
            job.result = target()
            job.status = JobStatus.done
        except Exception as exc:  # noqa: BLE001 - job failure must be captured, not raised
            job.error = str(exc)
            job.status = JobStatus.failed

    threading.Thread(target=runner, daemon=True).start()
    return job_id


def get_job(job_id: str) -> Optional[Job]:
    with _lock:
        return _jobs.get(job_id)
```

- [ ] **Step 4: Run jobs test to verify it passes**

Run: `pytest tests/test_jobs.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Append failing bulk-edit tests to test_edit_routes.py**

Append to `server/tests/test_edit_routes.py`:
```python
import time


def _wait_for_job(client, headers, job_id, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"/edit/jobs/{job_id}", headers=headers)
        if resp.json()["status"] in ("done", "failed"):
            return resp.json()
        time.sleep(0.02)
    raise TimeoutError("job did not complete in time")


def test_bulk_edit_applies_op_and_logs_audit(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-13")
    headers = auth_header("bulkeditor1", Role.qca)
    client.post("/session/shipx_2026-08-13/open", params={"source": "raw"}, headers=headers)

    resp = client.post(
        "/edit/bulk",
        json={
            "filename": "shipx_2026-08-13",
            "var_name": "temperature",
            "slices": [[1, 4]],
            "op": "add",
            "value": 1.0,
        },
        headers=headers,
    )
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]

    result = _wait_for_job(client, headers, job_id)
    assert result["status"] == "done"
    assert result["result"]["audit_id"] > 0

    verify = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-13", "var_name": "temperature", "indices": [1], "value": 999.0},
        headers=headers,
    )
    assert verify.json()["old_value"] == 12.0


def test_bulk_edit_requires_open_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-14")
    headers = auth_header("bulkeditor2", Role.qca)
    resp = client.post(
        "/edit/bulk",
        json={
            "filename": "shipx_2026-08-14",
            "var_name": "temperature",
            "slices": [[0, 2]],
            "op": "set",
            "value": 0.0,
        },
        headers=headers,
    )
    assert resp.status_code in (404, 409)
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pytest tests/test_edit_routes.py -v`
Expected: FAIL — 404s (no `/edit/bulk` or `/edit/jobs/{id}` routes yet)

- [ ] **Step 7: Add bulk edit and job-status endpoints to edit.py**

Append to `server/app/routers/edit.py` (add imports at top: `import numpy as np`, `from app.database import SessionLocal`, `from app import jobs`; add `from app.schemas import BulkEditRequest` alongside the existing `PointEditRequest` import):

```python
@router.post("/bulk")
def bulk_edit(
    payload: BulkEditRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    _require_lock(db, payload.filename, user)
    path = storage.temp_path(user.username, payload.filename)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )

    slices = [tuple(pair) for pair in payload.slices]

    def run_bulk_edit() -> dict:
        old_values = netcdf_ops.write_bulk(path, payload.var_name, slices, payload.value, payload.op)
        job_db = SessionLocal()
        try:
            log = AuditLog(
                filename=payload.filename,
                user_id=user.id,
                action="bulk_edit",
                var_name=payload.var_name,
                indices_json=json.dumps(payload.slices),
                new_value_scalar=payload.value,
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

    job_id = jobs.submit_job(run_bulk_edit)
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
def job_status(job_id: str, _: User = Depends(require_role(Role.admin, Role.qca))):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return {"status": job.status.value, "error": job.error, "result": job.result}
```

Note: `run_bulk_edit` opens its own `SessionLocal()` rather than reusing the request-scoped `db` — the injected session is closed by FastAPI right after the endpoint returns, but the background thread may still be running at that point.

- [ ] **Step 8: Run test to verify it passes**

Run: `pytest tests/test_edit_routes.py -v`
Expected: PASS (7 passed)

- [ ] **Step 9: Commit**

```bash
git add server/app/jobs.py server/app/routers/edit.py server/app/main.py server/tests/test_jobs.py server/tests/test_edit_routes.py
git commit -m "feat: background job runner and bulk edit route"
```

---

### Task 13: Workflow routes (save/publish)

**Files:**
- Create: `server/app/routers/workflow.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_workflow_routes.py`

- [ ] **Step 1: Write failing tests**

`server/tests/test_workflow_routes.py`:
```python
from app.models import Role
from app import storage


def test_save_copies_temp_to_draft(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-15")
    headers = auth_header("saver1", Role.qca)
    client.post("/session/shipx_2026-08-15/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/save", json={"filename": "shipx_2026-08-15"}, headers=headers)
    assert resp.status_code == 200
    draft = storage.draft_path("saver1", "shipx_2026-08-15")
    assert draft.exists()


def test_save_overwrites_previous_draft(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-16")
    headers = auth_header("saver2", Role.qca)
    client.post("/session/shipx_2026-08-16/open", params={"source": "raw"}, headers=headers)
    client.post("/save", json={"filename": "shipx_2026-08-16"}, headers=headers)

    temp = storage.temp_path("saver2", "shipx_2026-08-16")
    temp.write_bytes(b"second-save-marker")
    client.post("/save", json={"filename": "shipx_2026-08-16"}, headers=headers)

    draft = storage.draft_path("saver2", "shipx_2026-08-16")
    assert draft.read_bytes() == b"second-save-marker"


def test_publish_copies_temp_to_shared_v300(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-17")
    headers = auth_header("publisher1", Role.qca)
    client.post("/session/shipx_2026-08-17/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/publish", json={"filename": "shipx_2026-08-17"}, headers=headers)
    assert resp.status_code == 200
    published = storage.published_path("shipx_2026-08-17")
    assert published.exists()


def test_publish_does_not_require_prior_save(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-18")
    headers = auth_header("publisher2", Role.qca)
    client.post("/session/shipx_2026-08-18/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/publish", json={"filename": "shipx_2026-08-18"}, headers=headers)
    assert resp.status_code == 200


def test_republish_overwrites_existing_v300(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-19")
    headers = auth_header("publisher3", Role.qca)
    client.post("/session/shipx_2026-08-19/open", params={"source": "raw"}, headers=headers)
    client.post("/publish", json={"filename": "shipx_2026-08-19"}, headers=headers)

    temp = storage.temp_path("publisher3", "shipx_2026-08-19")
    temp.write_bytes(b"republish-marker")
    client.post("/publish", json={"filename": "shipx_2026-08-19"}, headers=headers)

    published = storage.published_path("shipx_2026-08-19")
    assert published.read_bytes() == b"republish-marker"


def test_save_and_publish_require_open_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-20")
    headers = auth_header("nosessuser", Role.qca)
    resp = client.post("/save", json={"filename": "shipx_2026-08-20"}, headers=headers)
    assert resp.status_code == 404
    resp = client.post("/publish", json={"filename": "shipx_2026-08-20"}, headers=headers)
    assert resp.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_workflow_routes.py -v`
Expected: FAIL — 404s (no `/save` or `/publish` routes yet)

- [ ] **Step 3: Implement workflow router**

`server/app/routers/workflow.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import storage
from app.database import get_db
from app.deps import require_role
from app.models import AuditLog, Role, User
from app.schemas import PublishRequest, SaveRequest

router = APIRouter(tags=["workflow"])


@router.post("/save")
def save(
    payload: SaveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    temp = storage.temp_path(user.username, payload.filename)
    if not temp.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )
    dst = storage.draft_path(user.username, payload.filename)
    storage.atomic_copy(temp, dst)
    db.add(AuditLog(filename=payload.filename, user_id=user.id, action="save"))
    db.commit()
    return {"draft_path": str(dst)}


@router.post("/publish")
def publish(
    payload: PublishRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    temp = storage.temp_path(user.username, payload.filename)
    if not temp.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )
    dst = storage.published_path(payload.filename)
    storage.atomic_copy(temp, dst)
    db.add(AuditLog(filename=payload.filename, user_id=user.id, action="publish"))
    db.commit()
    return {"published_path": str(dst)}
```

- [ ] **Step 4: Register router in main.py**

Update imports to `from app.routers import auth, edit, files, session, users, workflow` and add `app.include_router(workflow.router)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_workflow_routes.py -v`
Expected: PASS (6 passed)

- [ ] **Step 6: Commit**

```bash
git add server/app/routers/workflow.py server/app/main.py server/tests/test_workflow_routes.py
git commit -m "feat: save and publish workflow routes"
```

---

### Task 14: Audit routes (history + revert)

**Files:**
- Create: `server/app/routers/audit.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_audit_routes.py`

- [ ] **Step 1: Write failing tests**

`server/tests/test_audit_routes.py`:
```python
from app.models import Role


def test_history_lists_edits_in_order(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-21")
    headers = auth_header("audituser1", Role.qca)
    client.post("/session/shipx_2026-08-21/open", params={"source": "raw"}, headers=headers)
    client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-21", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=headers,
    )
    client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-21", "var_name": "temperature", "indices": [1], "value": 2.0},
        headers=headers,
    )

    resp = client.get("/audit/shipx_2026-08-21", headers=headers)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 2
    assert entries[0]["timestamp"] <= entries[1]["timestamp"]


def test_revert_point_edit_restores_value(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-22")
    headers = auth_header("audituser2", Role.qca)
    client.post("/session/shipx_2026-08-22/open", params={"source": "raw"}, headers=headers)
    edit_resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-22", "var_name": "temperature", "indices": [0], "value": 999.0},
        headers=headers,
    )
    audit_id = edit_resp.json()["audit_id"]

    resp = client.post(f"/audit/{audit_id}/revert", headers=headers)
    assert resp.status_code == 200

    check = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-22", "var_name": "temperature", "indices": [0], "value": -1.0},
        headers=headers,
    )
    assert check.json()["old_value"] == 10.0


def test_revert_already_reverted_returns_409(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-23")
    headers = auth_header("audituser3", Role.qca)
    client.post("/session/shipx_2026-08-23/open", params={"source": "raw"}, headers=headers)
    edit_resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-23", "var_name": "temperature", "indices": [0], "value": 5.0},
        headers=headers,
    )
    audit_id = edit_resp.json()["audit_id"]

    client.post(f"/audit/{audit_id}/revert", headers=headers)
    resp = client.post(f"/audit/{audit_id}/revert", headers=headers)
    assert resp.status_code == 409


def test_revert_bulk_edit_restores_values(client, auth_header, synthetic_nc):
    import time

    synthetic_nc("shipx_2026-08-24")
    headers = auth_header("audituser4", Role.qca)
    client.post("/session/shipx_2026-08-24/open", params={"source": "raw"}, headers=headers)
    bulk_resp = client.post(
        "/edit/bulk",
        json={
            "filename": "shipx_2026-08-24",
            "var_name": "temperature",
            "slices": [[0, 3]],
            "op": "set",
            "value": 0.0,
        },
        headers=headers,
    )
    job_id = bulk_resp.json()["job_id"]

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

    resp = client.post(f"/audit/{audit_id}/revert", headers=headers)
    assert resp.status_code == 200

    check = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-24", "var_name": "temperature", "indices": [0], "value": -1.0},
        headers=headers,
    )
    assert check.json()["old_value"] == 10.0


def test_revert_missing_entry_returns_409(client, auth_header):
    headers = auth_header("audituser6", Role.qca)
    resp = client.post("/audit/999999/revert", headers=headers)
    assert resp.status_code == 409


def test_revert_without_open_session_returns_404(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-25")
    headers = auth_header("audituser5", Role.qca)
    client.post("/session/shipx_2026-08-25/open", params={"source": "raw"}, headers=headers)
    edit_resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-25", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=headers,
    )
    audit_id = edit_resp.json()["audit_id"]
    client.post("/session/shipx_2026-08-25/close", headers=headers)

    resp = client.post(f"/audit/{audit_id}/revert", headers=headers)
    assert resp.status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_audit_routes.py -v`
Expected: FAIL — 404s (no `/audit/*` routes yet)

- [ ] **Step 3: Implement audit router**

`server/app/routers/audit.py`:
```python
import json

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import netcdf_ops, storage
from app.database import get_db
from app.deps import get_current_user, require_role
from app.models import AuditLog, Lock, Role, User

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/{filename}")
def history(
    filename: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    entries = (
        db.query(AuditLog)
        .filter(AuditLog.filename == filename)
        .order_by(AuditLog.timestamp.asc())
        .all()
    )
    return [
        {
            "id": e.id,
            "user_id": e.user_id,
            "action": e.action,
            "var_name": e.var_name,
            "old_value": e.old_value_scalar,
            "new_value": e.new_value_scalar,
            "reverted": e.reverted,
            "timestamp": e.timestamp.isoformat(),
        }
        for e in entries
    ]


@router.post("/{audit_id}/revert")
def revert(
    audit_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    entry = db.query(AuditLog).filter(AuditLog.id == audit_id).first()
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="audit entry not found"
        )
    if entry.action not in ("point_edit", "bulk_edit"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="entry not revertible"
        )
    if entry.reverted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="already reverted"
        )

    lock = db.query(Lock).filter(Lock.filename == entry.filename).first()
    if lock is None or lock.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="no active edit lock for this file",
        )

    path = storage.temp_path(user.username, entry.filename)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )

    if entry.action == "point_edit":
        indices = json.loads(entry.indices_json)
        netcdf_ops.restore_point(path, entry.var_name, indices, entry.old_value_scalar)
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
        old_values = np.load(entry.old_value_ref)
        netcdf_ops.restore_bulk(path, entry.var_name, slices, old_values)
        new_log = AuditLog(
            filename=entry.filename,
            user_id=user.id,
            action="revert",
            var_name=entry.var_name,
            indices_json=entry.indices_json,
            old_value_ref=entry.old_value_ref,
        )

    entry.reverted = True
    db.add(new_log)
    db.commit()
    return {"status": "reverted"}
```

- [ ] **Step 4: Register router in main.py**

Update imports to `from app.routers import audit, auth, edit, files, session, users, workflow` and add `app.include_router(audit.router)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_audit_routes.py -v`
Expected: PASS (6 passed)

- [ ] **Step 6: Commit**

```bash
git add server/app/routers/audit.py server/app/main.py server/tests/test_audit_routes.py
git commit -m "feat: audit history and revert routes"
```

---

### Task 15: Full backend test run + run instructions

**Files:**
- Create: `server/README.md`

- [ ] **Step 1: Run the full backend test suite**

Run: `conda activate svidat && cd /Users/ustropics/Documents/svidat/server && pytest -v`
Expected: all tests across every module pass (health, models, security, netcdf_ops, storage, deps, auth, users, files, session, edit, jobs, workflow, audit).

- [ ] **Step 2: Create server README with run instructions**

`server/README.md`:
```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add server/README.md
git commit -m "docs: backend setup and run instructions"
```

---

### Task 16: Frontend scaffold + API client

**Files:**
- Create: Vite React-TS scaffold under `client/`
- Create: `client/src/api/types.ts`
- Create: `client/src/api/client.ts`
- Test: `client/src/__tests__/apiClient.test.ts`

- [ ] **Step 1: Scaffold Vite React-TS app**

Run:
```bash
cd /Users/ustropics/Documents/svidat
npm create vite@latest client -- --template react-ts
cd client
npm install
npm install react-router-dom
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Configure Vitest**

Modify `client/vite.config.ts` (merge into the generated file):
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
})
```

`client/src/setupTests.ts`:
```typescript
import '@testing-library/jest-dom'
```

Add to `client/package.json` `scripts`:
```json
"test": "vitest run"
```

- [ ] **Step 3: Define API types**

`client/src/api/types.ts`:
```typescript
export type Role = 'admin' | 'qca' | 'user'

export interface LoginResponse {
  access_token: string
  token_type: string
  role: Role
}

export interface VariableMetadata {
  dims: string[]
  shape: number[]
  dtype: string
  attrs: Record<string, unknown>
}

export interface FileMetadata {
  variables: Record<string, VariableMetadata>
  dimensions: Record<string, number>
}

export interface AuditEntry {
  id: number
  user_id: number
  action: string
  var_name: string | null
  old_value: number | null
  new_value: number | null
  reverted: boolean
  timestamp: string
}

export interface JobStatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed'
  error: string | null
  result: { audit_id: number } | null
}
```

- [ ] **Step 4: Write failing test for API client token handling**

`client/src/__tests__/apiClient.test.ts`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setToken, getToken, apiFetch } from '../api/client'

describe('apiClient', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('stores and retrieves the auth token', () => {
    setToken('abc123')
    expect(getToken()).toBe('abc123')
  })

  it('attaches Authorization header when a token is present', async () => {
    setToken('abc123')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/health')

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer abc123')
  })

  it('omits Authorization header when no token is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/health')

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBeUndefined()
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd /Users/ustropics/Documents/svidat/client && npm test`
Expected: FAIL — `Cannot find module '../api/client'`

- [ ] **Step 6: Implement API client**

`client/src/api/client.ts`:
```typescript
const BASE_URL = 'http://localhost:8000'
const TOKEN_KEY = 'svidat_token'

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${response.status}: ${body}`)
  }
  return response
}

export async function login(username: string, password: string) {
  const form = new URLSearchParams()
  form.set('username', username)
  form.set('password', password)
  const response = await fetch(`${BASE_URL}/auth/login`, { method: 'POST', body: form })
  if (!response.ok) {
    throw new Error('invalid username or password')
  }
  return response.json()
}

export const listRawFiles = () => apiFetch('/files/raw').then((r) => r.json())
export const listDrafts = (username?: string) =>
  apiFetch(`/files/drafts${username ? `?username=${username}` : ''}`).then((r) => r.json())
export const getFileMetadata = (filename: string) =>
  apiFetch(`/files/${filename}/metadata`).then((r) => r.json())
export const openSession = (filename: string, source: string, sourceUsername?: string) =>
  apiFetch(
    `/session/${filename}/open?source=${source}${sourceUsername ? `&source_username=${sourceUsername}` : ''}`,
    { method: 'POST' }
  ).then((r) => r.json())
export const closeSession = (filename: string) =>
  apiFetch(`/session/${filename}/close`, { method: 'POST' }).then((r) => r.json())
export const pointEdit = (
  filename: string,
  varName: string,
  indices: number[],
  value: number
) =>
  apiFetch('/edit/point', {
    method: 'POST',
    body: JSON.stringify({ filename, var_name: varName, indices, value }),
  }).then((r) => r.json())
export const bulkEdit = (
  filename: string,
  varName: string,
  slices: number[][],
  op: string,
  value: number
) =>
  apiFetch('/edit/bulk', {
    method: 'POST',
    body: JSON.stringify({ filename, var_name: varName, slices, op, value }),
  }).then((r) => r.json())
export const jobStatus = (jobId: string) => apiFetch(`/edit/jobs/${jobId}`).then((r) => r.json())
export const saveDraft = (filename: string) =>
  apiFetch('/save', { method: 'POST', body: JSON.stringify({ filename }) }).then((r) => r.json())
export const publishFile = (filename: string) =>
  apiFetch('/publish', { method: 'POST', body: JSON.stringify({ filename }) }).then((r) => r.json())
export const getAuditHistory = (filename: string) =>
  apiFetch(`/audit/${filename}`).then((r) => r.json())
export const revertAuditEntry = (auditId: number) =>
  apiFetch(`/audit/${auditId}/revert`, { method: 'POST' }).then((r) => r.json())
export const listUsers = () => apiFetch('/users').then((r) => r.json())
export const createUser = (username: string, password: string, role: string) =>
  apiFetch('/users', { method: 'POST', body: JSON.stringify({ username, password, role }) }).then(
    (r) => r.json()
  )
export const deleteUser = (userId: number) => apiFetch(`/users/${userId}`, { method: 'DELETE' })
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 passed)

- [ ] **Step 8: Commit**

```bash
git add client/
git commit -m "feat: Vite React-TS scaffold with typed API client"
```

---

### Task 17: Auth context + Login page + ProtectedRoute

**Files:**
- Create: `client/src/context/AuthContext.tsx`
- Create: `client/src/components/ProtectedRoute.tsx`
- Create: `client/src/pages/LoginPage.tsx`
- Test: `client/src/__tests__/ProtectedRoute.test.tsx`

- [ ] **Step 1: Write failing test for ProtectedRoute**

`client/src/__tests__/ProtectedRoute.test.tsx`:
```typescript
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from '../components/ProtectedRoute'
import { AuthProvider } from '../context/AuthContext'
import { setToken, clearToken } from '../api/client'

function renderProtected(initialEntries: string[]) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route
            path="/private"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <div>private content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    clearToken()
    localStorage.clear()
  })

  it('redirects to login when not authenticated', () => {
    renderProtected(['/private'])
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('renders children when authenticated with an allowed role', () => {
    setToken('abc123')
    localStorage.setItem('svidat_role', 'qca')
    renderProtected(['/private'])
    expect(screen.getByText('private content')).toBeInTheDocument()
  })

  it('redirects when authenticated but role not allowed', () => {
    setToken('abc123')
    localStorage.setItem('svidat_role', 'user')
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/private']}>
          <Routes>
            <Route path="/login" element={<div>login page</div>} />
            <Route
              path="/private"
              element={
                <ProtectedRoute roles={['admin', 'qca']}>
                  <div>private content</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    )
    expect(screen.getByText('login page')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../components/ProtectedRoute'`

- [ ] **Step 3: Implement AuthContext**

`client/src/context/AuthContext.tsx`:
```typescript
import { createContext, useContext, useState, ReactNode } from 'react'
import { clearToken, getToken, setToken } from '../api/client'
import type { Role } from '../api/types'

const ROLE_KEY = 'svidat_role'
const USERNAME_KEY = 'svidat_username'

interface AuthState {
  token: string | null
  role: Role | null
  username: string | null
  login: (token: string, role: Role, username: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken())
  const [role, setRole] = useState<Role | null>(
    (localStorage.getItem(ROLE_KEY) as Role | null) ?? null
  )
  const [username, setUsername] = useState<string | null>(localStorage.getItem(USERNAME_KEY))

  const login = (newToken: string, newRole: Role, newUsername: string) => {
    setToken(newToken)
    localStorage.setItem(ROLE_KEY, newRole)
    localStorage.setItem(USERNAME_KEY, newUsername)
    setTokenState(newToken)
    setRole(newRole)
    setUsername(newUsername)
  }

  const logout = () => {
    clearToken()
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(USERNAME_KEY)
    setTokenState(null)
    setRole(null)
    setUsername(null)
  }

  return (
    <AuthContext.Provider value={{ token, role, username, login, logout }}>
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

- [ ] **Step 4: Implement ProtectedRoute**

`client/src/components/ProtectedRoute.tsx`:
```typescript
import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
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
  return <>{children}</>
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 passed)

- [ ] **Step 6: Implement LoginPage**

`client/src/pages/LoginPage.tsx`:
```typescript
import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../api/types'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const auth = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const response = await login(username, password)
      auth.login(response.access_token, response.role as Role, username)
      navigate('/files')
    } catch {
      setError('Invalid username or password')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>svidat login</h1>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Log in</button>
    </form>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add client/src/context client/src/components/ProtectedRoute.tsx client/src/pages/LoginPage.tsx client/src/__tests__/ProtectedRoute.test.tsx
git commit -m "feat: auth context, protected routes, login page"
```

---

### Task 18: File browser page

**Files:**
- Create: `client/src/pages/FileBrowserPage.tsx`

- [ ] **Step 1: Implement FileBrowserPage**

`client/src/pages/FileBrowserPage.tsx`:
```typescript
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listDrafts, listRawFiles } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function FileBrowserPage() {
  const [rawFiles, setRawFiles] = useState<string[]>([])
  const [drafts, setDrafts] = useState<string[]>([])
  const { role } = useAuth()

  useEffect(() => {
    listRawFiles().then(setRawFiles)
    if (role === 'admin' || role === 'qca') {
      listDrafts().then(setDrafts)
    }
  }, [role])

  return (
    <div>
      <h1>Files</h1>
      <section>
        <h2>Raw files</h2>
        <ul>
          {rawFiles.map((f) => (
            <li key={f}>
              <Link to={`/files/${f}`}>{f}</Link>
            </li>
          ))}
        </ul>
      </section>
      {(role === 'admin' || role === 'qca') && (
        <section>
          <h2>My drafts</h2>
          <ul>
            {drafts.map((f) => (
              <li key={f}>
                <Link to={`/files/${f}?source=draft`}>{f}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/FileBrowserPage.tsx
git commit -m "feat: file browser page listing raw files and drafts"
```

---

### Task 19: Data viewer page

**Files:**
- Create: `client/src/pages/DataViewerPage.tsx`

- [ ] **Step 1: Implement DataViewerPage**

`client/src/pages/DataViewerPage.tsx`:
```typescript
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { getFileMetadata, openSession } from '../api/client'
import type { FileMetadata } from '../api/types'
import { EditForm } from '../components/EditForm'
import { AuditPanel } from '../components/AuditPanel'

export function DataViewerPage() {
  const { filename } = useParams<{ filename: string }>()
  const [searchParams] = useSearchParams()
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!filename) return
    getFileMetadata(filename).then(setMetadata)
  }, [filename])

  const handleOpenSession = async () => {
    if (!filename) return
    setError(null)
    try {
      const source = searchParams.get('source') ?? 'raw'
      await openSession(filename, source)
      setSessionOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to open session')
    }
  }

  if (!filename) return null

  return (
    <div>
      <h1>{filename}</h1>
      {!sessionOpen && <button onClick={handleOpenSession}>Open for editing</button>}
      {error && <p role="alert">{error}</p>}
      {metadata && (
        <table>
          <thead>
            <tr>
              <th>Variable</th>
              <th>Dims</th>
              <th>Shape</th>
              <th>Dtype</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(metadata.variables).map(([name, v]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{v.dims.join(', ')}</td>
                <td>{v.shape.join(', ')}</td>
                <td>{v.dtype}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sessionOpen && metadata && (
        <>
          <EditForm filename={filename} variables={Object.keys(metadata.variables)} />
          <AuditPanel filename={filename} />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/DataViewerPage.tsx
git commit -m "feat: data viewer page with metadata table"
```

(Committed together with Task 20 since EditForm/AuditPanel are referenced here — see Task 20/21 for their implementation before this actually compiles. Order tasks 19–21 together if executing strictly file-by-file.)

---

### Task 20: Edit form (point + bulk) + save/publish actions

**Files:**
- Create: `client/src/components/EditForm.tsx`
- Test: `client/src/__tests__/EditForm.test.tsx`

- [ ] **Step 1: Write failing test**

`client/src/__tests__/EditForm.test.tsx`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditForm } from '../components/EditForm'
import * as apiClient from '../api/client'

describe('EditForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('submits a point edit with parsed indices and value', async () => {
    const pointEditSpy = vi
      .spyOn(apiClient, 'pointEdit')
      .mockResolvedValue({ audit_id: 1, old_value: 10, new_value: 42 })

    render(<EditForm filename="shipx_2026-08-30" variables={['temperature']} />)

    fireEvent.change(screen.getByLabelText('Indices (comma separated)'), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '42' } })
    fireEvent.click(screen.getByText('Apply point edit'))

    await waitFor(() =>
      expect(pointEditSpy).toHaveBeenCalledWith('shipx_2026-08-30', 'temperature', [1], 42)
    )
  })

  it('calls save and publish handlers', async () => {
    const saveSpy = vi.spyOn(apiClient, 'saveDraft').mockResolvedValue({ draft_path: 'x' })
    const publishSpy = vi.spyOn(apiClient, 'publishFile').mockResolvedValue({ published_path: 'y' })

    render(<EditForm filename="shipx_2026-08-31" variables={['temperature']} />)

    fireEvent.click(screen.getByText('Save draft (v250)'))
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith('shipx_2026-08-31'))

    fireEvent.click(screen.getByText('Publish (v300)'))
    await waitFor(() => expect(publishSpy).toHaveBeenCalledWith('shipx_2026-08-31'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../components/EditForm'`

- [ ] **Step 3: Implement EditForm**

`client/src/components/EditForm.tsx`:
```typescript
import { useState } from 'react'
import { bulkEdit, pointEdit, publishFile, saveDraft } from '../api/client'

export function EditForm({
  filename,
  variables,
}: {
  filename: string
  variables: string[]
}) {
  const [varName, setVarName] = useState(variables[0] ?? '')
  const [indices, setIndices] = useState('')
  const [value, setValue] = useState('')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeStop, setRangeStop] = useState('')
  const [op, setOp] = useState('add')
  const [status, setStatus] = useState<string | null>(null)

  const handlePointEdit = async () => {
    const parsedIndices = indices.split(',').map((i) => parseInt(i.trim(), 10))
    const parsedValue = parseFloat(value)
    await pointEdit(filename, varName, parsedIndices, parsedValue)
    setStatus('Point edit applied')
  }

  const handleBulkEdit = async () => {
    const slices = [[parseInt(rangeStart, 10), parseInt(rangeStop, 10)]]
    const parsedValue = parseFloat(value)
    const result = await bulkEdit(filename, varName, slices, op, parsedValue)
    setStatus(`Bulk edit job submitted: ${result.job_id}`)
  }

  const handleSave = async () => {
    await saveDraft(filename)
    setStatus('Saved as v250 draft')
  }

  const handlePublish = async () => {
    await publishFile(filename)
    setStatus('Published as v300')
  }

  return (
    <div>
      <h2>Edit</h2>
      <label>
        Variable
        <select value={varName} onChange={(e) => setVarName(e.target.value)}>
          {variables.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Point edit</legend>
        <label>
          Indices (comma separated)
          <input value={indices} onChange={(e) => setIndices(e.target.value)} />
        </label>
        <label>
          Value
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button onClick={handlePointEdit}>Apply point edit</button>
      </fieldset>

      <fieldset>
        <legend>Bulk edit</legend>
        <label>
          Range start
          <input value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
        </label>
        <label>
          Range stop
          <input value={rangeStop} onChange={(e) => setRangeStop(e.target.value)} />
        </label>
        <label>
          Operation
          <select value={op} onChange={(e) => setOp(e.target.value)}>
            <option value="add">add</option>
            <option value="multiply">multiply</option>
            <option value="set">set</option>
          </select>
        </label>
        <button onClick={handleBulkEdit}>Apply bulk edit</button>
      </fieldset>

      <div>
        <button onClick={handleSave}>Save draft (v250)</button>
        <button onClick={handlePublish}>Publish (v300)</button>
      </div>

      {status && <p role="status">{status}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/EditForm.tsx client/src/__tests__/EditForm.test.tsx client/src/pages/DataViewerPage.tsx
git commit -m "feat: edit form with point/bulk edit and save/publish actions"
```

---

### Task 21: Audit panel + revert

**Files:**
- Create: `client/src/components/AuditPanel.tsx`
- Test: `client/src/__tests__/AuditPanel.test.tsx`

- [ ] **Step 1: Write failing test**

`client/src/__tests__/AuditPanel.test.tsx`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuditPanel } from '../components/AuditPanel'
import * as apiClient from '../api/client'
import type { AuditEntry } from '../api/types'

const entries: AuditEntry[] = [
  {
    id: 1,
    user_id: 1,
    action: 'point_edit',
    var_name: 'temperature',
    old_value: 10,
    new_value: 42,
    reverted: false,
    timestamp: '2026-07-30T00:00:00',
  },
]

describe('AuditPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lists audit entries and reverts on click', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue(entries)
    const revertSpy = vi.spyOn(apiClient, 'revertAuditEntry').mockResolvedValue({ status: 'reverted' })

    render(<AuditPanel filename="shipx_2026-08-30" />)

    await waitFor(() => expect(screen.getByText(/temperature/)).toBeInTheDocument())

    fireEvent.click(screen.getByText('Revert'))
    await waitFor(() => expect(revertSpy).toHaveBeenCalledWith(1))
  })

  it('disables revert button for already-reverted entries', async () => {
    vi.spyOn(apiClient, 'getAuditHistory').mockResolvedValue([{ ...entries[0], reverted: true }])

    render(<AuditPanel filename="shipx_2026-08-30" />)

    await waitFor(() => expect(screen.getByText('Reverted')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../components/AuditPanel'`

- [ ] **Step 3: Implement AuditPanel**

`client/src/components/AuditPanel.tsx`:
```typescript
import { useEffect, useState } from 'react'
import { getAuditHistory, revertAuditEntry } from '../api/client'
import type { AuditEntry } from '../api/types'

export function AuditPanel({ filename }: { filename: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])

  const refresh = () => {
    getAuditHistory(filename).then(setEntries)
  }

  useEffect(refresh, [filename])

  const handleRevert = async (id: number) => {
    await revertAuditEntry(id)
    refresh()
  }

  return (
    <div>
      <h2>Audit history</h2>
      <ul>
        {entries.map((e) => (
          <li key={e.id}>
            {e.timestamp} — {e.action} {e.var_name ?? ''} {e.old_value ?? ''} → {e.new_value ?? ''}
            {e.action !== 'point_edit' && e.action !== 'bulk_edit' ? null : e.reverted ? (
              <span> (Reverted)</span>
            ) : (
              <button onClick={() => handleRevert(e.id)}>Revert</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AuditPanel.tsx client/src/__tests__/AuditPanel.test.tsx
git commit -m "feat: audit history panel with revert action"
```

---

### Task 22: Admin user management page

**Files:**
- Create: `client/src/pages/AdminUsersPage.tsx`

- [ ] **Step 1: Implement AdminUsersPage**

`client/src/pages/AdminUsersPage.tsx`:
```typescript
import { useEffect, useState } from 'react'
import { createUser, deleteUser, listUsers } from '../api/client'

interface UserRow {
  id: number
  username: string
  role: string
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')

  const refresh = () => {
    listUsers().then(setUsers)
  }

  useEffect(refresh, [])

  const handleCreate = async () => {
    await createUser(username, password, role)
    setUsername('')
    setPassword('')
    refresh()
  }

  const handleDelete = async (id: number) => {
    await deleteUser(id)
    refresh()
  }

  return (
    <div>
      <h1>Users</h1>
      <ul>
        {users.map((u) => (
          <li key={u.id}>
            {u.username} ({u.role})
            <button onClick={() => handleDelete(u.id)}>Delete</button>
          </li>
        ))}
      </ul>

      <h2>Add user</h2>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="user">user</option>
          <option value="qca">qca</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <button onClick={handleCreate}>Create user</button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/AdminUsersPage.tsx
git commit -m "feat: admin user management page"
```

---

### Task 23: Wire App.tsx routes and manual smoke test

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/main.tsx`
- Create: `client/README.md`

- [ ] **Step 1: Wire routes in App.tsx**

`client/src/App.tsx` (replace entirely):
```typescript
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { FileBrowserPage } from './pages/FileBrowserPage'
import { DataViewerPage } from './pages/DataViewerPage'
import { AdminUsersPage } from './pages/AdminUsersPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/files"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <FileBrowserPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/files/:filename"
            element={
              <ProtectedRoute roles={['admin', 'qca', 'user']}>
                <DataViewerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/files" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
```

- [ ] **Step 2: Confirm main.tsx renders App**

`client/src/main.tsx` (verify/replace to match):
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 3: Create client README**

`client/README.md`:
```markdown
# svidat frontend

Vite + React + TypeScript client for the svidat netCDF QC app.

## Setup

    cd client
    npm install

## Run

    npm run dev

Requires the backend running at `http://localhost:8000` (see `server/README.md`).

## Test

    npm test
```

- [ ] **Step 4: Manual smoke test**

Run backend: `conda activate svidat && cd /Users/ustropics/Documents/svidat/server && uvicorn app.main:app --reload --port 8000`
Run frontend (separate terminal): `cd /Users/ustropics/Documents/svidat/client && npm run dev`
In browser: create an admin user per `server/README.md`, log in at `http://localhost:5173/login`, place a real `.nc` file at `server/data/raw/`, confirm it lists at `/files`, open it, apply a point edit, save, publish, and revert — confirming each step against the running backend.

- [ ] **Step 5: Run full test suites one more time**

Run: `conda activate svidat && cd /Users/ustropics/Documents/svidat/server && pytest -v`
Run: `cd /Users/ustropics/Documents/svidat/client && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/main.tsx client/README.md
git commit -m "feat: wire application routes and add run instructions"
```

---

## Out of scope (per design doc)

- Concurrent multi-user live editing of the same file
- Cloud object storage
- Celery/Redis job queue (in-process thread is the v1 choice — revisit if load requires it)
