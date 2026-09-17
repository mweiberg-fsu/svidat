from app import temp_sessions
from app.models import TempSession


def test_get_or_create_creates_row_once(db_session, make_user):
    user = make_user("tsuser1", is_qca=True)
    ts1 = temp_sessions.get_or_create(db_session, "shipx_ts_a", user.id)
    db_session.commit()
    ts2 = temp_sessions.get_or_create(db_session, "shipx_ts_a", user.id)
    db_session.commit()
    assert ts1.id == ts2.id
    assert (
        db_session.query(TempSession).filter(TempSession.filename == "shipx_ts_a").count()
        == 1
    )


def test_reset_generates_new_created_at_and_clears_dirty(db_session, make_user):
    user = make_user("tsuser2", is_qca=True)
    temp_sessions.get_or_create(db_session, "shipx_ts_b", user.id)
    db_session.commit()
    temp_sessions.mark_dirty(db_session, "shipx_ts_b", user.id)
    db_session.commit()
    ts = db_session.query(TempSession).filter(TempSession.filename == "shipx_ts_b").first()
    first_created_at = ts.created_at

    reset_ts = temp_sessions.reset(db_session, "shipx_ts_b", user.id)
    db_session.commit()
    assert reset_ts.dirty is False
    assert reset_ts.last_edited_at is None
    assert reset_ts.created_at >= first_created_at


def test_mark_dirty_and_mark_clean(db_session, make_user):
    user = make_user("tsuser3", is_qca=True)
    temp_sessions.get_or_create(db_session, "shipx_ts_c", user.id)
    db_session.commit()

    temp_sessions.mark_dirty(db_session, "shipx_ts_c", user.id)
    db_session.commit()
    ts = db_session.query(TempSession).filter(TempSession.filename == "shipx_ts_c").first()
    assert ts.dirty is True
    assert ts.last_edited_at is not None

    temp_sessions.mark_clean(db_session, "shipx_ts_c", user.id)
    db_session.commit()
    db_session.refresh(ts)
    assert ts.dirty is False


def test_mark_dirty_on_missing_row_is_a_no_op(db_session, make_user):
    user = make_user("tsuser4", is_qca=True)
    temp_sessions.mark_dirty(db_session, "shipx_ts_missing", user.id)
    db_session.commit()
    assert (
        db_session.query(TempSession).filter(TempSession.filename == "shipx_ts_missing").count()
        == 0
    )


def test_audit_visible_across_explicit_close_and_reopen_via_session_started_at(
    client, auth_header, synthetic_nc
):
    synthetic_nc("shipx_2026-09-13")
    headers = auth_header("audituser19", is_qca=True)

    client.post("/session/shipx_2026-09-13/open", params={"source": "raw"}, headers=headers)
    client.post(
        "/edit/point",
        json={
            "filename": "shipx_2026-09-13",
            "var_name": "temperature",
            "indices": [0],
            "value": 1.0,
        },
        headers=headers,
    )
    client.post("/session/shipx_2026-09-13/close", headers=headers)

    reopened = client.post(
        "/session/shipx_2026-09-13/open", params={"source": "raw"}, headers=headers
    ).json()
    since = reopened["session_started_at"]

    resp = client.get("/audit/shipx_2026-09-13", params={"since": since}, headers=headers)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["new_value"] == 1.0


