import json
import os
import shutil
import sys

import pytest

from app import storage
from app.database import SessionLocal
from app.models import Lock, User


def test_save_copies_temp_to_draft(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-15")
    headers = auth_header("saver1", is_qca=True)
    client.post("/session/shipx_2026-08-15/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/save", json={"filename": "shipx_2026-08-15"}, headers=headers)
    assert resp.status_code == 200
    draft = storage.draft_path("saver1", "shipx_2026-08-15")
    assert draft.exists()


def test_save_deletes_temp_and_releases_lock(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-15b")
    headers = auth_header("saver1b", is_qca=True)
    client.post("/session/shipx_2026-08-15b/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/save", json={"filename": "shipx_2026-08-15b"}, headers=headers)
    assert resp.status_code == 200

    temp = storage.temp_path("saver1b", "shipx_2026-08-15b")
    assert not temp.exists()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "saver1b").first()
        lock = (
            db.query(Lock)
            .filter(Lock.filename == "shipx_2026-08-15b", Lock.user_id == user.id)
            .first()
        )
        assert lock is None
    finally:
        db.close()

    # session is over (lock released) -> editing without reopening is rejected
    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-15b", "var_name": "temp", "indices": [0], "value": 1.0},
        headers=headers,
    )
    assert resp.status_code == 409


