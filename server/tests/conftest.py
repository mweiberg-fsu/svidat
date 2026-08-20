import atexit
import os
import shutil
import tempfile
from pathlib import Path

_TEST_DIR = Path(tempfile.mkdtemp(prefix="svidat_test_"))
atexit.register(shutil.rmtree, _TEST_DIR, ignore_errors=True)
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DIR / 'test.db'}"
os.environ["DATA_DIR"] = str(_TEST_DIR / "data")
os.environ["SECRET_KEY"] = "test-secret"

import netCDF4
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import OAuthSettings, User
from app.security import hash_password

Base.metadata.create_all(bind=engine)


@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _clean_oauth_settings(db_session):
    # db_session shares one persistent SQLite file across the whole test run
    # with no per-test rollback, so oauth_settings rows would otherwise leak
    # between tests (and files) and break "first row" get_or_create semantics.
    db_session.query(OAuthSettings).delete()
    db_session.commit()
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def make_user(db_session):
    def _make(username: str, password: str = "pass1234", is_admin: bool = False, is_qca: bool = False):
        user = User(
            username=username,
            password_hash=hash_password(password),
            is_admin=is_admin,
            is_qca=is_qca,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        return user

    return _make


@pytest.fixture
def auth_header(client, make_user):
    def _login(username: str, password: str = "pass1234", is_admin: bool = False, is_qca: bool = False):
        make_user(username, password, is_admin, is_qca)
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

            pres_var = ds.createVariable("pressure", "f4", ("time",))
            pres_var[:] = np.array([1000.0, 1001.0, 1002.0, 1003.0, 1004.0], dtype="f4")
            # deliberately no qcindex attr — flags should come back None

            flag_var = ds.createVariable("flag", "S1", ("time", "f_string"))
            flag_var[:, 0] = np.array([b"Z"] * 5, dtype="S1")
            flag_var[:, 1] = np.array([b"Z"] * 5, dtype="S1")
            flag_var.long_name = "quality control flags"
            flag_var.Z = "Good data"
            flag_var.K = "Suspect - visual"
        return path

    return _make