def test_mine_empty_by_default(client, auth_header):
    headers = auth_header("tsmine_empty", is_qca=True)
    resp = client.get("/session/mine", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_mine_only_returns_current_users_dirty_sessions(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-09-20")
    headers_a = auth_header("tsmine_a", is_qca=True)
    headers_b = auth_header("tsmine_b", is_qca=True)

    client.post("/session/shipx_2026-09-20/open", params={"source": "raw"}, headers=headers_a)
    client.post(
        "/edit/point",
        json={
            "filename": "shipx_2026-09-20",
            "var_name": "temperature",
            "indices": [0],
            "value": 1.0,
        },
        headers=headers_a,
    )

    assert client.get("/session/mine", headers=headers_b).json() == []
    mine = client.get("/session/mine", headers=headers_a).json()
    assert len(mine) == 1
    assert mine[0]["filename"] == "shipx_2026-09-20"
    assert "created_at" in mine[0]
    assert "last_edited_at" in mine[0]


def test_regular_user_cannot_call_mine(client, auth_header):
    headers = auth_header("tsmine_viewer")
    resp = client.get("/session/mine", headers=headers)
    assert resp.status_code == 403


def test_discard_deletes_lock_temp_file_and_temp_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-09-21")
    headers = auth_header("tsdiscard1", is_qca=True)
    client.post("/session/shipx_2026-09-21/open", params={"source": "raw"}, headers=headers)
    client.post(
        "/edit/point",
        json={
            "filename": "shipx_2026-09-21",
            "var_name": "temperature",
            "indices": [0],
            "value": 1.0,
        },
        headers=headers,
    )

    resp = client.post("/session/shipx_2026-09-21/discard", headers=headers)
    assert resp.status_code == 200

    from app import storage

    temp = storage.temp_path("tsdiscard1", "shipx_2026-09-21")
    assert not temp.exists()
    assert client.get("/session/mine", headers=headers).json() == []

    other = auth_header("tsdiscard2", is_qca=True)
    resp = client.post("/session/shipx_2026-09-21/open", params={"source": "raw"}, headers=other)
    assert resp.status_code == 200


def test_discard_is_a_no_op_when_nothing_exists(client, auth_header):
    headers = auth_header("tsdiscard3", is_qca=True)
    resp = client.post("/session/never-opened/discard", headers=headers)
    assert resp.status_code == 200


def test_discard_only_releases_the_calling_users_own_lock(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-09-22")
    headers_a = auth_header("tsdiscard4", is_qca=True)
    headers_b = auth_header("tsdiscard5", is_qca=True)

    client.post("/session/shipx_2026-09-22/open", params={"source": "raw"}, headers=headers_a)

    resp = client.post("/session/shipx_2026-09-22/discard", headers=headers_b)
    assert resp.status_code == 200

    # b's discard must not touch a's active lock.
    resp = client.post("/session/shipx_2026-09-22/open", params={"source": "raw"}, headers=headers_b)
    assert resp.status_code == 409


def test_admin_alone_cannot_discard(client, auth_header):
    headers = auth_header("tsdiscard_admin", is_admin=True)
    resp = client.post("/session/shipx/discard", headers=headers)
    assert resp.status_code == 403


def test_point_edit_marks_temp_session_dirty(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-09-14")
    headers = auth_header("tsdirty1", is_qca=True)
    client.post("/session/shipx_2026-09-14/open", params={"source": "raw"}, headers=headers)
    assert client.get("/session/mine", headers=headers).json() == []

    client.post(
        "/edit/point",
        json={
            "filename": "shipx_2026-09-14",
            "var_name": "temperature",
            "indices": [0],
            "value": 1.0,
        },
        headers=headers,
    )

    mine = client.get("/session/mine", headers=headers).json()
    assert len(mine) == 1
    assert mine[0]["filename"] == "shipx_2026-09-14"


def test_bulk_edit_marks_temp_session_dirty(client, auth_header, synthetic_nc):
    import time

    synthetic_nc("shipx_2026-09-15")
    headers = auth_header("tsdirty2", is_qca=True)
    client.post("/session/shipx_2026-09-15/open", params={"source": "raw"}, headers=headers)

    job_id = client.post(
        "/edit/bulk",
        json={
            "filename": "shipx_2026-09-15",
            "var_name": "temperature",
            "slices": [[0, 3]],
            "op": "set",
            "value": 0.0,
        },
        headers=headers,
    ).json()["job_id"]

    deadline = time.time() + 2
    while time.time() < deadline:
        if client.get(f"/edit/jobs/{job_id}", headers=headers).json()["status"] == "done":
            break
        time.sleep(0.02)

    assert len(client.get("/session/mine", headers=headers).json()) == 1


def test_bulk_edit_then_save_marks_temp_session_clean(client, auth_header, synthetic_nc):
    # Regression test for widening file_write_lock in run_bulk_edit/save to
    # cover the dirty/clean mutation: run a bulk edit to completion, then
    # save, and confirm the sequential (non-racing) case still ends up
    # clean, exactly as before the lock-scope change.
    import time

    synthetic_nc("shipx_2026-09-23")
    headers = auth_header("tsdirty5", is_qca=True)
    client.post("/session/shipx_2026-09-23/open", params={"source": "raw"}, headers=headers)

    job_id = client.post(
        "/edit/bulk",
        json={
            "filename": "shipx_2026-09-23",
            "var_name": "temperature",
            "slices": [[0, 3]],
            "op": "set",
            "value": 0.0,
        },
        headers=headers,
    ).json()["job_id"]

    deadline = time.time() + 2
    while time.time() < deadline:
        if client.get(f"/edit/jobs/{job_id}", headers=headers).json()["status"] == "done":
            break
        time.sleep(0.02)

    assert len(client.get("/session/mine", headers=headers).json()) == 1

    resp = client.post("/save", json={"filename": "shipx_2026-09-23"}, headers=headers)
    assert resp.status_code == 200
    assert client.get("/session/mine", headers=headers).json() == []


def test_bulk_edit_then_discard_clears_temp_session(client, auth_header, synthetic_nc):
    # Companion regression test: a bulk edit followed by discard (instead of
    # save) should still clear out the temp session/lock, confirming the
    # widened lock scope in run_bulk_edit didn't break the discard path.
    import time

    synthetic_nc("shipx_2026-09-24")
    headers = auth_header("tsdirty6", is_qca=True)
    client.post("/session/shipx_2026-09-24/open", params={"source": "raw"}, headers=headers)

    job_id = client.post(
        "/edit/bulk",
        json={
            "filename": "shipx_2026-09-24",
            "var_name": "temperature",
            "slices": [[0, 3]],
            "op": "set",
            "value": 0.0,
        },
        headers=headers,
    ).json()["job_id"]

    deadline = time.time() + 2
    while time.time() < deadline:
        if client.get(f"/edit/jobs/{job_id}", headers=headers).json()["status"] == "done":
            break
        time.sleep(0.02)

    assert len(client.get("/session/mine", headers=headers).json()) == 1

    resp = client.post("/session/shipx_2026-09-24/discard", headers=headers)
    assert resp.status_code == 200
    assert client.get("/session/mine", headers=headers).json() == []


def test_point_edit_then_publish_marks_temp_session_clean(client, auth_header, synthetic_nc):
    # Regression test for widening file_write_lock in publish to cover the
    # mark_clean mutation: confirm the sequential publish path still ends
    # up clean, exactly as before the lock-scope change.
    synthetic_nc("shipx_2026-09-25")
    headers = auth_header("tsdirty7", is_qca=True)
    client.post("/session/shipx_2026-09-25/open", params={"source": "raw"}, headers=headers)
    client.post(
        "/edit/point",
        json={
            "filename": "shipx_2026-09-25",
            "var_name": "temperature",
            "indices": [0],
            "value": 1.0,
        },
        headers=headers,
    )
    assert len(client.get("/session/mine", headers=headers).json()) == 1

    resp = client.post("/publish", json={"filename": "shipx_2026-09-25"}, headers=headers)
    assert resp.status_code == 200
    assert client.get("/session/mine", headers=headers).json() == []


def test_revert_marks_temp_session_dirty_again(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-09-17b")
    headers = auth_header("tsdirty4", is_qca=True)
    client.post("/session/shipx_2026-09-17b/open", params={"source": "raw"}, headers=headers)
    edit_resp = client.post(
        "/edit/point",
        json={
            "filename": "shipx_2026-09-17b",
            "var_name": "temperature",
            "indices": [0],
            "value": 5.0,
        },
        headers=headers,
    )
    audit_id = edit_resp.json()["audit_id"]

    client.post("/save", json={"filename": "shipx_2026-09-17b"}, headers=headers)
    assert client.get("/session/mine", headers=headers).json() == []

    client.post(f"/audit/{audit_id}/revert", headers=headers)
    assert len(client.get("/session/mine", headers=headers).json()) == 1


def test_save_marks_temp_session_clean(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-09-18")
    headers = auth_header("tsclean1", is_qca=True)
    client.post("/session/shipx_2026-09-18/open", params={"source": "raw"}, headers=headers)
    client.post(
        "/edit/point",
        json={
            "filename": "shipx_2026-09-18",
            "var_name": "temperature",
            "indices": [0],
            "value": 1.0,
        },
        headers=headers,
    )
    assert len(client.get("/session/mine", headers=headers).json()) == 1

    client.post("/save", json={"filename": "shipx_2026-09-18"}, headers=headers)
    assert client.get("/session/mine", headers=headers).json() == []


def test_publish_marks_temp_session_clean(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-09-19")
    headers = auth_header("tsclean2", is_qca=True)
    client.post("/session/shipx_2026-09-19/open", params={"source": "raw"}, headers=headers)
    client.post(
        "/edit/point",
        json={
            "filename": "shipx_2026-09-19",
            "var_name": "temperature",
            "indices": [0],
            "value": 1.0,
        },
        headers=headers,
    )
    assert len(client.get("/session/mine", headers=headers).json()) == 1

    client.post("/publish", json={"filename": "shipx_2026-09-19"}, headers=headers)
    assert client.get("/session/mine", headers=headers).json() == []


def test_flag_edit_marks_temp_session_dirty(client, auth_header, synthetic_nc_with_qc):
    import time

    synthetic_nc_with_qc("shipx_2026-09-16")
    headers = auth_header("tsdirty3", is_qca=True)
    client.post("/session/shipx_2026-09-16/open", params={"source": "raw"}, headers=headers)

    job_id = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-09-16",
            "var_name": "temperature",
            "start_time_idx": 0,
            "end_time_idx": 1,
            "flag_code": "K",
        },
        headers=headers,
    ).json()["job_id"]

    deadline = time.time() + 2
    while time.time() < deadline:
        if client.get(f"/edit/jobs/{job_id}", headers=headers).json()["status"] == "done":
            break
        time.sleep(0.02)

    assert len(client.get("/session/mine", headers=headers).json()) == 1