def test_save_overwrites_previous_draft(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-16")
    headers = auth_header("saver2", is_qca=True)
    client.post("/session/shipx_2026-08-16/open", params={"source": "raw"}, headers=headers)
    client.post("/save", json={"filename": "shipx_2026-08-16"}, headers=headers)

    # save ends the session -> reopen (from the draft just written) before editing again
    client.post("/session/shipx_2026-08-16/open", params={"source": "draft"}, headers=headers)
    temp = storage.temp_path("saver2", "shipx_2026-08-16")
    temp.write_bytes(b"second-save-marker")
    client.post("/save", json={"filename": "shipx_2026-08-16"}, headers=headers)

    draft = storage.draft_path("saver2", "shipx_2026-08-16")
    assert draft.read_bytes() == b"second-save-marker"


def test_publish_copies_temp_to_shared_v300(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-17")
    headers = auth_header("publisher1", is_qca=True)
    client.post("/session/shipx_2026-08-17/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/publish", json={"filename": "shipx_2026-08-17"}, headers=headers)
    assert resp.status_code == 200
    published = storage.published_path("shipx_2026-08-17")
    assert published.exists()


def test_publish_does_not_require_prior_save(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-18")
    headers = auth_header("publisher2", is_qca=True)
    client.post("/session/shipx_2026-08-18/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/publish", json={"filename": "shipx_2026-08-18"}, headers=headers)
    assert resp.status_code == 200


def test_republish_overwrites_existing_v300(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-19")
    headers = auth_header("publisher3", is_qca=True)
    client.post("/session/shipx_2026-08-19/open", params={"source": "raw"}, headers=headers)
    client.post("/publish", json={"filename": "shipx_2026-08-19"}, headers=headers)

    temp = storage.temp_path("publisher3", "shipx_2026-08-19")
    temp.write_bytes(b"republish-marker")
    client.post("/publish", json={"filename": "shipx_2026-08-19"}, headers=headers)

    published = storage.published_path("shipx_2026-08-19")
    assert published.read_bytes() == b"republish-marker"


def test_save_and_publish_require_open_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-20")
    headers = auth_header("nosessuser", is_qca=True)
    resp = client.post("/save", json={"filename": "shipx_2026-08-20"}, headers=headers)
    assert resp.status_code == 404
    resp = client.post("/publish", json={"filename": "shipx_2026-08-20"}, headers=headers)
    assert resp.status_code == 404


def test_publish_with_stale_temp_but_no_active_lock_is_rejected(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-21b")
    headers_a = auth_header("publisher_stale_a", is_qca=True)
    headers_b = auth_header("publisher_stale_b", is_qca=True)

    client.post("/session/shipx_2026-08-21b/open", params={"source": "raw"}, headers=headers_a)
    client.post("/session/shipx_2026-08-21b/close", headers=headers_a)

    # a's temp file still exists (recovery copy), but a no longer holds the lock,
    # and no one else has opened it either -> publish must still be rejected.
    resp = client.post("/publish", json={"filename": "shipx_2026-08-21b"}, headers=headers_a)
    assert resp.status_code == 409

    # now b opens (and thus holds) the lock; a's stale temp must not be publishable
    # over b's active session.
    client.post("/session/shipx_2026-08-21b/open", params={"source": "raw"}, headers=headers_b)
    resp = client.post("/publish", json={"filename": "shipx_2026-08-21b"}, headers=headers_a)
    assert resp.status_code == 409

    resp = client.post("/publish", json={"filename": "shipx_2026-08-21b"}, headers=headers_b)
    assert resp.status_code == 200


def test_admin_alone_cannot_save(client, auth_header):
    headers = auth_header("adminonly_workflow1", is_admin=True)
    resp = client.post("/save", headers=headers, json={"filename": "shipx_2026-08-10"})
    assert resp.status_code == 403


def _configure(db_session, draft=(), published=()):
    from app.path_settings import get_or_create_path_settings

    row = get_or_create_path_settings(db_session)
    row.draft_dirs = json.dumps([str(p) for p in draft])
    row.published_dirs = json.dumps([str(p) for p in published])
    db_session.commit()


def test_save_writes_every_configured_draft_dir(client, auth_header, synthetic_nc, db_session, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    _configure(db_session, draft=[a, b])
    synthetic_nc("shipx_cfg_save")
    headers = auth_header("cfgsaver", is_qca=True)
    client.post("/session/shipx_cfg_save/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/save", json={"filename": "shipx_cfg_save"}, headers=headers)
    assert resp.status_code == 200, resp.text
    expected = [a / "cfgsaver" / "shipx_cfg_save_v250.nc", b / "cfgsaver" / "shipx_cfg_save_v250.nc"]
    assert all(p.exists() for p in expected)
    body = resp.json()
    assert body["draft_paths"] == [str(p) for p in expected]
    assert body["draft_path"] == str(expected[0])
    assert not storage.temp_path("cfgsaver", "shipx_cfg_save").exists()


def test_publish_writes_every_configured_published_dir(client, auth_header, synthetic_nc, db_session, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    _configure(db_session, published=[a, b])
    synthetic_nc("shipx_cfg_pub")
    headers = auth_header("cfgpub", is_qca=True)
    client.post("/session/shipx_cfg_pub/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/publish", json={"filename": "shipx_cfg_pub"}, headers=headers)
    assert resp.status_code == 200, resp.text
    expected = [a / "shipx_cfg_pub_v300.nc", b / "shipx_cfg_pub_v300.nc"]
    assert all(p.exists() for p in expected)
    assert resp.json()["published_paths"] == [str(p) for p in expected]
    assert resp.json()["published_path"] == str(expected[0])


@pytest.mark.skipif(sys.platform == "win32" or os.geteuid() == 0, reason="chmod has no effect")
def test_save_failure_keeps_temp_and_lock(client, auth_header, synthetic_nc, db_session, tmp_path):
    parent = tmp_path / "parent"
    parent.mkdir()
    dest = parent / "drafts"
    dest.mkdir()
    _configure(db_session, draft=[dest])
    synthetic_nc("shipx_cfg_fail")
    headers = auth_header("cfgfail", is_qca=True)
    client.post("/session/shipx_cfg_fail/open", params={"source": "raw"}, headers=headers)

    shutil.rmtree(dest)
    parent.chmod(0o555)
    try:
        resp = client.post("/save", json={"filename": "shipx_cfg_fail"}, headers=headers)
    finally:
        parent.chmod(0o755)
    assert resp.status_code == 500
    assert "could not write" in resp.json()["detail"]
    assert str(dest / "cfgfail" / "shipx_cfg_fail_v250.nc") in resp.json()["detail"]
    assert storage.temp_path("cfgfail", "shipx_cfg_fail").exists()
    db_session.expire_all()
    assert db_session.query(Lock).filter(Lock.filename == "shipx_cfg_fail").count() == 1
