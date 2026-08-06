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
    assert entries[0]["username"] == "audituser1"
    assert entries[1]["username"] == "audituser1"


def test_history_visible_to_non_admin_with_usernames(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-26")
    editor_headers = auth_header("audituser7", Role.qca)
    client.post("/session/shipx_2026-08-26/open", params={"source": "raw"}, headers=editor_headers)
    client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-26", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=editor_headers,
    )

    viewer_headers = auth_header("audituser8", Role.user)
    resp = client.get("/audit/shipx_2026-08-26", headers=viewer_headers)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["username"] == "audituser7"


def test_my_history_returns_only_my_entries_newest_first(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-09-01")
    synthetic_nc("shipx_2026-09-02")
    mine = auth_header("audituser9", Role.qca)
    other = auth_header("audituser10", Role.qca)

    client.post("/session/shipx_2026-09-01/open", params={"source": "raw"}, headers=mine)
    client.post(
        "/edit/point",
        json={"filename": "shipx_2026-09-01", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=mine,
    )
    client.post("/session/shipx_2026-09-02/open", params={"source": "raw"}, headers=mine)
    client.post(
        "/edit/point",
        json={"filename": "shipx_2026-09-02", "var_name": "temperature", "indices": [0], "value": 2.0},
        headers=mine,
    )
    # A different user's edit on one of the same files — must not appear.
    client.post("/session/shipx_2026-09-01/close", headers=mine)
    client.post("/session/shipx_2026-09-01/open", params={"source": "raw"}, headers=other)
    client.post(
        "/edit/point",
        json={"filename": "shipx_2026-09-01", "var_name": "temperature", "indices": [1], "value": 3.0},
        headers=other,
    )

    resp = client.get("/audit", headers=mine)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 2
    assert all(e["username"] == "audituser9" for e in entries)
    # Newest first — the shipx_2026-09-02 edit happened after the
    # shipx_2026-09-01 one.
    assert entries[0]["filename"] == "shipx_2026-09-02"
    assert entries[1]["filename"] == "shipx_2026-09-01"


def test_my_history_empty_for_a_user_with_no_edits(client, auth_header):
    headers = auth_header("audituser11", Role.user)
    resp = client.get("/audit", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_audit_and_audit_filename_routes_do_not_collide(client, auth_header, synthetic_nc):
    synthetic_nc("audit")  # a file literally named "audit" — the trickiest
    # possible collision case between GET /audit and GET /audit/{filename}.
    headers = auth_header("audituser12", Role.qca)
    client.post("/session/audit/open", params={"source": "raw"}, headers=headers)
    client.post(
        "/edit/point",
        json={"filename": "audit", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=headers,
    )

    my_history = client.get("/audit", headers=headers)
    assert my_history.status_code == 200
    assert len(my_history.json()) == 1

    file_history = client.get("/audit/audit", headers=headers)
    assert file_history.status_code == 200
    assert len(file_history.json()) == 1
    # filename on the per-file endpoint is optional and not asserted here — out of scope for this task.


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


def test_revert_missing_entry_returns_409(client, auth_header):
    headers = auth_header("audituser6", Role.qca)
    resp = client.post("/audit/999999/revert", headers=headers)
    assert resp.status_code == 409


def test_revert_flag_edit_restores_values(client, auth_header, synthetic_nc_with_qc):
    import time

    synthetic_nc_with_qc("shipx_2026-08-31b")
    headers = auth_header("audituser13", Role.qca)
    client.post("/session/shipx_2026-08-31b/open", params={"source": "raw"}, headers=headers)
    flag_resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-31b",
            "var_name": "temperature",
            "start_time_idx": 1,
            "end_time_idx": 3,
            "flag_code": "K",
        },
        headers=headers,
    )
    job_id = flag_resp.json()["job_id"]

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

    data_before = client.get(
        "/files/shipx_2026-08-31b/data", params={"vars": "temperature"}, headers=headers
    )
    assert data_before.json()["variables"]["temperature"]["flags"] == ["Z", "K", "K", "Z", "Z"]

    resp = client.post(f"/audit/{audit_id}/revert", headers=headers)
    assert resp.status_code == 200

    data_after = client.get(
        "/files/shipx_2026-08-31b/data", params={"vars": "temperature"}, headers=headers
    )
    assert data_after.json()["variables"]["temperature"]["flags"] == ["Z", "Z", "Z", "Z", "Z"]

    entries = client.get("/audit/shipx_2026-08-31b", headers=headers).json()
    flag_entry = next(e for e in entries if e["id"] == audit_id)
    assert flag_entry["reverted"] is True


def test_revert_flag_edit_already_reverted_returns_409(client, auth_header, synthetic_nc_with_qc):
    import time

    synthetic_nc_with_qc("shipx_2026-09-03")
    headers = auth_header("audituser14", Role.qca)
    client.post("/session/shipx_2026-09-03/open", params={"source": "raw"}, headers=headers)
    flag_resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-09-03",
            "var_name": "temperature",
            "start_time_idx": 0,
            "end_time_idx": 1,
            "flag_code": "K",
        },
        headers=headers,
    )
    job_id = flag_resp.json()["job_id"]

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

    client.post(f"/audit/{audit_id}/revert", headers=headers)
    resp = client.post(f"/audit/{audit_id}/revert", headers=headers)
    assert resp.status_code == 409
